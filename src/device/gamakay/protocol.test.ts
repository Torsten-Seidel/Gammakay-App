// Prüft das Paketformat gegen echte Mitschnitte (docs/protocol.md). Start: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checksum, decodeInfoName, decodeLed, decodeSleep, ledBrightnessPacket, makePacket, readPacket,
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

test('Energiespar-Zeiten und Geräteinfo werden dekodiert', () => {
  assert.deepEqual(decodeSleep(bytes('91 00 00 00 00 00 00 6e 78 00 78 00 90 06 90 06')), [120, 120, 1680, 1680]);
  const info = bytes('ad 02 01 ff ff 01 00 00 07 0e 00 00 00 52 59 35 30 36 30 52 59 35 30 00 00');
  assert.equal(decodeInfoName(info), 'RY5060RY50');
});
