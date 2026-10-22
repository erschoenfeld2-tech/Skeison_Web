// Holt die oeffentlichen Steam-Profildaten und schreibt site/steam.json. Laeuft im GitHub-Pages-Workflow.
// Quellen: 1. Steam Web API, wenn STEAM_API_KEY gesetzt ist (zuverlaessig, Limit pro Schluessel)
//          2. sonst die XML-Ansicht der Community-Seite (ohne Schluessel; blockt Server von GitHub oft mit 429)
// Zwischenspeicher: Jeder erfolgreiche Abruf wird zusaetzlich nach STEAM_CACHE geschrieben (vom Workflow
// zwischen den Laeufen aufbewahrt). Scheitert ein Abruf, wird der letzte erfolgreiche Stand veroeffentlicht.
// Start: node tools/fetch-steam.js [Ausgabedatei]
'use strict';
const fs = require('fs'), path = require('path');
const ID = process.env.STEAM_ID || '76561199246929908';
const KEY = process.env.STEAM_API_KEY || '';
const OUT = process.argv[2] || path.join(__dirname, '..', 'site', 'steam.json');
const CACHE = process.env.STEAM_CACHE || path.join(__dirname, '..', '.steam-cache', 'steam.json');
const BASE = 'https://steamcommunity.com/profiles/' + ID;

const tag = (x, t) => { const m = x.match(new RegExp('<' + t + '>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</' + t + '>')); return m ? m[1].trim() : ''; };
const blocks = (x, t) => x.match(new RegExp('<' + t + '>[\\s\\S]*?</' + t + '>', 'g')) || [];
const num = (s) => parseFloat(String(s).replace(/,/g, '')) || 0;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const store = (id) => 'https://store.steampowered.com/app/' + id;
const header = (id) => 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + id + '/header.jpg';

// Abruf mit Wiederholung bei 429/5xx (wartet laut Retry-After, hoechstens 30 s)
async function get(u, tries = 3) {
  for (let i = 1; ; i++) {
    const r = await fetch(u, { headers: { 'user-agent': 'skeison-web-build' } });
    if (r.ok) return r.text();
    if (i >= tries || (r.status !== 429 && r.status < 500)) throw new Error(u.replace(/key=[^&]+/, 'key=***') + ' -> ' + r.status);
    const wait = Math.min(30, Number(r.headers.get('retry-after')) || 5 * i);
    console.log('Steam antwortet ' + r.status + ', neuer Versuch in ' + wait + ' s');
    await sleep(wait * 1000);
  }
}

// Gemeinsames Ausgabeformat fuer beide Quellen (Stunden statt Minuten)
function build(base, games, extra) {
  const card = (g) => ({ name: g.name, url: store(g.id), image: header(g.id), hours: g.hours, recent: g.recent });
  return Object.assign({ updated: new Date().toISOString(), steamId: ID, url: BASE + '/' }, base, extra, {
    recent: games.filter(g => g.recent > 0).sort((a, b) => b.recent - a.recent).slice(0, 4).map(card),
    top: games.filter(g => g.hours > 0).sort((a, b) => b.hours - a.hours).slice(0, 6).map(card)
  });
}

function parse(profileXml, gamesXml) {
  const base = { name: tag(profileXml, 'steamID'), avatar: tag(profileXml, 'avatarFull') }, extra = {};
  let games = blocks(gamesXml, 'game').map(g => ({ id: tag(g, 'appID'), name: tag(g, 'name'), hours: num(tag(g, 'hoursOnRecord')), recent: num(tag(g, 'hoursLast2Weeks')) })).filter(g => g.id && g.name);
  if (!games.length) { // Spieleliste privat: nur die "meistgespielten" Spiele aus dem Profil
    games = blocks(profileXml, 'mostPlayedGame').map(g => ({ id: (tag(g, 'gameLink').match(/app\/(\d+)/) || [])[1], name: tag(g, 'gameName'), hours: num(tag(g, 'hoursOnRecord')), recent: num(tag(g, 'hoursPlayed')) })).filter(g => g.id && g.name);
  } else { extra.gameCount = games.length; extra.totalHours = Math.round(games.reduce((a, g) => a + g.hours, 0)); }
  return build(base, games, extra);
}

async function fromXml() {
  const profile = await get(BASE + '/?xml=1');
  if (tag(profile, 'privacyState') && tag(profile, 'privacyState') !== 'public') throw new Error('Profil ist nicht oeffentlich');
  const games = await get(BASE + '/games?tab=all&xml=1').catch(() => '');
  return parse(profile, games);
}

function fromApiJson(summary, owned, level) {
  const p = (summary.response && summary.response.players || [])[0];
  if (!p) throw new Error('Steam-API: Profil nicht gefunden');
  const list = (owned.response && owned.response.games) || [];
  const games = list.map(g => ({ id: String(g.appid), name: g.name, hours: Math.round((g.playtime_forever || 0) / 6) / 10, recent: Math.round((g.playtime_2weeks || 0) / 6) / 10 })).filter(g => g.name);
  const extra = {};
  if (list.length) { extra.gameCount = owned.response.game_count || list.length; extra.totalHours = Math.round(games.reduce((a, g) => a + g.hours, 0)); }
  if (level && level.response && level.response.player_level != null) extra.level = level.response.player_level;
  return build({ name: p.personaname, avatar: p.avatarfull, url: p.profileurl || BASE + '/' }, games, extra);
}

async function fromApi() {
  const q = (iface, params) => get('https://api.steampowered.com/' + iface + '?key=' + KEY + '&steamid=' + ID + '&steamids=' + ID + (params || '') + '&format=json').then(JSON.parse);
  const [summary, owned, level] = await Promise.all([
    q('ISteamUser/GetPlayerSummaries/v2/'),
    q('IPlayerService/GetOwnedGames/v1/', '&include_appinfo=1&include_played_free_games=1').catch(() => ({})),
    q('IPlayerService/GetSteamLevel/v1/').catch(() => null)
  ]);
  return fromApiJson(summary, owned, level);
}

const hasData = (s) => s && s.name && ((s.top && s.top.length) || (s.recent && s.recent.length) || s.gameCount);
const write = (file, s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 1) + '\n'); };

module.exports = { parse, fromApiJson };
if (require.main === module) (async () => {
  try {
    const s = KEY ? await fromApi() : await fromXml();
    write(OUT, s);
    if (hasData(s)) write(CACHE, s);
    console.log('steam.json geschrieben (' + (KEY ? 'Steam Web API' : 'XML') + ')');
  } catch (e) {
    console.log('Steam-Daten nicht aktualisiert: ' + e.message);
    let cached = null; try { cached = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (err) {}
    if (hasData(cached)) { write(OUT, cached); console.log('Letzten erfolgreichen Stand vom ' + cached.updated + ' verwendet.'); }
    else console.log('Kein zwischengespeicherter Stand vorhanden.' + (KEY ? '' : ' Tipp: Secret STEAM_API_KEY eintragen (siehe README).'));
  }
})();
