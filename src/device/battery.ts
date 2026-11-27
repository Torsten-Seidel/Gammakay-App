// Akkuanzeige im Seitenlicht: reine Logik ohne Imports (direkt mit `node --test` prüfbar).

export type BatteryZone = 'normal' | 'low' | 'critical';

export interface BatteryIndicatorConfig {
  enabled: boolean;
  /** Bereich „Normal“ (über low.percent): eigene Seitenlicht-Einstellung oder feste Farbe */
  normal: { useOwn: boolean; color: string };
  /** Bereich „Niedrig“: ab diesem Prozentwert abwärts, Seitenlicht dauerhaft an */
  low: { percent: number; color: string };
  /** Bereich „Kritisch“: ab diesem Prozentwert abwärts, Seitenlicht pulsiert */
  critical: { percent: number; color: string };
}

export const DEFAULT_BATTERY_INDICATOR: BatteryIndicatorConfig = {
  enabled: false,
  normal: { useOwn: true, color: '#00ff40' },
  low: { percent: 20, color: '#ff8000' },
  critical: { percent: 10, color: '#ff0000' },
};

/** Abstand in Prozentpunkten, damit die Farbe an einer Grenze nicht hin- und herspringt */
export const HYSTERESIS = 2;

/**
 * Bereich zum Akkustand. Ein Bereich wird erst verlassen, wenn der Wert die Grenze um HYSTERESIS
 * überschreitet; abwärts wird sofort gewechselt.
 */
export function batteryZone(percent: number, cfg: BatteryIndicatorConfig, previous: BatteryZone = 'normal'): BatteryZone {
  const crit = cfg.critical.percent;
  const low = Math.max(cfg.low.percent, crit);
  const rank = (z: BatteryZone) => (z === 'critical' ? 2 : z === 'low' ? 1 : 0);
  const plain: BatteryZone = percent <= crit ? 'critical' : percent <= low ? 'low' : 'normal';
  if (rank(plain) >= rank(previous)) return plain;
  // aufwärts: nur mit Abstand
  if (previous === 'critical' && percent <= crit + HYSTERESIS) return 'critical';
  if (previous !== 'normal' && percent <= low + HYSTERESIS) return percent <= crit + HYSTERESIS ? 'critical' : 'low';
  return plain;
}

/** Abfrage-Intervall in Millisekunden: selten bei vollem Akku, häufiger je näher die Warnschwelle. */
export function pollIntervalMs(percent: number | null, cfg: BatteryIndicatorConfig): number {
  const min = 60_000;
  if (percent === null) return min; // keine Antwort (z. B. Ruhezustand): bald erneut versuchen
  if (percent <= cfg.low.percent + 5) return min;
  if (percent <= 50) return 5 * min;
  return 15 * min;
}

export interface SideLook {
  effect: string;
  rainbow: boolean;
  color: string;
  brightness: number;
  speed: number;
}

/** Was das Seitenlicht im jeweiligen Bereich zeigen soll; null = eigene Einstellung. */
export function zoneLook(zone: BatteryZone, cfg: BatteryIndicatorConfig): SideLook | null {
  if (zone === 'critical') return { effect: 'breathing', rainbow: false, color: cfg.critical.color, brightness: 4, speed: 2 };
  if (zone === 'low') return { effect: 'static', rainbow: false, color: cfg.low.color, brightness: 4, speed: 2 };
  return cfg.normal.useOwn ? null : { effect: 'static', rainbow: false, color: cfg.normal.color, brightness: 4, speed: 2 };
}

/**
 * Eingaben bereinigen: niedrig 1–100 (100 = sofort, zum Testen), kritisch 1–99. Bewusst ohne Abhängigkeit
 * untereinander, damit Tippen in einem Feld das andere nicht verstellt; batteryZone kommt mit kritisch > niedrig klar.
 */
export function sanitizeIndicator(cfg: BatteryIndicatorConfig): BatteryIndicatorConfig {
  const clamp = (v: number, max: number) => Math.min(max, Math.max(1, Math.round(Number.isFinite(v) ? v : 1)));
  const low = clamp(cfg.low.percent, 100);
  const critical = clamp(cfg.critical.percent, 99);
  return { ...cfg, low: { ...cfg.low, percent: low }, critical: { ...cfg.critical, percent: critical } };
}
