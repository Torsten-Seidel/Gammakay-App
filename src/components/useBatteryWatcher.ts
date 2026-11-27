import { useEffect, useRef } from 'react';
import { batteryZone, pollIntervalMs, zoneLook, type BatteryZone } from '../device/battery';
import { log } from '../device/log';
import { useApp } from '../store';

/**
 * Fragt kabellos (Bluetooth oder Empfänger) den Akkustand ab (Intervall je nach Ladestand) und färbt bei aktivierter
 * Akkuanzeige das Seitenlicht. Geschrieben wird nur, wenn sich die Darstellung ändert (der Treiber
 * überspringt identische Pakete).
 */
export function useBatteryWatcher() {
  const driver = useApp((s) => s.driver);
  const battery = useApp((s) => s.battery);
  const indicator = useApp((s) => s.batteryIndicator);
  const zone = useRef<BatteryZone>('normal');

  // Abfrage-Schleife
  useEffect(() => {
    if (!driver?.readBattery || (driver.info.transport !== 'bt' && driver.info.transport !== 'dongle')) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const pct = await driver.readBattery!().catch(() => null);
      if (stopped) return;
      if (pct !== null) useApp.setState({ battery: pct });
      timer = setTimeout(tick, pollIntervalMs(pct, useApp.getState().batteryIndicator));
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [driver]);

  // Seitenlicht passend zu Akkustand und Einstellung
  useEffect(() => {
    if (!driver?.setSideOverride) return;
    const state = useApp.getState();
    const own = state.deviceConfig?.profiles[state.deviceConfig.activeProfile].lighting.side;
    if (!own) return;
    if (!indicator.enabled) {
      zone.current = 'normal';
      driver.setSideOverride(null, own).catch((e) => log('error', String(e)));
      return;
    }
    if (battery === null) return; // Akkustand unbekannt (Kabel, Ruhezustand): nichts ändern
    const next = batteryZone(battery, indicator, zone.current);
    if (next !== zone.current) log('info', `Akku ${battery} %: Bereich ${next}`);
    zone.current = next;
    driver.setSideOverride(zoneLook(next, indicator), own).catch((e) => log('error', String(e)));
  }, [driver, battery, indicator]);
}
