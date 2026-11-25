import type { LightingConfig } from '../device/model';
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

export function LightingPanel() {
  const editProfile = useApp((s) => s.editProfile);
  const writable = useApp((s) => s.driver?.writableSections);
  const { lightEffects, lightLevels } = useCapabilities();
  const profile = useProfile();
  if (!profile) return null;
  const l = profile.lighting;
  const set = (patch: Partial<LightingConfig>) => editProfile((p) => void (p.lighting = { ...p.lighting, ...patch }));
  const unknownEffect = !lightEffects.some((e) => e.id === l.effect);
  const options = lightEffects.find((e) => e.id === l.effect)?.options;

  return (
    <div className="panel">
      <PanelHeader title="Beleuchtung" />
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
          <div className="row">
            <button className={`chip ${l.rainbow ? 'active' : ''}`} onClick={() => set({ rainbow: true })}>Bunt („Glanz“)</button>
            <button className={`chip ${!l.rainbow ? 'active' : ''}`} onClick={() => set({ rainbow: false })}>Eine Farbe</button>
          </div>
          <div className={`stack ${l.rainbow ? 'dimmed' : ''}`}>
            <div className="row">
              <input type="color" value={l.color} onChange={(e) => set({ color: e.target.value, rainbow: false })} />
              <code>{l.color}</code>
            </div>
            <div className="swatches">
              {SWATCHES.map((c) => (
                <button key={c} className="swatch" style={{ background: c }} title={c} onClick={() => set({ color: c, rainbow: false })} />
              ))}
            </div>
          </div>
          <Slider label="Helligkeit" value={l.brightness} min={0} max={lightLevels} step={1} onChange={(v) => set({ brightness: v })} />
          <Slider label="Tempo" value={l.speed} min={0} max={lightLevels} step={1} onChange={(v) => set({ speed: v })} />
        </Card>
        <Card title="Seitenlicht">
          <dl className="info-list">
            <dt>Effekt</dt><dd>{effectLabel(l.side.effect, lightEffects)}</dd>
            <dt>Farbe</dt>
            <dd>
              {l.side.rainbow ? 'bunt' : <><span className="swatch inline" style={{ background: l.side.color }} /> {l.side.color}</>}
            </dd>
            <dt>Helligkeit</dt><dd>{l.side.brightness}</dd>
            <dt>Tempo</dt><dd>{l.side.speed}</dd>
          </dl>
          <EmptyHint>
            {writable ? 'Das Seitenlicht wird bisher nur gelesen – Ändern folgt nach dem nächsten Mitschnitt.' : 'Nur Anzeige.'}
          </EmptyHint>
        </Card>
      </div>
    </div>
  );
}
