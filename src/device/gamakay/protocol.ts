// Paketformat der Gamakay TK75 TMR (siehe docs/protocol.md).
// Bewusst ohne Imports, damit die Datei auch direkt mit `node --test` geprüft werden kann.

export const TK75_VENDOR_ID = 0x3151;
export const TK75_PRODUCT_ID = 0x5030;
/** Konfigurations-Interface: Feature-Report 0, 64 Byte */
export const CONFIG_USAGE_PAGE = 0xffff;
export const CONFIG_USAGE = 0x0002;
export const PACKET_SIZE = 64;

/** Bluetooth (Mitschnitt 7): eigene Produkt-ID, Vendor-Interface 0xff55/0x0202, Output-/Input-Report 6 (65 Byte). */
export const TK75_BT_PRODUCT_ID = 0x5027;
export const BT_USAGE_PAGE = 0xff55;
export const BT_USAGE = 0x0202;
export const BT_REPORT_ID = 6;
/** Präfix vor jedem normalen Befehl über Bluetooth */
export const BT_DATA_PREFIX = 0x55;
/** Akku-Abfrage über Bluetooth: `77` → Antwort `77 <Prozent> …` */
export const BT_BATTERY_CMD = 0x77;

/** 2,4-GHz-Empfänger (Mitschnitt 8): eigene Produkt-ID, Konfig-Interface wie per Kabel (0xffff/0x0002, Feature 0). */
export const TK75_DONGLE_PRODUCT_ID = 0x5038;
/** Status: Antwort `kannLesen | Akku Tastatur | Akku Maus | offline Tastatur | offline Maus | kannSenden | Typ | ? | RF-Boot` */
export const DONGLE_STATUS = 0xf7;
/** Zielgerät wählen: `F6 0A` = Tastatur */
export const DONGLE_SELECT = 0xf6;
export const DONGLE_KEYBOARD = 0x0a;
/** Antwort der Tastatur zum Abholen anfordern */
export const DONGLE_NOTICE_READ = 0xfc;

export const CMD = {
  GET_VERSION: 0x8f,
  GET_INFO: 0xad,
  GET_LED: 0x87,
  GET_SIDE_LED: 0x88,
  GET_SLEEP: 0x91,
  GET_REPORT_RATE: 0x83,
  SET_REPORT_RATE: 0x03,
  SET_LED: 0x07,
  SET_SIDE_LED: 0x08,
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

/**
 * Effektcodes für Byte 1 (Reihenfolge wie in GearHub). Mitschnitt 5, docs/protocol.md.
 * `options`: Richtungs-/Musteroptionen in Gerätereihenfolge (Index = oberes Halbbyte von Byte 4).
 */
export const LED_EFFECTS: { id: string; label: string; code: number; options?: string[] }[] = [
  { id: 'wave', label: 'Welle', code: 0x04, options: ['Nach rechts', 'Nach links', 'Nach unten', 'Nach oben'] },
  { id: 'ripple', label: 'Ripple', code: 0x05 },
  { id: 'starlight', label: 'Sternenlicht', code: 0x06 },
  { id: 'current', label: 'Strom', code: 0x07, options: ['Zickzack', 'Spirale'] },
  { id: 'shadow', label: 'Schatten', code: 0x08 },
  { id: 'mountain-wave', label: 'Berg Welle', code: 0x09 },
  { id: 'sine-wave', label: 'Sinuswelle', code: 0x0a },
  { id: 'kaleidoscope', label: 'Kaleidoskop', code: 0x0b, options: ['Nach außen', 'Nach innen'] },
  { id: 'snow-trail', label: 'Schneespur', code: 0x13 },
  { id: 'flower-wave', label: 'Blumenwelle', code: 0x0c, options: ['Nach rechts', 'Nach links'] },
  { id: 'laser', label: 'Laser', code: 0x0e },
  { id: 'circle-wave', label: 'Kreisende Welle', code: 0x0f, options: ['Gegen den Uhrzeigersinn', 'Im Uhrzeigersinn'] },
  { id: 'cross', label: 'Farbkreuz', code: 0x10 },
  { id: 'snowfall', label: 'Schneefall', code: 0x11 },
  { id: 'meteor', label: 'Meteor', code: 0x12 },
  { id: 'static', label: 'Immer an', code: 0x01 },
  { id: 'breathing', label: 'Dynamisches Atmen', code: 0x02 },
  { id: 'spectrum', label: 'Spektrum-Zyklus', code: 0x03 },
];

export const COLOR_MODE_SINGLE = 0x07;
export const COLOR_MODE_RAINBOW = 0x08;

/**
 * Bytes 1..7 der Licht-Antwort: Effekt, Tempo, Helligkeit, Option<<4 | Farbmodus, R, G, B.
 * `speed` ist der Rohwert: 0 = schnell, 4 = langsam (GearHub schreibt MAXSPEED − Tempo).
 */
export interface LedState {
  raw: number[];
  mode: number;
  speed: number;
  brightness: number;
  /** unteres Halbbyte von Byte 4 */
  colorMode: number;
  /** oberes Halbbyte von Byte 4: Richtung/Muster */
  option: number;
  color: string;
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

export function decodeLed(res: ArrayLike<number>): LedState {
  const raw = Array.from({ length: 7 }, (_, i) => res[i + 1] ?? 0);
  return {
    raw,
    mode: raw[0],
    speed: raw[1],
    brightness: raw[2],
    colorMode: raw[3] & 0x0f,
    option: raw[3] >> 4,
    color: `#${hex2(raw[4])}${hex2(raw[5])}${hex2(raw[6])}`,
  };
}

export const BRIGHTNESS_MAX = 4;
export const SPEED_MAX = 4;

/** App-Tempo (0 = langsam … 4 = schnell) ↔ Rohwert im Gerät (umgekehrt). */
export const speedToRaw = (speed: number) => SPEED_MAX - speed;
export const rawToSpeed = (raw: number) => SPEED_MAX - Math.min(SPEED_MAX, raw);

export interface LedWrite {
  /** Effektcode; nur Werte aus LED_EFFECTS oder der zuvor vom Gerät gelesene Code */
  mode: number;
  /** Rohwert (0 = schnell) */
  speed: number;
  brightness: number;
  rainbow: boolean;
  color: string;
  /** Richtung/Muster-Index (nur bei Effekten mit `options`), Standard 0 */
  option?: number;
}

function parseColor(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) throw new Error(`Ungültige Farbe ${color}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

const checkRange = (name: string, v: number, max: number) => {
  if (!Number.isInteger(v) || v < 0 || v > max) throw new Error(`${name} ${v} außerhalb 0–${max}`);
};

/** Komplettes Schreibpaket fürs Tastenlicht. */
export function ledPacket(w: LedWrite, allowedModes: number[] = LED_EFFECTS.map((e) => e.code)): Uint8Array {
  if (!allowedModes.includes(w.mode)) throw new Error(`Effektcode 0x${hex2(w.mode)} ist nicht freigegeben`);
  checkRange('Tempo', w.speed, SPEED_MAX);
  checkRange('Helligkeit', w.brightness, BRIGHTNESS_MAX);
  const option = w.option ?? 0;
  const optionCount = LED_EFFECTS.find((e) => e.code === w.mode)?.options?.length ?? 1;
  checkRange('Option', option, optionCount - 1);
  // Wie GearHub: reines Weiß wird als #fafffa geschickt.
  const [r, g, b] = parseColor(w.color.toLowerCase() === '#ffffff' ? '#fafffa' : w.color);
  const colorByte = (option << 4) | (w.rainbow ? COLOR_MODE_RAINBOW : COLOR_MODE_SINGLE);
  return makePacket([CMD.SET_LED, w.mode, w.speed, w.brightness, colorByte, r, g, b], 8);
}

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

// ---------- Seitenlicht ----------

/**
 * Effektcodes fürs Seitenlicht (Mitschnitt 6, docs/protocol.md) – eigene Codes, nicht die des Tastenlichts.
 * Keine Richtungsoptionen.
 */
export const SIDE_LED_EFFECTS: { id: string; label: string; code: number; rainbowOnly?: boolean }[] = [
  { id: 'wave', label: 'Welle', code: 0x04 },
  { id: 'snake', label: 'Schlange', code: 0x05 },
  { id: 'off', label: 'Aus', code: 0x00 },
  { id: 'static', label: 'Immer an', code: 0x01 },
  { id: 'breathing', label: 'Atmung', code: 0x02 },
  // Farbwechsel-Effekt: ignoriert die Farbe, GearHub schickt immer „bunt“.
  { id: 'neon', label: 'Neon', code: 0x03, rainbowOnly: true },
];

/** Seitenlicht-Tempo: 0 = langsam … 3 = schnell, wird NICHT umgekehrt übertragen. */
export const SIDE_SPEED_MAX = 3;

export interface SideLedWrite {
  mode: number;
  /** 0 = langsam … 3 = schnell (direkt der Rohwert) */
  speed: number;
  brightness: number;
  rainbow: boolean;
  color: string;
}

/** Schreibpaket fürs Seitenlicht: `08 | Effekt | Tempo | Helligkeit | Farbmodus | R G B | Prüfsumme`. */
export function sideLedPacket(w: SideLedWrite): Uint8Array {
  if (!SIDE_LED_EFFECTS.some((e) => e.code === w.mode)) throw new Error(`Seitenlicht-Effekt 0x${hex2(w.mode)} ist nicht freigegeben`);
  checkRange('Tempo', w.speed, SIDE_SPEED_MAX);
  checkRange('Helligkeit', w.brightness, BRIGHTNESS_MAX);
  const [r, g, b] = parseColor(w.color.toLowerCase() === '#ffffff' ? '#fafffa' : w.color);
  // Wie GearHub: „Aus“ mit Tempo/Helligkeit 0 und Farbmodus „eine Farbe“.
  if (w.mode === 0x00) return makePacket([CMD.SET_SIDE_LED, 0, 0, 0, COLOR_MODE_SINGLE, r, g, b], 8);
  const rainbowOnly = SIDE_LED_EFFECTS.find((e) => e.code === w.mode)?.rainbowOnly;
  const colorByte = w.rainbow || rainbowOnly ? COLOR_MODE_RAINBOW : COLOR_MODE_SINGLE;
  return makePacket([CMD.SET_SIDE_LED, w.mode, w.speed, w.brightness, colorByte, r, g, b], 8);
}

// ---------- 2,4-GHz-Empfänger ----------

/** Status des 2,4-GHz-Empfängers aus der `F7`-Antwort (nur der Tastatur-Teil). */
export interface DongleStatus {
  keyboard: boolean;
  canRead: boolean;
  canSend: boolean;
  online: boolean;
  battery: number;
}

export function decodeDongleStatus(res: ArrayLike<number>): DongleStatus {
  const type = res[6];
  const keyboard = type === 1 || type === 3;
  return {
    keyboard,
    canRead: keyboard && res[0] === 1,
    canSend: keyboard && res[5] === 1,
    online: keyboard && res[3] === 0,
    battery: Math.min(100, res[1] ?? 0),
  };
}

// ---------- Polling-Rate ----------

/** Polling-Raten in Hz, Index = Stufe im Gerät (GearHub setReportRate/getReportRate) */
export const POLLING_RATES = [8000, 4000, 2000, 1000, 500, 250, 125];

/** Antwort auf `83`: Byte 2 = Stufe. undefined bei unbekanntem Wert. */
export function decodeReportRate(res: ArrayLike<number>): number | undefined {
  return POLLING_RATES[res[2]];
}

/** Schreibpaket `03 00 <Stufe> 00 00 00 00 <Prüfsumme>` */
export function reportRatePacket(rate: number): Uint8Array {
  const index = POLLING_RATES.indexOf(rate);
  if (index < 0) throw new Error(`Polling-Rate ${rate} Hz wird nicht unterstützt`);
  return makePacket([CMD.SET_REPORT_RATE, 0, index], 7);
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
