import { create } from 'zustand';

export type LogDirection = 'out' | 'in' | 'info' | 'error';

export interface LogEntry {
  id: number;
  time: number;
  dir: LogDirection;
  text: string;
}

interface LogState {
  entries: LogEntry[];
  add(dir: LogDirection, text: string): void;
  clear(): void;
}

let counter = 0;
const MAX_ENTRIES = 500;

/** Protokoll-Log: jeder Befehl an die Tastatur und jede Antwort landet hier. */
export const useLog = create<LogState>((set) => ({
  entries: [],
  add: (dir, text) =>
    set((s) => ({ entries: [...s.entries.slice(-(MAX_ENTRIES - 1)), { id: ++counter, time: Date.now(), dir, text }] })),
  clear: () => set({ entries: [] }),
}));

export const log = (dir: LogDirection, text: string) => {
  useLog.getState().add(dir, text);
  // In Electron zusätzlich in die Log-Datei (logs/diagnose.log), gleiches Format wie „Log kopieren“.
  window.desktop?.appendLog?.(formatLogLine(Date.now(), dir, text));
};

export function formatLogLine(time: number, dir: LogDirection, text: string): string {
  return `${new Date(time).toISOString()} ${dir.toUpperCase().padEnd(5)} ${text}`;
}

export function toHex(data: DataView | Uint8Array, max = 64): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const shown = Array.from(bytes.slice(0, max), (b) => b.toString(16).padStart(2, '0')).join(' ');
  return bytes.length > max ? `${shown} … (+${bytes.length - max})` : shown;
}

export function hex16(n: number | undefined): string {
  return n === undefined ? '—' : `0x${n.toString(16).padStart(4, '0')}`;
}
