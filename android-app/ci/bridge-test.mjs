// Prueft die Bruecke zwischen Webseite und App ueber das Chrome-DevTools-Protokoll der Debug-WebView.
//   node bridge-test.mjs <port> <ausgabeordner>
import { execSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';

const [, , port = '9222', out = '.'] = process.argv;
let failed = false;
const log = (s) => { console.log(s); appendFileSync(`${out}/ergebnis.txt`, s + '\n'); };
const ok = (name, cond, extra = '') => { log(`${cond ? 'OK     ' : 'FEHLER '} 7-bruecke: ${name}${extra ? ' (' + extra + ')' : ''}`); if (!cond) failed = true; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (cmd) => { try { return execSync(`adb ${cmd}`, { encoding: 'utf8' }); } catch (e) { return ''; } };
const shot = (name) => { try { writeFileSync(`${out}/${name}.png`, execSync('adb exec-out screencap -p')); } catch (e) {} };

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((p) => p.type === 'page' && p.url.includes('/wunschliste'));
if (!page) { log('FEHLER  7-bruecke: keine Wunschliste-Seite in der WebView gefunden'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const run = (expression) => new Promise((res) => {
  const i = ++id;
  pending.set(i, (m) => res(m.result && m.result.result ? m.result.result.value : undefined));
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true, userGesture: true } }));
});

ok('Bruecke geladen', (await run('typeof window.__wlApp')) === 'object');
ok('Seite weiss, dass sie in der App laeuft', (await run("document.documentElement.classList.contains('in-app')")) === true);
ok('App-Kennung im User-Agent', (await run("navigator.userAgent.includes('SkeisonWunschlisteApp/')")) === true);
ok('Teilen verfuegbar', (await run('typeof navigator.share')) === 'function');

// QR-Code speichern: genau wie saveQr() in site/wunschliste/app.js
adb('shell rm -rf /sdcard/Pictures/Wunschliste');
await run(`(() => {
  const q = qrcode(0, 'M'); q.addData('${'https://erschoenfeld2-tech.github.io/Skeison_Web/wunschliste/?teilen=test'}'); q.make();
  const box = document.createElement('div'); box.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(box.firstChild)], { type: 'image/svg+xml' }));
  a.download = 'wunschliste-qr.svg'; a.click(); return true;
})()`);
await sleep(2500);
shot('7-qr-gespeichert');
const files = adb('shell ls /sdcard/Pictures/Wunschliste/');
ok('QR-Code als PNG in Bilder › Wunschliste gespeichert', files.includes('wunschliste-qr.png'), files.trim() || 'leer');
if (files.includes('wunschliste-qr.png')) adb(`pull /sdcard/Pictures/Wunschliste/wunschliste-qr.png ${out}/7-qr-datei.png`);

// Teilen-Menue von Android
await run("navigator.share({ title: 'Meine Wunschliste', text: 'Test', url: 'https://erschoenfeld2-tech.github.io/Skeison_Web/wunschliste/' })");
await sleep(3000);
shot('7-teilen-menue');
const top = adb('shell dumpsys activity activities');
ok('Teilen-Menue von Android geoeffnet', /ChooserActivity|chooser/i.test(top));
adb('shell input keyevent KEYCODE_BACK');
await sleep(1500);

// Zurueck-Taste schliesst zuerst einen offenen Dialog
await run("(() => { const d = document.getElementById('dlg'); d.innerHTML = '<div class=\"dlg-in\"><h2>Testdialog</h2></div>'; d.showModal(); return d.open; })()");
await sleep(800);
shot('7-dialog-offen');
adb('shell input keyevent KEYCODE_BACK');
await sleep(1200);
ok('Zurueck schliesst den Dialog', (await run("document.getElementById('dlg').open")) === false);
ok('App bleibt nach Zurueck offen', adb(`shell pidof de.skeison.wunschliste`).trim() !== '');

// Designs: Statusleiste folgt der Hintergrundfarbe der Seite
await run("document.body.setAttribute('data-theme', 'geschenkpapier'); true");
await sleep(1500);
shot('7-design-geschenkpapier');
await run("document.body.removeAttribute('data-theme'); true");

ws.close();
process.exit(failed ? 1 : 0);
