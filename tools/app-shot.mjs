// Screenshot der laufenden App (npm run dev), optional mitten in einer Aktion.
// Aufruf:  node tools/app-shot.mjs <datei.png> [Verzögerung ms] ["<Ausdruck, wird gestartet, nicht abgewartet>"]
// `t` ist der Test-Zugang (window.__tk75), wie bei tools/app-test.mjs.
import { writeFileSync } from 'node:fs';

const [file, delayArg = '0', expr] = process.argv.slice(2);
if (!file) {
  console.error('Aufruf: node tools/app-shot.mjs <datei.png> [ms] ["<Ausdruck>"]');
  process.exit(2);
}
const targets = await fetch('http://127.0.0.1:9229/json').then((r) => r.json()).catch(() => null);
const page = targets?.find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:5173'));
if (!page) {
  console.error('App nicht gefunden – läuft „npm run dev“?');
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 1;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  pending.get(m.id)?.(m);
};
const call = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

if (expr) await call('Runtime.evaluate', { expression: `{ const t = window.__tk75; (async () => (${expr}))(); }` });
await new Promise((r) => setTimeout(r, Number(delayArg)));
const shot = await call('Page.captureScreenshot', { format: 'png' });
ws.close();
if (!shot.result?.data) {
  console.error('Screenshot fehlgeschlagen', shot.error);
  process.exit(1);
}
writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
console.log(file);
