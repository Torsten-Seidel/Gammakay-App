import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { describeAction, describeFactory } from '../device/keycodes';
import { KNOB, KNOB_PARTS, LAYOUTS, LAYOUT_HEIGHT, LAYOUT_WIDTH, keyLabel, type KeyDef } from '../device/layout';
import { actionFor, switchFor, type KeyId, type LightingConfig } from '../device/model';
import { useApp, useCapabilities, useMacros, useProfile } from '../store';
import { PRESS_LIFETIME, REACTIVE, previewFrame, type PreviewKey, type PreviewPress } from './lightPreview';

const UNIT = 54;
const GAP = 4;

const center = (def: KeyDef): PreviewKey => ({ id: def.id, cx: def.x + def.w / 2, cy: def.y + def.h / 2 });

/**
 * Animierte Licht-Vorschau: setzt Farben direkt per DOM (kein React-Render pro Frame).
 * Gibt eine Funktion zurück, die einen virtuellen Tastendruck auslöst.
 */
function useLightPreview(
  active: boolean,
  lighting: LightingConfig | undefined,
  keys: KeyDef[],
  els: React.RefObject<Map<KeyId, HTMLButtonElement>>,
): (id: KeyId) => void {
  const presses = useRef<PreviewPress[]>([]);
  const lightingRef = useRef(lighting);
  lightingRef.current = lighting;
  const simulate = useApp((s) => s.previewSimulate);
  const keyList = useRef<PreviewKey[]>([]);
  keyList.current = keys.map(center);

  const press = useRef((id: KeyId) => {
    const k = keyList.current.find((x) => x.id === id);
    if (!k) return;
    presses.current.push({ ...k, t: performance.now() / 1000, hue: Math.random() * 360 });
    const el = els.current.get(id);
    if (el) {
      el.classList.add('pressed');
      window.setTimeout(() => el.classList.remove('pressed'), 140);
    }
  });

  // Animationsschleife
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      const l = lightingRef.current;
      const t = performance.now() / 1000;
      presses.current = presses.current.filter((p) => t - p.t < PRESS_LIFETIME);
      if (l) {
        const colors = previewFrame(l, keyList.current, t, presses.current);
        for (const [id, el] of els.current) {
          const c = colors.get(id);
          if (c) el.style.setProperty('--key-glow', c);
          el.classList.toggle('lit', !!c);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      presses.current = [];
      for (const el of els.current.values()) {
        el.classList.remove('lit');
        el.style.removeProperty('--key-glow');
      }
    };
  }, [active, els]);

  // Echtes Tippen löst virtuelle Drücke aus (nicht in Eingabefeldern)
  useEffect(() => {
    if (!active) return;
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.repeat || (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      press.current(e.code);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [active]);

  // Simulierte Drücke für reaktive Effekte
  const reactive = !!lighting && REACTIVE.has(lighting.effect);
  // Ripple braucht Platz für die Ringe, daher seltenere Tropfen.
  const interval = lighting?.effect === 'ripple' ? 1600 : 1000;
  useEffect(() => {
    if (!active || !simulate || !reactive) return;
    const id = window.setInterval(() => {
      const list = keyList.current;
      if (list.length) press.current(list[Math.floor(Math.random() * list.length)].id);
    }, interval);
    return () => window.clearInterval(id);
  }, [active, simulate, reactive, interval]);

  return press.current;
}

export function KeyboardView({ pressed = [] }: { pressed?: KeyId[] }) {
  const layout = useApp((s) => s.layout);
  const view = useApp((s) => s.view);
  const layer = useApp((s) => s.layer);
  const selected = useApp((s) => s.selected);
  const macros = useMacros();
  const { factoryFn, factoryBase: baseKnob } = useCapabilities();
  const toggleKey = useApp((s) => s.toggleKey);
  const profile = useProfile();
  const keys = LAYOUTS[layout];
  const isLight = view === 'lighting' && !!profile;
  const els = useRef(new Map<KeyId, HTMLButtonElement>());
  const virtualPress = useLightPreview(isLight, profile?.lighting, keys, els);

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
        const isSelected = view !== 'diagnose' && !isLight && selected.includes(def.id);
        let sub = '';
        let remapped = false;
        if (profile) {
          if (view === 'keymap') {
            const action = actionFor(profile, layer, def.id);
            remapped = action.kind !== 'default';
            sub = action.kind === 'default' && layer === 'fn'
              ? describeFactory(factoryFn?.[def.id], layout)
              : describeAction(action, layout, macros);
          }
          if (view === 'switches') {
            const sw = switchFor(profile, def.id);
            sub = `${sw.actuation.toFixed(2)}${sw.rapidTrigger ? ' RT' : ''}`;
          }
        }
        const style: CSSProperties = {
          left: def.x * UNIT + 12,
          top: def.y * UNIT + 12,
          width: def.w * UNIT - GAP,
          height: def.h * UNIT - GAP,
        };
        // In der Licht-Ansicht setzt die Vorschau `lit` und `--key-glow` selbst.
        const cls = [
          'key',
          isSelected && 'selected',
          def.isoEnter && 'iso-enter',
          pressed.includes(def.id) && 'pressed',
          remapped && view === 'keymap' && 'remapped',
        ].filter(Boolean).join(' ');
        return (
          <button
            key={def.id}
            type="button"
            className={cls}
            style={style}
            title={def.id}
            ref={(el) => {
              if (el) els.current.set(def.id, el);
              else els.current.delete(def.id);
            }}
            onMouseDown={(e) => {
              if (isLight) {
                virtualPress(def.id);
                return;
              }
              dragging.current = true;
              toggleKey(def.id, e.ctrlKey || e.shiftKey || e.metaKey);
            }}
            onMouseEnter={() => {
              if (!isLight && dragging.current && !selected.includes(def.id)) toggleKey(def.id, true);
            }}
          >
            <span className="key-label">{keyLabel(def.id, layout)}</span>
            {sub && <span className="key-sub">{sub}</span>}
            {view === 'advanced' && advancedKeys.has(def.id) && <span className="key-badge" />}
          </button>
        );
      })}
      <div
        className={`knob ${view === 'keymap' ? 'editable' : ''}`}
        title="Drehregler"
        style={{ left: KNOB.x * UNIT + 12, top: KNOB.y * UNIT + 12, width: UNIT - GAP, height: UNIT - GAP }}
      >
        {view === 'keymap' && profile && KNOB_PARTS.map((part) => {
          const action = actionFor(profile, layer, part.id);
          const text = action.kind === 'default'
            ? (layer === 'fn' ? describeFactory(factoryFn?.[part.id], layout) : describeFactory(baseKnob?.[part.id], layout))
            : describeAction(action, layout, macros);
          return (
            <button
              key={part.id}
              type="button"
              className={[
                'knob-part',
                selected.includes(part.id) && 'selected',
                action.kind !== 'default' && 'remapped',
              ].filter(Boolean).join(' ')}
              title={`${part.title}${text ? `: ${text}` : ''}`}
              onMouseDown={(e) => toggleKey(part.id, e.ctrlKey || e.shiftKey || e.metaKey)}
            >
              {part.icon}
            </button>
          );
        })}
      </div>
    </div>
  );
}
