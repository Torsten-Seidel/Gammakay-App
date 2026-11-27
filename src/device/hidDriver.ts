import type { KeyboardDriver } from './driver';
import { TK75_CAPABILITIES } from './driver';
import { log } from './log';
import { createDefaultConfig, type ConfigSection, type DeviceConfig, type LightingConfig } from './model';
import {
  CMD, COLOR_MODE_RAINBOW, CONFIG_USAGE, CONFIG_USAGE_PAGE, LED_EFFECTS, SIDE_LED_EFFECTS, SIDE_SPEED_MAX,
  TK75_PRODUCT_ID, TK75_VENDOR_ID, rawToSpeed, sideLedPacket, speedToRaw,
  BT_USAGE, BT_USAGE_PAGE, TK75_BT_PRODUCT_ID, TK75_DONGLE_PRODUCT_ID,
  decodeInfoName, decodeLed, decodeSleep, decodeVersion, ledPacket, type LedState,
} from './gamakay/protocol';
import { BtTransport, DongleTransport, GamakayTransport, type Transport } from './gamakay/transport';

type SideLight = LightingConfig['side'];

const deviceEffectId = (code: number) => `device-0x${code.toString(16).padStart(2, '0')}`;
const effectIdFor = (code: number) => LED_EFFECTS.find((e) => e.code === code)?.id ?? deviceEffectId(code);
const sideEffectIdFor = (code: number) => SIDE_LED_EFFECTS.find((e) => e.code === code)?.id ?? deviceEffectId(code);
const sameBytes = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a).every((v, i) => v === b[i]);

const isUsbConfig = (d: HIDDevice) =>
  d.vendorId === TK75_VENDOR_ID &&
  d.productId === TK75_PRODUCT_ID &&
  d.collections.some((c) => c.usagePage === CONFIG_USAGE_PAGE && c.usage === CONFIG_USAGE);
const isBtConfig = (d: HIDDevice) =>
  d.vendorId === TK75_VENDOR_ID &&
  d.productId === TK75_BT_PRODUCT_ID &&
  d.collections.some((c) => c.usagePage === BT_USAGE_PAGE && c.usage === BT_USAGE);
const isDongleConfig = (d: HIDDevice) =>
  d.vendorId === TK75_VENDOR_ID &&
  d.productId === TK75_DONGLE_PRODUCT_ID &&
  d.collections.some((c) => c.usagePage === CONFIG_USAGE_PAGE && c.usage === CONFIG_USAGE);
const isConfigInterface = (d: HIDDevice) => isUsbConfig(d) || isBtConfig(d) || isDongleConfig(d);
const TRANSPORT_LABEL = { usb: 'USB', bt: 'Bluetooth', dongle: 'Empfänger 2,4 GHz' } as const;

/**
 * Treiber für die echte TK75 über WebHID (Feature-Report 0).
 * Per Kabel (Feature-Report 0), Bluetooth (Report 6, Präfix 0x55) oder 2,4-GHz-Empfänger (Feature 0, weitergeleitet).
 * Lesen: Geräteinfo, Tastenlicht, Seitenlicht, Energiespar-Zeiten, Akku (nur kabellos).
 * Schreiben: bisher NUR Tasten- und Seitenlicht (Effekt, Tempo, Helligkeit, Farbe/bunt) – alles andere
 * ist gesperrt, bis der jeweilige Befehl per Mitschnitt bestätigt ist.
 */
export class GamakayHidDriver implements KeyboardDriver {
  readonly capabilities = TK75_CAPABILITIES;
  readonly supports = { read: true, write: true };
  readonly writableSections: ConfigSection[] = ['lighting'];
  readonly info: { name: string; transport: 'usb' | 'bt' | 'dongle'; vendorId: number; productId: number; firmware?: string };
  private readonly transport: Transport;
  /** Eigene Seitenlicht-Einstellung, solange die Akkuanzeige das Seitenlicht überlagert */
  private userSide: SideLight | null = null;
  private led: LedState | null = null;
  private side: LedState | null = null;

  private constructor(device: HIDDevice) {
    const transport = isBtConfig(device) ? 'bt' : isDongleConfig(device) ? 'dongle' : 'usb';
    this.transport = transport === 'bt' ? new BtTransport(device)
      : transport === 'dongle' ? new DongleTransport(device)
      : new GamakayTransport(device);
    this.info = {
      // Über den Empfänger meldet sich das Gerät als „2.4G Wireless Keyboard“
      name: transport === 'dongle' || !device.productName ? 'TK75 TMR' : device.productName,
      transport,
      vendorId: device.vendorId,
      productId: device.productId,
    };
  }

  /** Bereits freigegebenes Gerät verwenden, sonst die Geräteauswahl (nur TK75-Konfig-Interface) öffnen. */
  static async connect(): Promise<GamakayHidDriver> {
    if (!('hid' in navigator)) throw new Error('WebHID ist hier nicht verfügbar (nur Chromium/Electron).');
    // Alle freigegebenen Wege probieren (Kabel → Bluetooth → Empfänger) und den ersten nehmen, der antwortet.
    // Sonst bliebe z. B. der eingesteckte Empfänger hängen, obwohl die Tastatur auf Bluetooth steht.
    const rank = (d: HIDDevice) => (isUsbConfig(d) ? 0 : isBtConfig(d) ? 1 : 2);
    const known = (await navigator.hid.getDevices()).filter(isConfigInterface).sort((a, b) => rank(a) - rank(b));
    for (const candidate of known) {
      const driver = new GamakayHidDriver(candidate);
      try {
        await driver.transport.open();
        await driver.transport.query(CMD.GET_VERSION);
        log('info', `Verbunden: ${driver.info.name} (${TRANSPORT_LABEL[driver.info.transport]})`);
        return driver;
      } catch (e) {
        log('info', `${TRANSPORT_LABEL[driver.info.transport]}: keine Antwort – nächster Weg (${String(e)})`);
        await driver.transport.close().catch(() => undefined);
      }
    }
    let device: HIDDevice | undefined;
    {
      const picked = await navigator.hid.requestDevice({
        filters: [
          { vendorId: TK75_VENDOR_ID, productId: TK75_PRODUCT_ID, usagePage: CONFIG_USAGE_PAGE, usage: CONFIG_USAGE },
          { vendorId: TK75_VENDOR_ID, productId: TK75_BT_PRODUCT_ID, usagePage: BT_USAGE_PAGE, usage: BT_USAGE },
          { vendorId: TK75_VENDOR_ID, productId: TK75_DONGLE_PRODUCT_ID, usagePage: CONFIG_USAGE_PAGE, usage: CONFIG_USAGE },
        ],
      });
      if (!picked.length) throw new Error('Keine Tastatur ausgewählt.');
      device = picked.find(isConfigInterface);
    }
    if (!device) throw new Error('Das Konfigurations-Interface der TK75 wurde nicht gefunden.');
    const driver = new GamakayHidDriver(device);
    await driver.transport.open();
    log('info', `Verbunden: ${driver.info.name} (${TRANSPORT_LABEL[driver.info.transport]})`);
    return driver;
  }

  async readConfig(): Promise<DeviceConfig> {
    const cfg = createDefaultConfig(this.capabilities.profiles);
    const t = this.transport;

    const version = await t.query(CMD.GET_VERSION);
    const info = await t.query(CMD.GET_INFO);
    this.info.firmware = `${decodeInfoName(info) || '?'} · ${decodeVersion(version)}`;

    this.led = decodeLed(await t.query(CMD.GET_LED));
    const side = (this.side = decodeLed(await t.query(CMD.GET_SIDE_LED)));
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
        // Seitenlicht: eigene Effektcodes, Tempo 0–3 ohne Umkehrung.
        // Während die Akkuanzeige aktiv ist, gilt die eigene Einstellung, nicht die Warnfarbe auf dem Gerät.
        side: this.userSide ? { ...this.userSide } : {
          effect: sideEffectIdFor(side.mode),
          rainbow: side.colorMode === COLOR_MODE_RAINBOW,
          color: side.color,
          brightness: side.brightness,
          speed: Math.min(side.speed, SIDE_SPEED_MAX),
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
    if (!this.led || !this.side) throw new Error('Licht wurde noch nicht gelesen.');
    const wanted = config.profiles[config.activeProfile].lighting;

    // Pakete erst komplett bauen (und prüfen), dann nur senden, was sich gegenüber dem Gerät ändert.
    const mode = LED_EFFECTS.find((e) => e.id === wanted.effect)?.code;
    const effect = LED_EFFECTS.find((e) => e.code === mode);
    const option = effect?.options ? Math.min(wanted.option ?? 0, effect.options.length - 1) : 0;
    const keyPacket = mode === undefined ? null : ledPacket({
      mode,
      speed: speedToRaw(wanted.speed),
      brightness: wanted.brightness,
      rainbow: wanted.rainbow,
      color: wanted.color,
      option,
    });
    const sideEffect = SIDE_LED_EFFECTS.find((e) => e.id === wanted.side.effect);
    // Akkuanzeige aktiv: neue Seitenlicht-Einstellung nur merken, sie wird beim Beenden der Anzeige geschrieben.
    if (this.userSide && sideEffect) this.userSide = { ...wanted.side };
    const sidePacket = sideEffect && !this.userSide ? this.sidePacketFor(wanted.side) : null;
    const keyChanged = !!keyPacket && !sameBytes(keyPacket.slice(1, 8), this.led.raw);
    const sideChanged = !!sidePacket && !sameBytes(sidePacket.slice(1, 8), this.side.raw);
    if (!keyPacket && !sideChanged && !this.userSide) {
      throw new Error('Der aktuelle Geräte-Effekt ist unbekannt – bitte zuerst einen Effekt aus der Liste wählen.');
    }

    if (keyPacket && keyChanged) {
      await this.transport.write(keyPacket);
      this.led = decodeLed([CMD.GET_LED, ...keyPacket.slice(1, 8)]);
      log('info', `Licht geschrieben: ${effect?.label}${effect?.options ? ` (${effect.options[option]})` : ''}, Tempo ${wanted.speed}, ` +
        `Helligkeit ${wanted.brightness}, ${wanted.rainbow ? 'bunt' : wanted.color}`);
    }
    if (sidePacket && sideChanged) {
      await this.transport.write(sidePacket);
      this.side = decodeLed([CMD.GET_SIDE_LED, ...sidePacket.slice(1, 8)]);
      log('info', `Seitenlicht geschrieben: ${sideEffect!.label}, Tempo ${wanted.side.speed}, ` +
        `Helligkeit ${wanted.side.brightness}, ${wanted.side.rainbow ? 'bunt' : wanted.side.color}`);
    }
    if (!keyChanged && !sideChanged) log('info', 'Licht unverändert – nichts gesendet.');
  }

  private sidePacketFor(side: SideLight): Uint8Array {
    const effect = SIDE_LED_EFFECTS.find((e) => e.id === side.effect);
    if (!effect) throw new Error(`Unbekannter Seitenlicht-Effekt "${side.effect}"`);
    return sideLedPacket({
      mode: effect.code,
      speed: Math.min(side.speed, SIDE_SPEED_MAX),
      brightness: side.brightness,
      rainbow: side.rainbow,
      color: side.color,
    });
  }

  private async writeSideRaw(packet: Uint8Array): Promise<void> {
    if (this.side && sameBytes(packet.slice(1, 8), this.side.raw)) return;
    await this.transport.write(packet);
    this.side = decodeLed([CMD.GET_SIDE_LED, ...packet.slice(1, 8)]);
  }

  /** Akkustand in Prozent (nur Bluetooth), null = nicht verfügbar. */
  readBattery(): Promise<number | null> {
    return this.transport.readBattery();
  }

  /**
   * Seitenlicht vorübergehend überlagern (Akkuanzeige), ohne die eigene Einstellung zu verlieren.
   * `null` beendet die Überlagerung und stellt die eigene Einstellung wieder her.
   */
  async setSideOverride(override: SideLight | null, own: SideLight): Promise<void> {
    if (override) {
      if (!this.userSide) this.userSide = { ...own };
      await this.writeSideRaw(this.sidePacketFor(override));
    } else if (this.userSide) {
      const restore = this.userSide;
      this.userSide = null;
      if (SIDE_LED_EFFECTS.some((e) => e.id === restore.effect)) await this.writeSideRaw(this.sidePacketFor(restore));
      log('info', 'Akkuanzeige beendet – eigenes Seitenlicht wiederhergestellt');
    }
  }

  async disconnect(): Promise<void> {
    // Eigene Einstellung zurückschreiben, damit keine Warnfarbe auf der Tastatur hängen bleibt.
    if (this.userSide) await this.setSideOverride(null, this.userSide).catch(() => undefined);
    await this.transport.close();
    log('info', 'Tastatur getrennt');
  }
}

/** Geräteauswahl ohne Filter (für die Diagnose). */
export async function requestHidDevices(): Promise<HIDDevice[]> {
  if (!('hid' in navigator)) throw new Error('WebHID ist hier nicht verfügbar (nur Chromium/Electron).');
  return navigator.hid.requestDevice({ filters: [] });
}
