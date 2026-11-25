# TK75 TMR – Protokoll-Notizen

Quelle: eigener Mitschnitt der WebHID-Kommunikation (`tools/hid-logger.js`) beim Verbinden mit GearHub, 2026-11-25.
Status: **Hypothesen**, sofern nicht als „bestätigt“ markiert.

## Gerät

- USB: VID `0x3151`, PID `0x5030`, Produktname „TK75 TMR“
- Konfigurationskanal: Interface mit Usage Page `0xFFFF`, Usage `0x0002`, **Feature-Report ID 0, 64 Byte** (bestätigt)
- Zweites Interface: Consumer-Control (Input #3, 2 B) + Usage Page `0xFFFF`/`0x0001` mit Input #5 (31 B) – Zweck noch offen

## Paketformat (bestätigt)

```
Byte 0      Befehl
Byte 1..6   Parameter
Byte 7      Prüfsumme = 0xFF - (Summe Byte 0..6) & 0xFF
Byte 8..63  Nutzdaten
```

Ablauf: `sendFeatureReport(0, paket)` → ca. 10 ms später `receiveFeatureReport(0)` → Antwort beginnt mit demselben Befehlsbyte.
Ohne Daten spiegelt das Gerät das Anfragepaket.

Muster: Befehle ≥ `0x80` lesen, `Befehl & 0x7F` ist vermutlich der passende Schreibbefehl (z. B. `0x87` lesen ↔ `0x07` schreiben).

## Gesehene Befehle beim Verbinden

| Befehl | Antwort (ab Byte 1) | Deutung |
|---|---|---|
| `8F` | `07 0e 00 00 00 00 03 04` | Firmware/Version (Format offen) |
| `80` | Echo | ? |
| `AE` | Echo | ? |
| `AD` | `02 01 ff ff 01 00 00 07 0e … "RY5060RY50"` | Geräteinfo, ASCII-Kennung `RY5060RY50` |
| `84` | Echo (0) | vermutlich aktives Profil = 0 |
| `E6` | `aa` | Status? |
| `28` | – (nur Senden) | **Uhrzeit setzen** (bestätigt): Byte 8.. = `07ea 0b 19 15 0b` → 2026-11-25 21:11 |
| `87` | `04 02 04 08 b4 b4 b4` | **Licht** (Tasten): Modus 4? + 3 Parameter + Farbe RGB `b4b4b4` |
| `88` | `04 01 04 08 ff ff ff` | **Seitenlicht**: gleiche Struktur, Farbe `ffffff` |
| `91` | Byte 8.. = `0078 0078 0690 0690` (LE) | **Energiespar-Zeiten in Sekunden**: 120, 120, 1680, 1680 → 2/2/28/28 min (passt zu GearHub) |
| `83` | Echo (0) | vielleicht Polling-Rate-Index (0 = 8 kHz?) |
| `97`, `86`, `89` | Echo (0) | ? |

## Licht schreiben (Mitschnitt 2: Helligkeit 4 → 3)

```
SET  07 04 02 03 08 b4 b4 b4 cb
READ 87 04 02 04 08 b4 b4 b4      (vorher)
```

- `0x07` ist der Schreibbefehl zu `0x87` (bestätigt).
- **Prüfsumme hier in Byte 8** über Byte 0..7 (`0xFF - Summe & 0xFF` = `cb`, bestätigt).
  → Es gibt zwei Varianten: kurze Befehle mit Prüfsumme in Byte 7, Befehle mit 7 Datenbytes mit Prüfsumme in Byte 8.
- Licht-Layout (Byte 1..7): `Modus=04`, `?=02` (Tempo?), **`Helligkeit=03`** (bestätigt, Skala 0–4), `?=08` (Richtung/Option?), `R G B = b4 b4 b4`.
- Danach meldet das Gerät auf Input #5: `0f 01` und ~30 ms später `0f 00` → vermutlich „speichert“ / „fertig“.

## Offen / nächste Mitschnitte

1. Farbe ändern → Lage der RGB-Bytes bestätigen.
2. Tempo und Effekt ändern → Byte 2 und Byte 1 (Modusnummern).
3. Polling-Rate ändern → bestätigt `83`/`03`?
