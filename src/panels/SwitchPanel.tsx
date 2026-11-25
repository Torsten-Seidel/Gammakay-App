import { switchFor, type SwitchConfig } from '../device/model';
import { useApp, useProfile } from '../store';
import { Card, EmptyHint, PanelHeader, Slider, Toggle } from '../components/ui';

export function SwitchPanel() {
  const selected = useApp((s) => s.selected);
  const editProfile = useApp((s) => s.editProfile);
  const travel = useApp((s) => s.driver?.capabilities.travel ?? { min: 0.1, max: 3.4, step: 0.01 });
  const profile = useProfile();
  if (!profile) return null;

  const sw: SwitchConfig = selected.length ? switchFor(profile, selected[0]) : profile.defaultSwitch;
  const target = selected.length ? `${selected.length} ausgewählte Taste(n)` : 'alle nicht angepassten Tasten (Standard)';

  const update = (patch: Partial<SwitchConfig>) =>
    editProfile((p) => {
      if (!selected.length) {
        p.defaultSwitch = { ...p.defaultSwitch, ...patch };
        return;
      }
      for (const k of selected) p.switches[k] = { ...switchFor(p, k), ...patch };
    });

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
        </Card>
        <Card title="Rapid Trigger" actions={<Toggle checked={sw.rapidTrigger} onChange={(v) => update({ rapidTrigger: v })} />}>
          <Slider label="Empfindlichkeit Drücken" value={sw.rtPress} min={0.01} max={2} step={0.01} unit="mm"
            disabled={!sw.rapidTrigger} onChange={(v) => update({ rtPress: v })} />
          <Slider label="Empfindlichkeit Loslassen" value={sw.rtRelease} min={0.01} max={2} step={0.01} unit="mm"
            disabled={!sw.rapidTrigger} onChange={(v) => update({ rtRelease: v })} />
          <Toggle checked={sw.continuousRT} onChange={(v) => update({ continuousRT: v })} label="Continuous RT (gesamter Hub)" />
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
