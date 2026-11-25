// HID-Logger für die DevTools-Konsole (Chrome/Edge).
// Zeichnet auf, was eine WebHID-Seite an das Gerät sendet und was zurückkommt.
// Nur zum Beobachten des eigenen Geräteverkehrs – verändert keine Daten.
//
// Nutzung: Seite öffnen → F12 → Konsole → dieses Skript einfügen → Enter → DANN erst
// die Tastatur in der Seite verbinden. Am Ende: copy(__hidLog.join('\n'))
(() => {
  if (window.__hidLog) return console.log('HID-Logger läuft bereits.');
  const toBytes = (d) =>
    d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  const hex = (d) => Array.from(toBytes(d), (b) => b.toString(16).padStart(2, '0')).join(' ');
  const log = (window.__hidLog = []);
  const t0 = performance.now();
  const rec = (dir, id, data) => {
    const line = `${(performance.now() - t0).toFixed(0).padStart(7)} ms  ${dir.padEnd(11)} #${id}  ${hex(data)}`;
    log.push(line);
    console.log(line);
  };
  window.__hidMark = (text) => {
    const line = `----- ${text} -----`;
    log.push(line);
    console.log(line);
  };

  const P = HIDDevice.prototype;
  const sendFeature = P.sendFeatureReport;
  const receiveFeature = P.receiveFeatureReport;
  const sendReport = P.sendReport;
  const addListener = P.addEventListener;

  P.sendFeatureReport = function (id, data) {
    rec('SET_FEATURE', id, data);
    return sendFeature.call(this, id, data);
  };
  P.receiveFeatureReport = async function (id) {
    const res = await receiveFeature.call(this, id);
    rec('GET_FEATURE', id, res);
    return res;
  };
  P.sendReport = function (id, data) {
    rec('OUT', id, data);
    return sendReport.call(this, id, data);
  };
  P.addEventListener = function (type, fn, opts) {
    if (type !== 'inputreport') return addListener.call(this, type, fn, opts);
    const wrapped = (e) => {
      rec('IN', e.reportId, e.data);
      return typeof fn === 'function' ? fn.call(this, e) : fn.handleEvent(e);
    };
    return addListener.call(this, type, wrapped, opts);
  };
  const desc = Object.getOwnPropertyDescriptor(P, 'oninputreport');
  if (desc?.set) {
    Object.defineProperty(P, 'oninputreport', {
      configurable: true,
      get() {
        return desc.get.call(this);
      },
      set(fn) {
        desc.set.call(this, fn ? (e) => { rec('IN', e.reportId, e.data); return fn.call(this, e); } : fn);
      },
    });
  }
  console.log('HID-Logger aktiv. Markierung setzen: __hidMark("Text") · Kopieren: copy(__hidLog.join("\\n"))');
})();
