import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { Card, EmptyHint, PanelHeader, Slider } from '../components/ui';

const MAX_FRAMES = 60;

/** Bild auf Displaygröße skalieren (zuschneiden, damit es den Bildschirm füllt). */
async function toFrame(file: Blob, width: number, height: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas nicht verfügbar');
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
  bitmap.close();
  return canvas.toDataURL('image/png');
}

export function DisplayPanel() {
  const display = useApp((s) => s.config?.display);
  const size = useApp((s) => s.driver?.capabilities.display ?? null);
  const edit = useApp((s) => s.edit);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const frames = display?.frames ?? [];
  useEffect(() => {
    if (!playing || frames.length < 2 || !display) return;
    const t = setInterval(() => setFrameIdx((i) => (i + 1) % frames.length), Math.max(20, display.intervalMs));
    return () => clearInterval(t);
  }, [playing, frames.length, display]);

  if (!display) return null;
  if (!size) return <div className="panel"><EmptyHint>Für dieses Gerät ist kein Display bekannt.</EmptyHint></div>;

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    try {
      const list = await Promise.all(Array.from(files).map((f) => toFrame(f, size.width, size.height)));
      edit((d) => void (d.display.frames = [...d.display.frames, ...list].slice(0, MAX_FRAMES)));
    } catch (e) {
      setError(`Bild konnte nicht geladen werden: ${String(e)}`);
    }
  };

  const current = frames[frameIdx % Math.max(1, frames.length)];

  return (
    <div className="panel">
      <PanelHeader title="Display">
        <label className="btn">
          Bilder hinzufügen
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" multiple hidden
            onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
        </label>
        <button className="btn ghost" disabled={!frames.length} onClick={() => edit((d) => void (d.display.frames = []))}>Alle löschen</button>
      </PanelHeader>
      {error && <p className="error-text">{error}</p>}
      <div className="grid-2">
        <Card title={`Vorschau (${size.width}×${size.height})`}>
          <div className="display-preview" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
            {current ? <img src={current} alt="Display-Vorschau" /> : <span>Kein Bild</span>}
          </div>
          <div className="row">
            <button className="btn ghost" disabled={frames.length < 2} onClick={() => setPlaying((p) => !p)}>
              {playing ? 'Pause' : 'Abspielen'}
            </button>
            <small>Frame {frames.length ? (frameIdx % frames.length) + 1 : 0} / {frames.length}</small>
          </div>
          <EmptyHint>Die Auflösung ist noch eine Annahme und wird mit dem Protokoll geprüft. GIFs werden vorerst nur als erstes Bild übernommen.</EmptyHint>
        </Card>
        <Card title="Frames & Einstellungen">
          <div className="row">
            <label className="field inline">Speicherplatz
              <select value={display.slot} onChange={(e) => edit((d) => void (d.display.slot = Number(e.target.value)))}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <Slider label="Bildintervall" value={display.intervalMs} min={20} max={1000} step={10} unit="ms"
            onChange={(v) => edit((d) => void (d.display.intervalMs = v))} />
          <div className="frames">
            {frames.map((f, i) => (
              <div key={i} className={`frame ${i === frameIdx % frames.length ? 'active' : ''}`} onClick={() => setFrameIdx(i)}>
                <img src={f} alt={`Frame ${i + 1}`} />
                <button className="step-x" onClick={(e) => { e.stopPropagation(); edit((d) => void d.display.frames.splice(i, 1)); }}>×</button>
              </div>
            ))}
            {!frames.length && <EmptyHint>Noch keine Frames.</EmptyHint>}
          </div>
        </Card>
      </div>
    </div>
  );
}
