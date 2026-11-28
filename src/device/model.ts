// Herstellerneutrales Modell der Tastatur-Konfiguration.
// Die UI arbeitet nur mit diesem Modell; Treiber übersetzen es ins Geräteprotokoll.

/** Physische Taste, benannt nach KeyboardEvent.code (z. B. "KeyA"), plus "Fn". */
export type KeyId = string;
export type LayerId = 'base' | 'fn';

export type KeyAction =
  | { kind: 'default' }
  | { kind: 'key'; code: string }
  | { kind: 'combo'; codes: string[] } // max. 3 Tasten
  | { kind: 'function'; fn: string }
  | { kind: 'macro'; macroId: string }
  | { kind: 'disabled' };

export interface SwitchConfig {
  /** Auslösepunkt in mm */
  actuation: number;
  /** Rückstellpunkt in mm (gilt ohne Rapid Trigger; gleich actuation = nicht getrennt eingestellt) */
  releasePoint: number;
  /** Rapid Trigger über den gesamten Hub (bei der TK75 gibt es kein getrenntes „Continuous RT“) */
  rapidTrigger: boolean;
  /** RT-Empfindlichkeit beim Drücken / Loslassen in mm */
  rtPress: number;
  rtRelease: number;
  /** Totzonen oben / unten in mm */
  deadzoneTop: number;
  deadzoneBottom: number;
}

export type SnapMode = 'last' | 'neutral' | 'first-wins' | 'second-wins';

/**
 * Was eine DKS-Belegung in einer Phase tut:
 * 'off' nichts, 'tap' kurz auslösen, 'hold' drücken und in der nächsten Phase loslassen,
 * 'holdOn' gedrückt weiter in die nächste Phase (dort 'hold' oder wieder 'holdOn').
 */
export type DksAction = 'off' | 'tap' | 'hold' | 'holdOn';

export interface DksBinding {
  code: string;
  /** Phasen: 1. Punkt drücken, ganz drücken, ganz loslassen, 1. Punkt loslassen */
  phases: [DksAction, DksAction, DksAction, DksAction];
}

/** Ältere gespeicherte Stände hatten Ja/Nein je Phase. */
export function dksAction(v: DksAction | boolean | undefined): DksAction {
  return v === true ? 'tap' : v === false || v === undefined ? 'off' : v;
}

export type AdvancedKey =
  /** `secondPoint` fehlt = fest ganz unten (TK75) */
  | { id: string; kind: 'dks'; key: KeyId; firstPoint: number; secondPoint?: number; bindings: DksBinding[] }
  | { id: string; kind: 'mt'; key: KeyId; tap: string; hold: string; holdMs: number }
  /** `variant`: 'hold' = gedrückt halten bis zum nächsten Druck, 'repeat' = Dauerklick (fehlt = 'hold') */
  | { id: string; kind: 'tgl'; key: KeyId; code: string; variant?: 'hold' | 'repeat' }
  /** `mode` fehlt = Gerät entscheidet (TK75: letzte Eingabe gewinnt, keine Auswahl) */
  | { id: string; kind: 'snap'; keys: [KeyId, KeyId]; mode?: SnapMode };

export type AdvancedKind = AdvancedKey['kind'];

/**
 * Effekt-ID aus `capabilities.lightEffects` (z. B. "wave").
 * Unbekannte Gerätecodes erscheinen als "device-0x0d" und werden unverändert zurückgeschrieben.
 */
export type LightEffect = string;

export interface LightingConfig {
  effect: LightEffect;
  /** true = bunt („Glanz“), false = eine Farbe */
  rainbow: boolean;
  color: string; // #rrggbb
  brightness: number; // 0–4
  speed: number; // 0–4, 4 = schnell
  /** Richtung/Muster-Index (nur bei Effekten mit Optionen; fehlt = 0) */
  option?: number;
  /** Seitenlicht: Effekt aus `capabilities.sideLightEffects`, Tempo 0–3 (3 = schnell) */
  side: { effect: LightEffect; rainbow: boolean; color: string; brightness: number; speed: number };
}

export interface Profile {
  name: string;
  /** Nur abweichende Belegungen; fehlende Taste = Standard */
  keymap: Record<LayerId, Record<KeyId, KeyAction>>;
  /** Nur abweichende Schaltereinstellungen; fehlende Taste = defaultSwitch */
  switches: Record<KeyId, SwitchConfig>;
  defaultSwitch: SwitchConfig;
  advanced: AdvancedKey[];
  lighting: LightingConfig;
}

export type MacroStep =
  | { type: 'down'; code: string }
  | { type: 'up'; code: string }
  | { type: 'delay'; ms: number };

export type MacroPlayback = 'once' | 'repeat' | 'while-held' | 'toggle';

export interface Macro {
  id: string;
  name: string;
  steps: MacroStep[];
  repeat: number;
  playback: MacroPlayback;
}

export interface DeviceSettings {
  pollingRate: number;
  /** Beleuchtung aus nach … Minuten (Bluetooth / 2,4 GHz), 1–60 */
  backlightOffBtMin: number;
  backlightOff24gMin: number;
  /** Tiefschlaf nach … Minuten (Bluetooth / 2,4 GHz), 10–60 */
  deepSleepBtMin: number;
  deepSleep24gMin: number;
}

export interface DisplayConfig {
  /** Speicherplatz auf dem Gerät (1–5) */
  slot: number;
  intervalMs: number;
  /** Frames als PNG-Data-URL in Displayauflösung */
  frames: string[];
}

export interface DeviceConfig {
  version: 2;
  activeProfile: number;
  profiles: Profile[];
  macros: Macro[];
  settings: DeviceSettings;
  display: DisplayConfig;
}

export type ConfigSection =
  | 'activeProfile' | 'keymap' | 'switches' | 'advanced' | 'lighting' | 'macros' | 'settings' | 'display';

export const ALL_SECTIONS: ConfigSection[] = [
  'activeProfile', 'keymap', 'switches', 'advanced', 'lighting', 'macros', 'settings', 'display',
];

export const DEFAULT_SWITCH: SwitchConfig = {
  actuation: 1.2,
  releasePoint: 1.2,
  rapidTrigger: false,
  rtPress: 0.15,
  rtRelease: 0.15,
  deadzoneTop: 0.1,
  deadzoneBottom: 0.1,
};

function defaultProfile(index: number): Profile {
  return {
    name: `Profil ${index + 1}`,
    keymap: { base: {}, fn: {} },
    switches: {},
    defaultSwitch: { ...DEFAULT_SWITCH },
    advanced: [],
    lighting: {
      effect: 'wave',
      rainbow: true,
      color: '#8b7cf6',
      brightness: 3,
      speed: 2,
      side: { effect: 'static', rainbow: false, color: '#8b7cf6', brightness: 3, speed: 2 },
    },
  };
}

export function createDefaultConfig(profileCount = 4): DeviceConfig {
  return {
    version: 2,
    activeProfile: 0,
    profiles: Array.from({ length: profileCount }, (_, i) => defaultProfile(i)),
    macros: [],
    settings: { pollingRate: 8000, backlightOffBtMin: 2, backlightOff24gMin: 2, deepSleepBtMin: 30, deepSleep24gMin: 30 },
    display: { slot: 1, intervalMs: 50, frames: [] },
  };
}

export function switchFor(profile: Profile, key: KeyId): SwitchConfig {
  return profile.switches[key] ?? profile.defaultSwitch;
}

export function actionFor(profile: Profile, layer: LayerId, key: KeyId): KeyAction {
  return profile.keymap[layer][key] ?? { kind: 'default' };
}

/** Welche Bereiche weichen zwischen zwei Konfigurationen ab? */
export function diffSections(a: DeviceConfig, b: DeviceConfig): ConfigSection[] {
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const per = <T>(pick: (p: Profile) => T) => same(a.profiles.map(pick), b.profiles.map(pick));
  const out: ConfigSection[] = [];
  if (a.activeProfile !== b.activeProfile || !per((p) => p.name)) out.push('activeProfile');
  if (!per((p) => p.keymap)) out.push('keymap');
  if (!per((p) => [p.switches, p.defaultSwitch])) out.push('switches');
  if (!per((p) => p.advanced)) out.push('advanced');
  if (!per((p) => p.lighting)) out.push('lighting');
  if (!same(a.macros, b.macros)) out.push('macros');
  if (!same(a.settings, b.settings)) out.push('settings');
  if (!same(a.display, b.display)) out.push('display');
  return out;
}

/** Übernimmt die angegebenen Bereiche von `from` nach `to` (verändert `to`). */
export function copySections(from: DeviceConfig, to: DeviceConfig, sections: ConfigSection[]): void {
  const clone = structuredClone(from);
  for (const s of sections) {
    switch (s) {
      case 'activeProfile':
        to.activeProfile = clone.activeProfile;
        to.profiles.forEach((p, i) => (p.name = clone.profiles[i]?.name ?? p.name));
        break;
      case 'keymap':
      case 'advanced':
      case 'lighting':
        to.profiles.forEach((p, i) => {
          if (clone.profiles[i]) (p as unknown as Record<string, unknown>)[s] = clone.profiles[i][s];
        });
        break;
      case 'switches':
        to.profiles.forEach((p, i) => {
          if (!clone.profiles[i]) return;
          p.switches = clone.profiles[i].switches;
          p.defaultSwitch = clone.profiles[i].defaultSwitch;
        });
        break;
      case 'macros':
        to.macros = clone.macros;
        break;
      case 'settings':
        to.settings = clone.settings;
        break;
      case 'display':
        to.display = clone.display;
        break;
    }
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
