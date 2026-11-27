import type { DeviceSettings } from '../device/model';
import type { LayoutVariant } from '../device/layout';
import { useApp, useCapabilities } from '../store';
import { Card, EmptyHint, PanelHeader, Slider } from '../components/ui';

// Grenzen wie in GearHub für die TK75 TMR (Minuten)
const TIMERS: { key: keyof DeviceSettings; label: string; min: number; max: number }[] = [
  { key: 'backlightOffBtMin', label: 'Bluetooth: Beleuchtung aus nach', min: 1, max: 60 },
  { key: 'backlightOff24gMin', label: '2,4 GHz: Beleuchtung aus nach', min: 1, max: 60 },
  { key: 'deepSleepBtMin', label: 'Bluetooth: Tiefschlaf nach', min: 10, max: 60 },
  { key: 'deepSleep24gMin', label: '2,4 GHz: Tiefschlaf nach', min: 10, max: 60 },
];

export function DevicePanel() {
  const settings = useApp((s) => s.config?.settings);
  const rates = useCapabilities().pollingRates;
  const info = useApp((s) => s.driver?.info);
  const layout = useApp((s) => s.layout);
  const setLayout = useApp((s) => s.setLayout);
  const edit = useApp((s) => s.edit);
  if (!settings) return null;
  const set = (patch: Partial<DeviceSettings>) => edit((d) => void (d.settings = { ...d.settings, ...patch }));

  return (
    <div className="panel">
      <PanelHeader title="Geräteeinstellungen" />
      <div className="grid-3">
        <Card title="Polling-Rate">
          <div className="chip-grid">
            {rates.map((r) => (
              <button key={r} className={`chip ${settings.pollingRate === r ? 'active' : ''}`} onClick={() => set({ pollingRate: r })}>
                {r >= 1000 ? `${r / 1000} kHz` : `${r} Hz`}
              </button>
            ))}
          </div>
          <EmptyHint>8 kHz nur per USB-Kabel; kabellos sind meist max. 1 kHz möglich. Wirkt nach „Übernehmen“.</EmptyHint>
        </Card>
        <Card title="Energiesparen">
          {TIMERS.map((t) => (
            <Slider key={t.key} label={t.label} unit="min" value={settings[t.key]} min={t.min} max={t.max} step={1}
              onChange={(v) => set({ [t.key]: v })} />
          ))}
          <EmptyHint>Gilt nur kabellos. Wirkt nach „Übernehmen“.</EmptyHint>
        </Card>
        <Card title="App & Gerät">
          <label className="field inline spread">
            <span>Layout der Anzeige</span>
            <select value={layout} onChange={(e) => setLayout(e.target.value as LayoutVariant)}>
              <option value="iso-de">ISO (Deutsch)</option>
              <option value="ansi-us">ANSI (US)</option>
            </select>
          </label>
          <dl className="info-list">
            <dt>Gerät</dt><dd>{info?.name}</dd>
            <dt>Firmware</dt><dd>{info?.firmware ?? 'unbekannt'}</dd>
          </dl>
          <EmptyHint>Firmware-Updates sind bewusst nicht eingebaut.</EmptyHint>
        </Card>
      </div>
    </div>
  );
}
