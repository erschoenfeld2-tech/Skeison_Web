# Wunschliste-App (Android)

Die App zeigt die **echte Wunschliste-Webseite** (`site/wunschliste/` auf GitHub Pages) und ergänzt, was ein Handy braucht.
Dadurch gilt jede Änderung an der Webseite sofort auch in der App, ohne neue App-Version. Konto, Listen und Reservierungen
sind dieselben wie im Browser (Supabase).

## Was die App zusätzlich kann

| Funktion | Wie |
| --- | --- |
| Teilen über WhatsApp & Co. | `navigator.share` der Seite öffnet das Teilen-Menü von Android |
| QR-Code speichern | Downloads der Seite (`<a download>` mit `blob:`) landen als PNG in *Bilder › Wunschliste* |
| Kopieren | `navigator.clipboard.writeText` schreibt in die Zwischenablage von Android |
| Zurück-Taste | schließt zuerst offene Dialoge und das Menü, dann eine Seite zurück |
| Ziehen zum Aktualisieren | ganz oben auf der Seite nach unten ziehen |
| Immer aktuell | nach 1 Minute im Hintergrund werden die Daten neu geladen, nach 30 Minuten die ganze Seite |
| Links in der App | `https://erschoenfeld2-tech.github.io/Skeison_Web/wunschliste…` (geteilte Listen, Einladungen) öffnen in der App |
| Externe Links | Shops, Discord usw. öffnen im Browser bzw. in der passenden App |
| Hell/dunkel, Designs | folgt dem Handy; Status- und Navigationsleiste nehmen die Hintergrundfarbe der Liste an |
| Ohne Internet | eigener Hinweis, lädt von selbst weiter, sobald das Netz wieder da ist |
| Update in der App | prüft alle 6 Stunden das Release `app-latest`; ein Tipp auf „Jetzt aktualisieren“ lädt die neue Version in der App (mit Fortschritt) und übergibt sie dem Installer von Android. Kein Browser, keine Datei suchen ([`Updater.java`](app/src/main/java/de/skeison/wunschliste/Updater.java)) |
| Automatische Updates | auch bei geschlossener App: [`UpdateWorker`](app/src/main/java/de/skeison/wunschliste/UpdateWorker.java) sieht alle 6 Stunden und 2 Minuten nach dem Schließen der App nach (nur mit Internet, höchstens alle 30 Minuten), lädt eine neue Version und installiert sie. Muss Android nachfragen, erscheint die Benachrichtigung „Update für die Wunschliste bereit“ (Kanal „App-Updates“) |

Die Ergänzungen stecken in [`bridge.js`](app/src/main/assets/bridge.js) (wird in die Seite eingespielt) und
[`MainActivity.java`](app/src/main/java/de/skeison/wunschliste/MainActivity.java). Die Webseite merkt die App an der Klasse
`in-app` auf `<html>` und an `SkeisonWunschlisteApp/<version>` im User-Agent; Elemente mit `web-only` (z. B. „📱 Als App“) blendet sie dort aus.

## Updates: was Nutzer sehen

Die allermeisten Änderungen betreffen nur die Webseite und brauchen **gar kein** App-Update. Nur wenn sich die App selbst ändert:

1. **Automatisch im Hintergrund:** Spätestens 6 Stunden nach dem Erscheinen (oder 2 Minuten nachdem jemand die App geschlossen hat) lädt die App die neue Version selbst. Ab Android 12 wird sie danach **ohne Rückfrage** installiert, sobald die App sich einmal selbst aktualisiert hat; niemand muss etwas tun, auch keine Meldung danach. So kommen neue Benachrichtigungen (z. B. „Angebote“) früh auf die Handys.
2. **Beim ersten Update** (und auf Android 8 bis 11 bei jedem) muss Android einmal fragen: Bei geschlossener App erscheint die Benachrichtigung „Update für die Wunschliste bereit“, ein Tipp öffnet die Rückfrage „Aktualisieren?“. Beim allerersten Mal kommt dazu der Schalter „Dieser Quelle vertrauen“.
3. **Mit offener App:** Die App meldet „Update für die Wunschliste“ mit dem Knopf **Jetzt aktualisieren** und lädt die neue Version mit Fortschrittsbalken. Danach öffnet die Meldung „Wunschliste ist aktualisiert“ sie wieder.

Grenzen: Die Sicherheitsprüfung von Android (Play Protect) lässt sich von einer App nicht abschalten und soll das auch nicht. Sie meldet sich bei gleichbleibendem Signaturschlüssel und Updates aus der App heraus in der Regel nicht mehr. Ganz ohne solche Hinweise ginge es nur über den Play Store. Wer noch eine App-Version **vor** dem Update in der App hat, bekommt dieses eine Mal noch den alten Weg (Download im Browser).

## Bauen und Veröffentlichen

Der Workflow [`.github/workflows/android-app.yml`](../.github/workflows/android-app.yml) läuft bei jeder Änderung in `android-app/`:

1. baut die APK,
2. testet sie im Android-Emulator (Start, geteilter Link, Zurück, Aktualisieren, Dunkelmodus, ohne Internet, Teilen, QR speichern, Dialog schließen),
3. veröffentlicht sie
   - auf `main` als Release **`app-latest`** → Download: `https://github.com/erschoenfeld2-tech/Skeison_Web/releases/download/app-latest/Wunschliste.apk`
     (verlinkt auf [`wunschliste/app.html`](../site/wunschliste/app.html)),
   - auf anderen Branches als Vorabversion **`app-test`** mit Bildschirmfotos und Testprotokoll.

Änderungen nur an der Webseite (`site/`) brauchen **keinen** neuen App-Build.

### Signaturschlüssel (einmalig)

Android installiert ein Update nur, wenn es mit demselben Schlüssel signiert ist. Der Schlüssel liegt deshalb als
Repository-Secret (*Settings › Secrets and variables › Actions*):

| Secret | Inhalt |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Schlüsseldatei (`.jks`) als Base64 |
| `ANDROID_KEYSTORE_PASSWORD` | Passwort der Schlüsseldatei (Alias `wunschliste`) |

Ohne diese Secrets baut und testet der Workflow trotzdem, veröffentlicht auf `main` aber nichts.
**Die Schlüsseldatei gut aufheben:** Geht sie verloren, müssen alle die App einmal deinstallieren und neu installieren.

### Lokal bauen

Android Studio: Ordner `android-app/` öffnen und *Run* drücken. Oder mit installiertem Gradle 8.11 und Android SDK:
`gradle -p android-app assembleDebug`.

## iPhone

Für iOS gibt es keine APK. Die Wunschliste lässt sich in Safari über *Teilen › Zum Home-Bildschirm* als Web-App installieren
(`manifest.webmanifest`, Symbole in `site/wunschliste/icons/`). Anleitung für alle Geräte: `wunschliste/app.html`.
