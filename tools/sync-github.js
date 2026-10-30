// Laeuft auf dem Server-PC (mit dem Node aus dem MCSManager-Daemon). Spiegelt die vom Collector
// erzeugten Daten regelmaessig in den Branch "data" des GitHub-Repos. Keine Zugangsdaten im Skript:
// git nutzt die Anmeldung des Windows-Anmeldeinformationsmanagers (einmalig `git push` bzw. `gh auth login`).
// Zusaetzlich exportiert es alle Minecraft-Statistiken der Welt (world/stats/*.json) als stats.json fuer
// die Statistik-Suche auf der Webseite. Die Welt wird unter MC_ROOT gesucht; fester Pfad per MC_STATS_DIR.
// Start: node sync-github.js   (am besten in start-services.bat aufnehmen)
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');

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
let statsDir = process.env.MC_STATS_DIR || '', statsFoundAt = 0, statsWarned = false;

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
  const names = playerNames(path.dirname(path.dirname(statsDir))), players = [], stats = {};
  for (const f of fs.readdirSync(statsDir)) {
    if (!f.endsWith('.json')) continue;
    let j; try { j = JSON.parse(fs.readFileSync(path.join(statsDir, f), 'utf8')); } catch (e) { continue; }
    const uuid = f.slice(0, -5).toLowerCase(), idx = players.push(names[uuid] || uuid.slice(0, 8)) - 1;
    for (const [cat, vals] of Object.entries(j.stats || {})) {
      const c = stats[cat] || (stats[cat] = {});
      for (const [key, v] of Object.entries(vals)) if (typeof v === 'number' && v > 0) (c[key] || (c[key] = [])).push([idx, v]);
    }
  }
  for (const c of Object.values(stats)) for (const list of Object.values(c)) list.sort((a, b) => b[1] - a[1]);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ updated: new Date().toISOString(), players, stats }));
}

let last = '', lastPush = 0, hasCommit = false;
function cycle() {
  try { exportStats(FILES[FILES.length - 1][0]); } catch (e) { log('Statistik-Export fehlgeschlagen: ' + e.message); }
  const snap = FILES.map(([src]) => normalized(src)).join('|');
  if (snap === last && Date.now() - lastPush < MAX_AGE_MS) return;
  for (const [src, dst] of FILES) if (fs.existsSync(src)) fs.copyFileSync(src, path.join(WORK, dst));
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

module.exports = { exportStats, findStatsDir };
if (require.main === module) {
  init();
  const run = () => { try { cycle(); } catch (e) { log('Fehler: ' + (e.stderr ? e.stderr.toString() : e.message)); } };
  run(); setInterval(run, INTERVAL_MS);
}
