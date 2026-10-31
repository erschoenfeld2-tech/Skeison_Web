// Laeuft auf dem Server-PC (mit dem Node aus dem MCSManager-Daemon). Spiegelt die vom Collector
// erzeugten Daten regelmaessig in den Branch "data" des GitHub-Repos. Keine Zugangsdaten im Skript:
// git nutzt die Anmeldung des Windows-Anmeldeinformationsmanagers (einmalig `git push` bzw. `gh auth login`).
// Zusaetzlich exportiert es alle Minecraft-Statistiken der Welt (world/stats/*.json) als stats.json fuer
// die Statistik-Suche auf der Webseite. Die Welt wird unter MC_ROOT gesucht; fester Pfad per MC_STATS_DIR.
// Ausserdem berechnet es die Rangliste "Collector" (verschiedene GEFANGENE Pokemon, aus den Pokedex-Dateien der Spieler, siehe
// pokedex.js) und fuegt sie in leaderboards.json/history.json ein. Der Wochenstand dafuer liegt in github-sync/collector-state.json.
// Und es holt die Skins der Spieler von Mojang (skins.js) und legt sie als skins/<name>.png in den Branch, damit die Webseite die Koepfe zeigen kann.
// Start: node sync-github.js   (am besten in start-services.bat aufnehmen)
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const pokedex = require('./pokedex.js'), skins = require('./skins.js');

const ROOT = process.env.MC_ROOT || 'C:\\MinecraftHosting';
const REPO_URL = process.env.SYNC_REPO || 'https://github.com/erschoenfeld2-tech/Skeison_Web.git';
const BRANCH = 'data';
const WORK = path.join(ROOT, 'github-sync', 'repo');
const FILES = [ // [Quelle, Ziel im Branch]
  [path.join(ROOT, 'web', 'data', 'leaderboards.json'), 'leaderboards.json'],
  [path.join(ROOT, 'web', 'data', 'history.json'), 'history.json'],
  [path.join(ROOT, 'web', 'announcements.json'), 'announcements.json'],
  [path.join(ROOT, 'web', 'data', 'stats.json'), 'stats.json'],   // von exportStats() erzeugt
];
const STATE_FILE = path.join(ROOT, 'github-sync', 'collector-state.json');
const SKIN_STATE = path.join(ROOT, 'github-sync', 'skins-state.json');
const SKIN_DIR = path.join(WORK, 'skins');
const FIRST_WEEK = pokedex.mondayOf(process.env.SERVER_START || '2026-10-30T15:00:00+01:00'); // Montag der Woche des Serverstarts
const INTERVAL_MS = 2 * 60 * 1000;   // Pruefintervall
const MAX_AGE_MS = 30 * 60 * 1000;   // auch ohne Aenderung spaetestens alle 30 min (Zeitstempel/Status frisch halten)

const git = (...a) => cp.execFileSync('git', a, { cwd: WORK, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const log = (m) => console.log(new Date().toISOString() + ' ' + m);

function normalized(file) { // Zeitstempel ignorieren, damit nur echte Aenderungen zaehlen
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && !Array.isArray(j)) delete j.updated;
    return JSON.stringify(j);
  } catch (e) { return null; }
}

function init() {
  fs.mkdirSync(WORK, { recursive: true });
  if (!fs.existsSync(path.join(WORK, '.git'))) {
    git('init', '-q');
    git('checkout', '-q', '--orphan', BRANCH);
    git('remote', 'add', 'origin', REPO_URL);
  }
  git('config', 'user.name', 'Server Sync');
  git('config', 'user.email', 'sync@localhost');
}

/* ---------- Export aller Minecraft-Statistiken ---------- */
// Ordner, die beim Suchen der Welt uebersprungen werden (gross und ohne Welt darin)
const SKIP = new Set(['node_modules', '.git', 'github-sync', 'mods', 'config', 'libraries', 'logs', 'crash-reports', 'region', 'entities', 'poi',
  'playerdata', 'advancements', 'datapacks', 'DIM-1', 'DIM1', 'resourcepacks', 'shaderpacks', 'versions', 'cache', 'web']);
let statsDir = process.env.MC_STATS_DIR || '', statsFoundAt = 0, statsWarned = false, exportedPlayers = []; // exportedPlayers: [{ name, uuid }]

// Sucht Welt-Ordner (level.dat + stats/) und nimmt den mit den zuletzt geaenderten Statistiken
function findStatsDir() {
  let best = null, bestTime = 0;
  (function walk(dir, depth) {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    if (entries.some(e => e.isFile() && e.name === 'level.dat') && entries.some(e => e.isDirectory() && e.name === 'stats')) {
      const sd = path.join(dir, 'stats');
      let t = 0; try { for (const f of fs.readdirSync(sd)) if (f.endsWith('.json')) t = Math.max(t, fs.statSync(path.join(sd, f)).mtimeMs); } catch (e) {}
      if (t > bestTime) { best = sd; bestTime = t; }
      return;
    }
    if (depth <= 0) return;
    for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth - 1);
  })(ROOT, 9);
  return best;
}

// Spielernamen zu UUIDs aus usercache.json/whitelist.json des Servers
function playerNames(serverDir) {
  const names = {};
  for (const f of ['whitelist.json', 'usercache.json']) {
    try { for (const p of JSON.parse(fs.readFileSync(path.join(serverDir, f), 'utf8'))) if (p.uuid && p.name) names[p.uuid.toLowerCase()] = p.name; } catch (e) {}
  }
  return names;
}

// Liest alle stats/<uuid>.json und schreibt pro Statistik eine sortierte Rangliste:
// { players: [Namen], stats: { "minecraft:mined": { "minecraft:stone": [[Spielerindex, Wert], ...] } } }
function exportStats(out) {
  if (!process.env.MC_STATS_DIR && (!statsDir || Date.now() - statsFoundAt > 3600000)) { statsDir = findStatsDir() || ''; statsFoundAt = Date.now(); }
  if (!statsDir) { if (!statsWarned) { log('Keine Welt mit stats-Ordner unter ' + ROOT + ' gefunden (MC_STATS_DIR setzen).'); statsWarned = true; } return; }
  const names = playerNames(path.dirname(path.dirname(statsDir))), players = [], stats = {}, roster = [];
  for (const f of fs.readdirSync(statsDir)) {
    if (!f.endsWith('.json')) continue;
    let j; try { j = JSON.parse(fs.readFileSync(path.join(statsDir, f), 'utf8')); } catch (e) { continue; }
    const uuid = f.slice(0, -5).toLowerCase(), idx = players.push(names[uuid] || uuid.slice(0, 8)) - 1;
    if (names[uuid]) roster.push({ name: names[uuid], uuid });
    for (const [cat, vals] of Object.entries(j.stats || {})) {
      const c = stats[cat] || (stats[cat] = {});
      for (const [key, v] of Object.entries(vals)) if (typeof v === 'number' && v > 0) (c[key] || (c[key] = [])).push([idx, v]);
    }
  }
  for (const c of Object.values(stats)) for (const list of Object.values(c)) list.sort((a, b) => b[1] - a[1]);
  exportedPlayers = roster;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ updated: new Date().toISOString(), players, stats }));
}

/* ---------- Collector: verschiedene gefangene Pokemon ---------- */
let collectorWarned = false, collectorLogged = false, collectorState = null;
function readCollector() {
  if (!statsDir) return null;
  const world = path.dirname(statsDir), dex = pokedex.readDex(world);
  if (!dex.size) {
    if (!collectorWarned) { log('Collector: keine Pokedex-Dateien unter ' + path.join(world, 'pokedex') + ' bzw. cobblemonplayerdata gefunden - Rangliste "Collector" wird nicht berechnet.'); collectorWarned = true; }
    return null;
  }
  if (!collectorLogged) { // Kontrolle fuer den Betreiber: "gesehen+gefangen" sollte zur Rangliste "Pokedex Collector" passen
    const names = playerNames(path.dirname(world));
    const top = [...dex].sort((a, b) => b[1].seen.size - a[1].seen.size).slice(0, 3).map(([u, d]) => (names[u] || u.slice(0, 8)) + ': ' + d.caught.size + ' gefangen / ' + d.seen.size + ' gesehen+gefangen');
    log('Collector: Pokedex von ' + dex.size + ' Spielern gelesen (' + top.join('; ') + ').'); collectorLogged = true;
  }
  return dex;
}
function applyCollector(dex) {
  if (!collectorState) { try { collectorState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { collectorState = {}; } }
  const names = playerNames(path.dirname(path.dirname(statsDir)));
  const lbFile = path.join(WORK, 'leaderboards.json'), hFile = path.join(WORK, 'history.json');
  const lb = JSON.parse(fs.readFileSync(lbFile, 'utf8')); let hist = []; try { hist = JSON.parse(fs.readFileSync(hFile, 'utf8')); } catch (e) {}
  const before = JSON.stringify(collectorState);
  pokedex.augment({ lb, hist, dex, names, state: collectorState, firstWeek: FIRST_WEEK });
  fs.writeFileSync(lbFile, JSON.stringify(lb)); fs.writeFileSync(hFile, JSON.stringify(hist));
  if (JSON.stringify(collectorState) !== before) { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(collectorState)); }
}

let last = '', lastPush = 0, hasCommit = false;
function cycle() {
  try { exportStats(FILES[FILES.length - 1][0]); } catch (e) { log('Statistik-Export fehlgeschlagen: ' + e.message); }
  let dex = null; try { dex = readCollector(); } catch (e) { log('Collector-Daten nicht lesbar: ' + e.message); }
  const dexSig = dex ? JSON.stringify([...dex].map(([u, d]) => [u, d.caught.size])) : ''; // neue Faenge sollen sofort hochgeladen werden
  let skinSig = ''; try { skinSig = fs.readdirSync(SKIN_DIR).map((f) => f + fs.statSync(path.join(SKIN_DIR, f)).size).join(','); } catch (e) {} // neue Skins sofort hochladen
  const snap = FILES.map(([src]) => normalized(src)).join('|') + '|' + dexSig + '|' + skinSig;
  if (snap === last && Date.now() - lastPush < MAX_AGE_MS) return;
  for (const [src, dst] of FILES) if (fs.existsSync(src)) fs.copyFileSync(src, path.join(WORK, dst));
  if (dex && fs.existsSync(path.join(WORK, 'leaderboards.json'))) { try { applyCollector(dex); } catch (e) { log('Collector-Rangliste fehlgeschlagen: ' + e.message); } }
  git('add', '-A');
  if (!hasCommit) {
    try { git('rev-parse', 'HEAD'); hasCommit = true; } catch (e) { /* noch kein Commit */ }
  }
  // Ein einziger Commit, der immer ersetzt wird -> Repo waechst nicht mit jedem Sync.
  if (hasCommit) git('commit', '-q', '--amend', '--allow-empty', '-m', 'Daten ' + new Date().toISOString());
  else { git('commit', '-q', '-m', 'Daten ' + new Date().toISOString()); hasCommit = true; }
  git('push', '-q', '--force', 'origin', BRANCH);
  last = snap; lastPush = Date.now();
  log('Daten nach GitHub synchronisiert.');
}

module.exports = { exportStats, findStatsDir, readCollector, applyCollector, getPlayers: () => exportedPlayers };
if (require.main === module) {
  init();
  const run = () => { try { cycle(); } catch (e) { log('Fehler: ' + (e.stderr ? e.stderr.toString() : e.message)); } };
  run(); setInterval(run, INTERVAL_MS);
  // Skins im Hintergrund holen: erster Lauf kurz nach dem Start (wenn die Spielerliste steht), danach alle 30 Minuten
  const skinRun = () => skins.syncSkins(exportedPlayers, SKIN_DIR, { stateFile: SKIN_STATE, log }).catch((e) => log('Skins: ' + e.message));
  setTimeout(skinRun, 20000); setInterval(skinRun, 30 * 60 * 1000);
}
