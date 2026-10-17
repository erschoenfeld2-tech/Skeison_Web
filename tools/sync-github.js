// Laeuft auf dem Server-PC (mit dem Node aus dem MCSManager-Daemon). Spiegelt die vom Collector
// erzeugten Daten regelmaessig in den Branch "data" des GitHub-Repos. Keine Zugangsdaten im Skript:
// git nutzt die Anmeldung des Windows-Anmeldeinformationsmanagers (einmalig `git push` bzw. `gh auth login`).
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

let last = '', lastPush = 0, hasCommit = false;
function cycle() {
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

init();
const run = () => { try { cycle(); } catch (e) { log('Fehler: ' + (e.stderr ? e.stderr.toString() : e.message)); } };
run(); setInterval(run, INTERVAL_MS);
