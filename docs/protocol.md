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

## Seitenlicht (Mitschnitt 6, 2026-11-27, selbst über Claude in Chrome)

```
SET 08 01 00 04 08 fa ff fa f7   Immer an
SET 08 04 01 04 08 fa ff fa f3   Welle
SET 08 05 01 04 08 fa ff fa f2   Schlange
SET 08 02 01 04 08 fa ff fa f5   Atmung
SET 08 03 01 04 08 fa ff fa f4   Neon
SET 08 03 03 04 08 fa ff fa f2   Tempo „Schnell“
SET 08 03 00 04 08 fa ff fa f5   Tempo „Langsam“
SET 08 03 00 02 08 fa ff fa f7   Helligkeit 2
SET 08 00 00 00 07 fa ff fa fd   Ausschalten (= Ursprungszustand)
```

- `0x08` schreibt das Seitenlicht (bestätigt), Aufbau wie beim Tastenlicht:
  `08 | Effekt | Tempo | Helligkeit | Farbmodus | R G B | Prüfsumme (Byte 8)`.
- **Eigene Effektcodes** (bestätigt): `00` Aus, `01` Immer an, `02` Atmung, `03` Neon, `04` Welle, `05` Schlange.
  Keine Richtungsoptionen.
- **Tempo 0–3, nicht umgekehrt** (bestätigt): 3 = schnell, 0 = langsam.
- Helligkeit 0–4. Farbmodus `07`/`08` wie beim Tastenlicht.
- Neon ist ein Farbwechsel-Effekt: GearHub schickt ihn immer mit Farbmodus `08`, eine eigene Farbe wirkt nicht
  (auf der Tastatur bestätigt).
- „Aus“ schickt GearHub mit Tempo 0, Helligkeit 0 und Farbmodus `07`.
- Noch nicht mitgeschnitten: eigene Farbe (laut GearHub-Code gleiche Stelle wie beim Tastenlicht, Byte 5..7).

## Bluetooth (Mitschnitt 7, 2026-11-27)

- Gerät über Bluetooth: VID `0x3151`, **PID `0x5027`**, Produktname leer.
  Konfig-Interface: Usage Page `0xff55` / Usage `0x0202`, **Output- und Input-Report 6 mit 65 Byte**.
- Normale Befehle: `55` + das bekannte 64-Byte-Paket, z. B. `55 91 00 00 00 00 00 00 6e`.
  Die Antwort kommt als Input-Report 6 mit demselben Präfix (`55 91 … 78 00 78 00 …`) – ohne `55` ist sie
  identisch mit der USB-Antwort.
- **Akkustand** (bestätigt): `77 00 …` → Antwort `77 63 07 09 …`, Byte 1 = Prozent (`0x63` = 99 %, Display: voll).
  Bedeutung von `07 09` offen. GearHub fragt alle 5 s.
- Laut GearHub-Code: Input `88 …` ohne Präfix = Tastatur offline/Ruhezustand; Schreibbefehle über Bluetooth mit
  100 ms Abstand.
- Per Kabel liest GearHub keinen Akkustand (setzt fest 100 %).

## 2,4-GHz-Empfänger (Mitschnitt 8, 2026-11-27)

- Empfänger: VID `0x3151`, **PID `0x5038`**, Name „2.4G Wireless Keyboard“. Konfig-Interface wie per Kabel
  (`0xffff`/`0x0002`, Feature-Report 0, 64 Byte).
- **Status `F7`** (ohne Prüfsumme) → z. B. `00 64 00 00 01 01 01 00 00`:
  Byte 0 = Antwort abholbereit, **Byte 1 = Akku Tastatur in %** (`0x64` = 100), Byte 2 = Akku Maus,
  Byte 3 = Tastatur offline (0 = online), Byte 4 = Maus offline, Byte 5 = kann senden,
  Byte 6 = Typ (1 Tastatur, 2 Maus, 3 beide), Byte 8 = RF-Boot.
- **Befehl weiterleiten:** per `F7` warten bis Byte 5 = 1 → einmalig `F6 0A` (Ziel Tastatur; Maus `05`) →
  normales Paket (z. B. `8f … 70`).
- **Antwort abholen:** per `F7` warten bis Byte 0 = 1 → `FC` → `GET_FEATURE` liefert die Antwort im USB-Format
  (`8f 07 0e …`).
- Abstände laut GearHub 10 ms, Warten auf Status bis 5 × 100 ms. GearHub fragt `F7` alle 2 s.

## Polling-Rate (aus dem GearHub-Treiber, `setReportRate`/`getReportRate`)

- Lesen `83` → Byte 2 = Stufe. Schreiben `03 00 <Stufe> 00 00 00 00 <Prüfsumme in Byte 7>`.
- Stufen: 0 = 8000 Hz, 1 = 4000, 2 = 2000, 3 = 1000, 4 = 500, 5 = 250, 6 = 125.
- Beim Verbinden gelesen: `83 00 00 …` = 8000 Hz. Die TK75 (PID `0x5030`) steht in GearHubs Geräteliste mit
  `reportRate: 8000` als Höchstwert.

- Auf der Tastatur bestätigt (2026-11-27, USB): 8 kHz → 1 kHz geschrieben, nach Neuverbinden 1 kHz gelesen.
  Die Tastatur bleibt dabei verbunden (keine Neuanmeldung).

## Energiespar-Zeiten (aus dem GearHub-Treiber, `setSleepTime`/`getSleepTime`)

- Lesen `91`, Schreiben `11 00 00 00 00 00 00 <Prüfsumme Byte 7>`; ab Byte 8 vier 16-Bit-Werte (LE) in **Sekunden**:

  | Bytes | Bedeutung (GearHub, deutsch) |
  |---|---|
  | 8–9 | Bluetooth: Hintergrundbeleuchtung ausschalten |
  | 10–11 | 2,4G: Hintergrundbeleuchtung ausschalten |
  | 12–13 | Bluetooth: Tiefschlafzeit |
  | 14–15 | 2,4G: Tiefschlafzeit |

- Die erste Annahme („Standby“, Reihenfolge 2,4G/BT) war falsch und ist korrigiert.
- Grenzen laut GearHubs Geräteliste (TK75 TMR v6): Beleuchtung 1–60 min, Tiefschlaf 10–60 min
  (Standard 2 / 30 min). Ältere TK75-Einträge erlauben 0–18 h; die App nutzt die engeren Grenzen.
- Gelesen: 120 / 120 / 1680 / 1680 s = 2 / 2 / 28 / 28 min.

- Auf der Tastatur bestätigt (2026-11-27): Schreiben und Zurücklesen über USB, Bluetooth (`55 11 …`) und
  Empfänger.
- Empfänger: Direkt nach einem Moduswechsel antwortet die Tastatur langsamer als GearHubs 5 × 100 ms Wartezeit;
  die App wartet bis ca. 2,5 s.

## Tastenmatrix & Magnetschalter lesen (2026-11-27, per Kabel geprüft)

Beide Antworten sind **reine Daten ohne Befehls-Echo**; je Seite 64 Byte, Seiten werden aneinandergehängt.

- **Matrix** `8a <Profil> ff <Seite> <Fn-Ebene>`, 8 Seiten = 128 Plätze × 4 Byte.
  Normale Taste `00 00 <HID> 00`, Fn `0a 01 00 00` (Platz 65), leerer Platz `00 00 00 00`.
  Reihenfolge ist **spaltenweise**: 0 Esc, 1 ^, 2 Tab, 3 Caps, 4 Shift, 5 Strg, 6 F1, 7 1, 8 Q, 9 A, 10 ISO <, 11 Win …
  Plätze 96–98: `13 01 00/01/03` (vermutlich Drehknopf). 82 Tasten erkannt.
- **Magnet** `e5 <Art> 01 <Seite>`: u16 LE je Platz (4 Seiten) bzw. 1 Byte je Platz (Art 7 und fb, 2 Seiten).
  Art 0 Auslösepunkt, 1 Rückstellpunkt (noch nicht gelesen), 2/3 RT Drücken/Loslassen, 6 Totzone unten,
  7 Tastenmodus (Bit 7 = RT), fb Totzone oben.
- **Faktor 100 = 1 mm** (Firmware 0x0403), bestätigt: Rohwert `c8` = 200 → GearHub zeigt 2,00 mm.
- Werkszustand: Auslösepunkt 2,00 mm, RT aus, RT 0,30/0,30 mm, Totzone unten 0,30 mm, oben 0.

## Magnetschalter schreiben, einzelne Taste (2026-11-27, per Kabel geprüft)

`65 <Art> 00 <Platz> <Ende> 00 00 <Prüfsumme>` + Wert (u16 LE, bei Art 7 und fb 1 Byte). Wie GearHub
(`_sendMagnetismInfoSimpleCMD`): erst Modus (Art 7), dann die geänderten Wege; nur das letzte Paket einer Taste hat Ende = 1.

- Bestätigt an F12 (Platz 72 = `48`): Auslösepunkt (Art 0), Modusbyte RT an/aus (`80`/`00`), RT Drücken/Loslassen (Art 2/3).
- **Nach jeder Taste ≥ 100 ms warten** (GearHub `defaultVendorSleepTime` = 100). Bei 40 ms kamen von F9–F12 nur F9 und F12 an.
  Die App wartet 150 ms und liest danach zur Kontrolle nach (die Tastatur bestätigt nichts).
- Direkt nach dem Schreiben antwortet sie einige 100 ms lang nur mit dem Echo der Anfrage → 500 ms warten.
  Achtung: `83` bei 8000 Hz sieht genauso aus wie ein Echo (lauter Nullen).
- Sammelschreiben (`65 <Art> 01 <Seite> <Ende>` + 56 Byte je Seite) ist noch nicht genutzt; die App erlaubt bis 5 Tasten pro Übernehmen.

## Offen / nächste Mitschnitte

1. Auslösepunkt/RT schreiben (`65`), Rückstellpunkt (Art 1), Continuous RT.
2. Tastenbelegung schreiben (`0a`).
