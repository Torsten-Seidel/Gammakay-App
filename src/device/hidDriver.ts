import type { KeyboardDriver } from './driver';
import { TK75_CAPABILITIES } from './driver';
import { log } from './log';
import { createDefaultConfig, type ConfigSection, type DeviceConfig } from './model';
import {
  CMD, COLOR_MODE_RAINBOW, CONFIG_USAGE, CONFIG_USAGE_PAGE, LED_EFFECTS, TK75_PRODUCT_ID, TK75_VENDOR_ID,
  rawToSpeed, speedToRaw,
  decodeInfoName, decodeLed, decodeSleep, decodeVersion, ledPacket, type LedState,
} from './gamakay/protocol';
import { GamakayTransport } from './gamakay/transport';

const deviceEffectId = (code: number) => `device-0x${code.toString(16).padStart(2, '0')}`;
const effectIdFor = (code: number) => LED_EFFECTS.find((e) => e.code === code)?.id ?? deviceEffectId(code);

const isConfigInterface = (d: HIDDevice) =>
  d.vendorId === TK75_VENDOR_ID &&
  d.productId === TK75_PRODUCT_ID &&
  d.collections.some((c) => c.usagePage === CONFIG_USAGE_PAGE && c.usage === CONFIG_USAGE);

/**
 * Treiber für die echte TK75 über WebHID (Feature-Report 0).
 * Lesen: Geräteinfo, Tastenlicht, Seitenlicht, Energiespar-Zeiten.
 * Schreiben: bisher NUR das Tastenlicht (Effekt, Tempo, Helligkeit, Farbe/bunt) – alles andere
 * ist gesperrt, bis der jeweilige Befehl per Mitschnitt bestätigt ist.
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
      p.lighting = {
        effect: effectIdFor(this.led.mode),
        rainbow: this.led.colorMode === COLOR_MODE_RAINBOW,
        color: this.led.color,
        brightness: this.led.brightness,
        speed: rawToSpeed(this.led.speed),
        option: this.led.option,
        // Seitenlicht: gleiche Struktur, Effektcodes noch nicht zugeordnet → nur Anzeige.
        side: {
          effect: deviceEffectId(side.mode),
          rainbow: side.colorMode === COLOR_MODE_RAINBOW,
          color: side.color,
          brightness: side.brightness,
          speed: rawToSpeed(side.speed),
        },
      };
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
    const effectName = LED_EFFECTS.find((e) => e.code === this.led!.mode)?.label ?? `unbekannt 0x${this.led.mode.toString(16)}`;
    log('info', `Gelesen: Licht ${effectName}, Tempo ${rawToSpeed(this.led.speed)}, Option ${this.led.option}, ` +
      `Helligkeit ${this.led.brightness}, ` +
      `${this.led.colorMode === COLOR_MODE_RAINBOW ? 'bunt' : `Farbe ${this.led.color}`}`);
    return cfg;
  }

  async writeSection(section: ConfigSection, config: DeviceConfig): Promise<void> {
    if (section !== 'lighting') throw new Error(`Bereich "${section}" kann noch nicht geschrieben werden.`);
    if (!this.led) throw new Error('Licht wurde noch nicht gelesen.');
    const wanted = config.profiles[config.activeProfile].lighting;
    const mode = LED_EFFECTS.find((e) => e.id === wanted.effect)?.code;
    if (mode === undefined) {
      throw new Error('Der aktuelle Geräte-Effekt ist unbekannt – bitte zuerst einen Effekt aus der Liste wählen.');
    }
    const effect = LED_EFFECTS.find((e) => e.code === mode);
    const option = effect?.options ? Math.min(wanted.option ?? 0, effect.options.length - 1) : 0;
    const packet = ledPacket({
      mode,
      speed: speedToRaw(wanted.speed),
      brightness: wanted.brightness,
      rainbow: wanted.rainbow,
      color: wanted.color,
      option,
    });
    await this.transport.write(packet);
    this.led = decodeLed([CMD.GET_LED, ...packet.slice(1, 8)]);
    log('info', `Licht geschrieben: ${effect?.label}${effect?.options ? ` (${effect.options[option]})` : ''}, Tempo ${wanted.speed}, ` +
      `Helligkeit ${wanted.brightness}, ${wanted.rainbow ? 'bunt' : wanted.color}`);
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
