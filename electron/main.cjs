// Electron-Hauptprozess: Fenster, WebHID-Geräteauswahl und Berechtigungen.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');

const DEV_URL = 'http://127.0.0.1:5173';
const useDist = app.isPackaged || process.argv.includes('--dist');

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
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1500));
      const result = await mainWindow.webContents.executeJavaScript(
        `JSON.stringify({ title: document.querySelector('h1')?.innerText, hid: 'hid' in navigator, bridge: !!window.desktop })`,
      );
      console.log('SMOKE', result);
      app.quit();
    });
  }

  if (useDist) mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  else mainWindow.loadURL(DEV_URL);
}

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
