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

## Farbe (Mitschnitt 3: auf Rot)

```
SET 07 04 02 04 07 b4 b4 b4 cb   ← Byte 4: 08 → 07
SET 07 04 02 04 07 ff 00 00 e8   ← Farbe Rot
```

- **Byte 5..7 = R, G, B** (bestätigt).
- Byte 4 wechselt vor dem Farbwechsel von `08` auf `07` → vermutlich Farbmodus:
  `07` = eigene Farbe, `08` = bunt/„Glanz“ (Hypothese).
- Prüfsummen in Byte 8 stimmen für beide Pakete.

## Tempo (Mitschnitt 4)

```
SET 07 0b 02 04 08 fa ff fa ec   Tempo 2
SET 07 0b 01 04 08 fa ff fa ed   Tempo 1
```

- **Byte 2 = Tempo** (bestätigt).

Hinweis: GearHub hat einen „IOT-Modus“ (localStorage `IOTSwitch`), der statt WebHID einen lokalen Dienst
(`iot_manager_rs.exe`, 127.0.0.1:6015) nutzt – dann sieht der Logger nichts. Für Mitschnitte `IOTSwitch` auf `false`.

## Effekte (Mitschnitt 5: alle Effekte der Reihe nach)

Licht-Paket komplett: `07 | Effekt | Tempo | Helligkeit | Farbmodus | R | G | B | Prüfsumme`

| Code | Effekt (GearHub) | | Code | Effekt (GearHub) |
|---|---|---|---|---|
| `01` | Immer an | | `0b` | Kaleidoskop |
| `02` | Dynamisches Atmen | | `0c` | Blumenwelle |
| `03` | Spektrum-Zyklus | | `0d` | Benutzerdefiniert (`LightUserPicture`) |
| `04` | Welle | | `0e` | Laser |
| `05` | Ripple | | `0f` | Kreisende Welle |
| `06` | Sternenlicht | | `10` | Farbkreuz |
| `07` | Strom | | `11` | Schneefall |
| `08` | Schatten | | `12` | Meteor |
| `09` | Berg Welle | | `13` | Schneespur |
| `0a` | Sinuswelle | | | |

- Benutzerdefiniert (pro Taste) und Musik Modus nicht mitgeschnitten (Musik Modus braucht IOT).
- **Byte 4 = Option << 4 | Farbmodus**: unteres Halbbyte `7` = eine Farbe, `8` = bunt („Glanz“);
  oberes Halbbyte = Richtung/Muster (siehe unten). Bei `0d` stand `00`.

### Aus dem GearHub-Treiber (`setLightSetting`, Effektliste der TK75)

- Effektliste (Code = Index): 0 Off, 1 AlwaysOn, 2 Breath, 3 Neon, 4 Wave, 5 Ripple, 6 Raindrop, 7 Snake,
  8 PressAction, 9 Converage, 10 SineWave, 11 Kaleidoscope, 12 LineWave, 13 UserPicture, 14 Laser,
  15 CircleWave, 16 Dazzing, 17 RainDown, 18 Meteor, 19 PressActionOff, 20 MusicFollow3, 21 ScreenColor
  (Lichtschatten), 22 MusicFollow2, …
- **Tempo ist umgekehrt**: Byte 2 = `MAXSPEED (4) − Tempo` → Rohwert 0 = schnellste Stufe. Die App
  rechnet das im Treiber um (`speedToRaw` / `rawToSpeed`).
- Optionen (Index im oberen Halbbyte von Byte 4):

  | Effekt | 0 | 1 | 2 | 3 |
  |---|---|---|---|---|
  | Welle `04` | nach rechts | nach links | nach unten | nach oben |
  | Strom `07` | Zickzack | Spirale | | |
  | Kaleidoskop `0b` | nach außen | nach innen | | |
  | Blumenwelle `0c` | nach rechts | nach links | | |
  | Kreisende Welle `0f` | gegen den Uhrzeigersinn | im Uhrzeigersinn | | |

- Weiß `#ffffff` schickt GearHub als `#fafffa` (16449530).
- Test Meteor mit Option 1 (`07 12 02 04 18 …`): Die Tastatur speichert den Wert, der Meteor läuft aber
  weiter von links nach rechts. Effekte ohne `options` beachten die Richtung also nicht.
- GearHub merkt sich Tempo/Farbe je Effekt und schickt sie beim Effektwechsel mit.
- Alle Prüfsummen (Byte 8) stimmen.

## Offen / nächste Mitschnitte

1. Seitenlicht (`08`/`88`) ändern.
2. Polling-Rate, Energiespar-Zeiten.
3. Polling-Rate ändern → bestätigt `83`/`03`?
