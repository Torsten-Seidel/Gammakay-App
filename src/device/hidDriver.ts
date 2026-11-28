import type { KeyboardDriver } from './driver';
import { TK75_CAPABILITIES } from './driver';
import { log, toHex } from './log';
import {
  createDefaultConfig, switchFor, actionFor, type AdvancedKey, type KeyAction, type ConfigSection, type DeviceConfig, type DeviceSettings, type LightingConfig, type Macro,
  type MacroPlayback, type Profile, type SwitchConfig,
} from './model';
import {
  CMD, COLOR_MODE_RAINBOW, CONFIG_USAGE, CONFIG_USAGE_PAGE, LED_EFFECTS, SIDE_LED_EFFECTS, SIDE_SPEED_MAX,
  TK75_PRODUCT_ID, TK75_VENDOR_ID, rawToSpeed, sideLedPacket, speedToRaw,
  BT_USAGE, BT_USAGE_PAGE, TK75_BT_PRODUCT_ID, TK75_DONGLE_PRODUCT_ID,
  MAGNETISM, PACKET_SIZE, keySwitchPackets, type KeySwitchValues, bulkSwitchPackets, mmToRaw, type SwitchTables, TRAVEL_STEP, decodeKeyMode, TK75_SLOTS, TK75_KEYMAP_SLOTS, decodeKeyAction, encodeKeyAction, keyMatrixWritePacket, fnMatrixReadPacket, fnMatrixWritePacket, type MatrixLayer, decodeU16List, keyMatrixReadPacket, magnetismReadPacket,
  KEY_MODE, MT_TIME_MAX_MS, MT_TIME_STEP_MS, entryToKeyCode, keyCodeToEntry, magnetismKeyPacket,
  MACRO_MAX_READ_PAGES, MACRO_SLOTS, decodeMacro, decodeMacroBinding, encodeMacro, macroPageHasEnd, macroReadPacket, macroWritePackets,
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
type SwitchChange = { key: string; to: SwitchConfig; packets: Uint8Array[] };
/** Bis zu so vielen geänderten Tasten wird einzeln geschrieben, darüber als Sammelschreiben (ganze Tabellen). */
const MAX_SWITCH_KEYS = 5;
/** Befehle beim Lesen: Belegung (8 Basis + 8 Fn) + Schalterdaten (2 Modus + 5×4 Wege + 2 Totzone oben), alles (+ 6 Basis) */
const KEYMAP_READ_OPS = 16;
const SWITCH_READ_OPS = KEYMAP_READ_OPS + 24;
const READ_OPS = 6 + SWITCH_READ_OPS;
const SECTION_LABEL: Partial<Record<ConfigSection, string>> = {
  lighting: 'Licht', settings: 'Geräteeinstellungen', switches: 'Schalter', keymap: 'Tastenbelegung', macros: 'Makros', advanced: 'Erweiterte Tasten',
};
/** Makronamen kennt die Tastatur nicht: Die App merkt sie sich je Speicherplatz (zugleich die Liste „eigener“ Plätze). */
const MACRO_NAMES_KEY = 'tk75.macroNames';
function loadMacroNames(): Record<number, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(MACRO_NAMES_KEY) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}
function saveMacroNames(names: Record<number, string>): void {
  try {
    localStorage.setItem(MACRO_NAMES_KEY, JSON.stringify(names));
  } catch {
    // nicht kritisch: dann heißen die Makros nach dem Neu-Lesen „Makro <Platz>“
  }
}
/** Anzahl, die auf die Tastatur geschrieben wird („einmal“ = 1; bei Start/Stopp und Halten zählt sie nicht). */
const macroRepeat = (m: Macro) => (m.playback === 'repeat' ? m.repeat : 1);
/** Vergleichsstand eines Makros = Gerätedaten, wie die App sie schreiben würde ('null' = nicht schreibbar). */
const macroSig = (m: Macro) => {
  try {
    return JSON.stringify(encodeMacro(m.steps, macroRepeat(m)));
  } catch {
    return 'null';
  }
};
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
  readonly writableSections: ConfigSection[] = ['lighting', 'settings', 'switches', 'keymap', 'macros', 'advanced'];
  readonly info: { name: string; transport: 'usb' | 'bt' | 'dongle'; vendorId: number; productId: number; firmware?: string };
  private readonly transport: Transport;
  /** Eigene Seitenlicht-Einstellung, solange die Akkuanzeige das Seitenlicht überlagert */
  private userSide: SideLight | null = null;
  private led: LedState | null = null;
  private side: LedState | null = null;
  /** Zuletzt gelesene/geschriebene Geräteeinstellungen (zum Erkennen, was sich ändert) */
  private settings: DeviceSettings | null = null;
  onProgress?: (step: string, percent?: number) => void;
  /**
   * Fortschritt: Jeder Befehl an die Tastatur zählt; die Gesamtzahl steht vorher fest (Lesen = READ_OPS,
   * Schreiben = Pakete + Kontroll-Lesen + das anschließende Neu-Lesen durch den Store).
   */
  private job: { done: number; total: number; step: string; shown: number } | null = null;
  /** Fester Text für zusammengefasste Schritte (Kontroll-Lesen, Neu-Lesen nach dem Schreiben) */
  private stepLabel: string | null = null;
  private progress(step: string) {
    const shown = this.stepLabel ?? step;
    if (this.job) this.job.step = shown;
    this.emitProgress(shown);
  }
  private emitProgress(step: string) {
    const j = this.job;
    if (!j) return this.onProgress?.(step);
    j.shown = Math.max(j.shown, Math.min(99, Math.round((j.done / Math.max(1, j.total)) * 100)));
    this.onProgress?.(step, j.shown);
  }
  private tick() {
    if (!this.job) return;
    this.job.done++;
    this.emitProgress(this.job.step);
  }
  private addOps(n: number) {
    if (this.job) this.job.total += n;
  }
  private endJob() {
    if (this.job) this.onProgress?.(this.job.step, 100);
    this.job = null;
  }
  /** Transport-Hülle, die jeden Befehl für den Fortschritt mitzählt. */
  private counted(t: Transport): Transport {
    const tick = () => this.tick();
    return {
      get device() {
        return t.device;
      },
      open: () => t.open(),
      close: () => t.close(),
      readBattery: () => t.readBattery(),
      query: async (cmd) => {
        const r = await t.query(cmd);
        tick();
        return r;
      },
      queryRaw: async (packet) => {
        const r = await t.queryRaw(packet);
        tick();
        return r;
      },
      write: async (packet) => {
        await t.write(packet);
        tick();
      },
    };
  }
  /** Taste → Matrix-Platz und zuletzt gelesene/geschriebene Schalterwerte (Grundlage fürs Schreiben) */
  private keySlots: Record<string, number> = {};
  /** Zuletzt gelesene Basis-Belegung je Platz (4 Byte) und daraus gelesene Aktion je Taste (Vergleichsstand). */
  private keymapRaw: Record<MatrixLayer, number[][]> = { base: [], fn: [] };
  private keymapRead: Record<MatrixLayer, Record<string, KeyAction>> = { base: {}, fn: {} };
  private switchState: Record<string, KeySwitchValues> = {};
  /** Zuletzt gelesene Rohtabellen aller 128 Plätze (Grundlage fürs Sammelschreiben). */
  private switchTables: SwitchTables | null = null;
  /** Tastenmodus-Byte je Platz (zuletzt gelesen); Bits 0–6 = Modus (KEY_MODE), Bit 7 = RT */
  private keyModes: number[] = [];
  /** Erweiterte Tasten, wie zuletzt gelesen (Vergleichsstand) */
  private advancedRead: AdvancedKey[] = [];
  /** Matrix-Platz → ID der erweiterten Taste (stabil über Neu-Lesen) */
  private advancedIds: Record<number, string> = {};
  /** Speicherplatz → Makro-ID (bleibt über Neu-Lesen stabil, damit die Auswahl in der Oberfläche erhalten bleibt) */
  private macroSlotIds: Record<number, string> = {};
  /** Wiedergabeart je Platz aus der zuletzt gelesenen Belegung (erste Taste mit diesem Makro) */
  private macroModes: Record<number, 'count' | 'toggle' | 'while-held'> = {};
  /** Zuletzt gelesener Stand je Platz (macroSig) */
  private macroRead: Record<number, string> = {};
  /** Plätze mit Inhalt; beim ersten Lesen werden alle Plätze durchsucht, danach nur noch diese. */
  private macroSlotsWithData: Set<number> | null = null;

  private constructor(device: HIDDevice) {
    const transport = isBtConfig(device) ? 'bt' : isDongleConfig(device) ? 'dongle' : 'usb';
    this.transport = this.counted(transport === 'bt' ? new BtTransport(device)
      : transport === 'dongle' ? new DongleTransport(device)
      : new GamakayTransport(device));
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
    // Nach dem Schreiben ist das Neu-Lesen schon im Fortschritt eingeplant; sonst eigener Ablauf.
    const afterWrite = !!this.job;
    if (!this.job) this.job = { done: 0, total: READ_OPS, step: '', shown: 0 };
    if (afterWrite) this.stepLabel = 'Lade aktuellen Stand …';
    try {
      return await this.readConfigInner();
    } finally {
      this.stepLabel = null;
      this.endJob();
    }
  }

  private async readConfigInner(): Promise<DeviceConfig> {
    const cfg = createDefaultConfig(this.capabilities.profiles);
    const t = this.transport;

    this.progress('Lese Geräteinfo und Licht …');
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
    try {
      cfg.macros = await this.readMacros();
    } catch (e) {
      log('info', `Makros nicht gelesen: ${String(e)}`);
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

  /**
   * Basis-Belegung (8A) lesen. Die Plätze sind fest (Werks-Matrix); abweichende Einträge werden zu Aktionen.
   * Makro-Belegungen (`09 …`) werden zu Makro-Aktionen; ihre Wiedergabeart merkt sich der Treiber je Platz.
   * Unbekannte Einträge bleiben „Standard“ im Modell und werden nicht überschrieben.
   */
  private async readKeymap(profile: Profile): Promise<void> {
    this.progress('Lese Tastenbelegung …');
    const pages: Record<MatrixLayer, (p: number) => Uint8Array> = {
      base: (p) => keyMatrixReadPacket(0, p),
      fn: (p) => fnMatrixReadPacket(0, p), // Fn-Ebene für Windows (System 0)
    };
    this.macroModes = {};
    for (const layer of ['base', 'fn'] as const) {
      const matrix = await this.readPages(pages[layer], 8, layer === 'base' ? 'Matrix' : 'Fn-Matrix');
      this.keymapRaw[layer] = Array.from({ length: 128 }, (_, i) => Array.from(matrix.subarray(i * 4, i * 4 + 4)));
      this.keymapRead[layer] = {};
      const actions: Record<string, KeyAction> = {};
      const unknown: string[] = [];
      TK75_KEYMAP_SLOTS.forEach((key, slot) => {
        if (!key) return;
        // Erweiterte Taste: Ebene 0 gehört zur erweiterten Taste, nicht zur normalen Belegung.
        if (layer === 'base' && this.isAdvancedSlot(slot)) {
          this.keymapRead.base[key] = { kind: 'default' };
          return;
        }
        const raw = this.keymapRaw[layer][slot];
        const binding = decodeMacroBinding(raw);
        if (binding) this.macroModes[binding.slot] ??= binding.mode;
        const action = binding ? { kind: 'macro' as const, macroId: this.macroIdFor(binding.slot) }
          : decodeKeyAction(raw, slot, layer) as KeyAction | null;
        if (!action) unknown.push(`${key}: ${toHex(Uint8Array.from(this.keymapRaw[layer][slot]), 4)}`);
        this.keymapRead[layer][key] = action ?? { kind: 'default' };
        if (action && action.kind !== 'default') actions[key] = action;
      });
      profile.keymap = { ...profile.keymap, [layer]: actions };
      const n = Object.keys(actions).length;
      log('info', `Gelesen: Belegung ${layer === 'base' ? 'Basis' : 'Fn'}, ${n} Tasten umbelegt${n ? `: ${Object.keys(actions).join(', ')}` : ''}`);
      if (unknown.length) log('info', `Unbekannte Belegungen ${layer} (bleiben unverändert): ${unknown.join(' | ')}`);
    }
  }

  private macroIdFor(slot: number): string {
    return (this.macroSlotIds[slot] ??= `tk75-macro-${slot}`);
  }

  /** Makrodaten eines Platzes (8B): Seiten lesen, bis das Ende der Ereignisliste darin steht. */
  private async readMacroData(slot: number): Promise<Uint8Array> {
    const out: number[] = [];
    for (let page = 0; page < MACRO_MAX_READ_PAGES; page++) {
      if (page) this.addOps(1);
      const res = (await this.transport.queryRaw(macroReadPacket(slot, page))).subarray(0, PACKET_SIZE);
      if (page === 0) log('info', `Makro ${slot} Seite 0 roh: ${toHex(res, 32)}`);
      out.push(...res);
      if (macroPageHasEnd(res) || res.every((b) => b === 0xff)) break; // ff = nie beschriebener Speicher
    }
    return Uint8Array.from(out);
  }

  /**
   * Makros lesen: beim ersten Mal alle Plätze (auch Reste aus GearHub ohne Taste), danach die Plätze mit Inhalt,
   * die eine Taste (Basis oder Fn) belegt oder die die App selbst angelegt hat.
   * Die Wiedergabeart steht nicht im Makro, sondern in der Belegung (`09 <Art> <Platz>`).
   * Leere Plätze lesen `00 …` (geleert) oder `ff …` (nie beschrieben).
   */
  private async readMacros(): Promise<Macro[]> {
    const names = loadMacroNames();
    const scan = !this.macroSlotsWithData;
    const wanted = scan ? Array.from({ length: MACRO_SLOTS }, (_, i) => i)
      : [...this.macroSlotsWithData!, ...Object.keys(this.macroModes).map(Number), ...Object.keys(names).map(Number)];
    const slots = [...new Set(wanted)].filter((n) => Number.isInteger(n) && n >= 0 && n < MACRO_SLOTS).sort((a, b) => a - b);
    this.macroRead = {};
    if (!slots.length) return [];
    this.progress(scan ? 'Durchsuche Makrospeicher …' : 'Lese Makros …');
    this.addOps(slots.length);
    const macros: Macro[] = [];
    const withData = new Set<number>();
    for (const slot of slots) {
      const { repeat, steps, skipped } = decodeMacro(await this.readMacroData(slot));
      const empty = !steps.length && !skipped && (repeat === 0 || repeat === 0xffff);
      const own = slot in this.macroModes || slot in names;
      if (empty && !own) continue;
      if (!empty) withData.add(slot);
      const mode = this.macroModes[slot] ?? 'count';
      const count = repeat >= 1 && repeat < 0xffff ? repeat : 1; // ffff = leerer Speicher
      const playback: MacroPlayback = mode !== 'count' ? mode : count > 1 ? 'repeat' : 'once';
      const m: Macro = { id: this.macroIdFor(slot), name: names[slot] ?? `Makro ${slot + 1}`, steps, repeat: count, playback };
      this.macroRead[slot] = macroSig(m);
      macros.push(m);
      if (skipped) log('info', `Makro ${slot}: ${skipped} Mausbewegung(en) übersprungen (kennt die App nicht)`);
    }
    this.macroSlotsWithData = withData;
    log('info', `Gelesen: ${macros.length} Makros (Plätze ${macros.map((m) => slots.find((s) => this.macroSlotIds[s] === m.id)).join(', ')})` +
      (scan ? `, ${slots.length} Plätze durchsucht` : ''));
    return macros;
  }

  /** Jedem Makro einen Speicherplatz geben: bekannte behalten, neue auf den kleinsten freien Platz. */
  private assignMacroSlots(macros: Macro[]): Map<string, number> {
    const known = new Map(Object.entries(this.macroSlotIds).map(([s, id]) => [id, Number(s)]));
    const result = new Map<string, number>();
    for (const m of macros) if (known.has(m.id)) result.set(m.id, known.get(m.id)!);
    // Auch Plätze, auf die (noch) eine Taste zeigt, gelten als belegt.
    const used = new Set([...result.values(), ...Object.keys(this.macroModes).map(Number)]);
    for (const m of macros) {
      if (result.has(m.id)) continue;
      let slot = 0;
      while (used.has(slot) && slot < MACRO_SLOTS) slot++;
      if (slot >= MACRO_SLOTS) throw new Error(`Alle ${MACRO_SLOTS} Makro-Plätze der Tastatur sind belegt.`);
      used.add(slot);
      result.set(m.id, slot);
      this.macroSlotIds[slot] = m.id;
    }
    return result;
  }

  private macroLookup(config: DeviceConfig) {
    const slots = this.assignMacroSlots(config.macros);
    return (id: string) => {
      const m = config.macros.find((x) => x.id === id);
      return m ? { slot: slots.get(id)!, playback: m.playback } : undefined;
    };
  }

  /**
   * Makros schreiben (0B, wie GearHub `_setMacro`): nur Plätze, deren Daten sich ändern; danach Kontroll-Lesen und
   * die Belegungen nachziehen, falls sich die Wiedergabeart geändert hat (die steht in der Belegung).
   */
  private async writeMacros(config: DeviceConfig): Promise<void> {
    const slots = this.assignMacroSlots(config.macros);
    // Gelöschte Makros: Einen Löschbefehl gibt es nicht → Platz mit Nullen überschreiben (liest danach wie leer).
    // Plätze, die gerade ein neues Makro bekommen hat, werden ohnehin überschrieben.
    const kept = new Set(slots.values());
    const removed = Object.entries(this.macroSlotIds)
      .filter(([slot, id]) => !config.macros.some((m) => m.id === id) && Number(slot) in this.macroRead && !kept.has(Number(slot)))
      .map(([slot, id]) => ({ m: { id, name: `Makro ${Number(slot) + 1}`, steps: [], repeat: 0, playback: 'once' } as Macro, slot: Number(slot), packets: macroWritePackets(Number(slot), []) }));
    const changes = [...removed, ...config.macros.flatMap((m) => {
      const slot = slots.get(m.id)!;
      if (macroSig(m) === this.macroRead[slot]) return [];
      return [{ m, slot, packets: macroWritePackets(slot, encodeMacro(m.steps, macroRepeat(m))) }];
    })];
    const isRemoved = (c: { m: Macro }) => removed.some((r) => r.m === c.m);
    // Namen merken (auch ohne Änderung der Gerätedaten); gelöschte Makros geben ihren Platz frei.
    saveMacroNames(Object.fromEntries(config.macros.map((m) => [slots.get(m.id)!, m.name])));
    for (const slot of Object.keys(this.macroSlotIds).map(Number)) {
      if (!config.macros.some((m) => m.id === this.macroSlotIds[slot])) delete this.macroSlotIds[slot];
    }
    if (changes.length) {
      this.addOps(changes.reduce((n, c) => n + c.packets.length + 1, 0));
      for (const [n, { m, slot, packets }] of changes.entries()) {
        if (isRemoved({ m })) {
          this.progress(`Lösche Makro-Platz ${slot + 1} (${n + 1}/${changes.length}) …`);
          log('info', `Lösche Makro ${slot} (mit Nullen überschreiben)`);
        } else {
          this.progress(`Schreibe Makro „${m.name}“ (${n + 1}/${changes.length}) …`);
          log('info', `Schreibe Makro ${slot} „${m.name}“: ${m.steps.filter((s) => s.type !== 'delay').length} Ereignisse, ` +
            `${m.playback}${m.playback === 'repeat' ? ` ×${m.repeat}` : ''} (${packets.length} Pakete)`);
        }
        for (const p of packets) await this.transport.write(p);
        await sleep(KEY_WRITE_GAP_MS); // GearHub: vendorSleep nach jedem Makro
      }
      await sleep(500);
      this.progress('Prüfe, ob alles angekommen ist …');
      this.stepLabel = 'Prüfe, ob alles angekommen ist …';
      try {
        const lost: string[] = [];
        for (const { m, slot } of changes) {
          const { repeat, steps } = decodeMacro(await this.readMacroData(slot));
          if (isRemoved({ m })) {
            if (repeat || steps.length) lost.push(`Löschen von Platz ${slot + 1}`);
            else delete this.macroRead[slot];
            continue;
          }
          const sig = JSON.stringify(encodeMacro(steps, Math.max(1, repeat)));
          if (sig !== macroSig(m)) lost.push(m.name);
          else this.macroRead[slot] = sig;
        }
        if (lost.length) throw new Error(`Makro nicht übernommen: ${lost.join(', ')} – bitte erneut „Übernehmen“.`);
      } finally {
        this.stepLabel = null;
      }
    }
    await this.writeKeymap(config.profiles[config.activeProfile], config);
  }

  /** Platz mit erweiterter Taste (DKS, Mod-Tap, Toggle): Ebene 0 gehört dann nicht zur normalen Belegung. */
  private isAdvancedSlot(slot: number): boolean {
    const mode = (this.keyModes[slot] ?? 0) & 0x7f;
    return mode === KEY_MODE.dks || mode === KEY_MODE.mt || mode === KEY_MODE.tglHold || mode === KEY_MODE.tglRepeat;
  }

  private advancedIdFor(slot: number): string {
    return (this.advancedIds[slot] ??= `adv-${slot}`);
  }

  /**
   * Erweiterte Tasten aus Tastenmodus, Zusatztabellen und Belegungsebenen (GearHub getMultiMagnetismInfo):
   * Mod-Tap = halten Ebene 0 / tippen Ebene 1 + Zeit (Art 5), Toggle = Ebene 0, Snap Tap = Partner (Art 9).
   * DKS wird noch nicht unterstützt und bleibt unverändert auf der Tastatur.
   */
  private async readAdvanced(profile: Profile): Promise<void> {
    const modeAt = (slot: number) => (this.keyModes[slot] ?? 0) & 0x7f;
    const used = (m: number) => this.keyModes.some((_, s) => TK75_SLOTS[s] && modeAt(s) === m);
    const hasMt = used(KEY_MODE.mt);
    const hasSnap = used(KEY_MODE.snap);
    this.addOps((hasMt ? 2 + 8 : 0) + (hasSnap ? 2 : 0));
    const mtTimes = hasMt ? await this.readPages((p) => magnetismReadPacket(MAGNETISM.mtTime, p), 2, 'Mod-Tap-Zeit') : null;
    const tapLayer = hasMt ? await this.readPages((p) => keyMatrixReadPacket(0, p, 1), 8, 'Ebene 1') : null;
    const partners = hasSnap ? await this.readPages((p) => magnetismReadPacket(MAGNETISM.snapPartner, p), 2, 'Snap-Partner') : null;

    const adv: AdvancedKey[] = [];
    const inSnap = new Set<number>();
    for (let slot = 0; slot < 128; slot++) {
      const key = TK75_SLOTS[slot];
      if (!key || key === 'Fn') continue;
      const base = this.keymapRaw.base[slot] ?? [0, 0, 0, 0];
      const mode = modeAt(slot);
      if (mode === KEY_MODE.mt && mtTimes && tapLayer) {
        adv.push({
          id: this.advancedIdFor(slot), kind: 'mt', key,
          hold: entryToKeyCode(base, slot) ?? '',
          tap: entryToKeyCode(tapLayer.subarray(slot * 4, slot * 4 + 4), slot) ?? '',
          holdMs: mtTimes[slot] * MT_TIME_STEP_MS,
        });
      } else if (mode === KEY_MODE.tglHold || mode === KEY_MODE.tglRepeat) {
        adv.push({
          id: this.advancedIdFor(slot), kind: 'tgl', key, code: entryToKeyCode(base, slot) ?? '',
          variant: mode === KEY_MODE.tglRepeat ? 'repeat' : 'hold',
        });
      } else if (mode === KEY_MODE.snap && partners && !inSnap.has(slot)) {
        const other = partners[slot];
        const otherKey = TK75_SLOTS[other];
        if (!otherKey || other === slot) {
          log('info', `Snap Tap auf ${key}: Partner-Platz ${other} unbekannt – bleibt unverändert`);
          continue;
        }
        inSnap.add(slot).add(other);
        adv.push({ id: this.advancedIdFor(slot), kind: 'snap', keys: [key, otherKey] });
      } else if (mode === KEY_MODE.dks) {
        log('info', `DKS auf ${key}: wird noch nicht unterstützt – bleibt unverändert`);
      }
    }
    profile.advanced = adv;
    this.advancedRead = structuredClone(adv);
    if (adv.length) log('info', `Gelesen: erweiterte Tasten ${adv.map((a) => `${a.kind} ${a.kind === 'snap' ? a.keys.join('/') : a.key}`).join(', ')}`);
  }

  /** Erweiterte Tasten je Platz: Modus, Belegung Ebene 0/1, Mod-Tap-Zeit (10-ms-Schritte), Snap-Partner. */
  private advancedSpecs(list: AdvancedKey[]) {
    type Spec = { key: string; mode: number; l0?: number[]; l1?: number[]; mt?: number; partner?: number };
    const specs = new Map<number, Spec>();
    const slotOf = (key: string) => {
      const slot = this.keySlots[key];
      if (slot === undefined) throw new Error(`${key || 'Diese Taste'} kann keine erweiterte Taste sein.`);
      return slot;
    };
    const put = (slot: number, spec: Spec) => {
      if (specs.has(slot)) throw new Error(`${spec.key} hat mehr als eine erweiterte Funktion.`);
      specs.set(slot, spec);
    };
    for (const a of list) {
      if (a.kind === 'dks') throw new Error('DKS kann noch nicht auf die Tastatur geschrieben werden.');
      if (a.kind === 'snap') {
        const [s1, s2] = a.keys.map(slotOf);
        if (s1 === s2) throw new Error('Snap Tap braucht zwei verschiedene Tasten.');
        put(s1, { key: a.keys[0], mode: KEY_MODE.snap, partner: s2 });
        put(s2, { key: a.keys[1], mode: KEY_MODE.snap, partner: s1 });
        continue;
      }
      const slot = slotOf(a.key);
      if (a.kind === 'mt') {
        const ms = Math.min(MT_TIME_MAX_MS, Math.max(MT_TIME_STEP_MS, Math.round(a.holdMs / MT_TIME_STEP_MS) * MT_TIME_STEP_MS));
        put(slot, { key: a.key, mode: KEY_MODE.mt, l0: keyCodeToEntry(a.hold, slot), l1: keyCodeToEntry(a.tap, slot), mt: ms / MT_TIME_STEP_MS });
      } else {
        put(slot, { key: a.key, mode: a.variant === 'repeat' ? KEY_MODE.tglRepeat : KEY_MODE.tglHold, l0: keyCodeToEntry(a.code, slot) });
      }
    }
    return specs;
  }

  /**
   * Erweiterte Tasten schreiben (wie GearHub setMagnetismInfoSimple/setSnapKeySimple): je geänderter Taste Modus (Art 7,
   * RT-Bit bleibt), Mod-Tap-Zeit (Art 5) bzw. Snap-Partner (Art 9), dann die Belegungen in Ebene 0/1 (`0a … <Ebene>`).
   * Entfernte Tasten: Modus normal, Ebene 0 = normale Belegung, Ebene 1 leer.
   */
  private async writeAdvanced(profile: Profile, config: DeviceConfig): Promise<void> {
    if (!this.switchTables || !this.keymapRaw.base.length) throw new Error('Schalterwerte wurden noch nicht gelesen.');
    const want = this.advancedSpecs(profile.advanced);
    const had = this.advancedSpecs(this.advancedRead);
    const macro = this.macroLookup(config);
    for (const [slot, spec] of had) {
      if (want.has(slot)) continue;
      want.set(slot, {
        key: spec.key, mode: KEY_MODE.normal,
        l0: encodeKeyAction(actionFor(profile, 'base', spec.key), slot, 'base', macro),
        l1: spec.l1 ? [0, 0, 0, 0] : undefined,
      });
    }
    type Job = { key: string; slot: number; mag: [number, number[]][]; layers: [number, number[]][] };
    const jobs: Job[] = [];
    for (const [slot, to] of want) {
      const from = had.get(slot);
      const curMode = this.keyModes[slot] ?? 0;
      const mag: [number, number[]][] = [];
      if ((curMode & 0x7f) !== to.mode) mag.push([MAGNETISM.modes, [(curMode & 0x80) | to.mode]]);
      if (to.mt !== undefined && to.mt !== from?.mt) mag.push([MAGNETISM.mtTime, [to.mt]]);
      if (to.partner !== undefined && to.partner !== from?.partner) mag.push([MAGNETISM.snapPartner, [to.partner]]);
      const layers: [number, number[]][] = [];
      // Ebene 0 gehört nur bei Mod-Tap/Toggle zur erweiterten Taste; sonst gilt wieder die normale Belegung.
      if (!to.l0 && from?.l0) to.l0 = encodeKeyAction(actionFor(profile, 'base', to.key), slot, 'base', macro);
      if (to.l0 && !sameBytes(to.l0, this.keymapRaw.base[slot])) layers.push([0, to.l0]);
      // Ebene 1 nur bei Mod-Tap belegt; wechselt die Taste weg von Mod-Tap, wird sie geleert.
      const l1 = to.l1 ?? (from?.l1 ? [0, 0, 0, 0] : undefined);
      if (l1 && !sameBytes(l1, from?.l1 ?? [0, 0, 0, 0])) layers.push([1, l1]);
      if (mag.length || layers.length) jobs.push({ key: to.key, slot, mag, layers });
      if (to.mode !== KEY_MODE.normal) {
        const a = profile.advanced.find((x) => (x.kind === 'snap' ? x.keys : [x.key]).includes(to.key));
        if (a) this.advancedIds[slot] = a.id;
      } else delete this.advancedIds[slot];
    }
    if (!jobs.length) return;
    this.addOps(jobs.reduce((n, j) => n + j.mag.length + j.layers.length, 0) + SWITCH_READ_OPS + 12);
    for (const [n, { key, slot, mag, layers }] of jobs.entries()) {
      this.progress(`Schreibe erweiterte Taste ${key} (${n + 1}/${jobs.length}) …`);
      log('info', `Erweiterte Taste ${key} (Platz ${slot}): ${mag.map(([k, d]) => `Art ${k} = ${toHex(Uint8Array.from(d), 4)}`).join(', ')}` +
        `${layers.length ? `; ${layers.map(([l, e]) => `Ebene ${l} = ${toHex(Uint8Array.from(e), 4)}`).join(', ')}` : ''}`);
      for (const [i, [kind, data]] of mag.entries()) await this.transport.write(magnetismKeyPacket(kind, slot, i === mag.length - 1, data));
      if (mag.length) await sleep(KEY_WRITE_GAP_MS);
      for (const [layer, entry] of layers) {
        await this.transport.write(keyMatrixWritePacket(0, slot, entry, layer));
        await sleep(KEY_WRITE_GAP_MS);
      }
    }
    await sleep(500);
    this.progress('Prüfe, ob alles angekommen ist …');
    const check = structuredClone(profile);
    this.stepLabel = 'Prüfe, ob alles angekommen ist …';
    try {
      await this.readSwitches(check);
    } finally {
      this.stepLabel = null;
    }
    const got = this.advancedSpecs(check.advanced);
    const lost = [...want].filter(([slot, s]) => {
      const g = got.get(slot) ?? { key: s.key, mode: (this.keyModes[slot] ?? 0) & 0x7f };
      return g.mode !== s.mode || (s.mt !== undefined && g.mt !== s.mt) || (s.partner !== undefined && g.partner !== s.partner) ||
        (s.l0 !== undefined && !sameBytes(s.l0, this.keymapRaw.base[slot])) || (s.mode === KEY_MODE.mt && !sameBytes(s.l1 ?? [], g.l1 ?? []));
    }).map(([, s]) => s.key);
    if (lost.length) throw new Error(`Erweiterte Taste nicht übernommen: ${[...new Set(lost)].join(', ')} – bitte erneut „Übernehmen“.`);
  }

  /** Tastenbelegung + Auslösepunkt, Rapid Trigger, Totzonen (E5) → Schalterwerte je Taste. */
  private async readSwitches(profile: Profile): Promise<void> {
    // Tastenmodi zuerst: Bei erweiterten Tasten ist die Belegung (Ebene 0) Teil der erweiterten Taste.
    this.progress('Lese Schalterwerte …');
    const modes = await this.readPages((p) => magnetismReadPacket(MAGNETISM.modes, p), 2, 'Tastenmodus');
    this.keyModes = Array.from(modes.subarray(0, 128));
    await this.readKeymap(profile);
    this.progress('Lese Schalterwerte …');
    const slots = TK75_SLOTS;
    const u16 = async (kind: number, label: string) =>
      decodeU16List(await this.readPages((p) => magnetismReadPacket(kind, p), 4, label));
    const travel = await u16(MAGNETISM.travel, 'Auslösepunkt');
    const release = await u16(MAGNETISM.release, 'Rückstellpunkt');
    const rtPress = await u16(MAGNETISM.rtPress, 'RT Drücken');
    const rtRelease = await u16(MAGNETISM.rtRelease, 'RT Loslassen');
    const dzBottom = await u16(MAGNETISM.deadzoneBottom, 'Totzone unten');
    const dzTop = await this.readPages((p) => magnetismReadPacket(MAGNETISM.deadzoneTop, p), 2, 'Totzone oben');

    this.switchTables = {
      modes: Array.from(modes.subarray(0, 128)),
      travel: travel.slice(0, 128),
      release: release.slice(0, 128),
      rtPress: rtPress.slice(0, 128),
      rtRelease: rtRelease.slice(0, 128),
      deadzoneBottom: dzBottom.slice(0, 128),
      deadzoneTop: Array.from(dzTop.subarray(0, 128)),
    };
    const mm = (raw: number) => Math.round((raw / TRAVEL_STEP) * 100) / 100;
    const perKey: Record<string, SwitchConfig> = {};
    this.keySlots = {};
    this.switchState = {};
    slots.forEach((key, i) => {
      if (!key || perKey[key]) return;
      this.keySlots[key] = i;
      perKey[key] = {
        actuation: mm(travel[i]),
        releasePoint: mm(release[i]),
        rapidTrigger: decodeKeyMode(modes[i]).rapidTrigger,
        rtPress: mm(rtPress[i]),
        rtRelease: mm(rtRelease[i]),
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

    await this.readAdvanced(profile);

    const d = profile.defaultSwitch;
    log('info', `Gelesen: ${Object.keys(perKey).length} Tasten, Standard Auslösepunkt ${d.actuation} mm, Rückstellpunkt ${d.releasePoint} mm, ` +
      `RT ${d.rapidTrigger ? `an (${d.rtPress}/${d.rtRelease} mm)` : 'aus'}, Totzone ${d.deadzoneTop}/${d.deadzoneBottom} mm, ` +
      `${Object.keys(profile.switches).length} Tasten abweichend: ${Object.keys(profile.switches).slice(0, 8).join(', ')}`);
  }

  /**
   * Belegung schreiben (Basis + Fn-Ebene für Windows): nur Tasten, deren Aktion sich gegenüber dem gelesenen Stand
   * geändert hat, einzeln wie GearHub.
   */
  private async writeKeymap(profile: Profile, config: DeviceConfig): Promise<void> {
    if (!this.keymapRaw.base.length || !this.keymapRaw.fn.length) throw new Error('Tastenbelegung wurde noch nicht gelesen.');
    const macro = this.macroLookup(config);
    const changes = (['base', 'fn'] as const).flatMap((layer) => TK75_KEYMAP_SLOTS.flatMap((key, slot) => {
      if (!key) return [];
      const to = actionFor(profile, layer, key);
      if (layer === 'base' && this.isAdvancedSlot(slot)) {
        if (to.kind === 'default') return [];
        throw new Error(`${key} ist eine erweiterte Taste – die Belegung bitte unter „Erweiterte Tasten“ ändern.`);
      }
      if (JSON.stringify(to) === JSON.stringify(this.keymapRead[layer][key] ?? { kind: 'default' })) {
        // Gleiches Makro, aber evtl. andere Wiedergabeart (steht in der Belegung) → Bytes vergleichen.
        if (to.kind !== 'macro' || !macro(to.macroId)) return [];
        const entry = encodeKeyAction(to, slot, layer, macro);
        return sameBytes(entry, this.keymapRaw[layer][slot]) ? [] : [{ layer, key, slot, to, entry }];
      }
      if (key === 'Fn') throw new Error('Die Fn-Taste kann nicht umbelegt werden (sonst ist die Fn-Ebene nicht mehr erreichbar).');
      const entry = encodeKeyAction(to, slot, layer, macro);
      return [{ layer, key, slot, to, entry }];
    }));
    if (!changes.length) return;
    this.addOps(changes.length + KEYMAP_READ_OPS);
    for (const [n, { layer, key, slot, to, entry }] of changes.entries()) {
      const name = layer === 'fn' ? `Fn+${key}` : key;
      this.progress(`Belege ${name} (${n + 1}/${changes.length}) …`);
      log('info', `Belege ${name} (Platz ${slot}): ${JSON.stringify(to)} → ${toHex(Uint8Array.from(entry), 4)}`);
      await this.transport.write(layer === 'fn' ? fnMatrixWritePacket(0, slot, entry) : keyMatrixWritePacket(0, slot, entry));
      await sleep(KEY_WRITE_GAP_MS); // GearHub: vendorSleep (100 ms) nach jeder Taste
    }
    await sleep(500);
    this.progress('Prüfe, ob alles angekommen ist …');
    const check = structuredClone(profile);
    this.stepLabel = 'Prüfe, ob alles angekommen ist …';
    try {
      await this.readKeymap(check);
    } finally {
      this.stepLabel = null;
    }
    const lost = changes.filter(({ layer, slot, entry }) => !sameBytes(this.keymapRaw[layer][slot], entry))
      .map((c) => (c.layer === 'fn' ? `Fn+${c.key}` : c.key));
    if (lost.length) throw new Error(`Belegung nicht übernommen: ${lost.join(', ')} – bitte erneut „Übernehmen“.`);
  }

  /**
   * Schalterwerte schreiben: nur Tasten, die vom gelesenen Stand abweichen. Wenige Tasten einzeln,
   * viele als Sammelschreiben der geänderten Tabellen (beides wie GearHub).
   */
  private async writeSwitches(profile: Profile): Promise<void> {
    if (!Object.keys(this.switchState).length) throw new Error('Schalterwerte wurden noch nicht gelesen.');
    const changes = Object.entries(this.switchState).flatMap(([key, from]) => {
      const to = switchFor(profile, key);
      const packets = keySwitchPackets(this.keySlots[key], from, { ...to, modeByte: from.modeByte });
      return packets.length ? [{ key, to, packets }] : [];
    });
    if (!changes.length) return;
    const newModeByte = (from: KeySwitchValues, rt: boolean) =>
      rt === from.rapidTrigger ? from.modeByte : (from.modeByte & 0x7f) | (rt ? 0x80 : 0);
    if (changes.length > MAX_SWITCH_KEYS) {
      await this.writeSwitchTables(changes, newModeByte);
    } else {
      await this.writeSwitchKeys(changes, newModeByte);
    }
    // GearHub wartet danach (vendorSleep, bei Sammelschreiben 500 ms); vorher liefert die Tastatur nur Echos.
    await sleep(500);
    // Nachlesen: Die Tastatur bestätigt Schreibbefehle nicht, verlorene Pakete fielen sonst nicht auf.
    this.progress('Prüfe, ob alles angekommen ist …');
    const check = structuredClone(profile);
    this.stepLabel = 'Prüfe, ob alles angekommen ist …';
    try {
      await this.readSwitches(check);
    } finally {
      this.stepLabel = null;
    }
    const lost = changes.filter(({ key, to }) => JSON.stringify(switchFor(check, key)) !== JSON.stringify(to)).map((c) => c.key);
    if (lost.length) {
      const list = lost.length > 8 ? `${lost.slice(0, 8).join(', ')} und ${lost.length - 8} weitere` : lost.join(', ');
      throw new Error(`Nicht von der Tastatur übernommen: ${list} – bitte erneut „Übernehmen“.`);
    }
  }

  /** Sammelschreiben: Kopie der gelesenen Tabellen, nur die Plätze geänderter Tasten ersetzt; unbekannte Plätze bleiben. */
  private async writeSwitchTables(changes: SwitchChange[], newModeByte: (from: KeySwitchValues, rt: boolean) => number) {
    const from = this.switchTables;
    if (!from) throw new Error('Schaltertabellen wurden noch nicht gelesen.');
    const to: SwitchTables = structuredClone(from);
    for (const { key, to: v } of changes) {
      const i = this.keySlots[key];
      to.modes[i] = newModeByte(this.switchState[key], v.rapidTrigger);
      to.travel[i] = mmToRaw(v.actuation);
      to.release[i] = mmToRaw(v.releasePoint);
      to.rtPress[i] = mmToRaw(v.rtPress);
      to.rtRelease[i] = mmToRaw(v.rtRelease);
      to.deadzoneBottom[i] = mmToRaw(v.deadzoneBottom);
      to.deadzoneTop[i] = mmToRaw(v.deadzoneTop);
    }
    const tables = bulkSwitchPackets(from, to);
    const total = tables.reduce((n, t) => n + t.packets.length, 0);
    this.addOps(total + SWITCH_READ_OPS);
    log('info', `Sammelschreiben: ${changes.length} Tasten, Tabellen ${tables.map((t) => t.kind).join(', ')} (${total} Pakete)`);
    let sent = 0;
    for (const { packets } of tables) {
      for (const p of packets) {
        this.progress(`Schreibe alle Tasten (Teil ${++sent}/${total}) …`);
        await this.transport.write(p);
      }
      await sleep(KEY_WRITE_GAP_MS);
    }
    for (const { key, to: v } of changes) this.switchState[key] = { ...v, modeByte: newModeByte(this.switchState[key], v.rapidTrigger) };
    this.switchTables = to;
  }

  /** Einzelschreiben je Taste (65 … 00 <Platz>). */
  private async writeSwitchKeys(changes: SwitchChange[], newModeByte: (from: KeySwitchValues, rt: boolean) => number) {
    this.addOps(changes.reduce((n, c) => n + c.packets.length, 0) + SWITCH_READ_OPS);
    for (const [n, { key, to, packets }] of changes.entries()) {
      this.progress(`Schreibe ${key} (${n + 1}/${changes.length}) …`);
      log('info', `Schreibe ${key} (Platz ${this.keySlots[key]}): Auslösen ${to.actuation} mm, Rückstellen ${to.releasePoint} mm, ` +
        `RT ${to.rapidTrigger ? `an ${to.rtPress}/${to.rtRelease}` : 'aus'}, Totzone ${to.deadzoneTop}/${to.deadzoneBottom} mm`);
      for (const p of packets) await this.transport.write(p);
      // Nach dem Ende-Kennzeichen speichert die Tastatur; Pakete in dieser Zeit gehen verloren
      // (getestet: bei 40 ms Abstand kamen von F9–F12 nur F9 und F12 an). GearHub wartet 100 ms je Taste.
      await sleep(KEY_WRITE_GAP_MS);
      this.switchState[key] = { ...to, modeByte: newModeByte(this.switchState[key], to.rapidTrigger) };
    }
  }

  async writeSection(section: ConfigSection, config: DeviceConfig): Promise<void> {
    // Fortschritt beginnt mit dem Neu-Lesen, das der Store nach dem Schreiben macht; jeder Bereich addiert seine Pakete.
    if (!this.job) this.job = { done: 0, total: READ_OPS, step: '', shown: 0 };
    try {
      await this.writeSectionInner(section, config);
    } catch (e) {
      this.endJob();
      throw e;
    }
  }

  private async writeSectionInner(section: ConfigSection, config: DeviceConfig): Promise<void> {
    this.progress(`Schreibe ${SECTION_LABEL[section] ?? section} …`);
    if (section === 'settings') return this.writeSettings(config.settings);
    if (section === 'switches') return this.writeSwitches(config.profiles[config.activeProfile]);
    if (section === 'keymap') return this.writeKeymap(config.profiles[config.activeProfile], config);
    if (section === 'macros') return this.writeMacros(config);
    if (section === 'advanced') return this.writeAdvanced(config.profiles[config.activeProfile], config);
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
    this.addOps(Number(keyChanged) + Number(sideChanged));

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
    this.addOps(Number(!!rate) + Number(!!sleep));
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
