import type { LightDirection, LightEffect } from '../device/model';
import { useApp, useProfile } from '../store';
import { Card, EmptyHint, PanelHeader, Slider } from '../components/ui';

const EFFECTS: { id: LightEffect; label: string }[] = [
  { id: 'off', label: 'Aus' },
  { id: 'static', label: 'Statisch' },
  { id: 'breathing', label: 'Atmen' },
  { id: 'wave', label: 'Welle' },
  { id: 'ripple', label: 'Ripple' },
  { id: 'starlight', label: 'Sternenlicht' },
  { id: 'reactive', label: 'Reaktiv' },
  { id: 'spectrum', label: 'Spektrum' },
  { id: 'custom', label: 'Pro Taste' },
];
const DEVICE_EFFECT = { id: 'device' as const, label: 'Vom Gerät' };

const DIRECTIONS: { id: LightDirection; label: string }[] = [
  { id: 'right', label: '→' }, { id: 'left', label: '←' }, { id: 'down', label: '↓' }, { id: 'up', label: '↑' },
];

const SWATCHES = ['#ff3b3b', '#ff9f1a', '#ffe14d', '#3ddc84', '#2ec5ff', '#3b6bff', '#8b7cf6', '#ff4fd8', '#ffffff'];

export function LightingPanel() {
  const selected = useApp((s) => s.selected);
  const editProfile = useApp((s) => s.editProfile);
  const profile = useProfile();
  if (!profile) return null;
  const l = profile.lighting;
  const set = (patch: Partial<typeof l>) => editProfile((p) => void (p.lighting = { ...p.lighting, ...patch }));

  const paintSelected = () =>
    editProfile((p) => {
      for (const k of selected) p.lighting.perKey[k] = p.lighting.color;
    });

  return (
    <div className="panel">
      <PanelHeader title="Beleuchtung" />
      <div className="grid-3">
        <Card title="Effekt">
          <div className="chip-grid">
            {(l.effect === 'device' ? [DEVICE_EFFECT, ...EFFECTS] : EFFECTS).map((e) => (
              <button key={e.id} className={`chip ${l.effect === e.id ? 'active' : ''}`} onClick={() => set({ effect: e.id })}>{e.label}</button>
            ))}
          </div>
          <div className="row">
            <span>Richtung</span>
            {DIRECTIONS.map((d) => (
              <button key={d.id} className={`chip small ${l.direction === d.id ? 'active' : ''}`} onClick={() => set({ direction: d.id })}>{d.label}</button>
            ))}
          </div>
        </Card>
        <Card title="Farbe & Helligkeit">
          <div className="row">
            <input type="color" value={l.color} onChange={(e) => set({ color: e.target.value })} />
            <code>{l.color}</code>
          </div>
          <div className="swatches">
            {SWATCHES.map((c) => (
              <button key={c} className="swatch" style={{ background: c }} title={c} onClick={() => set({ color: c })} />
            ))}
          </div>
          <Slider label="Helligkeit" value={l.brightness} min={0} max={4} step={1} onChange={(v) => set({ brightness: v })} />
          <Slider label="Tempo" value={l.speed} min={0} max={4} step={1} onChange={(v) => set({ speed: v })} />
        </Card>
        <Card title="Pro Taste & Seitenlicht">
          {l.effect === 'custom' ? (
            <div className="row">
              <button className="btn primary" disabled={!selected.length} onClick={paintSelected}>Farbe auf Auswahl</button>
              <button className="btn ghost" onClick={() => set({ perKey: {} })}>Alle löschen</button>
            </div>
          ) : (
            <EmptyHint>Für Farben pro Taste den Effekt „Pro Taste“ wählen.</EmptyHint>
          )}
          <div className="divider" />
          <div className="row">
            <span>Seitenlicht</span>
            <select value={l.side.effect} onChange={(e) => set({ side: { ...l.side, effect: e.target.value as LightEffect } })}>
              {[DEVICE_EFFECT, ...EFFECTS.filter((e) => e.id !== 'custom')].map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
            <input type="color" value={l.side.color} onChange={(e) => set({ side: { ...l.side, color: e.target.value } })} />
          </div>
          <Slider label="Helligkeit Seitenlicht" value={l.side.brightness} min={0} max={4} step={1}
            onChange={(v) => set({ side: { ...l.side, brightness: v } })} />
        </Card>
      </div>
    </div>
  );
}
