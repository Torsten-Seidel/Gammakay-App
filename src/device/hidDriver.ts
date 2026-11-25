import type { KeyboardDriver } from './driver';
import { TK75_CAPABILITIES } from './driver';
import { hex16, log } from './log';
import { createDefaultConfig, type ConfigSection, type DeviceConfig } from './model';

/**
 * Treiber für die echte TK75 über WebHID.
 * Das Gamakay-Protokoll ist noch nicht bekannt: Lesen und Schreiben sind deshalb gesperrt.
 * Die Befehle werden hier Schritt für Schritt ergänzt, sobald sie per Mitschnitt verstanden sind.
 */
export class GamakayHidDriver implements KeyboardDriver {
  readonly capabilities = TK75_CAPABILITIES;
  readonly supports = { read: false, write: false };
  readonly info;

  constructor(readonly devices: HIDDevice[]) {
    const d = devices[0];
    this.info = {
      name: d?.productName || 'HID-Gerät',
      transport: 'usb' as const,
      vendorId: d?.vendorId,
      productId: d?.productId,
    };
    log('info', `Verbunden: ${this.info.name} (VID ${hex16(this.info.vendorId)}, PID ${hex16(this.info.productId)}), ${devices.length} Interface(s)`);
  }

  async readConfig(): Promise<DeviceConfig> {
    log('info', 'Lesen ist noch nicht implementiert – es werden Standardwerte als Entwurf angezeigt.');
    return createDefaultConfig(this.capabilities.profiles);
  }

  async writeSection(section: ConfigSection): Promise<void> {
    throw new Error(`Schreiben ("${section}") ist für die echte Tastatur noch nicht implementiert.`);
  }

  async disconnect(): Promise<void> {
    for (const d of this.devices) if (d.opened) await d.close();
    log('info', 'Tastatur getrennt');
  }
}

/** Öffnet die Geräteauswahl (in Electron die eigene, im Browser die von Chrome). */
export async function requestHidDevices(): Promise<HIDDevice[]> {
  if (!('hid' in navigator)) throw new Error('WebHID ist hier nicht verfügbar (nur Chromium/Electron).');
  return navigator.hid.requestDevice({ filters: [] });
}
