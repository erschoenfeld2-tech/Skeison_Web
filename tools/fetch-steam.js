// Holt die oeffentlichen Steam-Profildaten (ohne API-Key, ueber die XML-Ansicht der Community-Seite)
// und schreibt site/steam.json. Laeuft im GitHub-Pages-Workflow; bei Fehlern bleibt die alte Datei bestehen.
// Start: node tools/fetch-steam.js [Ausgabedatei]
'use strict';
const fs = require('fs'), path = require('path');
const ID = process.env.STEAM_ID || '76561199246929908';
const OUT = process.argv[2] || path.join(__dirname, '..', 'site', 'steam.json');
const BASE = 'https://steamcommunity.com/profiles/' + ID;

const tag = (x, t) => { const m = x.match(new RegExp('<' + t + '>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</' + t + '>')); return m ? m[1].trim() : ''; };
const blocks = (x, t) => x.match(new RegExp('<' + t + '>[\\s\\S]*?</' + t + '>', 'g')) || [];
const num = (s) => parseFloat(String(s).replace(/,/g, '')) || 0;
const get = async (u) => { const r = await fetch(u, { headers: { 'user-agent': 'skeison-web-build' } }); if (!r.ok) throw new Error(u + ' -> ' + r.status); return r.text(); };
const store = (id) => 'https://store.steampowered.com/app/' + id;
const header = (id) => 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + id + '/header.jpg';

function parse(profileXml, gamesXml) {
  const out = { updated: new Date().toISOString(), steamId: ID, url: BASE + '/', name: tag(profileXml, 'steamID'), avatar: tag(profileXml, 'avatarFull'), state: tag(profileXml, 'stateMessage').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() };
  let games = blocks(gamesXml, 'game').map(g => ({ id: tag(g, 'appID'), name: tag(g, 'name'), hours: num(tag(g, 'hoursOnRecord')), recent: num(tag(g, 'hoursLast2Weeks')) })).filter(g => g.id && g.name);
  if (!games.length) { // Spieleliste privat: nur die "meistgespielten" Spiele aus dem Profil
    games = blocks(profileXml, 'mostPlayedGame').map(g => ({ id: (tag(g, 'gameLink').match(/app\/(\d+)/) || [])[1], name: tag(g, 'gameName'), hours: num(tag(g, 'hoursOnRecord')), recent: num(tag(g, 'hoursPlayed')) })).filter(g => g.id && g.name);
  } else { out.gameCount = games.length; out.totalHours = Math.round(games.reduce((a, g) => a + g.hours, 0)); }
  const card = (g, k) => ({ name: g.name, url: store(g.id), image: header(g.id), hours: g.hours, recent: g.recent });
  out.recent = games.filter(g => g.recent > 0).sort((a, b) => b.recent - a.recent).slice(0, 4).map(card);
  out.top = games.filter(g => g.hours > 0).sort((a, b) => b.hours - a.hours).slice(0, 6).map(card);
  return out;
}
module.exports = { parse };
if (require.main === module) (async () => {
  try {
    const profile = await get(BASE + '/?xml=1');
    if (tag(profile, 'privacyState') && tag(profile, 'privacyState') !== 'public') throw new Error('Profil ist nicht oeffentlich');
    const games = await get(BASE + '/games?tab=all&xml=1').catch(() => '');
    fs.writeFileSync(OUT, JSON.stringify(parse(profile, games), null, 1) + '\n');
    console.log('steam.json geschrieben');
  } catch (e) { console.log('Steam-Daten nicht aktualisiert: ' + e.message); }
})();
