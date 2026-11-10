// Holt die Valorant-Daten (Rang, Statistik, letzte Spiele) und schreibt site/valorant.json. Laeuft im GitHub-Pages-Workflow.
// Quelle: die inoffizielle Valorant-API von HenrikDev (api.henrikdev.xyz). Riot selbst gibt Spielerstatistiken nur an
// freigeschaltete Produkte heraus; diese API ist der uebliche Weg fuer private Seiten. Sie braucht einen kostenlosen
// Schluessel (HENRIK_API_KEY, Format "HDEV-…", siehe README, Abschnitt Valorant).
// Einstellungen (Umgebungsvariablen, im Workflow aus Repo-Variablen/Secrets):
//   VALORANT_RIOT_ID  Riot-ID "Name#Tag" (oder unten bei RIOT_ID eintragen)
//   VALORANT_REGION   eu (Standard), na, ap, kr, latam, br
//   HENRIK_API_KEY    Schluessel der API
// Zwischenspeicher wie bei Steam: Jeder erfolgreiche Abruf landet zusaetzlich in VALORANT_CACHE; scheitert ein Abruf,
// wird der letzte erfolgreiche Stand veroeffentlicht. Ohne Riot-ID oder Schluessel schreibt das Skript nur einen
// Platzhalter ("setup"), die Seite zeigt dann einen Hinweis statt Zahlen.
// Start: node tools/fetch-valorant.js [Ausgabedatei]
'use strict';
const fs = require('fs'), path = require('path');
const RIOT_ID = process.env.VALORANT_RIOT_ID || '';          // z. B. 'Skeison#EUW'
const REGION = (process.env.VALORANT_REGION || 'eu').toLowerCase();
const KEY = process.env.HENRIK_API_KEY || '';
const OUT = process.argv[2] || path.join(__dirname, '..', 'site', 'valorant.json');
const CACHE = process.env.VALORANT_CACHE || path.join(__dirname, '..', '.valorant-cache', 'valorant.json');
const API = 'https://api.henrikdev.xyz/valorant';
const MEDIA = 'https://media.valorant-api.com';
// Satz der Rang-Symbole (Episode 5 und neuer, mit "Ascendant")
const TIER_SET = '03621f52-342b-cf4e-4f86-9350a49c6d04';
const MATCHES = 30;

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const round = (v, d) => { const f = Math.pow(10, d || 0); return Math.round(v * f) / f; };
const uuid = (s) => (/^[0-9a-f-]{36}$/i.test(String(s || '')) ? String(s).toLowerCase() : '');

async function get(p, tries = 3) {
  for (let i = 1; ; i++) {
    const r = await fetch(API + p, { headers: { Authorization: KEY, 'user-agent': 'skeison-web-build' } });
    if (r.ok) { const j = await r.json(); return j && j.data !== undefined ? j.data : j; }
    if (i >= tries || (r.status !== 429 && r.status < 500)) throw new Error(p.split('?')[0] + ' -> ' + r.status);
    const wait = Math.min(30, Number(r.headers.get('retry-after')) || 5 * i);
    console.log('Valorant-API antwortet ' + r.status + ', neuer Versuch in ' + wait + ' s');
    await sleep(wait * 1000);
  }
}

// ---------- Antworten der API in ein einheitliches Format bringen (v3 und v2 der Rang-Abfrage) ----------
function tierIcon(id) { return id > 0 ? MEDIA + '/competitivetiers/' + TIER_SET + '/' + id + '/largeicon.png' : ''; }
function normRank(d) {
  if (!d) return null;
  // v3: { current: { tier: { id, name }, rr, last_change }, peak: { tier: { id, name }, season: { short } } }
  if (d.current) {
    const c = d.current, t = c.tier || {}, p = d.peak || {}, pt = p.tier || {};
    return { tier: num(t.id), name: t.name || 'Unranked', rr: num(c.rr), lastChange: num(c.last_change), icon: tierIcon(num(t.id)),
      peak: pt.name ? { tier: num(pt.id), name: pt.name, season: (p.season && p.season.short) || '', icon: tierIcon(num(pt.id)) } : null };
  }
  // v2: { current_data: { currenttier, currenttierpatched, ranking_in_tier, mmr_change_to_last_game }, highest_rank: { tier, patched_tier, season } }
  if (d.current_data) {
    const c = d.current_data, h = d.highest_rank || {};
    return { tier: num(c.currenttier), name: c.currenttierpatched || 'Unranked', rr: num(c.ranking_in_tier), lastChange: num(c.mmr_change_to_last_game), icon: tierIcon(num(c.currenttier)),
      peak: h.patched_tier ? { tier: num(h.tier), name: h.patched_tier, season: h.season || '', icon: tierIcon(num(h.tier)) } : null };
  }
  return null;
}
function normAccount(d) {
  if (!d) return {};
  const card = typeof d.card === 'string' ? d.card : (d.card && d.card.id) || '';
  return { name: d.name || '', tag: d.tag || '', level: d.account_level != null ? num(d.account_level) : null,
    card: uuid(card) ? { small: MEDIA + '/playercards/' + uuid(card) + '/smallart.png', wide: MEDIA + '/playercards/' + uuid(card) + '/wideart.png' } : null };
}
// Gespeicherte Spiele: [{ meta: { id, map: { name }, mode, started_at }, stats: { team, character: { id, name }, kills, deaths, assists,
//   shots: { head, body, leg }, damage: { made } }, teams: { red, blue } }]; teams.* sind gewonnene Runden
function normMatches(list) {
  const rows = (Array.isArray(list) ? list : []).map((m) => {
    const s = m.stats || {}, meta = m.meta || {}, t = m.teams || {}, ch = s.character || {}, sh = s.shots || {};
    const mine = String(s.team || '').toLowerCase(), own = num(t[mine]), other = num(mine === 'red' ? t.blue : t.red);
    return { id: meta.id || '', map: (meta.map && meta.map.name) || '', mode: meta.mode || '', date: meta.started_at || '', agent: ch.name || '', agentId: uuid(ch.id),
      k: num(s.kills), d: num(s.deaths), a: num(s.assists), head: num(sh.head), body: num(sh.body), leg: num(sh.leg), dmg: num(s.damage && s.damage.made),
      own, other, rounds: own + other, won: own > other, draw: own === other };
  }).filter((m) => m.agent && m.rounds > 0);
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return rows;
}
function build(account, rank, matches) {
  const sum = (f) => matches.reduce((n, m) => n + f(m), 0);
  const k = sum((m) => m.k), d = sum((m) => m.d), a = sum((m) => m.a), shots = sum((m) => m.head + m.body + m.leg), rounds = sum((m) => m.rounds);
  const wins = matches.filter((m) => m.won).length;
  const byAgent = {};
  matches.forEach((m) => { const x = byAgent[m.agent] = byAgent[m.agent] || { name: m.agent, id: m.agentId, games: 0, wins: 0, k: 0, d: 0 }; x.games++; if (m.won) x.wins++; x.k += m.k; x.d += m.d; });
  const agents = Object.keys(byAgent).map((n) => byAgent[n]).sort((x, y) => y.games - x.games || y.wins - x.wins).slice(0, 3).map((x) => ({
    name: x.name, games: x.games, winrate: Math.round(x.wins / x.games * 100), kd: round(x.k / Math.max(1, x.d), 2), icon: x.id ? MEDIA + '/agents/' + x.id + '/displayicon.png' : '' }));
  const riot = (account.name || RIOT_ID.split('#')[0]) + '#' + (account.tag || RIOT_ID.split('#')[1] || '');
  return {
    updated: new Date().toISOString(), riotId: riot, name: account.name || RIOT_ID.split('#')[0], tag: account.tag || RIOT_ID.split('#')[1] || '', region: REGION,
    url: 'https://tracker.gg/valorant/profile/riot/' + encodeURIComponent(riot) + '/overview', level: account.level, card: account.card || null, rank: rank,
    stats: matches.length ? { matches: matches.length, wins: wins, winrate: Math.round(wins / matches.length * 100), kd: round(k / Math.max(1, d), 2), kda: round((k + a) / Math.max(1, d), 2),
      hs: shots ? Math.round(sum((m) => m.head) / shots * 100) : null, adr: rounds ? Math.round(sum((m) => m.dmg) / rounds) : null, kills: k, deaths: d, assists: a } : null,
    agents: agents,
    recent: matches.slice(0, 5).map((m) => ({ map: m.map, agent: m.agent, k: m.k, d: m.d, a: m.a, won: m.won, draw: m.draw, score: m.own + ':' + m.other, date: m.date,
      icon: m.agentId ? MEDIA + '/agents/' + m.agentId + '/displayicon.png' : '' }))
  };
}

async function load() {
  const [name, tag] = RIOT_ID.split('#').map((s) => encodeURIComponent(s.trim()));
  const account = normAccount(await get('/v2/account/' + name + '/' + tag).catch(() => get('/v1/account/' + name + '/' + tag)));
  const rank = normRank(await get('/v3/mmr/' + REGION + '/pc/' + name + '/' + tag).catch(() => get('/v2/mmr/' + REGION + '/' + name + '/' + tag)).catch(() => null));
  const matches = normMatches(await get('/v1/stored-matches/' + REGION + '/' + name + '/' + tag + '?mode=competitive&size=' + MATCHES).catch(() => []));
  return build(account, rank, matches);
}

const hasData = (s) => !!(s && s.riotId && (s.rank || s.stats || s.level != null));
const write = (file, s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 1) + '\n'); };
const summary = (lines) => { if (process.env.GITHUB_STEP_SUMMARY) try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Valorant\n' + lines.map((l) => '- ' + l).join('\n') + '\n'); } catch (e) { /* nur Hinweis */ } };
const readCache = () => { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { return null; } };

module.exports = { normRank, normAccount, normMatches, build };
if (require.main === module) (async () => {
  if (!/^[^#]{2,}#[^#]{2,}$/.test(RIOT_ID) || !KEY) {
    const missing = [!/^[^#]{2,}#[^#]{2,}$/.test(RIOT_ID) && 'Riot-ID (Repo-Variable VALORANT_RIOT_ID, Format Name#Tag)', !KEY && 'API-Schluessel (Secret HENRIK_API_KEY)'].filter(Boolean);
    const cached = readCache();
    write(OUT, hasData(cached) ? cached : { setup: true });
    console.log('Valorant nicht eingerichtet: es fehlt ' + missing.join(' und '));
    summary(['Nicht eingerichtet: es fehlt ' + missing.join(' und '), 'Anleitung: README, Abschnitt Valorant']);
    return;
  }
  try {
    const s = await load();
    if (!hasData(s)) throw new Error('Profil gefunden, aber ohne Rang und Spiele');
    write(OUT, s); write(CACHE, s);
    console.log('valorant.json geschrieben (' + s.riotId + ')');
    summary(['Riot-ID: ' + s.riotId + ' (' + REGION + ')', 'Aktualisiert: ' + s.updated, 'Rang: ' + (s.rank ? s.rank.name + ' · ' + s.rank.rr + ' RR' : '–') + ', gewertete Spiele: ' + (s.stats ? s.stats.matches : 0)]);
  } catch (e) {
    console.log('Valorant-Daten nicht aktualisiert: ' + e.message);
    const cached = readCache();
    write(OUT, hasData(cached) ? cached : { setup: false, error: true });
    summary(['Fehler: ' + e.message, hasData(cached) ? 'Gezeigt wird der Stand vom ' + cached.updated : 'Kein frueherer Stand vorhanden',
      'Pruefen: Riot-ID richtig geschrieben? Schluessel gueltig? Region (VALORANT_REGION) passend?']);
  }
})();
