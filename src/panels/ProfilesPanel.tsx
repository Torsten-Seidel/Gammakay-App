import { useState } from 'react';
import type { DeviceConfig, Profile } from '../device/model';
import { useApp } from '../store';
import { Card, EmptyHint, PanelHeader } from '../components/ui';

function isProfile(x: unknown): x is Profile {
  const p = x as Profile;
  return !!p && typeof p.name === 'string' && !!p.keymap?.base && !!p.keymap?.fn && !!p.lighting && Array.isArray(p.advanced);
}

export function ProfilesPanel() {
  const config = useApp((s) => s.config);
  const edit = useApp((s) => s.edit);
  const [error, setError] = useState<string | null>(null);
  if (!config) return null;
  const active = config.activeProfile;

  const exportProfile = () => {
    const blob = new Blob([JSON.stringify({ type: 'tk75-profile', profile: config.profiles[active] }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${config.profiles[active].name.replace(/[^\w-]+/g, '_')}.tk75.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importProfile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const data = JSON.parse(await file.text());
      if (data?.type !== 'tk75-profile' || !isProfile(data.profile)) throw new Error('Keine gültige TK75-Profildatei');
      edit((d: DeviceConfig) => void (d.profiles[d.activeProfile] = data.profile));
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="panel">
      <PanelHeader title="Meine Profile">
        <button className="btn ghost" onClick={exportProfile}>Exportieren</button>
        <label className="btn ghost">
          Importieren
          <input type="file" accept=".json,application/json" hidden onChange={(e) => { void importProfile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </PanelHeader>
      {error && <p className="error-text">{error}</p>}
      <div className="grid-4">
        {config.profiles.map((p, i) => (
          <Card key={i} className={i === active ? 'card-active' : ''}>
            <input className="title-input" value={p.name} maxLength={24}
              onChange={(e) => edit((d) => void (d.profiles[i].name = e.target.value))} />
            <small className="hint">
              {Object.keys(p.keymap.base).length + Object.keys(p.keymap.fn).length} Belegungen ·{' '}
              {p.advanced.length} erweiterte Tasten
            </small>
            <div className="row">
              {i === active ? <span className="tag">Aktiv</span> : (
                <button className="btn" onClick={() => edit((d) => void (d.activeProfile = i))}>Aktivieren</button>
              )}
              {i !== active && (
                <button className="btn ghost" title="Aktives Profil in dieses kopieren"
                  onClick={() => edit((d) => void (d.profiles[i] = { ...structuredClone(d.profiles[d.activeProfile]), name: d.profiles[i].name }))}>
                  Aktives hierher kopieren
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
      <EmptyHint>Export/Import betrifft das aktive Profil. Makros und Display werden nicht mit exportiert.</EmptyHint>
    </div>
  );
}
