// Electron-Hauptprozess: Fenster, WebHID-Geräteauswahl und Berechtigungen.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DEV_URL = 'http://127.0.0.1:5173';
const useDist = app.isPackaged || process.argv.includes('--dist');

// Entwicklungsmodus: Debug-Zugang nur auf diesem Rechner (127.0.0.1), damit Tests die laufende App
// steuern können (tools/app-test.mjs). In der gebauten App gibt es ihn nicht.
const DEBUG_PORT = 9229;
if (!useDist) {
  app.commandLine.appendSwitch('remote-debugging-port', String(DEBUG_PORT));
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
}

// Protokoll-Log zusätzlich als Datei: Entwicklung → <Projekt>/logs, gebaute App → Log-Ordner des Systems.
const LOG_DIR = useDist ? app.getPath('logs') : path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'diagnose.log');
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  // Pro App-Start eine neue Datei, die vorige bleibt als diagnose.prev.log erhalten.
  if (fs.existsSync(LOG_FILE)) fs.renameSync(LOG_FILE, path.join(LOG_DIR, 'diagnose.prev.log'));
} catch (e) {
  console.error('Log-Ordner nicht nutzbar:', e);
}

let mainWindow = null;
// Callback aus 'select-hid-device', solange die eigene Geräteauswahl offen ist.
let pendingHidCallback = null;

function isOwnOrigin(url) {
  if (!url) return false;
  return useDist ? url.startsWith('file://') : url.startsWith(DEV_URL);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#0e1014',
    title: 'TK75 Konfigurator',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const ses = mainWindow.webContents.session;

  // WebHID: statt des Chrome-Dialogs schicken wir die Liste an die eigene Oberfläche.
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    // Smoke-Test mit echter Tastatur: erstes passendes Gerät automatisch wählen.
    if (process.env.TK75_SMOKE_DEVICE) {
      callback(details.deviceList[0]?.deviceId);
      return;
    }
    if (pendingHidCallback) pendingHidCallback(); // vorherige Anfrage abbrechen
    pendingHidCallback = callback;
    mainWindow.webContents.send(
      'hid:device-list',
      details.deviceList.map((d) => ({
        deviceId: d.deviceId,
        name: d.name,
        vendorId: d.vendorId,
        productId: d.productId,
      })),
    );
  });

  ses.setPermissionCheckHandler((_wc, permission, origin) => permission === 'hid' && isOwnOrigin(origin));
  ses.setDevicePermissionHandler((details) => details.deviceType === 'hid' && isOwnOrigin(details.origin));

  // Externe Links im Standardbrowser öffnen, keine Navigation weg von der App.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isOwnOrigin(url)) e.preventDefault();
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('Renderer beendet:', details.reason, details.exitCode);
  });

  // Smoke-Test: TK75_SMOKE=1 startet, prüft die Oberfläche und beendet sich wieder.
  if (process.env.TK75_SMOKE) {
    mainWindow.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 'warning') console.log('RENDERER', event.level, event.message);
    });
    mainWindow.webContents.once('did-finish-load', async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const run = (code) => mainWindow.webContents.executeJavaScript(code);
      await wait(1500);
      console.log('SMOKE start', await run(
        `JSON.stringify({ title: document.querySelector('h1')?.innerText, hid: 'hid' in navigator, bridge: !!window.desktop })`,
      ));
      if (process.env.TK75_SMOKE_DEVICE) {
        // Nur Lesebefehle: verbinden, Konfiguration lesen, Banner und Log ausgeben.
        await mainWindow.webContents.executeJavaScript(
          `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Tastatur verbinden')).click()`, true);
        await wait(3000);
        console.log('SMOKE device', await run(
          `JSON.stringify({ banner: document.querySelector('.banner')?.innerText ?? null, toast: document.querySelector('.toast')?.innerText ?? null })`,
        ));
      }
      await run(`document.querySelector('.rail-btn[title="Diagnose"]').click()`);
      if (process.env.TK75_SMOKE_DEVICE) {
        await wait(500);
        console.log('SMOKE log\n' + await run(`[...document.querySelectorAll('.log-line')].map(l => l.innerText.replace(/\\n/g, ' ')).join('\\n')`));
      }
      await wait(1500);
      if (mainWindow.webContents.isCrashed()) console.log('SMOKE diagnose: Renderer abgestürzt');
      else console.log('SMOKE diagnose', await run(
        `JSON.stringify({ heading: document.querySelector('.panel-header h2')?.innerText ?? null, rootChildren: document.getElementById('root').childElementCount })`,
      ));
      app.quit();
    });
  }

  if (useDist) mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  else mainWindow.loadURL(DEV_URL);
}

ipcMain.on('log:line', (_event, line) => {
  if (typeof line !== 'string') return;
  try {
    fs.appendFileSync(LOG_FILE, `${line.slice(0, 4000)}\n`);
  } catch {
    // Log-Datei ist nur eine Hilfe – Fehler hier dürfen die App nicht stören.
  }
});

ipcMain.on('hid:choose', (_event, deviceId) => {
  if (!pendingHidCallback) return;
  const cb = pendingHidCallback;
  pendingHidCallback = null;
  if (typeof deviceId === 'string' && deviceId) cb(deviceId);
  else cb(); // abgebrochen
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
