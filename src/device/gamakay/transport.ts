import { log, toHex } from '../log';
import {
  BT_BATTERY_CMD, BT_DATA_PREFIX, BT_REPORT_ID, DONGLE_KEYBOARD, DONGLE_NOTICE_READ, DONGLE_SELECT, DONGLE_STATUS, PACKET_SIZE,
  decodeDongleStatus, readPacket, type DongleStatus,
} from './protocol';

const DONGLE_GAP_MS = 10; // GearHub: INTERVAL_24G_TIME
const DONGLE_POLL_MS = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RESPONSE_DELAY_MS = 12;
const MAX_POLLS = 10;
const AFTER_WRITE_MS = 2000;
const BT_TIMEOUT_MS = 1000;
const BT_SEND_TIMEOUT_MS = 3000;

function toBytes(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** Gemeinsame Schnittstelle für Kabel (Feature-Report 0) und Bluetooth (Report 6). */
export interface Transport {
  readonly device: HIDDevice;
  open(): Promise<void>;
  close(): Promise<void>;
  /** Lesebefehl senden; Antwort im USB-Format (Byte 0 = Befehl). */
  query(cmd: number): Promise<Uint8Array>;
  write(packet: Uint8Array): Promise<void>;
  /** Fertiges Lesepaket senden und die Antwort ungeprüft zurückgeben (Antworten ohne Befehls-Echo, z. B. `8A`/`E5`). */
  queryRaw(packet: Uint8Array): Promise<Uint8Array>;
  /** Akkustand in Prozent; null = nicht verfügbar (Kabel) oder keine Antwort (z. B. Ruhezustand). */
  readBattery(): Promise<number | null>;
}

/** Alle Zugriffe nacheinander, damit sich Befehl und Antwort nie überschneiden. */
abstract class QueuedTransport {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly device: HIDDevice) {}

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }

  protected enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.queue.then(job, job);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

/** Kabel: Feature-Report 0, 64 Byte. Jeder Befehl landet im Protokoll-Log. */
export class GamakayTransport extends QueuedTransport implements Transport {
  private lastWriteAt = 0;

  private async send(packet: Uint8Array): Promise<void> {
    log('out', `SET_FEATURE ${toHex(packet, 16)}`);
    await this.device.sendFeatureReport(0, packet as Uint8Array<ArrayBuffer>);
  }

  query(cmd: number): Promise<Uint8Array> {
    return this.enqueue(async () => {
      const packet = readPacket(cmd);
      await this.send(packet);
      // Kurz nach einem Schreibbefehl (z. B. Magnetschalter) ist die Tastatur noch beschäftigt und liefert nur
      // unsere Anfrage zurück. Dann weiter warten. Aber: Manche echten Antworten sehen genauso aus
      // (z. B. 83 bei 8000 Hz = lauter Nullen) – darum nur direkt nach dem Schreiben, und zur Not doch annehmen.
      const afterWrite = Date.now() - this.lastWriteAt < AFTER_WRITE_MS;
      let last: Uint8Array | null = null;
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        await sleep(RESPONSE_DELAY_MS);
        const res = toBytes(await this.device.receiveFeatureReport(0));
        log('in', `GET_FEATURE ${toHex(res, 24)}`);
        if (res[0] !== cmd) continue;
        if (!afterWrite || !packet.every((b, i) => res[i] === b)) return res;
        last = res;
        await sleep(50);
      }
      if (last) return last;
      throw new Error(`Keine passende Antwort auf Befehl 0x${cmd.toString(16)}`);
    });
  }

  /** Schreibpaket senden (ohne Antwort, wie GearHub). */
  write(packet: Uint8Array): Promise<void> {
    return this.enqueue(async () => {
      await this.send(packet);
      this.lastWriteAt = Date.now();
      await sleep(40);
    });
  }

  queryRaw(packet: Uint8Array): Promise<Uint8Array> {
    return this.enqueue(async () => {
      await this.send(packet);
      await sleep(RESPONSE_DELAY_MS);
      const res = toBytes(await this.device.receiveFeatureReport(0));
      log('in', `GET_FEATURE ${toHex(res, 24)}`);
      return res;
    });
  }

  /** Per Kabel lädt die Tastatur; GearHub liest hier keinen Akkustand. */
  async readBattery(): Promise<null> {
    return null;
  }
}

/**
 * 2,4-GHz-Empfänger: Feature-Report 0 wie per Kabel, aber der Empfänger leitet weiter.
 * Senden: per `F7` warten bis „kann senden“ → einmalig `F6 0A` (Tastatur wählen) → Paket.
 * Lesen: danach per `F7` warten bis „kann lesen“ → `FC` → Antwort abholen. Akku steht in der `F7`-Antwort.
 */
export class DongleTransport extends QueuedTransport implements Transport {
  private keyboardSelected = false;

  private async sendRaw(bytes: number[] | Uint8Array, quiet = false): Promise<void> {
    const p = new Uint8Array(PACKET_SIZE);
    p.set(bytes);
    if (!quiet) log('out', `SET_FEATURE ${toHex(p, 16)}`);
    await this.device.sendFeatureReport(0, p);
  }

  private async receive(quiet = false): Promise<Uint8Array> {
    const res = toBytes(await this.device.receiveFeatureReport(0));
    if (!quiet) log('in', `GET_FEATURE ${toHex(res, 24)}`);
    return res;
  }

  private async status(): Promise<DongleStatus> {
    await sleep(DONGLE_GAP_MS);
    await this.sendRaw([DONGLE_STATUS], true);
    await sleep(DONGLE_GAP_MS);
    return decodeDongleStatus(await this.receive(true));
  }

  private async waitFor(flag: 'canSend' | 'canRead'): Promise<void> {
    // Nach einem Moduswechsel braucht die Tastatur über Funk länger als GearHubs 5 × 100 ms → bis ca. 2,5 s warten.
    // Sofort nachsehen und dann in kurzen Abständen: feste 100 ms vor jeder Abfrage machten das Lesen sehr langsam.
    const until = Date.now() + 2500;
    do {
      if ((await this.status())[flag]) return;
      await sleep(DONGLE_POLL_MS);
    } while (Date.now() < until);
    throw new Error(flag === 'canSend'
      ? 'Tastatur über den Empfänger nicht erreichbar (ausgeschaltet oder im Ruhezustand?)'
      : 'Keine Antwort der Tastatur über den Empfänger');
  }

  private async sendToKeyboard(packet: Uint8Array): Promise<void> {
    await this.waitFor('canSend');
    if (!this.keyboardSelected) {
      await sleep(DONGLE_GAP_MS);
      await this.sendRaw([DONGLE_SELECT, DONGLE_KEYBOARD]);
      this.keyboardSelected = true;
    }
    await sleep(DONGLE_GAP_MS);
    await this.sendRaw(packet);
  }

  query(cmd: number): Promise<Uint8Array> {
    return this.enqueue(async () => {
      await this.sendToKeyboard(readPacket(cmd));
      await this.waitFor('canRead');
      await sleep(DONGLE_GAP_MS);
      await this.sendRaw([DONGLE_NOTICE_READ]);
      await sleep(DONGLE_GAP_MS);
      const res = await this.receive();
      if (res[0] !== cmd) throw new Error(`Keine passende Antwort auf Befehl 0x${cmd.toString(16)} (Empfänger)`);
      return res;
    });
  }

  queryRaw(packet: Uint8Array): Promise<Uint8Array> {
    return this.enqueue(async () => {
      await this.sendToKeyboard(packet);
      await this.waitFor('canRead');
      await sleep(DONGLE_GAP_MS);
      await this.sendRaw([DONGLE_NOTICE_READ]);
      await sleep(DONGLE_GAP_MS);
      return this.receive();
    });
  }

  write(packet: Uint8Array): Promise<void> {
    return this.enqueue(async () => {
      await this.sendToKeyboard(packet);
      await sleep(40);
    });
  }

  readBattery(): Promise<number | null> {
    return this.enqueue(async () => {
      const s = await this.status().catch(() => null);
      if (!s?.keyboard || !s.online) return null;
      log('in', `Empfänger: Akku ${s.battery} %`);
      return s.battery;
    });
  }
}

/**
 * Bluetooth: Output-/Input-Report 6 mit 65 Byte. Normale Befehle tragen das Präfix 0x55 vor dem
 * bekannten 64-Byte-Paket, die Antwort kommt mit demselben Präfix zurück. Akku: `77` → `77 <Prozent>`.
 */
export class BtTransport extends QueuedTransport implements Transport {
  private waiters: { match: (d: Uint8Array) => boolean; resolve: (d: Uint8Array) => void }[] = [];

  private readonly onInput = (e: HIDInputReportEvent) => {
    if (e.reportId !== BT_REPORT_ID) return;
    const data = toBytes(e.data);
    const i = this.waiters.findIndex((w) => w.match(data));
    if (i < 0) return;
    log('in', `IN #6 ${toHex(data, 24)}`);
    this.waiters.splice(i, 1)[0].resolve(data);
  };

  async open(): Promise<void> {
    await super.open();
    this.device.addEventListener('inputreport', this.onInput);
  }

  async close(): Promise<void> {
    this.device.removeEventListener('inputreport', this.onInput);
    this.waiters = [];
    await super.close();
  }

  private async send(body: number[] | Uint8Array): Promise<void> {
    const out = new Uint8Array(PACKET_SIZE + 1);
    out.set(body);
    log('out', `OUT #6 ${toHex(out, 16)}`);
    // Ist die Bluetooth-Verbindung weg, kehrt sendReport nie zurück (beobachtet 2026-11-27) → nicht ewig warten.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.device.sendReport(BT_REPORT_ID, out),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(
            'Bluetooth-Verbindung unterbrochen – Taste drücken, damit die Tastatur aufwacht, dann neu verbinden.')), BT_SEND_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Senden und auf die erste passende Antwort warten (null bei Zeitüberschreitung). */
  private request(body: number[] | Uint8Array, match: (d: Uint8Array) => boolean): Promise<Uint8Array | null> {
    return this.enqueue(async () => {
      let waiter!: (typeof this.waiters)[number];
      const answer = new Promise<Uint8Array>((resolve) => {
        waiter = { match, resolve };
        this.waiters.push(waiter);
      });
      try {
        await this.send(body);
        return await Promise.race([answer, sleep(BT_TIMEOUT_MS).then(() => null)]);
      } finally {
        this.waiters = this.waiters.filter((w) => w !== waiter);
      }
    });
  }

  async query(cmd: number): Promise<Uint8Array> {
    const res = await this.request([BT_DATA_PREFIX, ...readPacket(cmd)], (d) => d[0] === BT_DATA_PREFIX && d[1] === cmd);
    if (!res) throw new Error(`Keine Antwort auf Befehl 0x${cmd.toString(16)} (Bluetooth)`);
    return res.slice(1); // ohne Präfix = USB-Format
  }

  async queryRaw(packet: Uint8Array): Promise<Uint8Array> {
    const res = await this.request([BT_DATA_PREFIX, ...packet], (d) => d[0] === BT_DATA_PREFIX);
    if (!res) throw new Error(`Keine Antwort auf Befehl 0x${packet[0].toString(16)} (Bluetooth)`);
    return res.slice(1);
  }

  write(packet: Uint8Array): Promise<void> {
    return this.enqueue(async () => {
      await this.send([BT_DATA_PREFIX, ...packet]);
      await sleep(100); // GearHub wartet über Bluetooth länger (SEND_TIME 100 ms)
    });
  }

  async readBattery(): Promise<number | null> {
    const res = await this.request([BT_BATTERY_CMD], (d) => d[0] === BT_BATTERY_CMD);
    if (!res) return null;
    return Math.min(100, res[1]);
  }
}
