import { useState } from 'react';
import { FUNCTIONS, describeAction } from '../device/keycodes';
import { keyLabel } from '../device/layout';
import { actionFor, type KeyAction } from '../device/model';
import { useApp, useProfile } from '../store';
import { Card, EmptyHint, KeyPalette, PanelHeader } from '../components/ui';

type Tab = 'key' | 'combo' | 'function' | 'macro';

export function KeymapPanel() {
  const selected = useApp((s) => s.selected);
  const layer = useApp((s) => s.layer);
  const layout = useApp((s) => s.layout);
  const macros = useApp((s) => s.config?.macros ?? []);
  const editProfile = useApp((s) => s.editProfile);
  const profile = useProfile();
  const [tab, setTab] = useState<Tab>('key');
  const [combo, setCombo] = useState<string[]>([]);
  if (!profile) return null;

  const assign = (action: KeyAction) =>
    editProfile((p) => {
      for (const k of selected) {
        if (action.kind === 'default') delete p.keymap[layer][k];
        else p.keymap[layer][k] = action;
      }
    });

  const first = selected[0];
  const current = first ? describeAction(actionFor(profile, layer, first), layout, macros) : '';

  return (
    <div className="panel">
      <PanelHeader title={`Tastenbelegung – ${layer === 'base' ? 'Hauptebene' : 'Fn-Ebene'}`}>
        <button className="btn ghost" disabled={!selected.length} onClick={() => assign({ kind: 'default' })}>
          Auf Standard zurücksetzen
        </button>
        <button className="btn ghost" disabled={!selected.length} onClick={() => assign({ kind: 'disabled' })}>
          Taste deaktivieren
        </button>
      </PanelHeader>
      <div className="grid-2-wide">
        <Card title="Auswahl">
          {selected.length ? (
            <>
              <p>
                <strong>{selected.length}</strong> Taste(n): {selected.slice(0, 8).map((k) => keyLabel(k, layout)).join(', ')}
                {selected.length > 8 && ' …'}
              </p>
              {current && <p className="hint">Aktuell: {current}</p>}
            </>
          ) : (
            <EmptyHint>Wähle oben eine oder mehrere Tasten (Strg/Shift-Klick oder Ziehen) und dann rechts die neue Funktion.</EmptyHint>
          )}
          <div className="tabs vertical">
            {([['key', 'Einzelne Taste'], ['combo', 'Tastenkombination'], ['function', 'Funktionen'], ['macro', 'Makro']] as const).map(([id, label]) => (
              <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
        </Card>
        <Card className={!selected.length ? 'disabled-area' : ''}>
          {tab === 'key' && <KeyPalette onPick={(code) => assign({ kind: 'key', code })} />}
          {tab === 'combo' && (
            <>
              <div className="row">
                <span>Kombination (max. 3):</span>
                <strong>{combo.map((c) => keyLabel(c, layout)).join(' + ') || '—'}</strong>
                <div className="spacer" />
                <button className="btn ghost" onClick={() => setCombo([])}>Leeren</button>
                <button className="btn primary" disabled={combo.length < 2} onClick={() => assign({ kind: 'combo', codes: combo })}>
                  Zuweisen
                </button>
              </div>
              <KeyPalette active={combo} onPick={(c) => setCombo((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : cur.length < 3 ? [...cur, c] : cur))} />
            </>
          )}
          {tab === 'function' && (
            <div className="palette-keys wide">
              {FUNCTIONS.map((f) => (
                <button key={f.id} className="pkey wide" onClick={() => assign({ kind: 'function', fn: f.id })}>
                  <small>{f.group}</small>
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {tab === 'macro' && (
            macros.length ? (
              <div className="palette-keys wide">
                {macros.map((m) => (
                  <button key={m.id} className="pkey wide" onClick={() => assign({ kind: 'macro', macroId: m.id })}>{m.name}</button>
                ))}
              </div>
            ) : (
              <EmptyHint>Noch keine Makros. Lege sie unter „Makros“ an.</EmptyHint>
            )
          )}
        </Card>
      </div>
    </div>
  );
}
