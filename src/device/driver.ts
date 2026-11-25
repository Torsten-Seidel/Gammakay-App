import type { ConfigSection, DeviceConfig } from './model';
import { LED_EFFECTS } from './gamakay/protocol';

export interface DeviceInfo {
  name: string;
  transport: 'mock' | 'usb';
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
}

export const TK75_CAPABILITIES: Capabilities = {
  profiles: 4,
  pollingRates: [8000, 4000, 2000, 1000, 500, 250, 125],
  travel: { min: 0.1, max: 3.4, step: 0.01 },
  // Annahme – die echte Auflösung des TK75-Displays muss noch ermittelt werden.
  display: { width: 128, height: 128 },
  lightEffects: LED_EFFECTS.map(({ id, label, options }) => ({ id, label, options })),
  lightLevels: 4,
};
