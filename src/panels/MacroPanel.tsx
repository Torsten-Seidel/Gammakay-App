import { useEffect, useRef, useState } from 'react';
import { keyLabel } from '../device/layout';
import { newId, type MacroPlayback, type MacroStep } from '../device/model';
import { useApp } from '../store';
import { Card, EmptyHint, PanelHeader } from '../components/ui';
import { Icon } from '../components/Icon';

const PLAYBACK: { id: MacroPlayback; label: string }[] = [
  { id: 'once', label: 'Einmal abspielen' },
  { id: 'repeat', label: 'N-mal wiederholen' },
  { id: 'while-held', label: 'Solange gedrückt' },
  { id: 'toggle', label: 'Start/Stopp per Tastendruck' },
];

export function MacroPanel() {
  const macros = useApp((s) => s.config?.macros ?? []);
  const layout = useApp((s) => s.layout);
  const edit = useApp((s) => s.edit);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recorded = useRef<MacroStep[]>([]);
  const lastTime = useRef(0);
  const macro = macros.find((m) => m.id === activeId) ?? null;

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      const now = performance.now();
      if (recorded.current.length) recorded.current.push({ type: 'delay', ms: Math.round(now - lastTime.current) });
      lastTime.current = now;
      recorded.current.push({ type: e.type === 'keydown' ? 'down' : 'up', code: e.code });
    };
    window.addEventListener('keydown', handler, true);
    window.addEventListener('keyup', handler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('keyup', handler, true);
    };
  }, [recording]);

  const update = (fn: (m: (typeof macros)[number]) => void) =>
    edit((d) => {
      const m = d.macros.find((x) => x.id === activeId);
      if (m) fn(m);
    });

  const addMacro = () => {
    const id = newId('macro');
    edit((d) => void d.macros.push({ id, name: `Makro ${d.macros.length + 1}`, steps: [], repeat: 1, playback: 'once' }));
    setActiveId(id);
  };

  const toggleRecording = () => {
    if (recording) {
      const steps = recorded.current;
      update((m) => void (m.steps = [...m.steps, ...steps]));
      setRecording(false);
    } else {
      recorded.current = [];
      setRecording(true);
    }
  };

  return (
    <div className="panel">
      <PanelHeader title="Makros">
        <button className="btn" onClick={addMacro}><Icon name="plus" size={16} /> Neues Makro</button>
      </PanelHeader>
      <div className="grid-sidebar">
        <Card title="Bibliothek">
          {!macros.length && <EmptyHint>Noch keine Makros.</EmptyHint>}
          <div className="stack">
            {macros.map((m) => (
              <div key={m.id} className={`list-row ${m.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(m.id)}>
                <span>{m.name}</span>
                <div className="spacer" />
                <small>{m.steps.filter((s) => s.type !== 'delay').length} Ereignisse</small>
              </div>
            ))}
          </div>
        </Card>
        <Card
          title={macro ? <input className="title-input" value={macro.name} onChange={(e) => update((m) => void (m.name = e.target.value))} /> : 'Editor'}
          actions={macro && (
            <div className="row">
              <button className={`btn ${recording ? 'danger' : 'primary'}`} onClick={toggleRecording}>
                <Icon name="record" size={14} /> {recording ? 'Aufnahme stoppen' : 'Aufnehmen'}
              </button>
              <button className="btn ghost" disabled={recording} onClick={() => update((m) => void (m.steps = []))}>Leeren</button>
              <button className="icon-btn" disabled={recording} title="Makro löschen"
                onClick={() => { edit((d) => void (d.macros = d.macros.filter((x) => x.id !== activeId))); setActiveId(null); }}>
                <Icon name="trash" size={16} />
              </button>
            </div>
          )}
        >
          {!macro ? (
            <EmptyHint>Wähle links ein Makro oder lege ein neues an.</EmptyHint>
          ) : (
            <>
              {recording && <p className="recording">● Aufnahme läuft – tippe jetzt die gewünschte Tastenfolge.</p>}
              <div className="row">
                <label className="field inline">Wiedergabe
                  <select value={macro.playback} onChange={(e) => update((m) => void (m.playback = e.target.value as MacroPlayback))}>
                    {PLAYBACK.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </label>
                {macro.playback === 'repeat' && (
                  <label className="field inline">Anzahl
                    <input type="number" min={1} max={255} value={macro.repeat}
                      onChange={(e) => update((m) => void (m.repeat = Math.max(1, Math.min(255, Number(e.target.value) || 1))))} />
                  </label>
                )}
                <button className="btn ghost" onClick={() => update((m) => void (m.steps = m.steps.map((s) => (s.type === 'delay' ? { ...s, ms: 10 } : s))))}>
                  Feste Abstände (10 ms)
                </button>
              </div>
              <div className="steps">
                {macro.steps.map((s, i) => (
                  <div key={i} className={`step ${s.type}`}>
                    {s.type === 'delay' ? (
                      <>
                        <input type="number" min={0} value={s.ms}
                          onChange={(e) => update((m) => void (m.steps[i] = { type: 'delay', ms: Math.max(0, Number(e.target.value) || 0) }))} />
                        ms
                      </>
                    ) : (
                      <>{s.type === 'down' ? '↓' : '↑'} {keyLabel(s.code, layout)}</>
                    )}
                    <button className="step-x" onClick={() => update((m) => void m.steps.splice(i, 1))}>×</button>
                  </div>
                ))}
                {!macro.steps.length && <EmptyHint>Keine Schritte – drücke „Aufnehmen“.</EmptyHint>}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
