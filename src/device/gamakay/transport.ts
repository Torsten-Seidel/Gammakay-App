import { log, toHex } from '../log';
import { readPacket } from './protocol';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RESPONSE_DELAY_MS = 12;
const MAX_POLLS = 5;

function toBytes(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/**
 * Feature-Report-0-Kanal der TK75. Alle Zugriffe laufen nacheinander (Warteschlange),
 * damit sich Befehl und Antwort nie überschneiden. Jeder Befehl landet im Protokoll-Log.
 */
export class GamakayTransport {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly device: HIDDevice) {}

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.queue.then(job, job);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async send(packet: Uint8Array): Promise<void> {
    log('out', `SET_FEATURE ${toHex(packet, 16)}`);
    await this.device.sendFeatureReport(0, packet as Uint8Array<ArrayBuffer>);
  }

  /** Lesebefehl senden und auf die passende Antwort warten. */
  query(cmd: number): Promise<Uint8Array> {
    return this.enqueue(async () => {
      await this.send(readPacket(cmd));
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        await sleep(RESPONSE_DELAY_MS);
        const res = toBytes(await this.device.receiveFeatureReport(0));
        log('in', `GET_FEATURE ${toHex(res, 24)}`);
        if (res[0] === cmd) return res;
      }
      throw new Error(`Keine passende Antwort auf Befehl 0x${cmd.toString(16)}`);
    });
  }

  /** Schreibpaket senden (ohne Antwort, wie GearHub). */
  write(packet: Uint8Array): Promise<void> {
    return this.enqueue(async () => {
      await this.send(packet);
      await sleep(40);
    });
  }
}
