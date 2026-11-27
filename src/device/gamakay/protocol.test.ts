// Prüft das Paketformat gegen echte Mitschnitte (docs/protocol.md). Start: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checksum, decodeInfoName, decodeLed, decodeSleep, ledBrightnessPacket, ledPacket, makePacket, rawToSpeed, readPacket,
  decodeDongleStatus, sideLedPacket, speedToRaw,
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

test('Energiespar-Zeiten und Geräteinfo werden dekodiert', () => {
  assert.deepEqual(decodeSleep(bytes('91 00 00 00 00 00 00 6e 78 00 78 00 90 06 90 06')), [120, 120, 1680, 1680]);
  const info = bytes('ad 02 01 ff ff 01 00 00 07 0e 00 00 00 52 59 35 30 36 30 52 59 35 30 00 00');
  assert.equal(decodeInfoName(info), 'RY5060RY50');
});
