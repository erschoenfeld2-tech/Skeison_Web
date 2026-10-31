// Liest die Pokedex-Dateien der Spieler (Cobblemon) und berechnet die Rangliste "Collector":
// die Anzahl VERSCHIEDENER gefangener Pokemon-Arten (gesehene zaehlen nicht; die bisherige Rangliste heisst jetzt "Pokedex Collector").
// Wird vom Sync-Skript (sync-github.js) benutzt und in leaderboards.json / history.json eingefuegt.
// Dateiformat (Cobblemon): <welt>/pokedex/<xx>/<uuid>.json bzw. <welt>/cobblemonplayerdata/<xx>/<uuid>.json mit
//   speciesRecords -> "<art>" -> formRecords -> "<form>" -> knowledge: "ENCOUNTERED" | "CAUGHT"
// Die Suche nach speciesRecords ist bewusst tolerant (beliebige Tiefe), falls sich der Aufbau zwischen Versionen leicht aendert.
'use strict';
const fs = require('fs'), path = require('path');

const UUID_FILE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\.json$/i;
const DIRS = ['pokedex', 'cobblemonplayerdata'];

function dashed(f) { return f.slice(0, -5).replace(/-/g, '').toLowerCase().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'); }

function listJson(dir, depth, out) {
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0) listJson(p, depth - 1, out);
    else if (e.isFile() && UUID_FILE.test(e.name)) out.push(p);
  }
  return out;
}

// speciesRecords irgendwo im JSON finden
function findRecords(o, depth) {
  if (!o || typeof o !== 'object' || depth < 0) return null;
  if (o.speciesRecords && typeof o.speciesRecords === 'object') return o.speciesRecords;
  for (const v of Object.values(o)) { const r = findRecords(v, depth - 1); if (r) return r; }
  return null;
}

// Hoechster Wissensstand einer Art ueber alle Formen: 2 = gefangen, 1 = gesehen, 0 = nichts
function knowledge(rec) {
  let best = 0;
  (function walk(o, d) {
    if (!o || typeof o !== 'object' || d > 5) return;
    if (typeof o.knowledge === 'string') { const k = o.knowledge.toUpperCase(); best = Math.max(best, k === 'CAUGHT' ? 2 : k === 'ENCOUNTERED' ? 1 : 0); }
    for (const v of Object.values(o)) walk(v, d + 1);
  })(rec, 0);
  return best;
}

// Map uuid -> { caught: Set(Arten), seen: Set(Arten, auch gefangene) }; gleiche Datei in beiden Ordnern: hoechster Stand gewinnt
function readDex(world) {
  const dex = new Map();
  for (const dir of DIRS) {
    for (const file of listJson(path.join(world, dir), 3, [])) {
      let j; try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { continue; }
      const recs = findRecords(j, 4); if (!recs) continue;
      const uuid = dashed(path.basename(file)), d = dex.get(uuid) || { caught: new Set(), seen: new Set() };
      for (const [species, rec] of Object.entries(recs)) {
        const k = knowledge(rec);
        if (k >= 1) d.seen.add(species);
        if (k >= 2) d.caught.add(species);
      }
      dex.set(uuid, d);
    }
  }
  return dex;
}

const byValue = (a, b) => b.value - a.value || a.name.localeCompare(b.name);

// Fuegt die Rangliste "caught" (Titel "Collector") in leaderboards (lb) ein und die Wochensieger in history (hist).
// Woche = Neue Arten seit Wochenbeginn: beim ersten Lauf einer neuen Woche wird der Stand als Ausgangspunkt gemerkt (state.base).
// In der Woche des Serverstarts (firstWeek) ist der Ausgangspunkt leer, die Wochenwerte sind dort gleich den Gesamtwerten.
function augment({ lb, hist, dex, names, state, firstWeek }) {
  const ws = lb.weekStart;
  if (ws && state.week !== ws) {
    if (state.week && Array.isArray(state.last)) (state.winners = state.winners || {})[state.week] = state.last.slice(0, 3);
    state.week = ws; state.base = {};
    if (ws > firstWeek) for (const [u, d] of dex) state.base[u] = [...d.caught];
  }
  const total = [], week = [], base = state.base || {};
  for (const [u, d] of dex) {
    if (!d.caught.size) continue;
    const name = names[u] || u.slice(0, 8), seen = new Set(base[u] || []);
    total.push({ name, value: d.caught.size });
    let n = 0; for (const sp of d.caught) if (!seen.has(sp)) n++;
    if (n) week.push({ name, value: n });
  }
  total.sort(byValue); week.sort(byValue); state.last = week;
  const board = { id: 'caught', title: 'Collector', desc: 'Die meisten verschiedenen gefangenen Pokémon', icon: '🎒', unit: 'Arten', week, total };
  const own = lb.boards.findIndex(b => b.id === 'caught');
  if (own >= 0) lb.boards[own] = board;
  else { const at = lb.boards.findIndex(b => b.id === 'collector'); lb.boards.splice(at < 0 ? lb.boards.length : at, 0, board); }
  for (const [w, top] of Object.entries(state.winners || {})) {
    const h = hist.find(e => e.weekStart === w);
    if (h) { h.winners = h.winners || {}; h.winners.caught = top; }
  }
  return { lb, hist, state };
}

// Montag der Woche (YYYY-MM-DD, deutsche Zeit) zu einem Zeitpunkt
function mondayOf(isoTime) {
  const day = new Date(isoTime).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' }), d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}

module.exports = { readDex, augment, mondayOf, knowledge, findRecords };
