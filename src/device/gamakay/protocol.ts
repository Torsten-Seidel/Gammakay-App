// Paketformat der Gamakay TK75 TMR (siehe docs/protocol.md).
// Bewusst ohne Imports, damit die Datei auch direkt mit `node --test` geprüft werden kann.

export const TK75_VENDOR_ID = 0x3151;
export const TK75_PRODUCT_ID = 0x5030;
/** Konfigurations-Interface: Feature-Report 0, 64 Byte */
export const CONFIG_USAGE_PAGE = 0xffff;
export const CONFIG_USAGE = 0x0002;
export const PACKET_SIZE = 64;

export const CMD = {
  GET_VERSION: 0x8f,
  GET_INFO: 0xad,
  GET_LED: 0x87,
  GET_SIDE_LED: 0x88,
  GET_SLEEP: 0x91,
  SET_LED: 0x07,
} as const;

/** 0xFF minus Summe der Bytes 0..end-1 (nur unteres Byte). */
export function checksum(bytes: ArrayLike<number>, end: number): number {
  let sum = 0;
  for (let i = 0; i < end; i++) sum += bytes[i];
  return (0xff - (sum & 0xff)) & 0xff;
}

/**
 * Baut ein 64-Byte-Paket.
 * `head` = Byte 0 (Befehl) und folgende Parameter bis vor die Prüfsumme.
 * Kurze Befehle: Prüfsumme in Byte 7. Befehle mit 7 Parameterbytes: Prüfsumme in Byte 8.
 */
export function makePacket(head: number[], checksumAt: 7 | 8, tail: number[] = []): Uint8Array {
  if (head.length > checksumAt) throw new Error('Kopfdaten überschreiten die Prüfsummen-Position');
  if (checksumAt + 1 + tail.length > PACKET_SIZE) throw new Error('Paket zu lang');
  const p = new Uint8Array(PACKET_SIZE);
  p.set(head.map((b) => b & 0xff));
  p[checksumAt] = checksum(p, checksumAt);
  p.set(tail.map((b) => b & 0xff), checksumAt + 1);
  return p;
}

/** Lesebefehl (≥ 0x80) ohne Parameter. */
export function readPacket(cmd: number): Uint8Array {
  if (cmd < 0x80) throw new Error(`0x${cmd.toString(16)} ist kein Lesebefehl`);
  return makePacket([cmd], 7);
}

// ---------- Licht ----------

/** Bytes 1..7 der Licht-Antwort: Modus, ?, Helligkeit, ?, R, G, B */
export interface LedState {
  raw: number[];
  mode: number;
  brightness: number;
  color: string;
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

export function decodeLed(res: ArrayLike<number>): LedState {
  const raw = Array.from({ length: 7 }, (_, i) => res[i + 1] ?? 0);
  return { raw, mode: raw[0], brightness: raw[2], color: `#${hex2(raw[4])}${hex2(raw[5])}${hex2(raw[6])}` };
}

export const BRIGHTNESS_MAX = 4;

/** Schreibpaket fürs Tastenlicht: übernimmt alle gelesenen Bytes und ändert nur die Helligkeit. */
export function ledBrightnessPacket(raw: number[], brightness: number): Uint8Array {
  if (raw.length !== 7) throw new Error('Licht-Rohdaten unvollständig');
  if (!Number.isInteger(brightness) || brightness < 0 || brightness > BRIGHTNESS_MAX) {
    throw new Error(`Helligkeit ${brightness} außerhalb 0–${BRIGHTNESS_MAX}`);
  }
  const body = [...raw];
  body[2] = brightness;
  return makePacket([CMD.SET_LED, ...body], 8);
}

// ---------- Energiesparen ----------

/** Vier 16-Bit-Werte (Little Endian) ab Byte 8, in Sekunden. Reihenfolge noch nicht sicher. */
export function decodeSleep(res: ArrayLike<number>): number[] {
  return [0, 1, 2, 3].map((i) => (res[8 + i * 2] ?? 0) | ((res[9 + i * 2] ?? 0) << 8));
}

// ---------- Geräteinfo ----------

export function decodeVersion(res: ArrayLike<number>): string {
  return Array.from({ length: 7 }, (_, i) => hex2(res[i + 1] ?? 0)).join(' ');
}

/** Längste druckbare ASCII-Folge in der Antwort, z. B. "RY5060RY50". */
export function decodeInfoName(res: ArrayLike<number>): string {
  let best = '';
  let cur = '';
  for (let i = 1; i < res.length; i++) {
    const b = res[i];
    if (b >= 0x20 && b < 0x7f) cur += String.fromCharCode(b);
    else {
      if (cur.length > best.length) best = cur;
      cur = '';
    }
  }
  return cur.length > best.length ? cur : best;
}
