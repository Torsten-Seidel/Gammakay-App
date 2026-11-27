// Akkuanzeige: Bereiche, Hysterese und Abfrage-Intervall. Start: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BATTERY_INDICATOR as cfg, batteryZone, pollIntervalMs, sanitizeIndicator, zoneLook } from './battery.ts';

test('Bereiche nach den Standardgrenzen 20 % / 10 %', () => {
  assert.equal(batteryZone(99, cfg), 'normal');
  assert.equal(batteryZone(21, cfg), 'normal');
  assert.equal(batteryZone(20, cfg), 'low');
  assert.equal(batteryZone(11, cfg), 'low');
  assert.equal(batteryZone(10, cfg), 'critical');
  assert.equal(batteryZone(0, cfg), 'critical');
});

test('Hysterese: aufwärts erst mit Abstand, abwärts sofort', () => {
  assert.equal(batteryZone(21, cfg, 'low'), 'low');
  assert.equal(batteryZone(22, cfg, 'low'), 'low');
  assert.equal(batteryZone(23, cfg, 'low'), 'normal');
  assert.equal(batteryZone(12, cfg, 'critical'), 'critical');
  assert.equal(batteryZone(13, cfg, 'critical'), 'low');
  assert.equal(batteryZone(60, cfg, 'critical'), 'normal'); // nach dem Laden
  assert.equal(batteryZone(10, cfg, 'low'), 'critical');
});

test('Intervall: selten bei vollem Akku, jede Minute nahe der Warnschwelle', () => {
  assert.equal(pollIntervalMs(99, cfg), 15 * 60_000);
  assert.equal(pollIntervalMs(50, cfg), 5 * 60_000);
  assert.equal(pollIntervalMs(25, cfg), 60_000);
  assert.equal(pollIntervalMs(5, cfg), 60_000);
  assert.equal(pollIntervalMs(null, cfg), 60_000);
});

test('Darstellung je Bereich', () => {
  assert.equal(zoneLook('normal', cfg), null);
  assert.equal(zoneLook('low', cfg)?.color, '#ff8000');
  assert.equal(zoneLook('low', cfg)?.effect, 'static');
  assert.equal(zoneLook('critical', cfg)?.effect, 'breathing');
  assert.equal(zoneLook('normal', { ...cfg, normal: { useOwn: false, color: '#00ff40' } })?.color, '#00ff40');
});

test('Eingaben werden bereinigt', () => {
  const s = sanitizeIndicator({ ...cfg, low: { ...cfg.low, percent: 15 }, critical: { ...cfg.critical, percent: 30 } });
  assert.equal(s.low.percent, 15);
  assert.equal(s.critical.percent, 30); // bleibt beim Tippen erhalten
  assert.equal(batteryZone(25, s), 'critical'); // kritisch über niedrig: kritisch gewinnt
  assert.equal(sanitizeIndicator({ ...cfg, low: { ...cfg.low, percent: 150 } }).low.percent, 100);
});
