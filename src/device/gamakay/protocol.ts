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
  SET_SLEEP: 0x11,
  GET_KEYMATRIX: 0x8a,
  SET_KEYMATRIX: 0x0a,
  GET_FN: 0x90,
  SET_FN: 0x10,
  GET_MULTI_MAGNETISM: 0xe5,
  SET_MULTI_MAGNETISM: 0x65,
  GET_MACRO: 0x8b,
  SET_MACRO: 0x0b,
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

/**
 * Feste Farbliste der Tastatur (GearHub `COMMONCOLOR`): Farbmodus 0–6 wählt eine dieser Farben, die RGB-Bytes
 * bleiben dann auf der zuletzt eigenen Farbe stehen. Kommt z. B. über Fn+Zurück (Seitenlicht-Farbe wechseln).
 */
export const PRESET_COLORS = ['#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff'];

export function decodeLed(res: ArrayLike<number>): LedState {
  const raw = Array.from({ length: 7 }, (_, i) => res[i + 1] ?? 0);
  const colorMode = raw[3] & 0x0f;
  return {
    raw,
    mode: raw[0],
    speed: raw[1],
    brightness: raw[2],
    colorMode,
    option: raw[3] >> 4,
    color: PRESET_COLORS[colorMode] ?? `#${hex2(raw[4])}${hex2(raw[5])}${hex2(raw[6])}`,
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

// ---------- Tastenmatrix & Magnetschalter (nur Lesen) ----------

/** 128 Matrix-Plätze; jeder Platz 4 Byte in der Tastenmatrix, 2 Byte (LE) je Wert bei den Magnet-Daten. */
export const MATRIX_SLOTS = 128;
/** Rohwert ↔ mm: Firmware 0x0403 → GearHub-Faktor 100 (0,01 mm). */
export const TRAVEL_STEP = 100;

/** `8A <Profil> FF <Seite> <Fn-Ebene>` – 8 Seiten à 64 Byte = 128 × 4 Byte (GearHub _getKeyMatrix). */
export function keyMatrixReadPacket(profile: number, page: number, fnLayer = 0): Uint8Array {
  return makePacket([CMD.GET_KEYMATRIX, profile, 0xff, page, fnLayer], 7);
}

/**
 * `E5 <Art> 01 <Seite>` (GearHub _getMulitMagnetismCMD). Arten: 0 Auslösepunkt, 1 Rückstellpunkt,
 * 2/3 Rapid Trigger Drücken/Loslassen, 6 untere Totzone, 7 Tastenmodus (1 Byte/Taste), 251 obere Totzone (1 Byte/Taste).
 */
export function magnetismReadPacket(kind: number, page: number): Uint8Array {
  return makePacket([CMD.GET_MULTI_MAGNETISM, kind, 1, page], 7);
}

export const MAGNETISM = {
  travel: 0,
  release: 1,
  rtPress: 2,
  rtRelease: 3,
  deadzoneBottom: 6,
  modes: 7,
  deadzoneTop: 251,
} as const;

export function decodeU16List(bytes: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) out.push(bytes[i] | (bytes[i + 1] << 8));
  return out;
}

/** Tastenmodus-Byte: Bit 7 = Rapid Trigger, Rest = Modus (0 normal, 2 DKS, 3 MT, 4/5 Toggle, 7 Snap Tap). */
export function decodeKeyMode(b: number): { mode: number; rapidTrigger: boolean } {
  return { mode: b & 0x7f, rapidTrigger: (b & 0x80) !== 0 };
}

/** HID-Usage (Tastatur-Seite) → KeyboardEvent.code, wie die App Tasten benennt. */
const HID_TO_CODE: Record<number, string> = (() => {
  const m: Record<number, string> = {};
  for (let i = 0; i < 26; i++) m[4 + i] = `Key${String.fromCharCode(65 + i)}`;
  for (let i = 0; i < 9; i++) m[30 + i] = `Digit${i + 1}`;
  m[39] = 'Digit0';
  for (let i = 0; i < 12; i++) m[58 + i] = `F${i + 1}`;
  Object.assign(m, {
    40: 'Enter', 41: 'Escape', 42: 'Backspace', 43: 'Tab', 44: 'Space', 45: 'Minus', 46: 'Equal',
    47: 'BracketLeft', 48: 'BracketRight', 49: 'Backslash', 50: 'Backslash', 51: 'Semicolon', 52: 'Quote',
    53: 'Backquote', 54: 'Comma', 55: 'Period', 56: 'Slash', 57: 'CapsLock', 70: 'PrintScreen', 71: 'ScrollLock',
    72: 'Pause', 73: 'Insert', 74: 'Home', 75: 'PageUp', 76: 'Delete', 77: 'End', 78: 'PageDown', 79: 'ArrowRight',
    80: 'ArrowLeft', 81: 'ArrowDown', 82: 'ArrowUp', 100: 'IntlBackslash', 101: 'ContextMenu',
    224: 'ControlLeft', 225: 'ShiftLeft', 226: 'AltLeft', 227: 'MetaLeft', 228: 'ControlRight', 229: 'ShiftRight',
    230: 'AltRight', 231: 'MetaRight',
    83: 'NumLock', 84: 'NumpadDivide', 85: 'NumpadMultiply', 86: 'NumpadSubtract', 87: 'NumpadAdd', 88: 'NumpadEnter',
    89: 'Numpad1', 90: 'Numpad2', 91: 'Numpad3', 92: 'Numpad4', 93: 'Numpad5', 94: 'Numpad6', 95: 'Numpad7',
    96: 'Numpad8', 97: 'Numpad9', 98: 'Numpad0', 99: 'NumpadDecimal',
  });
  return m;
})();

/** Matrix (512 Byte) → Taste je Platz. Normale Taste: `00 00 <HID> 00`; Fn: `0A 01 00 00`. */
export function decodeKeyMatrix(bytes: ArrayLike<number>): (string | undefined)[] {
  const slots: (string | undefined)[] = [];
  for (let i = 0; i < MATRIX_SLOTS; i++) {
    const [t, a, code, b] = [bytes[i * 4], bytes[i * 4 + 1], bytes[i * 4 + 2], bytes[i * 4 + 3]];
    if (t === 10 && a === 1 && code === 0 && b === 0) slots.push('Fn');
    else if (t === 0 && a === 0 && b === 0 && code) slots.push(HID_TO_CODE[code]);
    else slots.push(undefined);
  }
  return slots;
}

// ---------- Tastenbelegung (0A schreiben, 8A lesen) ----------

/**
 * Werks-Matrix der TK75 (Basis-Ebene, aus dem Gerät gelesen am 2026-11-27): Platz → 4 Byte.
 * Dient als feste Zuordnung Platz ↔ physische Taste (wie GearHub `defaultMatrix`), denn die aktuelle Matrix
 * enthält Umbelegungen. 90–92 und 96–98 gehören zum Drehknopf.
 */
export const TK75_DEFAULT_MATRIX: readonly (readonly number[])[] = (() => {
  const m: number[][] = Array.from({ length: MATRIX_SLOTS }, () => [0, 0, 0, 0]);
  const hid =
    '0:41 1:53 2:43 3:57 4:225 5:224 6:58 7:30 8:20 9:4 10:100 11:227 12:59 13:31 14:26 15:22 16:29 17:226 ' +
    '18:60 19:32 20:8 21:7 22:27 24:61 25:33 26:21 27:9 28:6 30:62 31:34 32:23 33:10 34:25 36:63 37:35 38:28 ' +
    '39:11 40:5 41:44 42:64 43:36 44:24 45:13 46:17 48:65 49:37 50:12 51:14 52:16 54:66 55:38 56:18 57:15 ' +
    '58:54 59:230 60:67 61:39 62:19 63:51 64:55 66:68 67:45 68:47 69:52 70:56 71:228 72:69 73:46 74:48 ' +
    '76:229 77:80 78:76 79:42 80:40 81:50 82:82 83:81 85:74 86:75 87:78 89:79';
  for (const pair of hid.split(' ')) {
    const [slot, code] = pair.split(':').map(Number);
    m[slot] = [0, 0, code, 0];
  }
  m[65] = [10, 1, 0, 0]; // Fn
  m[90] = [3, 0, 234, 0]; // Drehknopf: leiser
  m[91] = [3, 0, 233, 0]; // lauter
  m[92] = [3, 0, 205, 0]; // Play/Pause (Drücken)
  m[96] = [19, 1, 0, 0];
  m[97] = [19, 1, 1, 0];
  m[98] = [19, 1, 3, 0];
  return m;
})();

/**
 * Werks-Fn-Ebene (Windows, System 0), gelesen am 2026-11-27. Leere Plätze = auf der Fn-Ebene unbelegt.
 * Enthält u. a. Fn+Esc = Reset (`0a 02`) – die App bietet Reset nicht als Funktion an.
 */
export const TK75_DEFAULT_FN_MATRIX: readonly (readonly number[])[] = (() => {
  const m: number[][] = Array.from({ length: MATRIX_SLOTS }, () => [0, 0, 0, 0]);
  const raw =
    '0:10,2,0,0 6:3,0,131,1 7:14,0,0,0 11:10,3,0,0 12:3,0,234,0 13:14,0,1,0 16:8,0,4,0 18:3,0,233,0 19:14,0,2,0 ' +
    '22:8,0,4,1 24:3,0,226,0 25:14,0,5,0 28:8,0,4,2 30:3,0,182,0 31:14,0,6,0 36:3,0,181,0 38:0,0,70,0 39:0,0,72,0 ' +
    '41:10,8,0,0 42:3,0,205,0 44:0,0,71,0 45:0,0,73,0 46:0,0,77,0 48:3,0,183,0 54:3,0,138,1 60:3,0,35,2 66:3,0,148,1 ' +
    '72:3,0,146,1 77:13,3,2,0 78:19,2,0,0 79:13,5,1,0 80:10,12,0,0 81:13,1,0,0 82:13,2,1,0 83:13,2,2,0 85:10,24,0,0 ' +
    '89:13,3,1,0 92:19,3,0,0 98:19,3,0,0';
  for (const pair of raw.split(' ')) {
    const [slot, bytes] = pair.split(':');
    m[Number(slot)] = bytes.split(',').map(Number);
  }
  return m;
})();

export type MatrixLayer = 'base' | 'fn';
const defaultEntry = (slot: number, layer: MatrixLayer) =>
  (layer === 'fn' ? TK75_DEFAULT_FN_MATRIX : TK75_DEFAULT_MATRIX)[slot];

/** Platz → physische Taste (fest, aus der Werks-Matrix). */
export const TK75_SLOTS: readonly (string | undefined)[] = decodeKeyMatrix(TK75_DEFAULT_MATRIX.flat());

/** Drehknopf: eigene Plätze ohne Magnetschalter (nur Belegung). 96–98 (`13 01 …`) bleiben unangetastet. */
export const TK75_KNOB_SLOTS: Record<string, number> = { KnobLeft: 90, KnobRight: 91, KnobPress: 92 };

/** Alle belegbaren Plätze: Tasten + Drehknopf. */
export const TK75_KEYMAP_SLOTS: readonly (string | undefined)[] = TK75_SLOTS.map((key, slot) =>
  key ?? Object.entries(TK75_KNOB_SLOTS).find(([, s]) => s === slot)?.[0]);

/** KeyboardEvent.code → HID-Usage. Bei doppelter Belegung (49/50 = Backslash) gilt der Wert der Werks-Matrix. */
const CODE_TO_HID: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (const [hid, code] of Object.entries(HID_TO_CODE)) m[code] ??= Number(hid);
  TK75_SLOTS.forEach((code, slot) => {
    if (code && code !== 'Fn') m[code] = TK75_DEFAULT_MATRIX[slot][2];
  });
  return m;
})();

/** Funktionen (GearHub-Tabelle `jy`): Medien = Consumer-Usage (LE), Licht 13, Verbindung 14, Profil 8, System 10. */
export const FUNCTION_CODES: Record<string, readonly number[]> = {
  'media.mute': [3, 0, 226, 0],
  'media.volDown': [3, 0, 234, 0],
  'media.volUp': [3, 0, 233, 0],
  'media.playPause': [3, 0, 205, 0],
  'media.prev': [3, 0, 182, 0],
  'media.next': [3, 0, 181, 0],
  'light.toggle': [13, 0, 0, 0],
  'light.nextEffect': [13, 1, 1, 0],
  'light.brightUp': [13, 2, 1, 0],
  'light.brightDown': [13, 2, 2, 0],
  'light.speedUp': [13, 3, 1, 0],
  'light.speedDown': [13, 3, 2, 0],
  'light.nextColor': [13, 5, 1, 0],
  'light.target': [10, 24, 0, 0], // in GearHub ohne Namen; schaltet die Licht-Kürzel zwischen Tasten- und Seitenlicht um
  'conn.usb': [14, 0, 6, 0],
  'conn.24g': [14, 0, 5, 0],
  'conn.bt1': [14, 0, 0, 0],
  'conn.bt2': [14, 0, 1, 0],
  'conn.bt3': [14, 0, 2, 0],
  'sys.profileNext': [8, 0, 3, 0],
  'sys.winLock': [10, 3, 0, 0],
};

/** Belegung eines Platzes (Modell) → 4 Byte. `default` = Werksbelegung dieses Platzes auf dieser Ebene. */
export function encodeKeyAction(
  action: KeyActionLike, slot: number, layer: MatrixLayer = 'base',
  /** Makro-ID → Speicherplatz und Wiedergabe (nur für Makro-Belegungen nötig) */
  macro?: (id: string) => { slot: number; playback: MacroPlaybackLike } | undefined,
): number[] {
  const hid = (code: string) => {
    const h = CODE_TO_HID[code];
    if (h === undefined) throw new Error(`Taste ${code} ist auf der TK75 nicht belegbar`);
    return h;
  };
  switch (action.kind) {
    case 'default': return [...defaultEntry(slot, layer)];
    case 'disabled': return [0, 0, 0, 0];
    case 'key': return action.code === 'Fn' ? [10, 1, 0, 0] : [0, 0, hid(action.code), 0];
    case 'combo': {
      const c = action.codes.map(hid);
      if (c.length < 1 || c.length > 3) throw new Error('Eine Kombination hat 1 bis 3 Tasten');
      return c.length === 1 ? [0, 0, c[0], 0] : [0, c[0], c[1], c[2] ?? 0];
    }
    case 'function': {
      const f = FUNCTION_CODES[action.fn];
      if (!f) throw new Error(`Funktion ${action.fn} wird von der TK75 noch nicht unterstützt`);
      return [...f];
    }
    case 'macro': {
      const m = macro?.(action.macroId);
      if (!m) throw new Error('Das zugewiesene Makro gibt es nicht mehr');
      return macroBindingEntry(m.slot, m.playback);
    }
    default: throw new Error(`${(action as { kind: string }).kind} kann noch nicht auf die Tastatur geschrieben werden`);
  }
}

/** 4 Byte → Belegung (Modell). `null` = unbekannt (wird nicht angezeigt und nicht überschrieben). */
export function decodeKeyAction(entry: ArrayLike<number>, slot: number, layer: MatrixLayer = 'base'): KeyActionLike | null {
  const e = Array.from(entry).slice(0, 4);
  const same = (a: readonly number[]) => a.every((b, i) => b === e[i]);
  if (same(defaultEntry(slot, layer))) return { kind: 'default' };
  if (same([0, 0, 0, 0])) return { kind: 'disabled' };
  if (same([10, 1, 0, 0])) return { kind: 'key', code: 'Fn' };
  const fn = Object.entries(FUNCTION_CODES).find(([, v]) => same(v));
  if (fn) return { kind: 'function', fn: fn[0] };
  if (e[0] !== 0) return null;
  const codes = e.slice(1).filter((b) => b).map((b) => HID_TO_CODE[b]);
  if (codes.some((c) => !c)) return null;
  if (e[1] === 0 && e[3] === 0) return { kind: 'key', code: codes[0] };
  return { kind: 'combo', codes };
}

/** Deutsche Namen für Sonderbelegungen, die die App (noch) nicht als Funktion anbietet (nur zur Anzeige). */
const RAW_LABELS: Record<string, string> = {
  '10,2,0,0': 'Reset',
  '10,3,0,0': 'Win-Sperre',
  '10,8,0,0': 'Akkustand',
  '10,12,0,0': 'Energiesparen',
  '3,0,131,1': 'Medienplayer',
  '3,0,183,0': 'Stopp',
  '3,0,138,1': 'Mail',
  '3,0,35,2': 'Browser',
  '3,0,148,1': 'Arbeitsplatz',
  '3,0,146,1': 'Rechner',
  '8,0,4,0': 'Profil 1',
  '8,0,4,1': 'Profil 2',
  '8,0,4,2': 'Profil 3',
  '13,1,0,0': 'Effekt wechseln',
  '19,2,0,0': 'Display wechseln',
};

/**
 * Anzeige einer rohen Belegung: `{ code }` für eine normale Taste (die Oberfläche beschriftet sie je Layout),
 * `{ fn }` für eine bekannte Funktion, `{ label }` für Sonderbelegungen; null = unbekannt oder leer.
 */
export function describeRawEntry(entry: ArrayLike<number>): { code?: string; fn?: string; label?: string } | null {
  const e = Array.from(entry).slice(0, 4);
  if (e.every((b) => b === 0)) return null;
  const fn = Object.entries(FUNCTION_CODES).find(([, v]) => v.every((b, i) => b === e[i]));
  if (fn) return { fn: fn[0] };
  const label = RAW_LABELS[e.join(',')];
  if (label) return { label };
  if (e[0] === 0 && e[1] === 0 && e[3] === 0 && HID_TO_CODE[e[2]]) return { code: HID_TO_CODE[e[2]] };
  return null;
}

/** Struktur wie KeyAction im Modell (protocol.ts bleibt importfrei). */
export type KeyActionLike =
  | { kind: 'default' }
  | { kind: 'key'; code: string }
  | { kind: 'combo'; codes: string[] }
  | { kind: 'function'; fn: string }
  | { kind: 'macro'; macroId: string }
  | { kind: 'disabled' };

// ---------- Makros (8B lesen, 0B schreiben; GearHub getMacro/_setMacro/buffToMacroEvents/macroEventToByte) ----------

export type MacroPlaybackLike = 'once' | 'repeat' | 'while-held' | 'toggle';
export type MacroStepLike = { type: 'down' | 'up'; code: string } | { type: 'delay'; ms: number };

/** Makro-Speicherplätze (GearHub `maxMacro`) und Datengröße je Makro (4 Leseseiten à 64 Byte). */
export const MACRO_SLOTS = 50;
export const MACRO_BYTES = 256;
const MACRO_WRITE_CHUNK = 56;
const MACRO_READ_PAGES = 4;
/** Abstand, wenn zwei Ereignisse ohne Pause aufeinander folgen (das Gerät braucht nach jedem Ereignis eine Pause). */
export const MACRO_DEFAULT_GAP_MS = 10;
const MACRO_MAX_DELAY = 0xffff;
/** Maustasten im Makro (GearHub `zn`: Links f0, Rechts f1, Mitte f2, Zurück f3, Vor f4). */
const MOUSE_HID: Record<string, number> = { MouseLeft: 0xf0, MouseRight: 0xf1, MouseMiddle: 0xf2, MouseBack: 0xf3, MouseForward: 0xf4 };
const HID_MOUSE: Record<number, string> = Object.fromEntries(Object.entries(MOUSE_HID).map(([c, h]) => [h, c]));
const MOUSE_MOVE = 0xf9;

/** Wiedergabeart in der Belegung `09 <Art> <Platz> 00`: 0 Anzahl, 1 Start/Stopp, 2 solange gedrückt. */
const PLAYBACK_CODE: Record<MacroPlaybackLike, number> = { once: 0, repeat: 0, toggle: 1, 'while-held': 2 };

export function macroBindingEntry(slot: number, playback: MacroPlaybackLike): number[] {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MACRO_SLOTS) throw new Error(`Ungültiger Makro-Platz ${slot}`);
  return [9, PLAYBACK_CODE[playback], slot, 0];
}

/** `09 <Art> <Platz> 00` → Platz und Wiedergabeart (Art 0 = Anzahl; „einmal“/„N-mal“ entscheidet die Anzahl). */
export function decodeMacroBinding(entry: ArrayLike<number>): { slot: number; mode: 'count' | 'toggle' | 'while-held' } | null {
  if (entry[0] !== 9 || entry[2] >= MACRO_SLOTS) return null;
  return { slot: entry[2], mode: entry[1] === 1 ? 'toggle' : entry[1] === 2 ? 'while-held' : 'count' };
}

/** `8B <Platz> <Seite>` (Prüfsumme Byte 7); Antwort = 64 Byte Makrodaten je Seite. */
export function macroReadPacket(slot: number, page: number): Uint8Array {
  return makePacket([CMD.GET_MACRO, slot, page], 7);
}

/** GearHub liest weiter, bis eine Seite vier Nullbytes am Stück enthält (Ende der Ereignisliste). */
export function macroPageHasEnd(page: ArrayLike<number>): boolean {
  for (let i = 0; i + 3 < page.length; i++) if (!page[i] && !page[i + 1] && !page[i + 2] && !page[i + 3]) return true;
  return false;
}
export const MACRO_MAX_READ_PAGES = MACRO_READ_PAGES;

/**
 * Schritte → Gerätedaten: `<Anzahl u16 LE>` + je Ereignis `<HID> <Bit7 = gedrückt | Pause>` (Pause 1–127 ms)
 * oder `<HID> <Bit7> <Pause u16 LE>` (ab 128 ms). Jedes Ereignis trägt die Pause danach; mehrere Pausen am Stück
 * werden addiert, Pausen vor dem ersten Ereignis fallen weg.
 */
export function encodeMacro(steps: readonly MacroStepLike[], repeat: number): number[] {
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 0xffff) throw new Error('Wiederholungen: 1 bis 65535');
  const out = [repeat & 0xff, repeat >> 8];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === 'delay') continue;
    let gap: number | null = null;
    for (let j = i + 1; j < steps.length && steps[j].type === 'delay'; j++) gap = (gap ?? 0) + (steps[j] as { ms: number }).ms;
    const ms = Math.round(Math.max(1, gap ?? MACRO_DEFAULT_GAP_MS));
    if (ms > MACRO_MAX_DELAY) throw new Error(`Pause zu lang (höchstens ${MACRO_MAX_DELAY} ms)`);
    const hid = MOUSE_HID[s.code] ?? (s.code === 'Fn' ? undefined : CODE_TO_HID[s.code]);
    if (hid === undefined) throw new Error(`Taste ${s.code} kann in einem TK75-Makro nicht vorkommen`);
    const down = s.type === 'down' ? 0x80 : 0;
    out.push(...(ms <= 0x7f ? [hid, down | ms] : [hid, down, ms & 0xff, ms >> 8]));
  }
  if (out.length > MACRO_BYTES) throw new Error(`Makro zu lang (${out.length} von ${MACRO_BYTES} Byte)`);
  return out;
}

/** Gerätedaten → Schritte. Mausbewegungen kennt die App nicht; sie werden übersprungen und gemeldet. */
export function decodeMacro(data: ArrayLike<number>): { repeat: number; steps: MacroStepLike[]; skipped: number } {
  const b = Array.from(data);
  const repeat = (b[0] ?? 0) | ((b[1] ?? 0) << 8);
  const steps: MacroStepLike[] = [];
  let skipped = 0;
  const u16 = (i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
  for (let i = 2; i + 1 < b.length;) {
    const [code, flags] = [b[i], b[i + 1]];
    let ms: number;
    if (code === MOUSE_MOVE) {
      // f9 <Pause|0> <dx> <dy> [Pause u16]
      ms = flags || u16(i + 4);
      i += flags ? 4 : 6;
      skipped++;
    } else {
      const name = HID_MOUSE[code] ?? (code >= 4 && code <= 0xef ? HID_TO_CODE[code] : undefined);
      if (!name) break; // 00 = Ende, ff = leerer Speicher, sonst unbekannt
      ms = flags & 0x7f;
      if (ms) i += 2;
      else {
        ms = u16(i + 2);
        i += 4;
      }
      steps.push({ type: flags & 0x80 ? 'down' : 'up', code: name });
    }
    if (ms) steps.push({ type: 'delay', ms });
  }
  return { repeat, steps, skipped };
}

/**
 * Makro schreiben: `0B <Platz> <Seite> 38 <Ende> 00 00 <Prüfsumme>` + 56 Byte. Gesendet werden die Seiten bis
 * einschließlich der vier Nullbytes nach dem letzten Ereignis, damit alte, längere Daten nicht weiterlaufen.
 */
export function macroWritePackets(slot: number, data: readonly number[]): Uint8Array[] {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MACRO_SLOTS) throw new Error(`Ungültiger Makro-Platz ${slot}`);
  if (data.length > MACRO_BYTES) throw new Error('Makro zu lang');
  const used = Math.min(MACRO_BYTES, data.length + 4);
  const buf = [...data, ...new Array(MACRO_BYTES - data.length).fill(0)];
  const pages = Math.ceil(used / MACRO_WRITE_CHUNK);
  return Array.from({ length: pages }, (_, p) => {
    const chunk = buf.slice(p * MACRO_WRITE_CHUNK, (p + 1) * MACRO_WRITE_CHUNK);
    return makePacket([CMD.SET_MACRO, slot, p, MACRO_WRITE_CHUNK, p === pages - 1 ? 1 : 0], 7,
      [...chunk, ...new Array(MACRO_WRITE_CHUNK - chunk.length).fill(0)]);
  });
}

/** `0A <Profil> <Platz> 00 00 <Ende> <Ebene> <Prüfsumme>` + 4 Byte (GearHub setKeyConfigSimple). */
export function keyMatrixWritePacket(profile: number, slot: number, entry: number[], layer = 0): Uint8Array {
  if (slot < 0 || slot >= MATRIX_SLOTS) throw new Error(`Ungültiger Platz ${slot}`);
  if (entry.length !== 4) throw new Error('Eine Belegung hat 4 Byte');
  return makePacket([CMD.SET_KEYMATRIX, profile, slot, 0, 0, 1, layer], 7, entry);
}

/** Fn-Ebene lesen: `90 <System> <Profil> ff <Seite>`, 8 Seiten (GearHub _getFnKeyMatrix). System 0 = Windows, 1 = Mac. */
export function fnMatrixReadPacket(profile: number, page: number, system = 0): Uint8Array {
  return makePacket([CMD.GET_FN, system, profile, 0xff, page], 7);
}

/** Fn-Ebene schreiben: `10 <System> <Profil> <Platz> 00 00 00 <Prüfsumme>` + 4 Byte (GearHub setFnKeyConfigSimple). */
export function fnMatrixWritePacket(profile: number, slot: number, entry: number[], system = 0): Uint8Array {
  if (slot < 0 || slot >= MATRIX_SLOTS) throw new Error(`Ungültiger Platz ${slot}`);
  if (entry.length !== 4) throw new Error('Eine Belegung hat 4 Byte');
  return makePacket([CMD.SET_FN, system, profile, slot], 7, entry);
}

/** Schalterwerte einer Taste in mm (strukturgleich mit SwitchConfig im Modell) + rohes Modusbyte. */
export interface KeySwitchValues {
  actuation: number;
  releasePoint: number;
  rapidTrigger: boolean;
  rtPress: number;
  rtRelease: number;
  deadzoneTop: number;
  deadzoneBottom: number;
  /** Rohes Modusbyte vom Gerät (Bit 7 = RT); andere Modi (DKS, MT …) bleiben unangetastet */
  modeByte: number;
}

export const SWITCH_LIMITS = {
  actuation: [0.1, 3.4],
  releasePoint: [0.1, 3.4],
  rtPress: [0.01, 2],
  rtRelease: [0.01, 2],
  deadzoneTop: [0, 1],
  deadzoneBottom: [0, 1],
} as const;

/** `65 <Art> 00 <Platz> <letzter?> 00 00 <Prüfsumme>` + Wert (GearHub _sendMagnetismInfoSimpleCMD). */
export function magnetismKeyPacket(kind: number, slot: number, last: boolean, data: number[]): Uint8Array {
  if (slot < 0 || slot >= MATRIX_SLOTS) throw new Error(`Ungültiger Platz ${slot}`);
  return makePacket([CMD.SET_MULTI_MAGNETISM, kind, 0, slot, last ? 1 : 0], 7, data);
}

/**
 * Pakete für eine Taste: nur geänderte Werte, Reihenfolge wie GearHub (erst Modus, dann Wege).
 * Das letzte Paket trägt das Ende-Kennzeichen. Prüft alle Grenzen, bevor etwas gebaut wird.
 */
export function keySwitchPackets(slot: number, from: KeySwitchValues, to: KeySwitchValues): Uint8Array[] {
  const raw = (mm: number) => Math.round(mm * TRAVEL_STEP);
  for (const [field, [min, max]] of Object.entries(SWITCH_LIMITS)) {
    const v = to[field as keyof typeof SWITCH_LIMITS];
    if (!(v >= min && v <= max)) throw new Error(`${field} = ${v} mm liegt außerhalb ${min}–${max} mm`);
  }
  const ops: { kind: number; data: number[] }[] = [];
  const u16 = (v: number) => [v & 0xff, v >> 8];
  if (to.rapidTrigger !== from.rapidTrigger) {
    ops.push({ kind: MAGNETISM.modes, data: [(from.modeByte & 0x7f) | (to.rapidTrigger ? 0x80 : 0)] });
  }
  const travels: [keyof typeof SWITCH_LIMITS, number][] = [
    ['actuation', MAGNETISM.travel], ['releasePoint', MAGNETISM.release], ['deadzoneBottom', MAGNETISM.deadzoneBottom],
    ['rtPress', MAGNETISM.rtPress], ['rtRelease', MAGNETISM.rtRelease],
  ];
  for (const [field, kind] of travels) {
    if (raw(to[field]) !== raw(from[field])) ops.push({ kind, data: u16(raw(to[field])) });
  }
  if (raw(to.deadzoneTop) !== raw(from.deadzoneTop)) ops.push({ kind: MAGNETISM.deadzoneTop, data: [raw(to.deadzoneTop)] });
  return ops.map((op, i) => magnetismKeyPacket(op.kind, slot, i === ops.length - 1, op.data));
}

export const mmToRaw = (mm: number) => Math.round(mm * TRAVEL_STEP);

/** Komplette Tabellen aller 128 Plätze (Rohwerte), wie sie `E5` liefert. */
export interface SwitchTables {
  modes: number[];
  travel: number[];
  release: number[];
  rtPress: number[];
  rtRelease: number[];
  deadzoneBottom: number[];
  deadzoneTop: number[];
}

const BULK_CHUNK = 56;

/**
 * Sammelschreiben (GearHub setMultiMagnetismInfo): je geänderter Tabelle `65 <Art> 01 <Seite> <Ende>` + 56 Byte.
 * Reihenfolge wie GearHub: Modus, Wege (0, 1, 2, 3, 6), obere Totzone. Nur das allerletzte Paket trägt Ende = 1.
 */
export function bulkSwitchPackets(from: SwitchTables, to: SwitchTables): { kind: number; packets: Uint8Array[] }[] {
  const u16 = (v: number[]) => v.flatMap((x) => [x & 0xff, (x >> 8) & 0xff]);
  const tables: [number, keyof SwitchTables, (v: number[]) => number[]][] = [
    [MAGNETISM.modes, 'modes', (v) => v],
    [MAGNETISM.travel, 'travel', u16],
    [MAGNETISM.release, 'release', u16],
    [MAGNETISM.rtPress, 'rtPress', u16],
    [MAGNETISM.rtRelease, 'rtRelease', u16],
    [MAGNETISM.deadzoneBottom, 'deadzoneBottom', u16],
    [MAGNETISM.deadzoneTop, 'deadzoneTop', (v) => v],
  ];
  const changed = tables.filter(([, field]) => {
    if (to[field].length !== MATRIX_SLOTS || from[field].length !== MATRIX_SLOTS) {
      throw new Error(`Tabelle ${field} braucht ${MATRIX_SLOTS} Einträge`);
    }
    return to[field].some((v, i) => v !== from[field][i]);
  });
  return changed.map(([kind, field, encode], t) => {
    const bytes = encode(to[field]);
    const pages = Math.ceil(bytes.length / BULK_CHUNK);
    const lastTable = t === changed.length - 1;
    const packets = Array.from({ length: pages }, (_, page) =>
      makePacket([CMD.SET_MULTI_MAGNETISM, kind, 1, page, lastTable && page === pages - 1 ? 1 : 0], 7,
        bytes.slice(page * BULK_CHUNK, (page + 1) * BULK_CHUNK)));
    return { kind, packets };
  });
}

// ---------- Energiesparen ----------

/** Zeiten in Sekunden (GearHub setSleepTime/getSleepTime). */
export interface SleepTimes {
  /** Bluetooth: Beleuchtung ausschalten nach */
  backlightBt: number;
  /** 2,4 GHz: Beleuchtung ausschalten nach */
  backlight24g: number;
  /** Bluetooth: Tiefschlaf nach */
  deepBt: number;
  /** 2,4 GHz: Tiefschlaf nach */
  deep24g: number;
}

/** Grenzen in Sekunden; gelten für alle TK75-TMR-Einträge in GearHubs Geräteliste. */
export const SLEEP_LIMITS = {
  backlight: { min: 60, max: 3600 },
  deep: { min: 600, max: 3600 },
} as const;

const u16 = (res: ArrayLike<number>, at: number) => (res[at] ?? 0) | ((res[at + 1] ?? 0) << 8);

/** Antwort auf `91`: ab Byte 8 vier 16-Bit-Werte (Little Endian): BT, 2,4G, Tief-BT, Tief-2,4G. */
export function decodeSleep(res: ArrayLike<number>): SleepTimes {
  return { backlightBt: u16(res, 8), backlight24g: u16(res, 10), deepBt: u16(res, 12), deep24g: u16(res, 14) };
}

/** Schreibpaket `11 … <Prüfsumme Byte 7> | BT | 2,4G | Tief-BT | Tief-2,4G` (Sekunden, LE). */
export function sleepPacket(t: SleepTimes): Uint8Array {
  const check = (name: string, v: number, lim: { min: number; max: number }) => {
    if (!Number.isInteger(v) || v < lim.min || v > lim.max) throw new Error(`${name} ${v} s außerhalb ${lim.min}–${lim.max} s`);
  };
  check('Beleuchtung aus (Bluetooth)', t.backlightBt, SLEEP_LIMITS.backlight);
  check('Beleuchtung aus (2,4 GHz)', t.backlight24g, SLEEP_LIMITS.backlight);
  check('Tiefschlaf (Bluetooth)', t.deepBt, SLEEP_LIMITS.deep);
  check('Tiefschlaf (2,4 GHz)', t.deep24g, SLEEP_LIMITS.deep);
  const le = (v: number) => [v & 0xff, v >> 8];
  return makePacket([CMD.SET_SLEEP], 7, [...le(t.backlightBt), ...le(t.backlight24g), ...le(t.deepBt), ...le(t.deep24g)]);
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
