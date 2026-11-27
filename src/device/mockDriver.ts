import type { KeyboardDriver } from './driver';
import { TK75_CAPABILITIES } from './driver';
import { log } from './log';
import { createDefaultConfig, type ConfigSection, type DeviceConfig } from './model';

const STORAGE_KEY = 'tk75.demo-config';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Demo-Treiber ohne Hardware. Speichert die "Gerätekonfiguration" im localStorage. */
export class MockDriver implements KeyboardDriver {
  readonly info = { name: 'Gamakay TK75 TMR (Demo)', transport: 'mock' as const, firmware: 'demo' };
  readonly capabilities = TK75_CAPABILITIES;
  readonly supports = { read: true, write: true };

  async readConfig(): Promise<DeviceConfig> {
    await wait(150);
    log('info', 'Demo: Konfiguration gelesen');
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DeviceConfig;
        if (parsed.version === 2) {
          // Ältere Demo-Daten kennen den Rückstellpunkt noch nicht → wie Auslösepunkt
          for (const p of parsed.profiles) {
            for (const s of [p.defaultSwitch, ...Object.values(p.switches)]) s.releasePoint ??= s.actuation;
          }
          return parsed;
        }
      }
    } catch {
      // ungültige oder blockierte Daten → Standardwerte
    }
    return createDefaultConfig(this.capabilities.profiles);
  }

  async writeSection(section: ConfigSection, config: DeviceConfig): Promise<void> {
    await wait(60);
    log('out', `Demo: schreibe Bereich "${section}"`);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      log('error', 'Demo: Speichern im localStorage fehlgeschlagen');
    }
  }

  async disconnect(): Promise<void> {
    log('info', 'Demo getrennt');
  }
}
