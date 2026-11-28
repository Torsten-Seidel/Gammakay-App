import type { AdvancedKind, ConfigSection, DeviceConfig, LightingConfig, MacroStep } from './model';
import {
  DKS_POINT_MM, MACRO_BYTES, MACRO_SLOTS, MT_TIME_MAX_MS, encodeMacro, LED_EFFECTS, POLLING_RATES, SIDE_LED_EFFECTS, SIDE_SPEED_MAX, TK75_DEFAULT_FN_MATRIX, TK75_DEFAULT_MATRIX, TK75_KEYMAP_SLOTS, TK75_KNOB_SLOTS, describeRawEntry,
} from './gamakay/protocol';

export interface DeviceInfo {
  name: string;
  transport: 'mock' | 'usb' | 'bt' | 'dongle';
  vendorId?: number;
  productId?: number;
  firmware?: string;
}

export interface Capabilities {
  profiles: number;
  pollingRates: number[];
  travel: { min: number; max: number; step: number };
  /** Displayauflösung; null = kein Display bekannt */
  display: { width: number; height: number } | null;
  /** Lichteffekte in Anzeige-Reihenfolge */
  /** `options`: Richtungen/Muster des Effekts (Index wird geschrieben) */
  lightEffects: { id: string; label: string; options?: string[] }[];
  /** Tempo- und Helligkeitsstufen (0 … max) */
  lightLevels: number;
  /** Seitenlicht-Effekte (eigene Liste, keine Optionen) */
  sideLightEffects: { id: string; label: string; rainbowOnly?: boolean }[];
  /** Höchste Tempostufe des Seitenlichts */
  sideSpeedMax: number;
  /** Werksbelegung der Fn-Ebene zur Anzeige („Standard“): Taste, Funktion oder fester Text */
  factoryFn?: Record<string, { code?: string; fn?: string; label?: string }>;
  /** Werksbelegung der Basis-Ebene für Teile ohne eigene Beschriftung (Drehknopf) */
  factoryBase?: Record<string, { code?: string; fn?: string; label?: string }>;
  /** Erweiterte Tasten: schreibbare Arten, ob Snap Tap Modi kennt, Toggle-Varianten, längste Mod-Tap-Zeit. Fehlt = alles. */
  advanced?: {
    kinds: AdvancedKind[]; snapModes: boolean; tglVariants: boolean; mtMaxMs: number;
    /** DKS: Bereich und Startwert des Auslösepunkts; `dksSecondPoint` = zweiter Punkt einstellbar (sonst fest ganz unten) */
    dksPoint: { min: number; max: number; default: number }; dksSecondPoint: boolean;
  };
  /** Makrospeicher: Plätze, Byte je Makro und Größe einer Schrittfolge (Fehlertext, wenn nicht schreibbar) */
  macros?: { slots: number; bytes: number; size(steps: MacroStep[]): number | string };
}

export interface KeyboardDriver {
  readonly info: DeviceInfo;
  readonly capabilities: Capabilities;
  /** Was der Treiber bereits beherrscht. Beim echten Gerät wächst das mit dem Protokoll. */
  readonly supports: { read: boolean; write: boolean };
  /** Bereiche, die der Treiber schreiben kann. Fehlt die Angabe, gelten alle als schreibbar. */
  readonly writableSections?: ConfigSection[];
  readConfig(): Promise<DeviceConfig>;
  writeSection(section: ConfigSection, config: DeviceConfig): Promise<void>;
  disconnect(): Promise<void>;
  /** Akkustand in Prozent; null = nicht verfügbar. Fehlt die Methode, gibt es keine Akku-Abfrage. */
  readBattery?(): Promise<number | null>;
  /** Seitenlicht überlagern (Akkuanzeige); null stellt die eigene Einstellung `own` wieder her. */
  setSideOverride?(override: LightingConfig['side'] | null, own: LightingConfig['side']): Promise<void>;
  /** Wird vom Store gesetzt: aktueller Arbeitsschritt für die Statusanzeige (z. B. „Schreibe F10 (2/4) …“). */
  onProgress?: (step: string, percent?: number) => void;
}

export const TK75_CAPABILITIES: Capabilities = {
  profiles: 4,
  pollingRates: POLLING_RATES,
  travel: { min: 0.1, max: 3.4, step: 0.01 },
  // Annahme – die echte Auflösung des TK75-Displays muss noch ermittelt werden.
  display: { width: 128, height: 128 },
  lightEffects: LED_EFFECTS.map(({ id, label, options }) => ({ id, label, options })),
  lightLevels: 4,
  sideLightEffects: SIDE_LED_EFFECTS.map(({ id, label, rainbowOnly }) => ({ id, label, rainbowOnly })),
  sideSpeedMax: SIDE_SPEED_MAX,
  advanced: {
    kinds: ['dks', 'mt', 'tgl', 'snap'], snapModes: false, tglVariants: true, mtMaxMs: MT_TIME_MAX_MS,
    dksPoint: DKS_POINT_MM, dksSecondPoint: false,
  },
  macros: {
    slots: MACRO_SLOTS,
    bytes: MACRO_BYTES,
    size(steps) {
      try {
        return encodeMacro(steps, 1).length;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
  },
  factoryBase: Object.fromEntries(Object.entries(TK75_KNOB_SLOTS).flatMap(([key, slot]) => {
    const d = describeRawEntry(TK75_DEFAULT_MATRIX[slot]);
    return d ? [[key, d]] : [];
  })),
  factoryFn: Object.fromEntries(TK75_KEYMAP_SLOTS.flatMap((key, slot) => {
    const d = key ? describeRawEntry(TK75_DEFAULT_FN_MATRIX[slot]) : null;
    return key && d ? [[key, d]] : [];
  })),
};
