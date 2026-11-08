#!/usr/bin/env bash
# Test der App im Emulator (GitHub Actions). Ergebnis: ergebnis.txt, Bildschirmfotos (*.png), logcat.txt
#   bash smoke-test.sh <release.apk> <debug.apk> <ausgabeordner>
set -u
APK="$1"; DEBUG_APK="$2"; OUT="$3"
PKG=de.skeison.wunschliste
BASE=https://erschoenfeld2-tech.github.io/Skeison_Web/wunschliste/
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"; : > "$OUT/ergebnis.txt"
FAIL=0

log()  { echo "$*" | tee -a "$OUT/ergebnis.txt"; }
shot() { adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null; }
dump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > "$OUT/$1.xml" 2>/dev/null; }
# wait_for <name> <text> <sekunden>: wartet, bis der Text auf dem Bildschirm steht (auch Text in der WebView)
wait_for() {
  local end=$((SECONDS + $3))
  while [ $SECONDS -lt $end ]; do
    dump "$1"
    if grep -q "$2" "$OUT/$1.xml"; then log "OK      $1: \"$2\" sichtbar"; shot "$1"; return 0; fi
    sleep 1
  done
  log "FEHLER  $1: \"$2\" nicht gefunden"; shot "$1"; FAIL=1; return 1
}
alive() {
  if adb shell pidof $PKG >/dev/null 2>&1; then log "OK      $1: App laeuft"; else log "FEHLER  $1: App laeuft nicht mehr"; FAIL=1; fi
}
net() { adb shell svc wifi "$1"; adb shell svc data "$1"; }

adb shell settings put global package_verifier_enable 0 >/dev/null 2>&1
adb install -r "$APK" >/dev/null || { log "FEHLER  Installation"; exit 1; }
log "OK      Installation ($(stat -c %s "$APK") Bytes)"
adb logcat -c

# 1. Start: Startseite der Wunschliste
adb shell am start -W -n $PKG/.MainActivity >/dev/null
wait_for 1-start "Konto erstellen" 90
alive 1-start

# 2. Link aus einer Nachricht (geteilte Liste) oeffnet in der App
adb shell am start -W -a android.intent.action.VIEW -d "${BASE}?teilen=00000000000000000000000000000000" -p $PKG >/dev/null
wait_for 2-link "nicht mehr g" 45
alive 2-link

# 3. Zurueck-Taste fuehrt zur vorherigen Seite statt die App zu schliessen
adb shell input keyevent KEYCODE_BACK
wait_for 3-zurueck "Konto erstellen" 30
alive 3-zurueck

# 4. Ziehen zum Aktualisieren
adb shell input swipe 540 700 540 1700 350
sleep 2; shot 4-aktualisieren-zieht
wait_for 4-aktualisiert "Konto erstellen" 45
alive 4-aktualisiert

# 5. Dunkelmodus des Handys
adb shell cmd uimode night yes
sleep 6; shot 5-dunkel-umgeschaltet
alive 5-dunkel-umgeschaltet
adb shell am force-stop $PKG
adb shell am start -W -n $PKG/.MainActivity >/dev/null
wait_for 5-dunkel-start "Konto erstellen" 60
alive 5-dunkel-start
adb shell cmd uimode night no
sleep 4

# 6. Ohne Internet: Hinweis, danach von selbst weiter
adb shell am force-stop $PKG
adb shell pm clear $PKG >/dev/null   # leerer Zwischenspeicher, sonst zeigt die WebView die zuletzt geladene Seite
net disable; sleep 3
adb shell am start -W -n $PKG/.MainActivity >/dev/null
wait_for 6-offline "Keine Verbindung" 40
net enable
wait_for 6-wieder-online "Konto erstellen" 90
alive 6-wieder-online

adb logcat -d > "$OUT/logcat-release.txt" 2>/dev/null
if grep -q "FATAL EXCEPTION" "$OUT/logcat-release.txt"; then log "FEHLER  Absturz im Protokoll (logcat-release.txt)"; FAIL=1; fi

# 7. Bruecke zur Webseite (Teilen, QR speichern, Zurueck schliesst Dialoge) mit der Debug-Version,
#    die sich per Chrome-DevTools-Protokoll fernsteuern laesst
adb uninstall $PKG >/dev/null 2>&1
adb install -r "$DEBUG_APK" >/dev/null || { log "FEHLER  Installation Debug-Version"; FAIL=1; }
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity >/dev/null
wait_for 7-debug-start "Konto erstellen" 90
sleep 3
APP_PID=$(adb shell pidof $PKG | tr -d '\r')
SOCK=$(adb shell cat /proc/net/unix | grep -o "webview_devtools_remote_${APP_PID}\b" | head -1)
if [ -z "$SOCK" ]; then
  log "FEHLER  7: DevTools-Socket der WebView nicht gefunden"; FAIL=1
else
  adb forward tcp:9222 localabstract:$SOCK >/dev/null
  node "$HERE/bridge-test.mjs" 9222 "$OUT" || FAIL=1
fi
adb logcat -d > "$OUT/logcat-debug.txt" 2>/dev/null
if grep -q "FATAL EXCEPTION" "$OUT/logcat-debug.txt"; then log "FEHLER  Absturz im Protokoll (logcat-debug.txt)"; FAIL=1; fi

rm -f "$OUT"/*.xml
if [ $FAIL -eq 0 ]; then log "ERGEBNIS: alle Tests bestanden"; else log "ERGEBNIS: mindestens ein Test fehlgeschlagen"; fi
exit $FAIL
