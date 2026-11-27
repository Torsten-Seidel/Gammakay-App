import type { ConfigSection, DeviceConfig, LightingConfig } from './model';
import {
  LED_EFFECTS, POLLING_RATES, SIDE_LED_EFFECTS, SIDE_SPEED_MAX, TK75_DEFAULT_FN_MATRIX, TK75_SLOTS, describeRawEntry,
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
  factoryFn: Object.fromEntries(TK75_SLOTS.flatMap((key, slot) => {
    const d = key ? describeRawEntry(TK75_DEFAULT_FN_MATRIX[slot]) : null;
    return key && d ? [[key, d]] : [];
  })),
};
