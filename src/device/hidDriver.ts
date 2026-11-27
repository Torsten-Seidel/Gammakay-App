import type { KeyboardDriver } from './driver';
import { TK75_CAPABILITIES } from './driver';
import { log, toHex } from './log';
import {
  createDefaultConfig, switchFor, type ConfigSection, type DeviceConfig, type DeviceSettings, type LightingConfig, type Profile, type SwitchConfig,
} from './model';
import {
  CMD, COLOR_MODE_RAINBOW, CONFIG_USAGE, CONFIG_USAGE_PAGE, LED_EFFECTS, SIDE_LED_EFFECTS, SIDE_SPEED_MAX,
  TK75_PRODUCT_ID, TK75_VENDOR_ID, rawToSpeed, sideLedPacket, speedToRaw,
  BT_USAGE, BT_USAGE_PAGE, TK75_BT_PRODUCT_ID, TK75_DONGLE_PRODUCT_ID,
  MAGNETISM, PACKET_SIZE, keySwitchPackets, type KeySwitchValues, TRAVEL_STEP, decodeKeyMatrix, decodeKeyMode, decodeU16List, keyMatrixReadPacket, magnetismReadPacket,
  decodeInfoName, decodeLed, decodeReportRate, reportRatePacket, decodeSleep, decodeVersion, sleepPacket, ledPacket, type LedState,
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
const MAX_SWITCH_KEYS = 5;
const KEY_WRITE_GAP_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
  readonly writableSections: ConfigSection[] = ['lighting', 'settings', 'switches'];
  readonly info: { name: string; transport: 'usb' | 'bt' | 'dongle'; vendorId: number; productId: number; firmware?: string };
  private readonly transport: Transport;
  /** Eigene Seitenlicht-Einstellung, solange die Akkuanzeige das Seitenlicht überlagert */
  private userSide: SideLight | null = null;
  private led: LedState | null = null;
  private side: LedState | null = null;
  /** Zuletzt gelesene/geschriebene Geräteeinstellungen (zum Erkennen, was sich ändert) */
  private settings: DeviceSettings | null = null;
  /** Taste → Matrix-Platz und zuletzt gelesene/geschriebene Schalterwerte (Grundlage fürs Schreiben) */
  private keySlots: Record<string, number> = {};
  private switchState: Record<string, KeySwitchValues & { continuousRT: boolean }> = {};

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
    // Wege sind freigegeben, aber keiner antwortet: Auswahlfenster hilft hier nicht weiter.
    if (known.length) {
      throw new Error('Die Tastatur antwortet nicht. Ist sie eingeschaltet und wach (einmal eine Taste drücken)? ' +
        'Dann erneut „Tastatur verbinden“.');
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
    const rate = decodeReportRate(await t.query(CMD.GET_REPORT_RATE));

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
    const min = (s: number) => Math.round(s / 60);
    cfg.settings = {
      ...cfg.settings,
      pollingRate: rate ?? cfg.settings.pollingRate,
      backlightOffBtMin: min(sleep.backlightBt),
      backlightOff24gMin: min(sleep.backlight24g),
      deepSleepBtMin: min(sleep.deepBt),
      deepSleep24gMin: min(sleep.deep24g),
    };
    this.settings = { ...cfg.settings };
    // Magnetschalter: nur lesen. Ein Fehler hier darf die Verbindung nicht kaputt machen.
    try {
      await this.readSwitches(cfg.profiles[cfg.activeProfile]);
    } catch (e) {
      log('info', `Schalterdaten nicht gelesen: ${String(e)}`);
    }
    const effectName = LED_EFFECTS.find((e) => e.code === this.led!.mode)?.label ?? `unbekannt 0x${this.led.mode.toString(16)}`;
    log('info', `Gelesen: Licht ${effectName}, Tempo ${rawToSpeed(this.led.speed)}, Option ${this.led.option}, ` +
      `Helligkeit ${this.led.brightness}, ` +
      `${this.led.colorMode === COLOR_MODE_RAINBOW ? 'bunt' : `Farbe ${this.led.color}`}`);
    return cfg;
  }

  /** Mehrseitige Antwort lesen und als reine Daten (64 Byte je Seite) aneinanderhängen. */
  private async readPages(packet: (page: number) => Uint8Array, pages: number, label: string): Promise<Uint8Array> {
    const out = new Uint8Array(pages * PACKET_SIZE);
    for (let page = 0; page < pages; page++) {
      const res = await this.transport.queryRaw(packet(page));
      if (page === 0) log('info', `${label} Seite 0 roh: ${toHex(res, 64)}`);
      out.set(res.subarray(0, PACKET_SIZE), page * PACKET_SIZE);
    }
    return out;
  }

  /** Tastenzuordnung (8A) + Auslösepunkt, Rapid Trigger, Totzonen (E5) → Schalterwerte je Taste. */
  private async readSwitches(profile: Profile): Promise<void> {
    const matrix = await this.readPages((p) => keyMatrixReadPacket(0, p), 8, 'Matrix');
    const slots = decodeKeyMatrix(matrix);
    const u16 = async (kind: number, label: string) =>
      decodeU16List(await this.readPages((p) => magnetismReadPacket(kind, p), 4, label));
    const modes = await this.readPages((p) => magnetismReadPacket(MAGNETISM.modes, p), 2, 'Tastenmodus');
    const travel = await u16(MAGNETISM.travel, 'Auslösepunkt');
    const rtPress = await u16(MAGNETISM.rtPress, 'RT Drücken');
    const rtRelease = await u16(MAGNETISM.rtRelease, 'RT Loslassen');
    const dzBottom = await u16(MAGNETISM.deadzoneBottom, 'Totzone unten');
    const dzTop = await this.readPages((p) => magnetismReadPacket(MAGNETISM.deadzoneTop, p), 2, 'Totzone oben');

    const mm = (raw: number) => Math.round((raw / TRAVEL_STEP) * 100) / 100;
    const perKey: Record<string, SwitchConfig> = {};
    this.keySlots = {};
    this.switchState = {};
    slots.forEach((key, i) => {
      if (!key || perKey[key]) return;
      this.keySlots[key] = i;
      perKey[key] = {
        actuation: mm(travel[i]),
        rapidTrigger: decodeKeyMode(modes[i]).rapidTrigger,
        rtPress: mm(rtPress[i]),
        rtRelease: mm(rtRelease[i]),
        continuousRT: false, // noch nicht entschlüsselt
        deadzoneTop: mm(dzTop[i]),
        deadzoneBottom: mm(dzBottom[i]),
      };
      this.switchState[key] = { ...perKey[key], modeByte: modes[i] };
    });

    // Häufigste Einstellung = Standard, nur Abweichungen pro Taste ablegen (wie das Modell es erwartet).
    const counts = new Map<string, number>();
    for (const s of Object.values(perKey)) counts.set(JSON.stringify(s), (counts.get(JSON.stringify(s)) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top) throw new Error('Keine Tasten in der Matrix erkannt');
    profile.defaultSwitch = JSON.parse(top[0]);
    profile.switches = Object.fromEntries(Object.entries(perKey).filter(([, s]) => JSON.stringify(s) !== top[0]));

    const d = profile.defaultSwitch;
    log('info', `Gelesen: ${Object.keys(perKey).length} Tasten, Standard Auslösepunkt ${d.actuation} mm, ` +
      `RT ${d.rapidTrigger ? `an (${d.rtPress}/${d.rtRelease} mm)` : 'aus'}, Totzone ${d.deadzoneTop}/${d.deadzoneBottom} mm, ` +
      `${Object.keys(profile.switches).length} Tasten abweichend: ${Object.keys(profile.switches).slice(0, 8).join(', ')}`);
    // Leere Plätze (00 00 00 00) sind Lücken in der Matrix; nur belegte, aber unbekannte Einträge melden.
    const unknown = slots.flatMap((k, i) => {
      const entry = matrix.subarray(i * 4, i * 4 + 4);
      return !k && entry.some((b) => b) ? [`${i}: ${toHex(entry, 4)}`] : [];
    });
    if (unknown.length) log('info', `Belegte Plätze ohne bekannte Taste: ${unknown.join(' | ')}`);
  }

  /**
   * Schalterwerte schreiben: nur Tasten, die vom gelesenen Stand abweichen, einzeln (wie GearHub).
   * Testphase: höchstens MAX_SWITCH_KEYS Tasten pro Übernehmen; Continuous RT ist noch nicht schreibbar.
   */
  private async writeSwitches(profile: Profile): Promise<void> {
    if (!Object.keys(this.switchState).length) throw new Error('Schalterwerte wurden noch nicht gelesen.');
    const changes = Object.entries(this.switchState).flatMap(([key, from]) => {
      const to = switchFor(profile, key);
      if (to.continuousRT !== from.continuousRT) throw new Error('Continuous RT kann noch nicht geschrieben werden.');
      const packets = keySwitchPackets(this.keySlots[key], from, { ...to, modeByte: from.modeByte });
      return packets.length ? [{ key, to, packets }] : [];
    });
    if (!changes.length) return;
    if (changes.length > MAX_SWITCH_KEYS) {
      throw new Error(`Testphase: höchstens ${MAX_SWITCH_KEYS} Tasten auf einmal (geändert: ${changes.length}).`);
    }
    for (const { key, to, packets } of changes) {
      log('info', `Schreibe ${key} (Platz ${this.keySlots[key]}): Auslösen ${to.actuation} mm, ` +
        `RT ${to.rapidTrigger ? `an ${to.rtPress}/${to.rtRelease}` : 'aus'}, Totzone ${to.deadzoneTop}/${to.deadzoneBottom} mm`);
      for (const p of packets) await this.transport.write(p);
      // Nach dem Ende-Kennzeichen speichert die Tastatur; Pakete in dieser Zeit gehen verloren
      // (getestet: bei 40 ms Abstand kamen von F9–F12 nur F9 und F12 an). GearHub wartet 100 ms je Taste.
      await sleep(KEY_WRITE_GAP_MS);
      const from = this.switchState[key];
      this.switchState[key] = {
        ...to,
        modeByte: to.rapidTrigger === from.rapidTrigger ? from.modeByte : (from.modeByte & 0x7f) | (to.rapidTrigger ? 0x80 : 0),
      };
    }
    // GearHub wartet danach (vendorSleep, bei Sammelschreiben 500 ms); vorher liefert die Tastatur nur Echos.
    await sleep(500);
    // Nachlesen: Die Tastatur bestätigt Schreibbefehle nicht, verlorene Pakete fielen sonst nicht auf.
    const check = structuredClone(profile);
    await this.readSwitches(check);
    const lost = changes.filter(({ key, to }) => JSON.stringify(switchFor(check, key)) !== JSON.stringify(to)).map((c) => c.key);
    if (lost.length) throw new Error(`Nicht von der Tastatur übernommen: ${lost.join(', ')} – bitte erneut „Übernehmen“.`);
  }

  async writeSection(section: ConfigSection, config: DeviceConfig): Promise<void> {
    if (section === 'settings') return this.writeSettings(config.settings);
    if (section === 'switches') return this.writeSwitches(config.profiles[config.activeProfile]);
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

  /** Polling-Rate und Energiespar-Zeiten; nur was sich gegenüber dem Gerät ändert, wird gesendet. */
  private async writeSettings(wanted: DeviceSettings): Promise<void> {
    if (!this.settings) throw new Error('Einstellungen wurden noch nicht gelesen.');
    const cur = this.settings;
    const sleepKeys = ['backlightOffBtMin', 'backlightOff24gMin', 'deepSleepBtMin', 'deepSleep24gMin'] as const;
    // Pakete erst bauen (prüft die Grenzen), dann senden.
    const sleep = sleepKeys.some((k) => wanted[k] !== cur[k])
      ? sleepPacket({
        backlightBt: wanted.backlightOffBtMin * 60,
        backlight24g: wanted.backlightOff24gMin * 60,
        deepBt: wanted.deepSleepBtMin * 60,
        deep24g: wanted.deepSleep24gMin * 60,
      })
      : null;
    const rate = wanted.pollingRate !== cur.pollingRate ? reportRatePacket(wanted.pollingRate) : null;
    if (rate) {
      await this.transport.write(rate);
      await new Promise((r) => setTimeout(r, 300)); // GearHub: kurze Pause nach dem Umschalten
      const r = wanted.pollingRate;
      log('info', `Polling-Rate geschrieben: ${r >= 1000 ? `${r / 1000} kHz` : `${r} Hz`}`);
    }
    if (sleep) {
      await this.transport.write(sleep);
      log('info', `Energiespar-Zeiten geschrieben: Licht aus BT ${wanted.backlightOffBtMin} / 2,4G ${wanted.backlightOff24gMin} min, ` +
        `Tiefschlaf BT ${wanted.deepSleepBtMin} / 2,4G ${wanted.deepSleep24gMin} min`);
    }
    this.settings = { ...wanted };
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
