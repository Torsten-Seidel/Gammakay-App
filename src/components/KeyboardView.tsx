import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { describeAction } from '../device/keycodes';
import { KNOB, LAYOUTS, LAYOUT_HEIGHT, LAYOUT_WIDTH, keyLabel, type KeyDef } from '../device/layout';
import { actionFor, switchFor, type KeyId } from '../device/model';
import { useApp, useProfile } from '../store';

const UNIT = 54;
const GAP = 4;

/** Effekt-Vorschau: einfache Farbe pro Taste für die Darstellung, keine echte Animation. */
function previewColor(effect: string, color: string, def: KeyDef): string | undefined {
  if (effect === 'off') return undefined;
  if (effect === 'spectrum' || effect === 'wave') {
    const hue = Math.round((def.x / LAYOUT_WIDTH) * 300);
    return `hsl(${hue} 80% 58%)`;
  }
  return color;
}

export function KeyboardView({ pressed = [] }: { pressed?: KeyId[] }) {
  const layout = useApp((s) => s.layout);
  const view = useApp((s) => s.view);
  const layer = useApp((s) => s.layer);
  const selected = useApp((s) => s.selected);
  const macros = useApp((s) => s.config?.macros ?? []);
  const toggleKey = useApp((s) => s.toggleKey);
  const profile = useProfile();
  const keys = LAYOUTS[layout];

  const dragging = useRef(false);
  const [, force] = useState(0);
  useEffect(() => {
    const up = () => {
      dragging.current = false;
      force((n) => n + 1);
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const advancedKeys = new Set(
    profile?.advanced.flatMap((a) => (a.kind === 'snap' ? a.keys : [a.key])) ?? [],
  );

  return (
    <div
      className="keyboard"
      style={{ width: LAYOUT_WIDTH * UNIT + 24, height: LAYOUT_HEIGHT * UNIT + 24 }}
      onMouseLeave={() => (dragging.current = false)}
    >
      {keys.map((def) => {
        const isSelected = view !== 'diagnose' && selected.includes(def.id);
        let sub = '';
        let color: string | undefined;
        if (profile) {
          if (view === 'keymap') sub = describeAction(actionFor(profile, layer, def.id), layout, macros);
          if (view === 'switches') {
            const sw = switchFor(profile, def.id);
            sub = `${sw.actuation.toFixed(2)}${sw.rapidTrigger ? ' RT' : ''}`;
          }
          if (view === 'lighting') {
            const l = profile.lighting;
            color = l.effect === 'custom' ? l.perKey[def.id] : previewColor(l.effect, l.color, def);
          }
        }
        const style: CSSProperties = {
          left: def.x * UNIT + 12,
          top: def.y * UNIT + 12,
          width: def.w * UNIT - GAP,
          height: def.h * UNIT - GAP,
          ...(color ? { ['--key-glow' as string]: color } : {}),
        };
        const cls = [
          'key',
          isSelected && 'selected',
          def.isoEnter && 'iso-enter',
          color && 'lit',
          pressed.includes(def.id) && 'pressed',
          sub && view === 'keymap' && 'remapped',
        ].filter(Boolean).join(' ');
        return (
          <button
            key={def.id}
            type="button"
            className={cls}
            style={style}
            title={def.id}
            onMouseDown={(e) => {
              dragging.current = true;
              toggleKey(def.id, e.ctrlKey || e.shiftKey || e.metaKey);
            }}
            onMouseEnter={() => {
              if (dragging.current && !selected.includes(def.id)) toggleKey(def.id, true);
            }}
          >
            <span className="key-label">{keyLabel(def.id, layout)}</span>
            {sub && <span className="key-sub">{sub}</span>}
            {view === 'advanced' && advancedKeys.has(def.id) && <span className="key-badge" />}
          </button>
        );
      })}
      <div
        className="knob"
        title="Drehregler"
        style={{ left: KNOB.x * UNIT + 12, top: KNOB.y * UNIT + 12, width: UNIT - GAP, height: UNIT - GAP }}
      />
    </div>
  );
}
