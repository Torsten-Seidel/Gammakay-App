// Angenäherte Licht-Vorschau: berechnet pro Frame eine Farbe pro Taste.
// Eigene Annäherung an die Effekte der Tastatur – nicht pixelgenau.

import type { LightingConfig } from '../device/model';

export interface PreviewKey {
  id: string;
  /** Mittelpunkt in Tasten-Einheiten */
  cx: number;
  cy: number;
}

export interface PreviewPress {
  id: string;
  cx: number;
  cy: number;
  /** Zeitpunkt in Sekunden */
  t: number;
  hue: number;
}

/** Effekte, die nur auf Tastendrücke reagieren. */
export const REACTIVE = new Set(['ripple', 'laser', 'snow-trail', 'shadow']);

/** So lange (s) beeinflusst ein Druck die Vorschau höchstens. */
export const PRESS_LIFETIME = 4;

const W = 16;
const H = 6.25;
const CX = W / 2;
const CY = H / 2;

function hash(s: string | number): number {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [139, 124, 246];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const wave = (x: number) => 0.5 + 0.5 * Math.sin(x);
const gauss = (d: number, w: number) => Math.exp(-(d * d) / w);

/** Intensität (0–1) und Farbton eines Effekts an einer Taste. */
function sample(
  effect: string, k: PreviewKey, t: number, sf: number, presses: PreviewPress[], opt: number,
): [number, number] {
  const dx = k.cx - CX;
  const dy = (k.cy - CY) * 1.6;
  const r = Math.hypot(dx, dy);
  const row = Math.round(k.cy - 0.5);
  const T = t * sf;

  switch (effect) {
    case 'static':
      return [1, (k.cx / W) * 300];
    case 'breathing':
      return [0.08 + 0.92 * (0.5 - 0.5 * Math.cos(T * 2)), Math.floor(T / Math.PI) * 67];
    case 'spectrum':
      return [1, T * 20];
    case 'wave': {
      // Optionen: 0 rechts, 1 links, 2 runter, 3 hoch
      const p = [k.cx, W - k.cx, k.cy * 2.5, (H - k.cy) * 2.5][opt] ?? k.cx;
      return [0.25 + 0.75 * wave(p * 0.7 - T * 4), p * 22 - T * 120];
    }
    case 'sine-wave': {
      const center = CY + 2.2 * Math.sin(k.cx * 0.55 - T * 3);
      return [Math.max(0.06, gauss(k.cy - center, 1.4)), k.cx * 20 + T * 40];
    }
    case 'mountain-wave': {
      // Ring zieht sich bis auf die Mitte zusammen und läuft dann wieder nach außen; sonst aus.
      const rr = Math.hypot(k.cx - 7.5, (k.cy - 3.25) * 1.3);
      const R = 0.5 + 8 * (0.5 + 0.5 * Math.cos(T * 1.2));
      const hue = T * 30;
      return [gauss(rr - R, 0.7), hue];
    }
    case 'kaleidoscope': {
      const dir = opt === 1 ? -1 : 1; // 0 nach außen, 1 nach innen
      return [0.3 + 0.7 * wave(r * 1.2 - dir * T * 3), r * 40 - dir * T * 100];
    }
    case 'flower-wave': {
      // Nach Video: alles an, Regenbogen wandert waagerecht (Option 0 rechts, 1 links);
      // jede zweite Reihe ist um ~2 Tasten vorversetzt → gezacktes Muster.
      const x = opt === 1 ? W - k.cx : k.cx;
      const p = x - (row % 2 === 1 ? 2 : 0);
      return [1, T * 51 - p * 16];
    }
    case 'circle-wave': {
      // Nach Video der echten Tastatur: 4 einfarbige Felder (Grenzen bei x≈9 und zwischen QWERTZ- und
      // Grundreihe); die Farben laufen im Kreis oben links → unten links → unten rechts → oben rechts,
      // jedes Feld ~45° Farbton hinter dem vorigen.
      const left = k.cx < 9;
      const top = k.cy < 3.25;
      // Option 0: gegen den Uhrzeigersinn (wie im Video), 1: im Uhrzeigersinn
      const q = opt === 1 ? (top ? (left ? 0 : 1) : left ? 3 : 2) : top ? (left ? 0 : 3) : left ? 1 : 2;
      return [1, T * 90 - q * 45];
    }
    case 'current': {
      if (opt === 1) {
        // Spirale: Puls läuft am Rand im Uhrzeigersinn und dann ringweise nach innen.
        const col = Math.min(15, Math.max(0, Math.floor(k.cx)));
        const rr = Math.min(row, 5 - row, col, 15 - col);
        const perim = (i: number) => 2 * (15 - 2 * i + (5 - 2 * i));
        let s = 0;
        for (let i = 0; i < rr; i++) s += perim(i);
        const w = 15 - 2 * rr, h = 5 - 2 * rr;
        if (row === rr) s += col - rr;
        else if (col === 15 - rr) s += w + (row - rr);
        else if (row === 5 - rr) s += w + h + (15 - rr - col);
        else s += 2 * w + h + (5 - rr - row);
        const total = perim(0) + perim(1) + perim(2) + 6;
        const head = (T * 10) % total;
        const behind = head - s;
        const v = behind >= -0.6 && behind < 4 ? (behind < 0 ? 1 + behind / 0.6 : (1 - behind / 4) ** 1.5) : 0.04;
        return [Math.max(0.04, v), T * 90 - behind * 25];
      }
      // Schlangenlinie: oben links → rechts, nächste Zeile rechts → links, usw.; Farbe wechselt laufend.
      const rows = 6;
      const span = W + 4; // inkl. Ein-/Auslauf
      const total = T * 10;
      const pos = total % (rows * span);
      const activeRow = Math.floor(pos / span);
      const hue = total * 9; // wechselnde Farben entlang des Wegs
      if (row !== activeRow) return [0.04, hue];
      const along = (pos % span) - 2;
      const head = activeRow % 2 === 0 ? along : W - along;
      const behind = activeRow % 2 === 0 ? head - k.cx : k.cx - head;
      const v = behind >= -0.6 && behind < 4 ? (behind < 0 ? 1 + behind / 0.6 : (1 - behind / 4) ** 1.5) : 0.04;
      return [Math.max(0.04, v), hue - behind * 25];
    }
    case 'starlight': {
      const h = hash(k.id);
      const x = (T * 0.5 + h * 7) % 1;
      return [x < 0.3 ? Math.sin((Math.PI * x) / 0.3) : 0.04, hash(k.id + '#') * 360];
    }
    case 'snowfall': {
      // Nach Video: zufällige Tasten blitzen ~0,4 s in zufälliger Farbe auf (≈ 8–10 gleichzeitig).
      const period = 2.6 + hash(k.id) * 1.8;
      const x = T / period + hash(k.id + 's') * 10;
      const n = Math.floor(x);
      const f = x - n;
      const on = 0.13;
      const v = f < on ? (f < 0.02 ? f / 0.02 : 1 - ((f - 0.02) / (on - 0.02)) ** 2) : 0;
      return [v, hash(k.id + ':' + n) * 360];
    }
    case 'meteor': {
      // Nach Video: immer ein Meteor, links → rechts, jeder Durchlauf in einer zufälligen Reihe;
      // bunter Schweif von ~4 Tasten.
      const span = W + 5;
      const x = (T * 14) / span;
      const n = Math.floor(x);
      const meteorRow = Math.floor(hash('m' + n) * 6);
      if (row !== meteorRow) return [0, 0];
      const head = (x - n) * span - 1;
      const behind = head - k.cx;
      if (behind < -0.5 || behind > 4) return [0, 0];
      const v = behind < 0 ? 1 + behind / 0.5 : 1 - (behind / 4) ** 2;
      return [v, hash('h' + n) * 360 + behind * 70];
    }
    case 'cross': {
      // Nach Video („Farbkreuz“): alle Tasten an, jede mit eigener Farbe, die langsam weiterwandert.
      const rate = 60 + hash(k.id + 'r') * 40;
      return [1, hash(k.id) * 360 + T * rate];
    }
  }

  if (!REACTIVE.has(effect)) return [1, (k.cx / W) * 300];

  // Reaktive Effekte
  let v = 0;
  let dark = 1; // nur für „Schneespur“
  let hue = (k.cx / W) * 300;
  let best = 0;
  for (const p of presses) {
    const a = t - p.t;
    if (a < 0) continue;
    let c = 0;
    let ph = p.hue;
    switch (effect) {
      case 'ripple': {
        // Wassertropfen: heller Aufschlag, dann konzentrische Ringe, die nach außen laufen und abklingen.
        const d = Math.hypot(k.cx - p.cx, (k.cy - p.cy) * 1.2);
        const front = a * 4.5 * sf;
        if (d > front + 0.4) break;
        const behind = Math.max(0, front - d);
        const lambda = 1.9; // Abstand der Ringe in Tasten
        const ring = Math.cos((behind * Math.PI) / lambda) ** 2;
        const fade = Math.exp(-behind / 4) * Math.max(0, 1 - (a / 3.5) ** 2) / (1 + d * 0.04);
        const splash = d < 0.8 ? Math.max(0, 1 - a / 0.35) : 0;
        c = Math.max(ring * fade, splash);
        break;
      }
      case 'laser': {
        // Einzeilige Welle: läuft von der gedrückten Taste in der Reihe nach links und rechts.
        if (Math.abs(k.cy - p.cy) >= 0.5) break;
        // Bei „Bunt“ hat der Streifen einen Regenbogen-Verlauf (Farbe nach Abstand hinter der Front).
        const d = Math.abs(k.cx - p.cx);
        const front = a * 7 * sf;
        const behind = front - d;
        const splash = d < 0.6 ? Math.max(0, 1 - a / 0.3) : 0;
        const band = behind > -0.6 && behind < 3.5 ? (behind < 0 ? 1 + behind / 0.6 : 1 - (behind / 3.5) ** 2) : 0;
        c = Math.max(band * Math.max(0, 1 - a / 2.5), splash);
        ph = p.hue + Math.max(0, behind) * 70;
        break;
      }
      case 'snow-trail':
        // Wie „Immer an“; die gedrückte Taste geht aus und blendet wieder ein (siehe unten).
        if (k.id === p.id) dark = Math.min(dark, Math.max(0, Math.min(1, (a * sf - 0.4) / 1.5)));
        break;
      case 'shadow':
        // Alles aus, nur die gedrückte Taste leuchtet auf und klingt ab.
        if (k.id === p.id) c = Math.max(0, 1 - (a * sf) / 1.2);
        break;
    }
    if (c > best) {
      best = c;
      hue = ph;
    }
    v = Math.min(1, v + c);
  }
  if (effect === 'snow-trail') return [dark, (k.cx / W) * 300];
  return [v, hue];
}

/** Farbe pro Taste für den Zeitpunkt `t` (Sekunden); `undefined` = aus. */
export function previewFrame(
  l: LightingConfig,
  keys: PreviewKey[],
  t: number,
  presses: PreviewPress[],
): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  const level = l.brightness / 4;
  const sf = 0.35 + l.speed * 0.45;
  const fixed = parseHex(l.color);
  for (const k of keys) {
    if (level <= 0) {
      out.set(k.id, undefined);
      continue;
    }
    const [v, hue] = sample(l.effect, k, t, sf, presses, l.option ?? 0);
    const i = Math.max(0, Math.min(1, v)) * (0.35 + 0.65 * level);
    if (i < 0.03) {
      out.set(k.id, undefined);
      continue;
    }
    const [r, g, b] = l.rainbow ? hslToRgb(hue, 0.85, 0.58) : fixed;
    out.set(k.id, `rgb(${Math.round(r * i)} ${Math.round(g * i)} ${Math.round(b * i)})`);
  }
  return out;
}
