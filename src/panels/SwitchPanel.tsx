import { switchFor, type SwitchConfig } from '../device/model';
import { useApp, useCapabilities, useProfile } from '../store';
import { Card, EmptyHint, PanelHeader, Slider, Toggle } from '../components/ui';

export function SwitchPanel() {
  const selected = useApp((s) => s.selected);
  const editProfile = useApp((s) => s.editProfile);
  const travel = useCapabilities().travel;
  const profile = useProfile();
  if (!profile) return null;

  const sw: SwitchConfig = selected.length ? switchFor(profile, selected[0]) : profile.defaultSwitch;
  const target = selected.length ? `${selected.length} ausgewählte Taste(n)` : 'alle nicht angepassten Tasten (Standard)';

  // Nicht getrennt eingestellt (Rückstellpunkt = Auslösepunkt) → Rückstellpunkt wandert mit dem Auslösepunkt mit.
  const apply = (s: SwitchConfig, patch: Partial<SwitchConfig>): SwitchConfig => {
    const next = { ...s, ...patch };
    if (patch.actuation !== undefined && patch.releasePoint === undefined && s.releasePoint === s.actuation) {
      next.releasePoint = patch.actuation;
    }
    return next;
  };
  const update = (patch: Partial<SwitchConfig>) =>
    editProfile((p) => {
      if (!selected.length) {
        p.defaultSwitch = apply(p.defaultSwitch, patch);
        return;
      }
      for (const k of selected) p.switches[k] = apply(switchFor(p, k), patch);
    });
  const separate = sw.releasePoint !== sw.actuation;

  const resetSelected = () => editProfile((p) => selected.forEach((k) => delete p.switches[k]));
  const customCount = Object.keys(profile.switches).length;

  return (
    <div className="panel">
      <PanelHeader title="Auslösepunkt & Rapid Trigger">
        <button className="btn ghost" disabled={!selected.length} onClick={resetSelected}>Auswahl auf Standard</button>
      </PanelHeader>
      <p className="hint">Änderungen gelten für {target}. {customCount > 0 && `${customCount} Taste(n) haben eigene Werte.`}</p>
      <div className="grid-3">
        <Card title="Auslösepunkt">
          <Slider label="Auslösen bei" value={sw.actuation} unit="mm" {...travel} onChange={(v) => update({ actuation: v })} />
          <div className="travel-visual">
            <div className="travel-bar">
              <div className="travel-mark" style={{ top: `${(sw.actuation / travel.max) * 100}%` }} />
            </div>
            <small>0 mm (oben) … {travel.max} mm (unten)</small>
          </div>
          <Toggle checked={separate} disabled={sw.rapidTrigger}
            onChange={(v) => update({ releasePoint: v ? Math.max(travel.min, Math.round((sw.actuation - 0.2) * 100) / 100) : sw.actuation })}
            label="Rückstellpunkt getrennt einstellen" />
          <Slider label="Zurücksetzen bei" value={sw.releasePoint} unit="mm" {...travel}
            disabled={sw.rapidTrigger || !separate} onChange={(v) => update({ releasePoint: v })} />
          {sw.rapidTrigger && <EmptyHint>Mit Rapid Trigger gilt stattdessen die Empfindlichkeit beim Loslassen.</EmptyHint>}
        </Card>
        <Card title="Rapid Trigger" actions={<Toggle checked={sw.rapidTrigger} onChange={(v) => update({ rapidTrigger: v })} />}>
          <Slider label="Empfindlichkeit Drücken" value={sw.rtPress} min={0.01} max={2} step={0.01} unit="mm"
            disabled={!sw.rapidTrigger} onChange={(v) => update({ rtPress: v })} />
          <Slider label="Empfindlichkeit Loslassen" value={sw.rtRelease} min={0.01} max={2} step={0.01} unit="mm"
            disabled={!sw.rapidTrigger} onChange={(v) => update({ rtRelease: v })} />
          <EmptyHint>Rapid Trigger wirkt bei der TK75 über den gesamten Hub (Continuous RT).</EmptyHint>
        </Card>
        <Card title="Totzonen">
          <Slider label="Oben" value={sw.deadzoneTop} min={0} max={1} step={0.01} unit="mm" onChange={(v) => update({ deadzoneTop: v })} />
          <Slider label="Unten" value={sw.deadzoneBottom} min={0} max={1} step={0.01} unit="mm" onChange={(v) => update({ deadzoneBottom: v })} />
          <EmptyHint>Größere Totzonen verhindern Fehlauslösungen bei leichtem Antippen.</EmptyHint>
        </Card>
      </div>
    </div>
  );
}
