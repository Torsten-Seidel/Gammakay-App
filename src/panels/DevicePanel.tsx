import type { DeviceSettings } from '../device/model';
import type { LayoutVariant } from '../device/layout';
import { useApp, useCapabilities } from '../store';
import { Card, EmptyHint, PanelHeader } from '../components/ui';

const TIMERS: { key: keyof DeviceSettings; label: string; hint?: string }[] = [
  { key: 'standbyMin', label: 'Standby nach', hint: '0 = nie' },
  { key: 'backlightOff24gMin', label: 'Beleuchtung aus (2.4G) nach' },
  { key: 'backlightOffBtMin', label: 'Beleuchtung aus (Bluetooth) nach' },
  { key: 'btSleepMin', label: 'Bluetooth-Schlafmodus nach' },
];

export function DevicePanel() {
  const settings = useApp((s) => s.config?.settings);
  const rates = useCapabilities().pollingRates;
  const info = useApp((s) => s.driver?.info);
  const isHid = !!info && info.transport !== 'mock';
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
          {isHid && <EmptyHint>Die Zeiten werden bisher nur gelesen – Ändern folgt nach dem nächsten Mitschnitt.</EmptyHint>}
          {TIMERS.map((t) => (
            <label key={t.key} className="field inline spread">
              <span>{t.label}{t.hint && <small> ({t.hint})</small>}</span>
              <span>
                <input type="number" min={0} max={120} value={settings[t.key]}
                  onChange={(e) => set({ [t.key]: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })} /> min
              </span>
            </label>
          ))}
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
