import type { KeyboardDriver } from './driver';
import { TK75_CAPABILITIES } from './driver';
import { log } from './log';
import { createDefaultConfig, type ConfigSection, type DeviceConfig } from './model';
import {
  CMD, CONFIG_USAGE, CONFIG_USAGE_PAGE, TK75_PRODUCT_ID, TK75_VENDOR_ID,
  decodeInfoName, decodeLed, decodeSleep, decodeVersion, ledBrightnessPacket, type LedState,
} from './gamakay/protocol';
import { GamakayTransport } from './gamakay/transport';

const isConfigInterface = (d: HIDDevice) =>
  d.vendorId === TK75_VENDOR_ID &&
  d.productId === TK75_PRODUCT_ID &&
  d.collections.some((c) => c.usagePage === CONFIG_USAGE_PAGE && c.usage === CONFIG_USAGE);

/**
 * Treiber für die echte TK75 über WebHID (Feature-Report 0).
 * Lesen: Geräteinfo, Tastenlicht, Seitenlicht, Energiespar-Zeiten.
 * Schreiben: bisher NUR die Helligkeit des Tastenlichts – alles andere ist gesperrt,
 * bis der jeweilige Befehl per Mitschnitt bestätigt ist.
 */
export class GamakayHidDriver implements KeyboardDriver {
  readonly capabilities = TK75_CAPABILITIES;
  readonly supports = { read: true, write: true };
  readonly writableSections: ConfigSection[] = ['lighting'];
  readonly info: { name: string; transport: 'usb'; vendorId: number; productId: number; firmware?: string };
  private readonly transport: GamakayTransport;
  private led: LedState | null = null;

  private constructor(device: HIDDevice) {
    this.transport = new GamakayTransport(device);
    this.info = { name: device.productName || 'TK75 TMR', transport: 'usb', vendorId: device.vendorId, productId: device.productId };
  }

  /** Bereits freigegebenes Gerät verwenden, sonst die Geräteauswahl (nur TK75-Konfig-Interface) öffnen. */
  static async connect(): Promise<GamakayHidDriver> {
    if (!('hid' in navigator)) throw new Error('WebHID ist hier nicht verfügbar (nur Chromium/Electron).');
    let device = (await navigator.hid.getDevices()).find(isConfigInterface);
    if (!device) {
      const picked = await navigator.hid.requestDevice({
        filters: [{ vendorId: TK75_VENDOR_ID, productId: TK75_PRODUCT_ID, usagePage: CONFIG_USAGE_PAGE, usage: CONFIG_USAGE }],
      });
      if (!picked.length) throw new Error('Keine Tastatur ausgewählt.');
      device = picked.find(isConfigInterface);
    }
    if (!device) throw new Error('Das Konfigurations-Interface der TK75 wurde nicht gefunden.');
    const driver = new GamakayHidDriver(device);
    await driver.transport.open();
    log('info', `Verbunden: ${driver.info.name}`);
    return driver;
  }

  async readConfig(): Promise<DeviceConfig> {
    const cfg = createDefaultConfig(this.capabilities.profiles);
    const t = this.transport;

    const version = await t.query(CMD.GET_VERSION);
    const info = await t.query(CMD.GET_INFO);
    this.info.firmware = `${decodeInfoName(info) || '?'} · ${decodeVersion(version)}`;

    this.led = decodeLed(await t.query(CMD.GET_LED));
    const side = decodeLed(await t.query(CMD.GET_SIDE_LED));
    const sleep = decodeSleep(await t.query(CMD.GET_SLEEP));

    // Profil-/Tastendaten sind noch nicht entschlüsselt → nur Licht und Energiesparen aus dem Gerät.
    for (const p of cfg.profiles) {
      p.lighting.effect = 'device';
      p.lighting.brightness = this.led.brightness;
      p.lighting.color = this.led.color;
      p.lighting.side = { effect: 'device', color: side.color, brightness: side.brightness };
    }
    // Reihenfolge der vier Zeiten ist eine Annahme (Mitschnitt: 120, 120, 1680, 1680 s).
    const min = (s: number) => Math.round(s / 60);
    cfg.settings = {
      ...cfg.settings,
      backlightOff24gMin: min(sleep[0]),
      backlightOffBtMin: min(sleep[1]),
      standbyMin: min(sleep[2]),
      btSleepMin: min(sleep[3]),
    };
    log('info', `Gelesen: Licht Modus ${this.led.mode}, Helligkeit ${this.led.brightness}, Farbe ${this.led.color}`);
    return cfg;
  }

  async writeSection(section: ConfigSection, config: DeviceConfig): Promise<void> {
    if (section !== 'lighting') throw new Error(`Bereich "${section}" kann noch nicht geschrieben werden.`);
    if (!this.led) throw new Error('Licht wurde noch nicht gelesen.');
    const wanted = config.profiles[config.activeProfile].lighting;
    if (wanted.color !== this.led.color || wanted.effect !== 'device') {
      log('info', 'Hinweis: Effekt und Farbe werden noch nicht geschrieben – nur die Helligkeit.');
    }
    if (wanted.brightness === this.led.brightness) return;
    await this.transport.write(ledBrightnessPacket(this.led.raw, wanted.brightness));
    this.led = decodeLed([CMD.GET_LED, ...this.led.raw.map((b, i) => (i === 2 ? wanted.brightness : b))]);
    log('info', `Helligkeit auf ${wanted.brightness} gesetzt`);
  }

  async disconnect(): Promise<void> {
    await this.transport.close();
    log('info', 'Tastatur getrennt');
  }
}

/** Geräteauswahl ohne Filter (für die Diagnose). */
export async function requestHidDevices(): Promise<HIDDevice[]> {
  if (!('hid' in navigator)) throw new Error('WebHID ist hier nicht verfügbar (nur Chromium/Electron).');
  return navigator.hid.requestDevice({ filters: [] });
}
