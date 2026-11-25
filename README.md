# TK75 Konfigurator

Eigene Desktop-App (Electron + React + TypeScript) zur Konfiguration der **Gamakay TK75 TMR**.
Keine Kopie der offiziellen Web-App: Das Layout ist an Wootility angelehnt, der Funktionsumfang an GearHub.

## Starten

```powershell
npm install
npm run dev        # Vite-Dev-Server + Electron mit Hot Reload
npm start          # Produktions-Build lokal in Electron starten
npm run typecheck
```

`npm run dev:web` startet nur die Oberfläche im Browser (Chrome/Edge, WebHID funktioniert dort auch).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `electron/main.cjs` | Fenster, eigene WebHID-Geräteauswahl, Berechtigungen nur für die eigene App |
| `electron/preload.cjs` | schmale IPC-Brücke (`window.desktop`) |
| `src/device/model.ts` | herstellerneutrales Konfigurationsmodell (Profile, Ebenen, RT, DKS, Licht, Makros, Display) |
| `src/device/driver.ts` | Treiber-Schnittstelle + Fähigkeiten der TK75 |
| `src/device/mockDriver.ts` | Demo-Treiber ohne Hardware (speichert im localStorage) |
| `src/device/hidDriver.ts` | Treiber für die echte Tastatur – **Protokoll noch offen**, Lesen/Schreiben gesperrt |
| `src/device/layout.ts` | TK75-Layout (ISO-DE / ANSI), Tasten-IDs = `KeyboardEvent.code` |
| `src/panels/*` | Konfigurationsbereiche; `DiagnosePanel` ist nur lesend |

## Stand

- Demo-Modus: alle Bereiche bedienbar, Rückgängig/Wiederholen, „Übernehmen“ schreibt nur geänderte Bereiche.
- Echte Tastatur: Verbindung und **Diagnose** (HID-Interfaces auflisten, Input-Reports mitlesen, Feature-Reports lesen).
- Keine Schreibbefehle an die echte Tastatur, kein Firmware-Flashen.

## Nächster Schritt: Protokoll

1. TK75 per Kabel anschließen → Diagnose → „HID-Gerät freigeben“ → Interfaces mit Usage Page `0xFFxx` notieren.
2. „Konfiguration lesen“ in der offiziellen Web-App mit Wireshark + USBPcap mitschneiden.
3. Lesebefehle im `GamakayHidDriver` umsetzen, danach RGB als ersten Schreibbefehl.

Offene Annahmen: Displayauflösung (128×128), Wertebereiche für Hub/RT, Anzahl Profile (4).
