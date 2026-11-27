// Nur im Entwicklungsmodus: Zugriff für automatische Tests über den Debug-Zugang (tools/app-test.mjs).
import { GamakayHidDriver } from './device/hidDriver';
import { useLog } from './device/log';
import { useApp } from './store';

declare global {
  interface Window {
    __tk75?: unknown;
  }
}

export function installDevHooks(): void {
  window.__tk75 = {
    app: useApp,
    log: useLog,
    /** Wie „Tastatur verbinden“ (nimmt den ersten antwortenden freigegebenen Weg). */
    async connect() {
      await useApp.getState().connect(await GamakayHidDriver.connect());
      const s = useApp.getState();
      return { device: s.driver?.info ?? null, error: s.error };
    },
  };
}
