import { useState } from 'react';
import type { LightingConfig } from '../device/model';
import { batteryZone, type BatteryIndicatorConfig } from '../device/battery';
import { useApp, useCapabilities, useProfile } from '../store';
import { Card, EmptyHint, PanelHeader, Slider } from '../components/ui';

const SWATCHES = ['#ff0000', '#ff8000', '#ffe000', '#00ff40', '#00c8ff', '#0040ff', '#8b00ff', '#ff00c8', '#ffffff'];

function effectLabel(id: string, effects: { id: string; label: string }[]): string {
  return effects.find((e) => e.id === id)?.label ?? (id.startsWith('device-') ? `Unbekannt (${id.slice(7)})` : id);
}

/** Pfeilsymbole passend zu den Optionstexten */
const OPTION_ICON: Record<string, string> = {
  'Nach rechts': '→', 'Nach links': '←', 'Nach unten': '↓', 'Nach oben': '↑',
  'Nach außen': '⤢', 'Nach innen': '⤡', 'Gegen den Uhrzeigersinn': '↺', 'Im Uhrzeigersinn': '↻',
  Zickzack: '⇌', Spirale: '◎',
};

function DirectionControl({ options, value, onChange }: { options: string[]; value: number; onChange: (i: number) => void }) {
  // Vier Richtungen (Welle) als Steuerkreuz; Reihenfolge im Gerät: rechts, links, unten, oben
  if (options.length === 4) {
    const cell = (i: number, area: string) => (
      <button
        key={i}
        className={`dpad-btn ${value === i ? 'active' : ''}`}
        style={{ gridArea: area }}
        title={options[i]}
        aria-label={options[i]}
        onClick={() => onChange(i)}
      >
        {OPTION_ICON[options[i]] ?? i + 1}
      </button>
    );
    return (
      <div className="dpad-wrap">
        <div className="dpad">
          {cell(3, 'up')}
          {cell(1, 'left')}
          <span className="dpad-center" style={{ gridArea: 'mid' }} />
          {cell(0, 'right')}
          {cell(2, 'down')}
        </div>
        <span className="hint">{options[value]}</span>
      </div>
    );
  }
  return (
    <div className="row">
      {options.map((o, i) => (
        <button key={o} className={`chip ${value === i ? 'active' : ''}`} onClick={() => onChange(i)}>
          <span className="chip-icon">{OPTION_ICON[o]}</span> {o}
        </button>
      ))}
    </div>
  );
}

/** Bunt/Eine Farbe, Farbwähler und Farbfelder */
function ColorChoice({ rainbow, color, onChange, disabled }: {
  rainbow: boolean; color: string; disabled?: boolean; onChange: (patch: { rainbow?: boolean; color?: string }) => void;
}) {
  return (
    <>
      <div className={`row ${disabled ? 'dimmed' : ''}`}>
        <button className={`chip ${rainbow ? 'active' : ''}`} onClick={() => onChange({ rainbow: true })}>Bunt („Glanz“)</button>
        <button className={`chip ${!rainbow ? 'active' : ''}`} onClick={() => onChange({ rainbow: false })}>Eine Farbe</button>
      </div>
      <div className={`stack ${rainbow || disabled ? 'dimmed' : ''}`}>
        <div className="row">
          <input type="color" value={color} onChange={(e) => onChange({ color: e.target.value, rainbow: false })} />
          <code>{color}</code>
        </div>
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button key={c} className="swatch" style={{ background: c }} title={c} onClick={() => onChange({ color: c, rainbow: false })} />
          ))}
        </div>
      </div>
    </>
  );
}

type Tab = 'keys' | 'side';

export function LightingPanel() {
  const [tab, setTab] = useState<Tab>('keys');
  return (
    <div className="panel">
      <PanelHeader title="Beleuchtung" />
      <div className="tabs horizontal">
        <button className={`tab ${tab === 'keys' ? 'active' : ''}`} onClick={() => setTab('keys')}>Tastenlicht</button>
        <button className={`tab ${tab === 'side' ? 'active' : ''}`} onClick={() => setTab('side')}>Seitenlicht</button>
      </div>
      {tab === 'keys' ? <KeyLighting /> : <SideLighting />}
    </div>
  );
}

function KeyLighting() {
  const editProfile = useApp((s) => s.editProfile);
  const { lightEffects, lightLevels } = useCapabilities();
  const profile = useProfile();
  if (!profile) return null;
  const l = profile.lighting;
  const set = (patch: Partial<LightingConfig>) => editProfile((p) => void (p.lighting = { ...p.lighting, ...patch }));
  const unknownEffect = !lightEffects.some((e) => e.id === l.effect);
  const options = lightEffects.find((e) => e.id === l.effect)?.options;

  return (
    <div className="grid-light">
      <Card title="Lichteffekt">
        {unknownEffect && (
          <p className="hint">Aktuell auf dem Gerät: <strong>{effectLabel(l.effect, lightEffects)}</strong> – wähle einen Effekt, um ihn zu ändern.</p>
        )}
        <div className="chip-grid six">
          {lightEffects.map((e) => (
            <button
              key={e.id}
              className={`chip ${l.effect === e.id ? 'active' : ''}`}
              onClick={() => e.id !== l.effect && set({ effect: e.id, option: 0 })}
            >
              {e.label}
            </button>
          ))}
        </div>
        {options && (
          <div className="direction">
            <div className="direction-title">Richtung</div>
            <DirectionControl options={options} value={Math.min(l.option ?? 0, options.length - 1)} onChange={(i) => set({ option: i })} />
          </div>
        )}
      </Card>
      <Card title="Farbe">
        <ColorChoice rainbow={l.rainbow} color={l.color} onChange={(p) => set(p)} />
        <Slider label="Helligkeit" value={l.brightness} min={0} max={lightLevels} step={1} onChange={(v) => set({ brightness: v })} />
        <Slider label="Tempo" value={l.speed} min={0} max={lightLevels} step={1} onChange={(v) => set({ speed: v })} />
      </Card>
    </div>
  );
}

function SideLighting() {
  const editProfile = useApp((s) => s.editProfile);
  const writable = useApp((s) => s.driver?.writableSections);
  const indicatorOn = useApp((s) => s.batteryIndicator.enabled);
  const { lightLevels, sideLightEffects: sideEffects, sideSpeedMax } = useCapabilities();
  const profile = useProfile();
  if (!profile) return null;
  const s = profile.lighting.side;
  const sideOff = s.effect === 'off';
  const rainbowOnly = !!sideEffects.find((e) => e.id === s.effect)?.rainbowOnly;
  const setSide = (patch: Partial<LightingConfig['side']>) =>
    editProfile((p) => void (p.lighting = { ...p.lighting, side: { ...p.lighting.side, ...patch } }));

  return (
    <div className="grid-side">
      <Card title="Effekt">
        {!sideEffects.some((e) => e.id === s.effect) && (
          <p className="hint">Aktuell auf dem Gerät: <strong>{effectLabel(s.effect, sideEffects)}</strong> – wähle einen Effekt, um ihn zu ändern.</p>
        )}
        {indicatorOn && <p className="hint">Die Akkuanzeige ist aktiv – im Warnbereich hat sie Vorrang vor dieser Einstellung.</p>}
        <div className="chip-grid">
          {sideEffects.map((e) => (
            <button
              key={e.id}
              className={`chip ${s.effect === e.id ? 'active' : ''}`}
              onClick={() =>
                // Im Zustand „Aus“ meldet das Gerät Helligkeit 0 – sonst bliebe der neue Effekt dunkel (GearHub nimmt 4).
                setSide(e.id !== 'off' && s.brightness === 0 ? { effect: e.id, brightness: lightLevels } : { effect: e.id })}
            >
              {e.label}
            </button>
          ))}
        </div>
        {writable && !writable.includes('lighting') && <EmptyHint>Nur Anzeige.</EmptyHint>}
      </Card>
      <Card title="Farbe">
        {rainbowOnly && <p className="hint">Neon wechselt immer durch alle Farben – die Farbauswahl gilt hier nicht.</p>}
        <div className={`stack ${sideOff ? 'dimmed' : ''}`}>
          <ColorChoice rainbow={s.rainbow} color={s.color} disabled={rainbowOnly} onChange={(p) => setSide(p)} />
          <Slider label="Helligkeit" value={s.brightness} min={0} max={lightLevels} step={1} onChange={(v) => setSide({ brightness: v })} />
          <Slider label="Tempo" value={Math.min(s.speed, sideSpeedMax)} min={0} max={sideSpeedMax} step={1} onChange={(v) => setSide({ speed: v })} />
        </div>
      </Card>
      <BatteryIndicatorCard />
    </div>
  );
}

const ZONE_LABEL = { normal: 'Normal', low: 'Niedrig', critical: 'Kritisch' } as const;

function BatteryIndicatorCard() {
  const cfg = useApp((s) => s.batteryIndicator);
  const setCfg = useApp((s) => s.setBatteryIndicator);
  const battery = useApp((s) => s.battery);
  const transport = useApp((s) => s.driver?.info.transport);
  const update = (patch: Partial<BatteryIndicatorConfig>) => setCfg({ ...cfg, ...patch });
  const zone = battery !== null ? batteryZone(battery, cfg) : null;

  return (
    <Card title="Akkuanzeige">
      <div className="row">
        <button className={`btn ${cfg.enabled ? 'primary' : ''}`} onClick={() => update({ enabled: !cfg.enabled })}>
          {cfg.enabled ? 'Akkuanzeige an' : 'Akkuanzeige aus'}
        </button>
        {battery !== null && (
          <span className="hint">Akku {battery} %{cfg.enabled && zone ? ` · Bereich ${ZONE_LABEL[zone]}` : ''}</span>
        )}
      </div>
      <p className="hint">
        Das Seitenlicht warnt bei niedrigem Akku. Funktioniert nur kabellos (Bluetooth oder Empfänger) und solange die App läuft;
        beim Ausschalten wird deine eigene Seitenlicht-Einstellung wiederhergestellt.
      </p>
      {transport !== 'bt' && transport !== 'dongle' && <p className="hint">Gerade nicht kabellos verbunden – kein Akkustand verfügbar.</p>}
      {cfg.enabled && (
        <div className="battery-zones">
          <div className="battery-zone">
            <div className="zone-head">
              <span className="zone-dot" style={{ background: cfg.normal.useOwn ? 'var(--surface-3, #444)' : cfg.normal.color }} />
              <strong>Normal</strong>
              <span className="hint">über {cfg.low.percent} %</span>
            </div>
            <div className="row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={cfg.normal.useOwn}
                  onChange={(e) => update({ normal: { ...cfg.normal, useOwn: e.target.checked } })}
                />
                Eigene Seitenlicht-Einstellung
              </label>
              {!cfg.normal.useOwn && (
                <input type="color" value={cfg.normal.color} onChange={(e) => update({ normal: { ...cfg.normal, color: e.target.value } })} />
              )}
            </div>
          </div>
          <div className="battery-zone">
            <div className="zone-head">
              <span className="zone-dot" style={{ background: cfg.low.color }} />
              <strong>Niedrig</strong>
              <span className="hint">leuchtet dauerhaft</span>
            </div>
            <div className="row">
              <label className="percent">
                ab
                <input
                  type="number" min={1} max={100} value={cfg.low.percent}
                  onChange={(e) => update({ low: { ...cfg.low, percent: Number(e.target.value) } })}
                />
                %
              </label>
              <input type="color" value={cfg.low.color} onChange={(e) => update({ low: { ...cfg.low, color: e.target.value } })} />
            </div>
          </div>
          <div className="battery-zone">
            <div className="zone-head">
              <span className="zone-dot pulse" style={{ background: cfg.critical.color }} />
              <strong>Kritisch</strong>
              <span className="hint">pulsiert</span>
            </div>
            <div className="row">
              <label className="percent">
                ab
                <input
                  type="number" min={1} max={99} value={cfg.critical.percent}
                  onChange={(e) => update({ critical: { ...cfg.critical, percent: Number(e.target.value) } })}
                />
                %
              </label>
              <input type="color" value={cfg.critical.color} onChange={(e) => update({ critical: { ...cfg.critical, color: e.target.value } })} />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
