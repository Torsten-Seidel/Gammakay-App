import { create } from 'zustand';
import { TK75_CAPABILITIES, type Capabilities, type KeyboardDriver } from './device/driver';
import { log } from './device/log';
import type { LayoutVariant } from './device/layout';
import {
  diffSections, type ConfigSection, type DeviceConfig, type KeyId, type LayerId, type Macro, type Profile,
} from './device/model';

export type View =
  | 'keymap' | 'switches' | 'advanced' | 'macros' | 'lighting' | 'display' | 'device' | 'profiles' | 'diagnose';

const HISTORY_LIMIT = 50;
const LAYOUT_KEY = 'tk75.layout';

function loadLayout(): LayoutVariant {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'ansi-us' ? 'ansi-us' : 'iso-de';
  } catch {
    return 'iso-de';
  }
}

interface AppState {
  driver: KeyboardDriver | null;
  /** Stand auf dem Gerät (zuletzt gelesen oder geschrieben) */
  deviceConfig: DeviceConfig | null;
  /** Bearbeiteter Entwurf */
  config: DeviceConfig | null;
  past: DeviceConfig[];
  future: DeviceConfig[];
  view: View;
  layer: LayerId;
  layout: LayoutVariant;
  selected: KeyId[];
  busy: boolean;
  error: string | null;

  connect(driver: KeyboardDriver): Promise<void>;
  disconnect(): Promise<void>;
  setView(view: View): void;
  setLayer(layer: LayerId): void;
  setLayout(layout: LayoutVariant): void;
  setSelection(keys: KeyId[]): void;
  toggleKey(key: KeyId, additive: boolean): void;
  edit(recipe: (draft: DeviceConfig) => void): void;
  editProfile(recipe: (profile: Profile, draft: DeviceConfig) => void): void;
  undo(): void;
  redo(): void;
  apply(): Promise<void>;
  revert(): void;
  dismissError(): void;
}

export const useApp = create<AppState>((set, get) => ({
  driver: null,
  deviceConfig: null,
  config: null,
  past: [],
  future: [],
  view: 'keymap',
  layer: 'base',
  layout: loadLayout(),
  selected: [],
  busy: false,
  error: null,

  async connect(driver) {
    set({ busy: true, error: null });
    try {
      const cfg = await driver.readConfig();
      set({ driver, deviceConfig: cfg, config: structuredClone(cfg), past: [], future: [], selected: [] });
    } catch (e) {
      set({ error: String(e) });
      log('error', String(e));
    } finally {
      set({ busy: false });
    }
  },

  async disconnect() {
    const { driver } = get();
    try {
      await driver?.disconnect();
    } catch (e) {
      log('error', String(e));
    }
    set({ driver: null, deviceConfig: null, config: null, past: [], future: [], selected: [] });
  },

  setView: (view) => set({ view }),
  setLayer: (layer) => set({ layer }),
  setLayout(layout) {
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      // nicht kritisch
    }
    set({ layout });
  },
  setSelection: (keys) => set({ selected: keys }),
  toggleKey(key, additive) {
    const { selected } = get();
    if (!additive) set({ selected: [key] });
    else set({ selected: selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key] });
  },

  edit(recipe) {
    const { config, past } = get();
    if (!config) return;
    const draft = structuredClone(config);
    recipe(draft);
    set({ config: draft, past: [...past.slice(-(HISTORY_LIMIT - 1)), config], future: [] });
  },
  editProfile(recipe) {
    get().edit((draft) => recipe(draft.profiles[draft.activeProfile], draft));
  },

  undo() {
    const { past, config, future } = get();
    if (!past.length || !config) return;
    set({ config: past[past.length - 1], past: past.slice(0, -1), future: [config, ...future] });
  },
  redo() {
    const { past, config, future } = get();
    if (!future.length || !config) return;
    set({ config: future[0], future: future.slice(1), past: [...past, config] });
  },

  async apply() {
    const { driver, config, deviceConfig } = get();
    if (!driver || !config || !deviceConfig) return;
    const changed = diffSections(deviceConfig, config);
    const sections = driver.writableSections ? changed.filter((s) => driver.writableSections!.includes(s)) : changed;
    const skipped = changed.filter((s) => !sections.includes(s));
    if (!sections.length) {
      if (skipped.length) set({ error: `Diese Änderungen kann die App noch nicht auf die Tastatur schreiben: ${skipped.join(', ')}` });
      return;
    }
    set({ busy: true, error: null });
    try {
      for (const section of sections) await driver.writeSection(section, config);
      // Mit Teil-Unterstützung den echten Gerätestand neu lesen, sonst gilt der Entwurf als geschrieben.
      const fresh = driver.writableSections ? await driver.readConfig() : structuredClone(config);
      set({ deviceConfig: fresh });
      log('info', `Übernommen: ${sections.join(', ')}`);
      if (skipped.length) log('info', `Nicht geschrieben (noch nicht unterstützt): ${skipped.join(', ')}`);
    } catch (e) {
      set({ error: String(e) });
      log('error', String(e));
    } finally {
      set({ busy: false });
    }
  },

  revert() {
    const { deviceConfig, config, past } = get();
    if (!deviceConfig || !config) return;
    set({ config: structuredClone(deviceConfig), past: [...past, config], future: [] });
  },

  dismissError: () => set({ error: null }),
}));

export function useDirtySections(): ConfigSection[] {
  const config = useApp((s) => s.config);
  const deviceConfig = useApp((s) => s.deviceConfig);
  return config && deviceConfig ? diffSections(deviceConfig, config) : [];
}

// Selektoren müssen stabile Referenzen liefern: ein neues `[]` pro Aufruf löst in Zustand v5 eine Endlosschleife aus.
const NO_MACROS: Macro[] = [];

export function useMacros(): Macro[] {
  return useApp((s) => s.config?.macros ?? NO_MACROS);
}

export function useCapabilities(): Capabilities {
  return useApp((s) => s.driver?.capabilities ?? TK75_CAPABILITIES);
}

export function useProfile(): Profile | null {
  return useApp((s) => (s.config ? s.config.profiles[s.config.activeProfile] : null));
}
