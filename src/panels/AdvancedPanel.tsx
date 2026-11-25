import { useState } from 'react';
import { keyLabel } from '../device/layout';
import { newId, type AdvancedKey, type AdvancedKind, type SnapMode } from '../device/model';
import { useApp, useProfile } from '../store';
import { Card, EmptyHint, KeyCodeSelect, PanelHeader, Slider } from '../components/ui';
import { Icon } from '../components/Icon';

const KINDS: { kind: AdvancedKind; title: string; text: string; keys: number }[] = [
  { kind: 'dks', title: 'DKS – Dynamischer Tastenanschlag', text: 'Bis zu 4 Aktionen an zwei Auslösepunkten (Drücken / Loslassen).', keys: 1 },
  { kind: 'mt', title: 'MT – Tippen oder Halten', text: 'Kurz tippen löst eine andere Taste aus als Gedrückthalten.', keys: 1 },
  { kind: 'tgl', title: 'TGL – Umschalten', text: 'Einmal drücken hält die Taste gedrückt, nochmal drücken lässt los.', keys: 1 },
  { kind: 'snap', title: 'SnapKey (SOCD)', text: 'Zwei Tasten (z. B. A/D): regelt, welche gewinnt, wenn beide gedrückt sind.', keys: 2 },
];

const SNAP_MODES: { mode: SnapMode; label: string }[] = [
  { mode: 'last', label: 'Letzte Eingabe gewinnt' },
  { mode: 'neutral', label: 'Neutral (beide aus)' },
  { mode: 'first-wins', label: 'Erste Taste hat Vorrang' },
  { mode: 'second-wins', label: 'Zweite Taste hat Vorrang' },
];

const PHASES = ['1. Punkt ↓', 'ganz ↓', 'ganz ↑', '1. Punkt ↑'];

export function AdvancedPanel() {
  const selected = useApp((s) => s.selected);
  const layout = useApp((s) => s.layout);
  const editProfile = useApp((s) => s.editProfile);
  const profile = useProfile();
  const [editingId, setEditingId] = useState<string | null>(null);
  if (!profile) return null;

  const create = (kind: AdvancedKind) => {
    const id = newId(kind);
    const key = selected[0];
    let entry: AdvancedKey;
    if (kind === 'dks') entry = { id, kind, key, firstPoint: 1.0, secondPoint: 3.0, bindings: [{ code: key, phases: [true, false, false, true] }] };
    else if (kind === 'mt') entry = { id, kind, key, tap: key, hold: 'ShiftLeft', holdMs: 200 };
    else if (kind === 'tgl') entry = { id, kind, key, code: key };
    else entry = { id, kind, keys: [selected[0], selected[1]], mode: 'last' };
    editProfile((p) => void p.advanced.push(entry));
    setEditingId(id);
  };

  const update = (id: string, fn: (a: AdvancedKey) => void) =>
    editProfile((p) => {
      const a = p.advanced.find((x) => x.id === id);
      if (a) fn(a);
    });
  const remove = (id: string) => editProfile((p) => void (p.advanced = p.advanced.filter((a) => a.id !== id)));

  const keysOf = (a: AdvancedKey) => (a.kind === 'snap' ? a.keys : [a.key]).map((k) => keyLabel(k, layout)).join(' / ');
  const editing = profile.advanced.find((a) => a.id === editingId);

  return (
    <div className="panel">
      <PanelHeader title="Erweiterte Tasten" />
      <div className="grid-2">
        <Card title="Neue erweiterte Taste">
          <EmptyHint>Wähle zuerst die Taste(n) auf der Tastatur, dann die Art.</EmptyHint>
          <div className="stack">
            {KINDS.map((k) => (
              <button key={k.kind} className="option-card" disabled={selected.length < k.keys} onClick={() => create(k.kind)}>
                <strong>{k.title}</strong>
                <span>{k.text}</span>
                {selected.length < k.keys && <small>Benötigt {k.keys} ausgewählte Taste(n)</small>}
              </button>
            ))}
          </div>
        </Card>
        <Card title={`Aktive erweiterte Tasten (${profile.advanced.length})`}>
          {!profile.advanced.length && <EmptyHint>Noch keine.</EmptyHint>}
          <div className="stack">
            {profile.advanced.map((a) => (
              <div key={a.id} className={`list-row ${a.id === editingId ? 'active' : ''}`} onClick={() => setEditingId(a.id)}>
                <span className="tag">{a.kind.toUpperCase()}</span>
                <span>{keysOf(a)}</span>
                <div className="spacer" />
                <button className="icon-btn" title="Löschen" onClick={(e) => { e.stopPropagation(); remove(a.id); }}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
          {editing && (
            <div className="editor">
              {editing.kind === 'dks' && (
                <>
                  <Slider label="1. Auslösepunkt" value={editing.firstPoint} min={0.1} max={3.4} step={0.05} unit="mm"
                    onChange={(v) => update(editing.id, (a) => a.kind === 'dks' && (a.firstPoint = v))} />
                  <Slider label="2. Auslösepunkt" value={editing.secondPoint} min={0.1} max={3.4} step={0.05} unit="mm"
                    onChange={(v) => update(editing.id, (a) => a.kind === 'dks' && (a.secondPoint = v))} />
                  <table className="dks-table">
                    <thead>
                      <tr><th>Taste</th>{PHASES.map((p) => <th key={p}>{p}</th>)}<th /></tr>
                    </thead>
                    <tbody>
                      {editing.bindings.map((b, i) => (
                        <tr key={i}>
                          <td><KeyCodeSelect value={b.code} onChange={(c) => update(editing.id, (a) => a.kind === 'dks' && (a.bindings[i].code = c))} /></td>
                          {b.phases.map((on, j) => (
                            <td key={j}>
                              <input type="checkbox" checked={on}
                                onChange={(e) => update(editing.id, (a) => a.kind === 'dks' && (a.bindings[i].phases[j] = e.target.checked))} />
                            </td>
                          ))}
                          <td>
                            <button className="icon-btn" onClick={() => update(editing.id, (a) => a.kind === 'dks' && a.bindings.splice(i, 1))}>
                              <Icon name="trash" size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button className="btn ghost" disabled={editing.bindings.length >= 4}
                    onClick={() => update(editing.id, (a) => a.kind === 'dks' && a.bindings.push({ code: '', phases: [false, false, false, false] }))}>
                    Aktion hinzufügen
                  </button>
                </>
              )}
              {editing.kind === 'mt' && (
                <>
                  <label className="field">Tippen<KeyCodeSelect value={editing.tap} onChange={(c) => update(editing.id, (a) => a.kind === 'mt' && (a.tap = c))} /></label>
                  <label className="field">Halten<KeyCodeSelect value={editing.hold} onChange={(c) => update(editing.id, (a) => a.kind === 'mt' && (a.hold = c))} /></label>
                  <Slider label="Haltezeit" value={editing.holdMs} min={50} max={1000} step={10} unit="ms"
                    onChange={(v) => update(editing.id, (a) => a.kind === 'mt' && (a.holdMs = v))} />
                </>
              )}
              {editing.kind === 'tgl' && (
                <label className="field">Umgeschaltete Taste<KeyCodeSelect value={editing.code} onChange={(c) => update(editing.id, (a) => a.kind === 'tgl' && (a.code = c))} /></label>
              )}
              {editing.kind === 'snap' && (
                <label className="field">Modus
                  <select value={editing.mode} onChange={(e) => update(editing.id, (a) => a.kind === 'snap' && (a.mode = e.target.value as SnapMode))}>
                    {SNAP_MODES.map((m) => <option key={m.mode} value={m.mode}>{m.label}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
