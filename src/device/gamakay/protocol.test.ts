// Prüft das Paketformat gegen echte Mitschnitte (docs/protocol.md). Start: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TK75_KEYMAP_SLOTS, encodeKeyAction, decodeKeyAction, fnMatrixReadPacket, fnMatrixWritePacket, TK75_DEFAULT_FN_MATRIX, keyMatrixWritePacket, TK75_SLOTS, TK75_DEFAULT_MATRIX,
  bulkSwitchPackets,
  keySwitchPackets,
  decodeKeyMatrix, decodeKeyMode, decodeU16List, magnetismReadPacket,
  checksum, decodeInfoName, decodeLed, decodeSleep, ledBrightnessPacket, ledPacket, makePacket, rawToSpeed, readPacket,
  decodeDongleStatus, decodeReportRate, reportRatePacket, sideLedPacket, sleepPacket, speedToRaw,
} from './protocol.ts';

const bytes = (s: string) => s.trim().split(/\s+/).map((h) => parseInt(h, 16));
const pad = (b: number[]) => [...b, ...new Array(64 - b.length).fill(0)];

test('Lesebefehle entsprechen dem Mitschnitt (Prüfsumme in Byte 7)', () => {
  for (const [cmd, chk] of [[0x8f, 0x70], [0x80, 0x7f], [0xad, 0x52], [0x87, 0x78], [0x91, 0x6e], [0xe6, 0x19]]) {
    const p = readPacket(cmd);
    assert.equal(p.length, 64);
    assert.deepEqual(Array.from(p), pad([cmd, 0, 0, 0, 0, 0, 0, chk]));
  }
});

test('Schreibbefehle werden abgelehnt', () => {
  assert.throws(() => readPacket(0x07));
});

test('Uhrzeit-Paket aus dem Mitschnitt lässt sich nachbauen', () => {
  const p = makePacket([0x28], 7, [0x07, 0xea, 0x0b, 0x19, 0x15, 0x0b]);
  assert.deepEqual(Array.from(p.slice(0, 14)), bytes('28 00 00 00 00 00 00 d7 07 ea 0b 19 15 0b'));
});

test('Helligkeit 4 → 3 ergibt exakt das Paket aus GearHub (Prüfsumme in Byte 8)', () => {
  const read = bytes('87 04 02 04 08 b4 b4 b4 00');
  const led = decodeLed(read);
  assert.equal(led.brightness, 4);
  assert.equal(led.color, '#b4b4b4');
  const p = ledBrightnessPacket(led.raw, 3);
  assert.deepEqual(Array.from(p.slice(0, 10)), bytes('07 04 02 03 08 b4 b4 b4 cb 00'));
  assert.equal(checksum(p, 8), 0xcb);
});

test('Helligkeit außerhalb 0–4 wird abgelehnt', () => {
  const raw = decodeLed(bytes('87 04 02 04 08 b4 b4 b4')).raw;
  assert.throws(() => ledBrightnessPacket(raw, 5));
  assert.throws(() => ledBrightnessPacket(raw, -1));
});

test('Komplette Licht-Pakete entsprechen den GearHub-Mitschnitten', () => {
  const cases: [Parameters<typeof ledPacket>[0], string][] = [
    [{ mode: 0x04, speed: 2, brightness: 4, rainbow: false, color: '#ff0000' }, '07 04 02 04 07 ff 00 00 e8'],
    [{ mode: 0x04, speed: 1, brightness: 4, rainbow: true, color: '#ff0000' }, '07 04 01 04 08 ff 00 00 e8'],
    [{ mode: 0x05, speed: 2, brightness: 4, rainbow: false, color: '#ff0000' }, '07 05 02 04 07 ff 00 00 e7'],
    [{ mode: 0x0b, speed: 1, brightness: 4, rainbow: true, color: '#faffFA' }, '07 0b 01 04 08 fa ff fa ed'],
    [{ mode: 0x13, speed: 2, brightness: 4, rainbow: true, color: '#faffFA' }, '07 13 02 04 08 fa ff fa e4'],
    [{ mode: 0x01, speed: 4, brightness: 4, rainbow: true, color: '#faffFA' }, '07 01 04 04 08 fa ff fa f4'],
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(Array.from(ledPacket(input).slice(0, 9)), bytes(expected), expected);
  }
});

test('Licht-Paket lehnt unbekannte Effekte und Werte ab', () => {
  const ok = { mode: 0x04, speed: 2, brightness: 4, rainbow: false, color: '#ff0000' };
  assert.throws(() => ledPacket({ ...ok, mode: 0x0d }));
  assert.throws(() => ledPacket({ ...ok, mode: 0x0d }, [0x04]));
  assert.doesNotThrow(() => ledPacket({ ...ok, mode: 0x0d }, [0x0d]));
  assert.throws(() => ledPacket({ ...ok, speed: 5 }));
  assert.throws(() => ledPacket({ ...ok, color: 'rot' }));
});

test('Licht-Antwort wird vollständig dekodiert', () => {
  const led = decodeLed(bytes('87 0b 02 04 08 fa ff fa'));
  assert.deepEqual(
    { ...led, raw: undefined },
    { raw: undefined, mode: 0x0b, speed: 2, brightness: 4, colorMode: 8, option: 0, color: '#faffFA'.toLowerCase() },
  );
  // Option im oberen Halbbyte (GearHub: option << 4 | Farbmodus)
  const dir = decodeLed(bytes('87 04 02 04 38 ff 00 00'));
  assert.equal(dir.option, 3);
  assert.equal(dir.colorMode, 8);
});

test('Richtungsoption landet im oberen Halbbyte von Byte 4', () => {
  const base = { mode: 0x04, speed: 2, brightness: 4, rainbow: true, color: '#ff0000' };
  assert.equal(ledPacket({ ...base, option: 0 })[4], 0x08);
  assert.equal(ledPacket({ ...base, option: 3 })[4], 0x38); // Welle „nach oben“
  assert.equal(ledPacket({ ...base, rainbow: false, option: 1 })[4], 0x17);
  assert.throws(() => ledPacket({ ...base, option: 4 })); // Welle hat nur 4 Richtungen
  assert.throws(() => ledPacket({ ...base, mode: 0x05, option: 1 })); // Ripple hat keine Optionen
});

test('Tempo wird wie in GearHub umgekehrt übertragen', () => {
  assert.equal(speedToRaw(4), 0);
  assert.equal(speedToRaw(0), 4);
  assert.equal(rawToSpeed(1), 3);
});

test('Seitenlicht-Pakete entsprechen dem GearHub-Mitschnitt', () => {
  const base = { speed: 1, brightness: 4, rainbow: true, color: '#fafffa' };
  const cases: [Parameters<typeof sideLedPacket>[0], string][] = [
    [{ ...base, mode: 0x01, speed: 0 }, '08 01 00 04 08 fa ff fa f7'],
    [{ ...base, mode: 0x04 }, '08 04 01 04 08 fa ff fa f3'],
    [{ ...base, mode: 0x05 }, '08 05 01 04 08 fa ff fa f2'],
    [{ ...base, mode: 0x02 }, '08 02 01 04 08 fa ff fa f5'],
    [{ ...base, mode: 0x03 }, '08 03 01 04 08 fa ff fa f4'],
    [{ ...base, mode: 0x03, speed: 3 }, '08 03 03 04 08 fa ff fa f2'], // „schnell“ = 3, nicht umgekehrt
    [{ ...base, mode: 0x03, speed: 0, brightness: 2 }, '08 03 00 02 08 fa ff fa f7'],
    [{ ...base, mode: 0x00, speed: 3 }, '08 00 00 00 07 fa ff fa fd'], // Aus
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(Array.from(sideLedPacket(input).slice(0, 9)), bytes(expected), expected);
  }
  assert.equal(sideLedPacket({ ...base, mode: 0x01, rainbow: false, color: '#ffffff' })[4], 0x07);
  assert.equal(sideLedPacket({ ...base, mode: 0x03, rainbow: false })[4], 0x08); // Neon immer bunt
  assert.throws(() => sideLedPacket({ ...base, mode: 0x06 }));
  assert.throws(() => sideLedPacket({ ...base, mode: 0x01, speed: 4 }));
});

test('Empfänger-Status (F7) aus dem Mitschnitt', () => {
  const idle = decodeDongleStatus(bytes('00 64 00 00 01 01 01 00 00'));
  assert.deepEqual(idle, { keyboard: true, canRead: false, canSend: true, online: true, battery: 100 });
  assert.equal(decodeDongleStatus(bytes('01 64 00 00 01 01 01 00 00')).canRead, true);
  assert.equal(decodeDongleStatus(bytes('00 00 50 01 00 01 02 00 00')).keyboard, false); // nur Maus
});

test('Energiespar-Zeiten schreiben (GearHub setSleepTime)', () => {
  const t = { backlightBt: 120, backlight24g: 300, deepBt: 1680, deep24g: 3600 };
  assert.deepEqual(Array.from(sleepPacket(t).slice(0, 16)), bytes('11 00 00 00 00 00 00 ee 78 00 2c 01 90 06 10 0e'));
  assert.throws(() => sleepPacket({ ...t, backlightBt: 30 })); // unter 1 min
  assert.throws(() => sleepPacket({ ...t, deepBt: 300 })); // Tiefschlaf unter 10 min
  assert.throws(() => sleepPacket({ ...t, deep24g: 7200 })); // über 60 min
});

test('Polling-Rate lesen und schreiben', () => {
  assert.equal(decodeReportRate(bytes('83 00 00 00 00 00 00 7c')), 8000); // Mitschnitt beim Verbinden
  assert.equal(decodeReportRate(bytes('83 00 03 00 00 00 00 79')), 1000);
  assert.equal(decodeReportRate(bytes('83 00 09')), undefined);
  assert.deepEqual(Array.from(reportRatePacket(1000).slice(0, 9)), bytes('03 00 03 00 00 00 00 f9 00'));
  assert.deepEqual(Array.from(reportRatePacket(8000).slice(0, 8)), bytes('03 00 00 00 00 00 00 fc'));
  assert.throws(() => reportRatePacket(3000));
});

test('Energiespar-Zeiten und Geräteinfo werden dekodiert', () => {
  assert.deepEqual(decodeSleep(bytes('91 00 00 00 00 00 00 6e 78 00 78 00 90 06 90 06')),
    { backlightBt: 120, backlight24g: 120, deepBt: 1680, deep24g: 1680 });
  const info = bytes('ad 02 01 ff ff 01 00 00 07 0e 00 00 00 52 59 35 30 36 30 52 59 35 30 00 00');
  assert.equal(decodeInfoName(info), 'RY5060RY50');
});

test('Magnet-Lesepaket: E5 <Art> 01 <Seite> mit Prüfsumme in Byte 7', () => {
  const p = magnetismReadPacket(0, 2);
  assert.deepEqual([...p.subarray(0, 8)], [0xe5, 0, 1, 2, 0, 0, 0, 0xff - ((0xe5 + 1 + 2) & 0xff)]);
});

test('Tastenmatrix: HID-Codes und Fn erkennen', () => {
  const m = new Uint8Array(512);
  m.set([0, 0, 41, 0], 0); // Esc
  m.set([0, 0, 4, 0], 8 * 4); // A
  m.set([10, 1, 0, 0], 75 * 4); // Fn
  const slots = decodeKeyMatrix(m);
  assert.equal(slots[0], 'Escape');
  assert.equal(slots[8], 'KeyA');
  assert.equal(slots[75], 'Fn');
  assert.equal(slots[9], undefined);
});

test('Magnetwerte u16 LE und Modusbyte', () => {
  assert.deepEqual(decodeU16List([120, 0, 0x2c, 0x01]), [120, 300]);
  assert.deepEqual(decodeKeyMode(0x80), { mode: 0, rapidTrigger: true });
  assert.deepEqual(decodeKeyMode(0x02), { mode: 2, rapidTrigger: false });
});

const BASE = { actuation: 2, releasePoint: 2, rapidTrigger: false, rtPress: 0.3, rtRelease: 0.3, deadzoneTop: 0, deadzoneBottom: 0.3, modeByte: 0 };

test('Schalter schreiben: nur Auslösepunkt geändert → ein Paket 65 00 00 <Platz> 01 + u16', () => {
  const [p, ...rest] = keySwitchPackets(69, BASE, { ...BASE, actuation: 1.5 });
  assert.equal(rest.length, 0);
  assert.deepEqual([...p.subarray(0, 5)], [0x65, 0, 0, 69, 1]);
  assert.equal(p[7], (0xff - ((0x65 + 69 + 1) & 0xff)) & 0xff);
  assert.deepEqual([...p.subarray(8, 10)], [150, 0]);
});

test('Schalter schreiben: RT an → zuerst Modusbyte, Ende-Kennzeichen nur am letzten Paket', () => {
  const ps = keySwitchPackets(3, BASE, { ...BASE, rapidTrigger: true, rtPress: 0.1 });
  assert.deepEqual(ps.map((p) => [p[1], p[4], p[8]]), [[7, 0, 0x80], [2, 1, 10]]);
});

test('Schalter schreiben: keine Änderung → keine Pakete; Grenzen werden geprüft', () => {
  assert.equal(keySwitchPackets(0, BASE, { ...BASE }).length, 0);
  assert.throws(() => keySwitchPackets(0, BASE, { ...BASE, actuation: 3.9 }));
  assert.throws(() => keySwitchPackets(128, BASE, { ...BASE, actuation: 1 }));
});

test('Sammelschreiben: nur geänderte Tabellen, 5 Seiten bei u16, Ende nur am allerletzten Paket', () => {
  const fill = (v: number) => Array(128).fill(v);
  const from = { modes: fill(0), travel: fill(200), release: fill(200), rtPress: fill(30), rtRelease: fill(30), deadzoneBottom: fill(30), deadzoneTop: fill(0) };
  const to = { ...from, travel: fill(180), modes: fill(0x80) };
  const out = bulkSwitchPackets(from, to);
  assert.deepEqual(out.map((o) => [o.kind, o.packets.length]), [[7, 3], [0, 5]]);
  const all = out.flatMap((o) => o.packets);
  assert.deepEqual(all.map((p) => p[4]), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual([...all[3].subarray(0, 4)], [0x65, 0, 1, 0]);
  assert.deepEqual([...all[3].subarray(8, 12)], [180, 0, 180, 0]);
  // 256 Byte = 4 × 56 + 32 → letzte Seite nur zum Teil gefüllt
  assert.equal(all[7][8 + 31], 0);
  assert.equal(all[7][8 + 32], 0);
  assert.deepEqual(bulkSwitchPackets(from, { ...from }), []);
});

test('Rückstellpunkt: Einzelpaket Art 1 nach dem Auslösepunkt, Sammelschreiben nach Tabelle 0', () => {
  const ps = keySwitchPackets(5, BASE, { ...BASE, actuation: 1.5, releasePoint: 1.2 });
  assert.deepEqual(ps.map((p) => [p[1], p[3], p[4], p[8], p[9]]), [[0, 5, 0, 150, 0], [1, 5, 1, 120, 0]]);
  assert.throws(() => keySwitchPackets(5, BASE, { ...BASE, releasePoint: 0 }));
  const fill = (v: number) => Array(128).fill(v);
  const from = { modes: fill(0), travel: fill(200), release: fill(200), rtPress: fill(30), rtRelease: fill(30), deadzoneBottom: fill(30), deadzoneTop: fill(0) };
  const out = bulkSwitchPackets(from, { ...from, travel: fill(150), release: fill(120) });
  assert.deepEqual(out.map((o) => [o.kind, o.packets.length]), [[0, 5], [1, 5]]);
});

test('Tastenbelegung: Werkstabelle, Kodieren/Dekodieren, Schreibpaket', () => {
  assert.equal(TK75_SLOTS.filter(Boolean).length, 82);
  assert.equal(TK75_SLOTS[72], 'F12');
  assert.equal(TK75_SLOTS[65], 'Fn');
  assert.equal(TK75_SLOTS[81], 'Backslash');
  // ISO-#-Taste ist HID 50, nicht 49
  assert.deepEqual(encodeKeyAction({ kind: 'key', code: 'Backslash' }, 0), [0, 0, 50, 0]);
  assert.deepEqual(encodeKeyAction({ kind: 'default' }, 72), [0, 0, 69, 0]);
  assert.deepEqual(encodeKeyAction({ kind: 'key', code: 'Escape' }, 3), [0, 0, 41, 0]);
  assert.deepEqual(encodeKeyAction({ kind: 'combo', codes: ['ControlLeft', 'KeyC'] }, 3), [0, 224, 6, 0]);
  assert.deepEqual(encodeKeyAction({ kind: 'combo', codes: ['ControlLeft', 'ShiftLeft', 'Escape'] }, 3), [0, 224, 225, 41]);
  assert.deepEqual(encodeKeyAction({ kind: 'function', fn: 'media.mute' }, 3), [3, 0, 226, 0]);
  assert.deepEqual(encodeKeyAction({ kind: 'disabled' }, 3), [0, 0, 0, 0]);
  assert.throws(() => encodeKeyAction({ kind: 'macro', macroId: 'x' }, 3));
  assert.throws(() => encodeKeyAction({ kind: 'function', fn: 'sys.displayNext' }, 3));
  // Rückweg
  assert.deepEqual(decodeKeyAction(TK75_DEFAULT_MATRIX[72], 72), { kind: 'default' });
  assert.deepEqual(decodeKeyAction([0, 0, 41, 0], 3), { kind: 'key', code: 'Escape' });
  assert.deepEqual(decodeKeyAction([0, 224, 6, 0], 3), { kind: 'combo', codes: ['ControlLeft', 'KeyC'] });
  assert.deepEqual(decodeKeyAction([3, 0, 226, 0], 3), { kind: 'function', fn: 'media.mute' });
  assert.deepEqual(decodeKeyAction([0, 0, 0, 0], 3), { kind: 'disabled' });
  assert.equal(decodeKeyAction([9, 0, 1, 0], 3), null);
  // Paket: 0a 00 48 00 00 01 00 <chk> 00 00 29 00
  const p = keyMatrixWritePacket(0, 72, [0, 0, 41, 0]);
  assert.deepEqual([...p.subarray(0, 12)], [0x0a, 0, 72, 0, 0, 1, 0, 0xff - ((0x0a + 72 + 1) & 0xff), 0, 0, 41, 0]);
});

test('Fn-Ebene: Werkstabelle, Standard je Ebene, Pakete', () => {
  assert.deepEqual([...TK75_DEFAULT_FN_MATRIX[0]], [10, 2, 0, 0]); // Fn+Esc = Reset (ab Werk)
  assert.deepEqual(encodeKeyAction({ kind: 'default' }, 24, 'fn'), [3, 0, 226, 0]); // Fn+F4 = Stumm
  assert.deepEqual(encodeKeyAction({ kind: 'default' }, 9, 'fn'), [0, 0, 0, 0]); // Fn+A unbelegt
  assert.deepEqual(decodeKeyAction([3, 0, 226, 0], 24, 'fn'), { kind: 'default' });
  assert.deepEqual(decodeKeyAction([3, 0, 226, 0], 24, 'base'), { kind: 'function', fn: 'media.mute' });
  assert.deepEqual(decodeKeyAction([0, 0, 0, 0], 9, 'fn'), { kind: 'default' });
  assert.deepEqual(decodeKeyAction([0, 0, 0, 0], 24, 'fn'), { kind: 'disabled' });
  const r = fnMatrixReadPacket(0, 3);
  assert.deepEqual([...r.subarray(0, 8)], [0x90, 0, 0, 0xff, 3, 0, 0, 0xff - ((0x90 + 0xff + 3) & 0xff)]);
  const w = fnMatrixWritePacket(0, 9, [3, 0, 226, 0]);
  assert.deepEqual([...w.subarray(0, 12)], [0x10, 0, 0, 9, 0, 0, 0, 0xff - ((0x10 + 9) & 0xff), 3, 0, 226, 0]);
});

test('Licht lesen: Farbmodus 0–6 = feste Farbliste, 7 = eigene Farbe, 8 = bunt', () => {
  // Seitenlicht nach Fn+Zurück: Farbmodus 05, RGB-Bytes noch auf der alten eigenen Farbe
  assert.equal(decodeLed(bytes('88 05 00 04 05 8b 00 ff')).color, '#0000ff');
  assert.equal(decodeLed(bytes('88 05 00 04 00 8b 00 ff')).color, '#ff0000');
  assert.equal(decodeLed(bytes('88 05 00 04 07 8b 00 ff')).color, '#8b00ff');
  assert.equal(decodeLed(bytes('88 05 00 04 08 8b 00 ff')).colorMode, 8);
});

test('Drehknopf: Plätze 90–92, Werk = Leiser/Lauter/Play', () => {
  assert.equal(TK75_KEYMAP_SLOTS[90], 'KnobLeft');
  assert.equal(TK75_KEYMAP_SLOTS[92], 'KnobPress');
  assert.equal(TK75_KEYMAP_SLOTS[96], undefined);
  assert.equal(TK75_KEYMAP_SLOTS.filter(Boolean).length, 85);
  assert.deepEqual(decodeKeyAction([3, 0, 234, 0], 90), { kind: 'default' });
  assert.deepEqual(encodeKeyAction({ kind: 'function', fn: 'light.brightDown' }, 90), [13, 2, 2, 0]);
});
