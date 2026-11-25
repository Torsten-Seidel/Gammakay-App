import { useState, type ReactNode } from 'react';
import { KEY_GROUPS } from '../device/keycodes';
import { keyLabel } from '../device/layout';
import { useApp } from '../store';

export function Card({ title, actions, children, className = '' }: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <h3>{title}</h3>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      <div className="row">{children}</div>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Slider({ label, value, min, max, step, unit, onChange, disabled }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  onChange(v: number): void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className={`slider ${disabled ? 'disabled' : ''}`}>
      <div className="slider-head">
        <span>{label}</span>
        <span className="slider-value">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v)) onChange(clamp(v));
            }}
          />
          {unit}
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** Auswahlpalette für Tastencodes, gruppiert und durchsuchbar. */
export function KeyPalette({ onPick, active }: { onPick(code: string): void; active?: string[] }) {
  const layout = useApp((s) => s.layout);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  return (
    <div className="palette">
      <input className="search" placeholder="Taste suchen …" value={query} onChange={(e) => setQuery(e.target.value)} />
      {KEY_GROUPS.map((g) => {
        const codes = g.codes.filter((c) => !q || keyLabel(c, layout).toLowerCase().includes(q) || c.toLowerCase().includes(q));
        if (!codes.length) return null;
        return (
          <div key={g.title} className="palette-group">
            <div className="palette-title">{g.title}</div>
            <div className="palette-keys">
              {codes.map((c) => (
                <button
                  key={c}
                  className={`pkey ${active?.includes(c) ? 'active' : ''}`}
                  title={c}
                  onClick={() => onPick(c)}
                >
                  {keyLabel(c, layout)}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function KeyCodeSelect({ value, onChange }: { value: string; onChange(code: string): void }) {
  const layout = useApp((s) => s.layout);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— keine —</option>
      {KEY_GROUPS.map((g) => (
        <optgroup key={g.title} label={g.title}>
          {g.codes.map((c) => (
            <option key={c} value={c}>{keyLabel(c, layout)}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="hint">{children}</p>;
}
