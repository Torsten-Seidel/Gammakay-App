import { keyLabel, type LayoutVariant } from './layout';
import type { KeyAction, Macro } from './model';

export interface KeyGroup {
  title: string;
  codes: string[];
}

const range = (prefix: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);

export const KEY_GROUPS: KeyGroup[] = [
  { title: 'Buchstaben', codes: 'QWERTYUIOPASDFGHJKLZXCVBNM'.split('').map((c) => `Key${c}`) },
  {
    title: 'Zahlen & Zeichen',
    codes: [...range('Digit', 1, 9), 'Digit0', 'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight',
      'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'IntlBackslash'],
  },
  {
    title: 'Steuertasten',
    codes: ['Escape', 'Tab', 'CapsLock', 'Backspace', 'Enter', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft',
      'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'ContextMenu'],
  },
  { title: 'F-Tasten', codes: range('F', 1, 12) },
  {
    title: 'Navigation',
    codes: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Insert', 'Delete', 'Home', 'End', 'PageUp',
      'PageDown', 'PrintScreen', 'ScrollLock', 'Pause'],
  },
  {
    title: 'Ziffernblock',
    codes: ['NumLock', ...range('Numpad', 0, 9), 'NumpadDivide', 'NumpadMultiply', 'NumpadSubtract', 'NumpadAdd',
      'NumpadDecimal', 'NumpadEnter'],
  },
];

export interface FunctionDef {
  id: string;
  label: string;
  group: string;
}

export const FUNCTIONS: FunctionDef[] = [
  { id: 'media.mute', label: 'Stumm', group: 'Medien' },
  { id: 'media.volDown', label: 'Leiser', group: 'Medien' },
  { id: 'media.volUp', label: 'Lauter', group: 'Medien' },
  { id: 'media.playPause', label: 'Play/Pause', group: 'Medien' },
  { id: 'media.prev', label: 'Zurück', group: 'Medien' },
  { id: 'media.next', label: 'Weiter', group: 'Medien' },
  { id: 'light.toggle', label: 'Licht an/aus', group: 'Licht' },
  // TK75: Effekt/Helligkeit/Tempo/Farbe wirken auf das gewählte Licht; „Licht wählen“ (ab Werk Fn+Pos1) schaltet
  // zwischen Tasten- und Seitenlicht um (geprüft 2026-11-28).
  { id: 'light.nextEffect', label: 'Nächster Effekt', group: 'Licht' },
  { id: 'light.brightUp', label: 'Heller', group: 'Licht' },
  { id: 'light.brightDown', label: 'Dunkler', group: 'Licht' },
  { id: 'light.speedUp', label: 'Schneller', group: 'Licht' },
  { id: 'light.speedDown', label: 'Langsamer', group: 'Licht' },
  { id: 'light.nextColor', label: 'Farbe wechseln', group: 'Licht' },
  { id: 'light.target', label: 'Licht wählen (Tasten/Seite)', group: 'Licht' },
  { id: 'conn.usb', label: 'USB-Modus', group: 'Verbindung' },
  { id: 'conn.24g', label: '2.4G-Modus', group: 'Verbindung' },
  { id: 'conn.bt1', label: 'Bluetooth 1', group: 'Verbindung' },
  { id: 'conn.bt2', label: 'Bluetooth 2', group: 'Verbindung' },
  { id: 'conn.bt3', label: 'Bluetooth 3', group: 'Verbindung' },
  { id: 'sys.profileNext', label: 'Nächstes Profil', group: 'System' },
  { id: 'sys.winLock', label: 'Win-Sperre', group: 'System' },
  { id: 'sys.displayNext', label: 'Display: nächstes Bild', group: 'System' },
];

/** Beschriftung der Werksbelegung (z. B. Fn+F4 = „Stumm“); '' = keine. */
export function describeFactory(
  entry: { code?: string; fn?: string; label?: string } | undefined, variant: LayoutVariant,
): string {
  if (!entry) return '';
  if (entry.code) return keyLabel(entry.code, variant);
  if (entry.fn) return FUNCTIONS.find((f) => f.id === entry.fn)?.label ?? entry.fn;
  return entry.label ?? '';
}

export function describeAction(action: KeyAction, variant: LayoutVariant, macros: Macro[]): string {
  switch (action.kind) {
    case 'default': return '';
    case 'key': return keyLabel(action.code, variant);
    case 'combo': return action.codes.map((c) => keyLabel(c, variant)).join('+');
    case 'function': return FUNCTIONS.find((f) => f.id === action.fn)?.label ?? action.fn;
    case 'macro': return `M: ${macros.find((m) => m.id === action.macroId)?.name ?? '?'}`;
    case 'disabled': return 'aus';
  }
}
