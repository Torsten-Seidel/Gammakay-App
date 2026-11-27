import { useEffect, useState } from 'react';
import { MockDriver } from '../device/mockDriver';
import { GamakayHidDriver } from '../device/hidDriver';
import { useApp, useDirtySections, type View } from '../store';
import { Icon } from './Icon';

const SECTIONS: { group: string; items: { view: View; label: string; icon: string }[] }[] = [
  {
    group: 'Profil',
    items: [{ view: 'profiles', label: 'Meine Profile', icon: 'user' }],
  },
  {
    group: 'Tastatur',
    items: [
      { view: 'keymap', label: 'Tastenbelegung', icon: 'layers' },
      { view: 'switches', label: 'Auslösepunkt & RT', icon: 'target' },
      { view: 'advanced', label: 'Erweiterte Tasten', icon: 'zap' },
      { view: 'macros', label: 'Makros', icon: 'repeat' },
    ],
  },
  {
    group: 'Darstellung',
    items: [
      { view: 'lighting', label: 'Beleuchtung', icon: 'sun' },
      { view: 'display', label: 'Display', icon: 'monitor' },
    ],
  },
  {
    group: 'Gerät',
    items: [{ view: 'device', label: 'Geräteeinstellungen', icon: 'sliders' }],
  },
];

export function IconRail() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const isDiag = view === 'diagnose';
  return (
    <nav className="rail">
      <div className="logo">TK</div>
      <button className={`rail-btn ${!isDiag ? 'active' : ''}`} onClick={() => setView('keymap')} title="Konfiguration">
        <Icon name="keyboard" />
        <span>Tastatur</span>
      </button>
      <button className={`rail-btn ${isDiag ? 'active' : ''}`} onClick={() => setView('diagnose')} title="Diagnose">
        <Icon name="pulse" />
        <span>Diagnose</span>
      </button>
    </nav>
  );
}

export function Sidebar() {
  const driver = useApp((s) => s.driver);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const disconnect = useApp((s) => s.disconnect);
  if (!driver) return null;
  return (
    <aside className="sidebar">
      <div className="sidebar-title">Konfiguration</div>
      <div className="device-card">
        <div className="device-thumb" />
        <div className="device-meta">
          <small>{driver.info.transport === 'mock' ? 'Demo-Gerät' : driver.info.transport === 'bt' ? 'Bluetooth' : driver.info.transport === 'dongle' ? 'Empfänger 2,4 GHz' : 'USB'}</small>
          <strong>{driver.info.name}</strong>
        </div>
        <button className="link" onClick={disconnect}>Trennen</button>
      </div>
      {SECTIONS.map((sec) => (
        <div key={sec.group} className="nav-group">
          <div className="nav-group-title">{sec.group}</div>
          {sec.items.map((it) => (
            <button key={it.view} className={`nav-item ${view === it.view ? 'active' : ''}`} onClick={() => setView(it.view)}>
              <Icon name={it.icon} />
              {it.label}
            </button>
          ))}
        </div>
      ))}
      <div className="sidebar-footer">TK75 Konfigurator v0.1</div>
    </aside>
  );
}

/** Dünner Laufbalken ganz oben, solange die App mit der Tastatur spricht. */
export function ActivityBar() {
  const busy = useApp((s) => s.busy);
  const progress = useApp((s) => s.progress);
  const known = busy && progress !== null;
  return (
    <div className={`activity-bar ${busy ? 'on' : ''} ${known ? 'known' : ''}`} aria-hidden="true">
      {known && <span style={{ width: `${progress}%` }} />}
    </div>
  );
}

/** Aktueller Arbeitsschritt bzw. kurze Bestätigung nach dem Speichern. */
function StatusPill() {
  const activity = useApp((s) => s.activity);
  const progress = useApp((s) => s.progress);
  const savedAt = useApp((s) => s.savedAt);
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (!savedAt) return;
    setShowSaved(true);
    const id = setTimeout(() => setShowSaved(false), 2500);
    return () => clearTimeout(id);
  }, [savedAt]);
  if (activity) {
    return (
      <span className="status-pill busy" role="status">
        <span className="spinner" />
        {activity}
        {progress !== null && <strong className="status-pct">{progress} %</strong>}
      </span>
    );
  }
  if (showSaved) return <span className="status-pill ok" role="status">✓ Auf Tastatur gespeichert</span>;
  return null;
}

export function TopBar() {
  const config = useApp((s) => s.config);
  const driver = useApp((s) => s.driver);
  const busy = useApp((s) => s.busy);
  const battery = useApp((s) => s.battery);
  const past = useApp((s) => s.past.length);
  const future = useApp((s) => s.future.length);
  const { undo, redo, apply, revert, edit } = useApp.getState();
  const dirty = useDirtySections();
  if (!config || !driver) return null;
  const canWrite = driver.supports.write;
  return (
    <header className="topbar">
      <select
        className="profile-select"
        disabled={busy}
        value={config.activeProfile}
        onChange={(e) => edit((d) => void (d.activeProfile = Number(e.target.value)))}
      >
        {config.profiles.map((p, i) => (
          <option key={i} value={i}>{p.name}</option>
        ))}
      </select>
      <div className="spacer" />
      <StatusPill />
      {battery !== null && (
        <span className={`battery-badge ${battery <= 20 ? 'low' : ''}`} title="Akkustand">
          <span className="battery-icon"><span style={{ width: `${battery}%` }} /></span>
          {battery} %
        </span>
      )}
      <button className="icon-btn" disabled={!past || busy} onClick={undo} title="Rückgängig (Strg+Z)"><Icon name="undo" /></button>
      <button className="icon-btn" disabled={!future || busy} onClick={redo} title="Wiederholen (Strg+Y)"><Icon name="redo" /></button>
      {dirty.length > 0 && <button className="btn ghost" disabled={busy} onClick={revert}>Verwerfen</button>}
      <button
        className="btn primary"
        disabled={!dirty.length || busy || !canWrite}
        title={canWrite ? dirty.join(', ') : 'Schreiben ist für dieses Gerät noch nicht implementiert'}
        onClick={apply}
      >
        {busy ? 'Bitte warten …' : dirty.length ? `Übernehmen (${dirty.length})` : 'Gespeichert'}
      </button>
    </header>
  );
}

export function Welcome() {
  const connect = useApp((s) => s.connect);
  const busy = useApp((s) => s.busy);
  const activity = useApp((s) => s.activity);
  const progress = useApp((s) => s.progress);
  const [error, setError] = useState<string | null>(null);

  async function connectUsb() {
    setError(null);
    try {
      await connect(await GamakayHidDriver.connect());
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="welcome">
      <h1>TK75 Konfigurator</h1>
      <p>
        Eigene Konfigurations-App für die Gamakay TK75 TMR. Verbinde die Tastatur per USB-Kabel, Bluetooth oder 2,4-GHz-Empfänger
        oder probiere die Oberfläche im Demo-Modus aus.
      </p>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => connect(new MockDriver())}>Demo-Modus</button>
        <button className="btn primary" disabled={busy} onClick={connectUsb}>Tastatur verbinden</button>
      </div>
      {busy && activity && (
        <p className="status-pill busy" role="status">
          <span className="spinner" />
          {activity}
          {progress !== null && <strong className="status-pct">{progress} %</strong>}
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
      <p className="hint">
        Mit der echten Tastatur liest und schreibt die App Licht, Seitenlicht, Polling-Rate, Energiespar-Zeiten, Tastenbelegung (mit Fn-Ebene)
        sowie Auslöse- und Rückstellpunkt, Rapid Trigger und Totzonen. Kabellos zeigt sie zusätzlich den Akkustand. Bitte GearHub vorher schließen.
      </p>
    </div>
  );
}
