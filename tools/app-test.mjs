// Steuert die laufende App (npm run dev) über den Debug-Zugang auf 127.0.0.1:9229.
// Aufruf:  node tools/app-test.mjs "<JavaScript-Ausdruck>"
// Der Ausdruck läuft in der Oberfläche; `t` ist der Test-Zugang (window.__tk75), Promises werden abgewartet.
// Beispiele:
//   node tools/app-test.mjs "t.connect()"
//   node tools/app-test.mjs "t.app.getState().draft.profiles[0].defaultSwitch"
const PORT = 9229;
const expr = process.argv[2];
if (!expr) {
  console.error('Aufruf: node tools/app-test.mjs "<Ausdruck>"');
  process.exit(2);
}

const targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).catch(() => null);
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
const source = `(async () => { const t = window.__tk75; if (!t) throw new Error('Test-Zugang fehlt (nur im Entwicklungsmodus)');
  const r = await (${expr}); return JSON.stringify(r ?? null, null, 2); })()`;
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: source, awaitPromise: true, userGesture: true } }));
const msg = await new Promise((resolve) => {
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id === 1) resolve(m);
  };
});
ws.close();

const res = msg.result;
if (msg.error || res?.exceptionDetails) {
  console.error('Fehler:', msg.error?.message ?? res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  process.exit(1);
}
console.log(res.result.value);
