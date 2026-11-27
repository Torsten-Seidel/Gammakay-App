// Schmale, sichere Brücke zwischen Oberfläche und Hauptprozess.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  /** Liefert die Geräteliste, sobald navigator.hid.requestDevice() aufgerufen wurde. */
  onHidDeviceList(callback) {
    const listener = (_event, list) => callback(list);
    ipcRenderer.on('hid:device-list', listener);
    return () => ipcRenderer.removeListener('hid:device-list', listener);
  },
  /** Gerät auswählen (deviceId) oder Auswahl abbrechen (null). */
  chooseHidDevice(deviceId) {
    ipcRenderer.send('hid:choose', deviceId ?? null);
  },
  /** Eine Zeile an die Log-Datei anhängen. */
  appendLog(line) {
    ipcRenderer.send('log:line', String(line));
  },
});
