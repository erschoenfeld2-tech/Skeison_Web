// Statistiken des Tages fuer die Cobblemon-Seite: Welche Minecraft-Statistiken haben sich seit dem Vortag am staerksten
// veraendert? Laeuft im GitHub-Pages-Workflow (alle 6 Stunden) und schreibt site/cobblemon/data/daily.json.
// So geht es: Der Branch "data" enthaelt immer nur den aktuellen Stand (stats.json, ein Commit, der ersetzt wird).
// Dieses Skript legt deshalb beim ersten Lauf jedes Tages (deutsche Zeit) eine Momentaufnahme in STATS_CACHE ab
// (der Workflow hebt den Ordner zwischen den Laeufen auf) und vergleicht die heutige mit der letzten davor.
// Ergebnis: die Statistiken mit der groessten Veraenderung samt den Spielern, die am meisten beigetragen haben.
// Die Seite zeigt daraus drei (cobblemon/app.js, renderDaily) und faellt ohne Daten auf drei zufaellige zurueck.
// Start: node tools/daily-stats.js [stats.json oder URL] [Ausgabedatei]
'use strict';
const fs = require('fs'), path = require('path');
const SRC = process.argv[2] || process.env.STATS_URL || 'https://raw.githubusercontent.com/erschoenfeld2-tech/Skeison_Web/data/stats.json';
const OUT = process.argv[3] || path.join(__dirname, '..', 'site', 'cobblemon', 'data', 'daily.json');
const CACHE = process.env.STATS_CACHE || path.join(__dirname, '..', '.stats-cache');
const KEEP = 4;      // so viele Tages-Momentaufnahmen bleiben liegen
const TOP = 15;      // so viele Statistiken landen in daily.json (die Seite waehlt daraus drei aus verschiedenen Bereichen)

const berlinDay = (d) => (d || new Date()).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
// Nicht geeignet: Zaehler, die von selbst laufen oder zurueckspringen (gleiche Liste wie BORING in cobblemon/app.js)
const BORING = /(leave_game|total_world_time|time_since_|inspect_|play_time)/;
// Einheit wie in cobblemon/app.js (unitOf): Strecken in cm, Zeiten in Ticks, Schaden in Zehntel-Herzen.
// Fuer den Vergleich wird in "erlebbare" Groessen umgerechnet (Bloecke, Minuten, Herzen), sonst gewaennen immer die Strecken.
function scale(cat, key) {
  if (cat !== 'minecraft:custom') return 1;
  if (/_one_cm$/.test(key) || /^cobblemon:riding_(land|air|liquid)$/.test(key)) return 1 / 100;
  if (/(sneak_time)$/.test(key)) return 1 / 1200;
  if (/damage_/.test(key)) return 1 / 20;
  return 1;
}

// stats.json ({ players: [Namen], stats: { Kategorie: { Schluessel: [[Spielerindex, Wert], ...] } } }) kompakt je Spielername
function snapshot(d) {
  const out = {};
  for (const [cat, keys] of Object.entries((d && d.stats) || {})) {
    for (const [key, list] of Object.entries(keys || {})) {
      const by = {};
      for (const e of list || []) { const name = d.players[e[0]]; if (name != null && e[1] > 0) by[name] = (by[name] || 0) + e[1]; }
      if (Object.keys(by).length) out[cat + '|' + key] = by;
    }
  }
  return out;
}
// Veraenderung zwischen zwei Momentaufnahmen. Bewertet wird, wie stark eine Statistik gewachsen ist (im Verhaeltnis zum
// Stand davor) und ob dahinter genug passiert ist: ln((nachher + c) / (vorher + c)) * ln(1 + Zuwachs), c daempft Kleinstwerte.
function diff(prev, cur) {
  const rows = [];
  for (const [id, by] of Object.entries(cur)) {
    const i = id.indexOf('|'), cat = id.slice(0, i), key = id.slice(i + 1);
    if (BORING.test(key)) continue;
    const old = prev[id] || {}, top = [];
    let delta = 0, before = 0;
    for (const [name, v] of Object.entries(by)) { const o = old[name] || 0; before += o; if (v > o) { delta += v - o; top.push([name, v - o]); } }
    if (delta <= 0) continue;
    const s = scale(cat, key), D = delta * s, B = before * s, c = 20;
    if (D < 1) continue;
    top.sort((a, b) => b[1] - a[1]);
    rows.push({ cat, key, delta, before, after: before + delta, players: top.length, top: top.slice(0, 5), score: Math.round(Math.log((B + D + c) / (B + c)) * Math.log(1 + D) * 1000) / 1000 });
  }
  rows.sort((a, b) => b.score - a.score || b.delta - a.delta);
  return rows;
}

async function load(src) {
  if (/^https?:\/\//.test(src)) { const r = await fetch(src + '?t=' + Date.now(), { headers: { 'user-agent': 'skeison-web-build' } }); if (!r.ok) throw new Error('stats.json -> ' + r.status); return r.json(); }
  return JSON.parse(fs.readFileSync(src, 'utf8'));
}
const snapFile = (day) => path.join(CACHE, 'snap-' + day + '.json');
const days = () => { try { return fs.readdirSync(CACHE).map((f) => (f.match(/^snap-(\d{4}-\d{2}-\d{2})\.json$/) || [])[1]).filter(Boolean).sort(); } catch (e) { return []; } };
const write = (file, s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s) + '\n'); };
const summary = (lines) => { if (process.env.GITHUB_STEP_SUMMARY) try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Statistiken des Tages\n' + lines.map((l) => '- ' + l).join('\n') + '\n'); } catch (e) { /* nur Hinweis */ } };

// Ein Lauf: Momentaufnahme des Tages anlegen (falls noch keine da ist) und mit der letzten davor vergleichen
function run(stats, today) {
  fs.mkdirSync(CACHE, { recursive: true });
  if (!fs.existsSync(snapFile(today))) write(snapFile(today), { day: today, taken: new Date().toISOString(), data: snapshot(stats) });
  const all = days(), prevDay = all.filter((d) => d < today).pop();
  all.slice(0, Math.max(0, all.length - KEEP)).forEach((d) => { try { fs.unlinkSync(snapFile(d)); } catch (e) { /* egal */ } });
  if (!prevDay) return { day: today, pending: true };
  const cur = JSON.parse(fs.readFileSync(snapFile(today), 'utf8')), prev = JSON.parse(fs.readFileSync(snapFile(prevDay), 'utf8'));
  const rows = diff(prev.data, cur.data);
  return { day: today, from: prevDay, since: prev.taken, until: cur.taken, changes: rows.slice(0, TOP) };
}

module.exports = { snapshot, diff, run, scale, berlinDay };
if (require.main === module) (async () => {
  const last = path.join(CACHE, 'daily.json');
  try {
    const out = run(await load(SRC), berlinDay());
    if (out.pending || !out.changes.length) {
      // Noch kein Vortag (erster Lauf) oder nichts passiert: den letzten Vergleich weiter zeigen, falls es einen gibt
      let keep = null; try { keep = JSON.parse(fs.readFileSync(last, 'utf8')); } catch (e) { /* keiner */ }
      write(OUT, keep && keep.changes && keep.changes.length ? keep : out);
      console.log(out.pending ? 'Erste Momentaufnahme angelegt; der Vergleich erscheint ab morgen.' : 'Seit ' + out.from + ' hat sich nichts veraendert.');
      summary([out.pending ? 'Erste Momentaufnahme angelegt, Vergleich ab morgen' : 'Keine Veraenderung seit ' + out.from]);
      return;
    }
    write(OUT, out); write(last, out);
    console.log('daily.json geschrieben: ' + out.changes.length + ' Statistiken, ' + out.from + ' -> ' + out.day + ' (' + out.changes.slice(0, 3).map((c) => c.key + ' +' + c.delta).join(', ') + ')');
    summary(['Vergleich ' + out.from + ' → ' + out.day, 'Vorne: ' + out.changes.slice(0, 3).map((c) => c.key + ' +' + c.delta).join(', ')]);
  } catch (e) {
    let keep = null; try { keep = JSON.parse(fs.readFileSync(last, 'utf8')); } catch (x) { /* keiner */ }
    write(OUT, keep || { pending: true });
    console.log('Statistiken des Tages nicht aktualisiert: ' + e.message);
    summary(['Fehler: ' + e.message]);
  }
})();
