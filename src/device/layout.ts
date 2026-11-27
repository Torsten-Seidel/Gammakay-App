import type { KeyId } from './model';

export type LayoutVariant = 'iso-de' | 'ansi-us';

export interface KeyDef {
  id: KeyId;
  x: number; // in Tasteneinheiten (1u)
  y: number;
  w: number;
  h: number;
  isoEnter?: boolean;
}

type RowItem = [KeyId, number?] | { gapTo: number };

function row(y: number, items: RowItem[]): KeyDef[] {
  let x = 0;
  const keys: KeyDef[] = [];
  for (const item of items) {
    if (!Array.isArray(item)) {
      x = item.gapTo;
      continue;
    }
    const [id, w = 1] = item;
    keys.push({ id, x, y, w, h: 1 });
    x += w;
  }
  return keys;
}

const k = (...ids: KeyId[]): RowItem[] => ids.map((id) => [id]);

const LETTERS_TOP = k('KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight');
const LETTERS_HOME = k('KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote');
const LETTERS_BOTTOM = k('KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash');

const FUNCTION_ROW = row(0, [
  ['Escape'],
  ...k('F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'),
  ['Delete'],
]);

const NUMBER_ROW = row(1.25, [
  ...k('Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'),
  ['Backspace', 2],
  ['Home'],
]);

const BOTTOM_ROW = row(5.25, [
  ['ControlLeft', 1.25], ['MetaLeft', 1.25], ['AltLeft', 1.25], ['Space', 6.25],
  ['AltRight'], ['Fn'], ['ControlRight'], ['ArrowLeft'], ['ArrowDown'], ['ArrowRight'],
]);

const ISO: KeyDef[] = [
  ...FUNCTION_ROW,
  ...NUMBER_ROW,
  ...row(2.25, [['Tab', 1.5], ...LETTERS_TOP, { gapTo: 15 }, ['PageUp']]),
  { id: 'Enter', x: 13.5, y: 2.25, w: 1.5, h: 2, isoEnter: true },
  ...row(3.25, [['CapsLock', 1.75], ...LETTERS_HOME, ['Backslash'], { gapTo: 15 }, ['PageDown']]),
  ...row(4.25, [['ShiftLeft', 1.25], ['IntlBackslash'], ...LETTERS_BOTTOM, ['ShiftRight', 1.75], ['ArrowUp']]),
  ...BOTTOM_ROW,
];

const ANSI: KeyDef[] = [
  ...FUNCTION_ROW,
  ...NUMBER_ROW,
  ...row(2.25, [['Tab', 1.5], ...LETTERS_TOP, ['Backslash', 1.5], ['PageUp']]),
  ...row(3.25, [['CapsLock', 1.75], ...LETTERS_HOME, ['Enter', 2.25], ['PageDown']]),
  ...row(4.25, [['ShiftLeft', 2.25], ...LETTERS_BOTTOM, ['ShiftRight', 1.75], ['ArrowUp']]),
  ...BOTTOM_ROW,
];

export const LAYOUTS: Record<LayoutVariant, KeyDef[]> = { 'iso-de': ISO, 'ansi-us': ANSI };

/** Drehregler oben rechts (nur Anzeige). */
export const KNOB = { x: 15, y: 0 };
export const LAYOUT_WIDTH = 16;
export const LAYOUT_HEIGHT = 6.25;

const BASE_LABELS: Record<string, string> = {
  Escape: 'Esc', Delete: 'Del', Backquote: '`', Minus: '-', Equal: '=', Backspace: 'Backspace',
  Home: 'Home', Tab: 'Tab', BracketLeft: '[', BracketRight: ']', Backslash: '\\', PageUp: 'PgUp',
  CapsLock: 'Caps', Semicolon: ';', Quote: "'", Enter: 'Enter', PageDown: 'PgDn', ShiftLeft: 'Shift',
  ShiftRight: 'Shift', IntlBackslash: '<', Comma: ',', Period: '.', Slash: '/', ArrowUp: '↑',
  ControlLeft: 'Ctrl', MetaLeft: 'Win', AltLeft: 'Alt', Space: 'Space', AltRight: 'AltGr', Fn: 'Fn',
  ControlRight: 'Ctrl', ArrowLeft: '←', ArrowDown: '↓', ArrowRight: '→',
  Insert: 'Ins', End: 'End', PrintScreen: 'PrtSc', ScrollLock: 'ScrLk', Pause: 'Pause',
  ContextMenu: 'Menü', NumLock: 'Num', NumpadEnter: 'Num ⏎', NumpadDivide: 'Num /',
  NumpadMultiply: 'Num *', NumpadSubtract: 'Num -', NumpadAdd: 'Num +', NumpadDecimal: 'Num ,',
  MetaRight: 'Win R',
  KnobLeft: 'Knopf ⟲', KnobRight: 'Knopf ⟳', KnobPress: 'Knopf drücken',
};

/** Drehknopf als drei belegbare „Tasten“ (nur Tastenbelegung). */
export const KNOB_PARTS = [
  { id: 'KnobLeft', icon: '⟲', title: 'Knopf nach links drehen' },
  { id: 'KnobPress', icon: '●', title: 'Knopf drücken' },
  { id: 'KnobRight', icon: '⟳', title: 'Knopf nach rechts drehen' },
] as const;

const DE_LABELS: Record<string, string> = {
  Backquote: '^', Minus: 'ß', Equal: '´', Delete: 'Entf', Home: 'Pos1', PageUp: 'Bild↑', PageDown: 'Bild↓',
  KeyY: 'Z', KeyZ: 'Y', BracketLeft: 'Ü', BracketRight: '+', Semicolon: 'Ö', Quote: 'Ä', Backslash: '#',
  Slash: '-', ControlLeft: 'Strg', ControlRight: 'Strg', CapsLock: 'Feststell', Backspace: '⟵',
  Enter: '⏎', Insert: 'Einfg', End: 'Ende', PrintScreen: 'Druck', Escape: 'Esc', Space: 'Leertaste',
  ShiftLeft: '⇧', ShiftRight: '⇧',
};

export function keyLabel(code: string, variant: LayoutVariant): string {
  if (variant === 'iso-de' && DE_LABELS[code]) return DE_LABELS[code];
  if (BASE_LABELS[code]) return BASE_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}
