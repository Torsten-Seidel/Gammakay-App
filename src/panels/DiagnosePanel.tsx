import { useCallback, useEffect, useState } from 'react';
import { requestHidDevices } from '../device/hidDriver';
import { formatLogLine, hex16, log, toHex, useLog } from '../device/log';
import { Card, EmptyHint, PanelHeader } from '../components/ui';

// Diagnose ist bewusst NUR lesend: Interfaces auflisten, Input-Reports mitlesen, Feature-Reports abfragen.

function reportBytes(r: HIDReportInfo): number {
  const bits = (r.items ?? []).reduce((sum, it) => sum + (it.reportSize ?? 0) * (it.reportCount ?? 0), 0);
  return Math.ceil(bits / 8);
}

function describeReports(list: HIDReportInfo[] | undefined): string {
  if (!list?.length) return '—';
  return list.map((r) => `#${r.reportId ?? 0} (${reportBytes(r)} B)`).join(', ');
}

const deviceKey = (d: HIDDevice, i: number) => `${d.vendorId}-${d.productId}-${i}`;

/** Schreibt alle Collections eines Interfaces ins Log (zum Kopieren/Weitergeben). */
function logDeviceDetails(d: HIDDevice) {
  log('info', `${d.productName} VID ${hex16(d.vendorId)} PID ${hex16(d.productId)}, ${d.collections.length} Collection(s)`);
  d.collections.forEach((c, i) => {
    log('info',
      `  Collection ${i + 1}: UsagePage ${hex16(c.usagePage)} Usage ${hex16(c.usage)} | ` +
      `Input ${describeReports(c.inputReports)} | Output ${describeReports(c.outputReports)} | Feature ${describeReports(c.featureReports)}`);
  });
}

export function DiagnosePanel() {
  const [devices, setDevices] = useState<HIDDevice[]>([]);
  const [listening, setListening] = useState<Set<HIDDevice>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const entries = useLog((s) => s.entries);
  const clearLog = useLog((s) => s.clear);
  const hasHid = typeof navigator !== 'undefined' && 'hid' in navigator;

  const refresh = useCallback(async () => {
    if (hasHid) setDevices(await navigator.hid.getDevices());
  }, [hasHid]);

  useEffect(() => {
    void refresh();
    if (!hasHid) return;
    const onChange = () => void refresh();
    navigator.hid.addEventListener('connect', onChange);
    navigator.hid.addEventListener('disconnect', onChange);
    return () => {
      navigator.hid.removeEventListener('connect', onChange);
      navigator.hid.removeEventListener('disconnect', onChange);
    };
  }, [refresh, hasHid]);

  const onInput = useCallback((e: HIDInputReportEvent) => {
    log('in', `${e.device.productName} · Input #${e.reportId}: ${toHex(e.data)}`);
  }, []);

  const addDevice = async () => {
    setError(null);
    try {
      const picked = await requestHidDevices();
      for (const d of picked) logDeviceDetails(d);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const toggleListen = async (d: HIDDevice) => {
    setError(null);
    try {
      const next = new Set(listening);
      if (next.has(d)) {
        d.removeEventListener('inputreport', onInput);
        next.delete(d);
        log('info', `Mitlesen beendet: ${d.productName}`);
      } else {
        if (!d.opened) await d.open();
        d.addEventListener('inputreport', onInput);
        next.add(d);
        log('info', `Mitlesen gestartet: ${d.productName}`);
      }
      setListening(next);
    } catch (e) {
      setError(`Öffnen fehlgeschlagen: ${String(e)}`);
      log('error', String(e));
    }
  };

  const readFeature = async (d: HIDDevice, reportId: number) => {
    setError(null);
    try {
      if (!d.opened) await d.open();
      log('out', `${d.productName} · receiveFeatureReport(#${reportId})`);
      const data = await d.receiveFeatureReport(reportId);
      log('in', `${d.productName} · Feature #${reportId}: ${toHex(data)}`);
    } catch (e) {
      log('error', `Feature #${reportId}: ${String(e)}`);
    }
  };

  const copyLog = () => {
    const text = entries.map((e) => formatLogLine(e.time, e.dir, e.text)).join('\n');
    void navigator.clipboard.writeText(text);
  };

  return (
    <div className="panel">
      <PanelHeader title="Diagnose (nur lesend)">
        <button className="btn ghost" disabled={!devices.length} onClick={() => devices.forEach(logDeviceDetails)}>
          Details ins Log
        </button>
        <button className="btn primary" disabled={!hasHid} onClick={addDevice}>HID-Gerät freigeben</button>
      </PanelHeader>
      {!hasHid && <p className="error-text">WebHID ist hier nicht verfügbar. Bitte die Desktop-App (Electron) oder Chrome/Edge verwenden.</p>}
      {error && <p className="error-text">{error}</p>}
      <div className="grid-2">
        <Card title={`Freigegebene Interfaces (${devices.length})`}>
          {!devices.length && (
            <EmptyHint>
              Tastatur per USB-Kabel anschließen und „HID-Gerät freigeben“ klicken. Die Interfaces mit Usage Page 0xFFxx
              (herstellerspezifisch) sind die Kandidaten für das Konfigurationsprotokoll. Normale Tastatur-Interfaces blockiert
              Chromium aus Sicherheitsgründen.
            </EmptyHint>
          )}
          <div className="stack">
            {devices.map((d, i) => (
              <div key={deviceKey(d, i)} className="hid-device">
                <div className="row">
                  <strong>{d.productName || 'Unbenannt'}</strong>
                  <code>VID {hex16(d.vendorId)} · PID {hex16(d.productId)}</code>
                  <div className="spacer" />
                  <button className={`btn ${listening.has(d) ? 'danger' : 'ghost'}`} onClick={() => void toggleListen(d)}>
                    {listening.has(d) ? 'Mitlesen stoppen' : 'Input mitlesen'}
                  </button>
                </div>
                <table className="hid-table">
                  <thead>
                    <tr><th>Usage Page</th><th>Usage</th><th>Input</th><th>Output</th><th>Feature</th></tr>
                  </thead>
                  <tbody>
                    {d.collections.map((c, j) => (
                      <tr key={j} className={(c.usagePage ?? 0) >= 0xff00 ? 'vendor' : ''}>
                        <td><code>{hex16(c.usagePage)}</code></td>
                        <td><code>{hex16(c.usage)}</code></td>
                        <td>{describeReports(c.inputReports)}</td>
                        <td>{describeReports(c.outputReports)}</td>
                        <td>
                          {describeReports(c.featureReports)}
                          {c.featureReports?.map((r) => (
                            <button key={r.reportId} className="link" onClick={() => void readFeature(d, r.reportId ?? 0)}>
                              lesen #{r.reportId ?? 0}
                            </button>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </Card>
        <Card title={`Protokoll-Log (${entries.length})`} actions={
          <div className="row">
            <button className="btn ghost" onClick={copyLog} disabled={!entries.length}>Kopieren</button>
            <button className="btn ghost" onClick={clearLog} disabled={!entries.length}>Leeren</button>
          </div>
        }>
          <div className="log">
            {entries.map((e) => (
              <div key={e.id} className={`log-line ${e.dir}`}>
                <span className="log-time">{new Date(e.time).toLocaleTimeString()}</span>
                <span className="log-dir">{e.dir}</span>
                <span className="log-text">{e.text}</span>
              </div>
            ))}
            {!entries.length && <EmptyHint>Noch keine Einträge.</EmptyHint>}
          </div>
        </Card>
      </div>
    </div>
  );
}
