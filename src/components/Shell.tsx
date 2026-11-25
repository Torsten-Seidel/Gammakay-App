import { useState } from 'react';
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
          <small>{driver.info.transport === 'mock' ? 'Demo-Gerät' : 'USB'}</small>
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

export function TopBar() {
  const config = useApp((s) => s.config);
  const driver = useApp((s) => s.driver);
  const busy = useApp((s) => s.busy);
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
        value={config.activeProfile}
        onChange={(e) => edit((d) => void (d.activeProfile = Number(e.target.value)))}
      >
        {config.profiles.map((p, i) => (
          <option key={i} value={i}>{p.name}</option>
        ))}
      </select>
      <div className="spacer" />
      <button className="icon-btn" disabled={!past} onClick={undo} title="Rückgängig (Strg+Z)"><Icon name="undo" /></button>
      <button className="icon-btn" disabled={!future} onClick={redo} title="Wiederholen (Strg+Y)"><Icon name="redo" /></button>
      {dirty.length > 0 && <button className="btn ghost" onClick={revert}>Verwerfen</button>}
      <button
        className="btn primary"
        disabled={!dirty.length || busy || !canWrite}
        title={canWrite ? dirty.join(', ') : 'Schreiben ist für dieses Gerät noch nicht implementiert'}
        onClick={apply}
      >
        {busy ? 'Schreibe …' : dirty.length ? `Übernehmen (${dirty.length})` : 'Gespeichert'}
      </button>
    </header>
  );
}

export function Welcome() {
  const connect = useApp((s) => s.connect);
  const busy = useApp((s) => s.busy);
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
        Eigene Konfigurations-App für die Gamakay TK75 TMR. Verbinde die Tastatur per USB-Kabel oder probiere die
        Oberfläche im Demo-Modus aus.
      </p>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => connect(new MockDriver())}>Demo-Modus</button>
        <button className="btn primary" disabled={busy} onClick={connectUsb}>Tastatur verbinden (USB)</button>
      </div>
      {error && <p className="error-text">{error}</p>}
      <p className="hint">
        Mit der echten Tastatur werden bisher Licht und Energiespar-Zeiten gelesen; schreiben kann die App vorerst nur
        die Helligkeit. Bitte GearHub vorher schließen.
      </p>
    </div>
  );
}
