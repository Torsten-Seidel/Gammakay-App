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
  rapidTrigger: boolean;
  /** RT-Empfindlichkeit beim Drücken / Loslassen in mm */
  rtPress: number;
  rtRelease: number;
  /** Continuous RT über den gesamten Hub */
  continuousRT: boolean;
  /** Totzonen oben / unten in mm */
  deadzoneTop: number;
  deadzoneBottom: number;
}

export type SnapMode = 'last' | 'neutral' | 'first-wins' | 'second-wins';

export interface DksBinding {
  code: string;
  /** Phasen: 1. Punkt drücken, ganz drücken, ganz loslassen → zurück, 1. Punkt loslassen */
  phases: [boolean, boolean, boolean, boolean];
}

export type AdvancedKey =
  | { id: string; kind: 'dks'; key: KeyId; firstPoint: number; secondPoint: number; bindings: DksBinding[] }
  | { id: string; kind: 'mt'; key: KeyId; tap: string; hold: string; holdMs: number }
  | { id: string; kind: 'tgl'; key: KeyId; code: string }
  | { id: string; kind: 'snap'; keys: [KeyId, KeyId]; mode: SnapMode };

export type AdvancedKind = AdvancedKey['kind'];

/** 'device' = Effekt vom Gerät, dessen Modusnummer noch nicht zugeordnet ist */
export type LightEffect =
  | 'off' | 'static' | 'breathing' | 'wave' | 'ripple' | 'starlight' | 'reactive' | 'spectrum' | 'custom' | 'device';
export type LightDirection = 'right' | 'left' | 'down' | 'up';

export interface LightingConfig {
  effect: LightEffect;
  color: string; // #rrggbb
  brightness: number; // 0–4
  speed: number; // 0–4
  direction: LightDirection;
  /** Farbe pro Taste (nur Effekt "custom") */
  perKey: Record<KeyId, string>;
  side: { effect: LightEffect; color: string; brightness: number };
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
  standbyMin: number; // 0 = nie
  backlightOff24gMin: number;
  backlightOffBtMin: number;
  btSleepMin: number;
}

export interface DisplayConfig {
  /** Speicherplatz auf dem Gerät (1–5) */
  slot: number;
  intervalMs: number;
  /** Frames als PNG-Data-URL in Displayauflösung */
  frames: string[];
}

export interface DeviceConfig {
  version: 1;
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
  rapidTrigger: false,
  rtPress: 0.15,
  rtRelease: 0.15,
  continuousRT: false,
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
      color: '#8b7cf6',
      brightness: 3,
      speed: 2,
      direction: 'right',
      perKey: {},
      side: { effect: 'static', color: '#8b7cf6', brightness: 3 },
    },
  };
}

export function createDefaultConfig(profileCount = 4): DeviceConfig {
  return {
    version: 1,
    activeProfile: 0,
    profiles: Array.from({ length: profileCount }, (_, i) => defaultProfile(i)),
    macros: [],
    settings: { pollingRate: 8000, standbyMin: 10, backlightOff24gMin: 2, backlightOffBtMin: 2, btSleepMin: 28 },
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

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
