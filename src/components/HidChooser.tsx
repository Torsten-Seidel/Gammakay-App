import { useEffect, useState } from 'react';
import { hex16 } from '../device/log';

interface ListedDevice {
  deviceId: string;
  name: string;
  vendorId: number;
  productId: number;
}

interface DesktopBridge {
  isElectron: boolean;
  onHidDeviceList(cb: (list: ListedDevice[]) => void): () => void;
  chooseHidDevice(deviceId: string | null): void;
  appendLog?(line: string): void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

/** Eigene Geräteauswahl für Electron (ersetzt den Chrome-Dialog von navigator.hid.requestDevice). */
export function HidChooser() {
  const [devices, setDevices] = useState<ListedDevice[] | null>(null);

  useEffect(() => window.desktop?.onHidDeviceList((list) => setDevices(list)), []);

  if (!devices) return null;
  const choose = (id: string | null) => {
    window.desktop?.chooseHidDevice(id);
    setDevices(null);
  };

  return (
    <div className="modal-backdrop" onClick={() => choose(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>HID-Gerät auswählen</h3>
        <p className="hint">
          Jede Zeile ist ein HID-Interface. Tastaturen haben meist mehrere – für die Konfiguration ist das Interface mit
          herstellerspezifischer Usage Page (0xFFxx) interessant.
        </p>
        <div className="device-list">
          {devices.length === 0 && <p className="hint">Keine Geräte gefunden.</p>}
          {devices.map((d) => (
            <button key={d.deviceId} className="device-row" onClick={() => choose(d.deviceId)}>
              <strong>{d.name || 'Unbenannt'}</strong>
              <code>VID {hex16(d.vendorId)} · PID {hex16(d.productId)}</code>
            </button>
          ))}
        </div>
        <div className="row end">
          <button className="btn ghost" onClick={() => choose(null)}>Abbrechen</button>
        </div>
      </div>
    </div>
  );
}
