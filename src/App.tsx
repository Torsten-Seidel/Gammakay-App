import { useEffect, useState } from 'react';
import { HidChooser } from './components/HidChooser';
import { KeyboardView } from './components/KeyboardView';
import { IconRail, Sidebar, TopBar, Welcome } from './components/Shell';
import { LAYOUTS } from './device/layout';
import type { KeyId } from './device/model';
import { AdvancedPanel } from './panels/AdvancedPanel';
import { DevicePanel } from './panels/DevicePanel';
import { DiagnosePanel } from './panels/DiagnosePanel';
import { DisplayPanel } from './panels/DisplayPanel';
import { KeymapPanel } from './panels/KeymapPanel';
import { LightingPanel } from './panels/LightingPanel';
import { MacroPanel } from './panels/MacroPanel';
import { ProfilesPanel } from './panels/ProfilesPanel';
import { SwitchPanel } from './panels/SwitchPanel';
import { useApp, type View } from './store';

const PANELS: Record<Exclude<View, 'diagnose'>, () => React.JSX.Element | null> = {
  keymap: KeymapPanel,
  switches: SwitchPanel,
  advanced: AdvancedPanel,
  macros: MacroPanel,
  lighting: LightingPanel,
  display: DisplayPanel,
  device: DevicePanel,
  profiles: ProfilesPanel,
};

/** Ansichten, bei denen die Tastatur oben gebraucht wird. */
const WITH_KEYBOARD: View[] = ['keymap', 'switches', 'advanced', 'lighting', 'diagnose'];

function useKeyTester(active: boolean): KeyId[] {
  const [pressed, setPressed] = useState<KeyId[]>([]);
  useEffect(() => {
    if (!active) return;
    const down = (e: KeyboardEvent) => setPressed((p) => (p.includes(e.code) ? p : [...p, e.code]));
    const up = (e: KeyboardEvent) => setPressed((p) => p.filter((c) => c !== e.code));
    const reset = () => setPressed([]);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
      setPressed([]);
    };
  }, [active]);
  return pressed;
}

function useShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const { undo, redo, view } = useApp.getState();
      if (view === 'diagnose') return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

function Stage({ pressed }: { pressed: KeyId[] }) {
  const view = useApp((s) => s.view);
  const layer = useApp((s) => s.layer);
  const layout = useApp((s) => s.layout);
  const selected = useApp((s) => s.selected);
  const simulate = useApp((s) => s.previewSimulate);
  const { setLayer, setSelection, setPreviewSimulate } = useApp.getState();
  const isDiag = view === 'diagnose';
  return (
    <section className="stage">
      {view === 'keymap' && (
        <div className="layers">
          <div className="layers-title">Ebenen</div>
          {(['base', 'fn'] as const).map((l) => (
            <button key={l} className={`layer-btn ${layer === l ? 'active' : ''}`} onClick={() => setLayer(l)}>
              {l === 'base' ? 'Hauptebene' : 'Fn-Ebene'}
            </button>
          ))}
        </div>
      )}
      <div className="stage-center">
        <KeyboardView pressed={pressed} />
        <div className="stage-bar">
          {isDiag ? (
            <span>Tastentester: gedrückte Tasten leuchten auf.</span>
          ) : view === 'lighting' ? (
            <>
              <span>Vorschau (angenähert) – Tasten anklicken oder tippen löst reaktive Effekte aus</span>
              <label className="check">
                <input type="checkbox" checked={simulate} onChange={(e) => setPreviewSimulate(e.target.checked)} />
                Tastendrücke simulieren
              </label>
            </>
          ) : (
            <>
              <span>Tasten auswählen: Klick, Strg/Shift-Klick oder Ziehen</span>
              <button className="btn small" onClick={() => setSelection(LAYOUTS[layout].map((k) => k.id))}>Alle</button>
              <button className="btn small ghost" disabled={!selected.length} onClick={() => setSelection([])}>Keine</button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export function App() {
  const driver = useApp((s) => s.driver);
  const view = useApp((s) => s.view);
  const error = useApp((s) => s.error);
  const dismissError = useApp((s) => s.dismissError);
  const isDiag = view === 'diagnose';
  const pressed = useKeyTester(isDiag);
  useShortcuts();

  const Panel = !isDiag ? PANELS[view] : null;

  return (
    <div className="app">
      <IconRail />
      {!isDiag && <Sidebar />}
      <main className="main">
        {isDiag ? (
          <>
            <Stage pressed={pressed} />
            <DiagnosePanel />
          </>
        ) : !driver ? (
          <Welcome />
        ) : (
          <>
            <TopBar />
            {driver.writableSections && (
              <div className="banner">
                Verbunden mit <strong>{driver.info.name}</strong> ({driver.info.firmware ?? 'Firmware unbekannt'}). Vom Gerät
                gelesen: Licht und Energiespar-Zeiten – alles andere sind noch Standardwerte. Schreiben kann die App bisher
                nur das <strong>Tastenlicht</strong> (Effekt, Tempo, Helligkeit, Farbe).
              </div>
            )}
            {WITH_KEYBOARD.includes(view) && <Stage pressed={[]} />}
            {Panel && <Panel />}
          </>
        )}
      </main>
      <HidChooser />
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="link" onClick={dismissError}>Schließen</button>
        </div>
      )}
    </div>
  );
}
