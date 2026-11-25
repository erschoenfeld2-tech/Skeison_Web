// Live-Daten fuer die Gaming-Profile (site/gaming/). Nur fuer angemeldete Nutzer.
// Aktionen (POST, JSON):
//   { action: 'refresh', owner, force? }  Live-Daten eines Profils erneuern, das ich sehen darf (gp_view prueft das).
//                                          Zweitkonten (valorant-2 ...) bekommen eigene Eintraege im Cache; eigene Reiter mit
//                                          Steam-Spiel holen die Errungenschaften (Cache "ach:<appid>", braucht STEAM_API_KEY).
//                                          Zurueck kommt der Cache so, wie der Nutzer ihn sehen darf (gefiltert von gp_view).
//                                          Veraltet nach 6 h; der Besitzer darf alle 5 min erzwingen; nach Fehlern erst nach 30 min neu.
//   { action: 'check', kind, handle, extra? }  Beim Verknuepfen pruefen, ob es das Konto/den Server gibt.
//   { action: 'steam-search', q }         Spiele im Steam-Shop suchen (fuer die Lieblingsspiele).
// Quellen: HenrikDev (Valorant, Secret HENRIK_API_KEY), Steam Web API (Secret STEAM_API_KEY; ohne Schluessel die XML-Profilseite),
// Mojang (Minecraft-Name, Skin), api.mcsrvstat.us (Serverstatus), Discord-Einladungen. Geschrieben wird nur gp_cache (Service-Role).
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SUPA = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE;
const HENRIK = Deno.env.get('HENRIK_API_KEY') ?? '';
const STEAM_KEY = Deno.env.get('STEAM_API_KEY') ?? '';
const TTL = 6 * 3600e3, FORCE_GAP = 5 * 60e3, RETRY_GAP = 30 * 60e3;
const MEDIA = 'https://media.valorant-api.com', TIER_SET = '03621f52-342b-cf4e-4f86-9350a49c6d04';
const LIVE = ['valorant', 'steam', 'minecraft', 'discord'];
// Zweitkonten heissen <art>-2 bis <art>-5
const baseKind = (k: string) => String(k || '').replace(/-[2-5]$/, '');

class Fail extends Error { constructor(public code: string) { super(code); } }
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
const round = (v: number, d = 0) => { const f = Math.pow(10, d); return Math.round(v * f) / f; };
const uuid = (s: unknown) => (/^[0-9a-f-]{36}$/i.test(String(s || '')) ? String(s).toLowerCase() : '');

// Abruf mit Zeitlimit; 404 -> not_found, 429 -> rate_limited, sonst upstream
async function fetchRaw(url: string, init: RequestInit = {}, ms = 10000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, headers: { 'user-agent': 'skeison-gaming/1.0', ...(init.headers || {}) } });
    if (r.status === 404) throw new Fail('not_found');
    if (r.status === 429) throw new Fail('rate_limited');
    if (r.status === 401 || r.status === 403) throw new Fail('upstream_denied');
    if (!r.ok) throw new Fail('upstream_' + r.status);
    return r;
  } catch (e) {
    if (e instanceof Fail) throw e;
    throw new Fail((e as Error).name === 'AbortError' ? 'timeout' : 'network');
  } finally { clearTimeout(t); }
}
const getJson = async (url: string, init?: RequestInit) => (await fetchRaw(url, init)).json();

// ---------------------------------------------------------------- Valorant (HenrikDev), wie tools/fetch-valorant.js
const tierIcon = (id: number) => (id > 0 ? `${MEDIA}/competitivetiers/${TIER_SET}/${id}/largeicon.png` : '');
// deno-lint-ignore no-explicit-any
function normRank(d: any) {
  if (!d) return null;
  if (d.current) {
    const c = d.current, t = c.tier || {}, p = d.peak || {}, pt = p.tier || {};
    return { tier: num(t.id), name: t.name || 'Unranked', rr: num(c.rr), lastChange: num(c.last_change), icon: tierIcon(num(t.id)),
      peak: pt.name ? { tier: num(pt.id), name: pt.name, season: (p.season && p.season.short) || '', icon: tierIcon(num(pt.id)) } : null };
  }
  if (d.current_data) {
    const c = d.current_data, h = d.highest_rank || {};
    return { tier: num(c.currenttier), name: c.currenttierpatched || 'Unranked', rr: num(c.ranking_in_tier), lastChange: num(c.mmr_change_to_last_game), icon: tierIcon(num(c.currenttier)),
      peak: h.patched_tier ? { tier: num(h.tier), name: h.patched_tier, season: h.season || '', icon: tierIcon(num(h.tier)) } : null };
  }
  return null;
}
// deno-lint-ignore no-explicit-any
function normAccount(d: any) {
  if (!d) return {} as Record<string, unknown>;
  const card = typeof d.card === 'string' ? d.card : (d.card && d.card.id) || '';
  return { name: d.name || '', tag: d.tag || '', level: d.account_level != null ? num(d.account_level) : null,
    card: uuid(card) ? { small: `${MEDIA}/playercards/${uuid(card)}/smallart.png`, wide: `${MEDIA}/playercards/${uuid(card)}/wideart.png` } : null };
}
// deno-lint-ignore no-explicit-any
function normMatches(list: any) {
  // deno-lint-ignore no-explicit-any
  const rows = (Array.isArray(list) ? list : []).map((m: any) => {
    const s = m.stats || {}, meta = m.meta || {}, t = m.teams || {}, ch = s.character || {}, sh = s.shots || {};
    const mine = String(s.team || '').toLowerCase(), own = num(t[mine]), other = num(mine === 'red' ? t.blue : t.red);
    return { map: (meta.map && meta.map.name) || '', date: meta.started_at || '', agent: ch.name || '', agentId: uuid(ch.id),
      k: num(s.kills), d: num(s.deaths), a: num(s.assists), head: num(sh.head), body: num(sh.body), leg: num(sh.leg), dmg: num(s.damage && s.damage.made),
      own, other, rounds: own + other, won: own > other, draw: own === other };
  }).filter((m: { agent: string; rounds: number }) => m.agent && m.rounds > 0);
  rows.sort((a: { date: string }, b: { date: string }) => (a.date < b.date ? 1 : -1));
  return rows;
}
// Valorant liefert keine Gesamtspielzeit. Geschaetzt wird aus allen bei HenrikDev gespeicherten Spielen (die Liste hat Luecken)
// mal einer ueblichen Dauer je Modus in Minuten. Genauer ist die Spielzeit, die man im Editor selbst eintraegt (extra.hours).
const MODE_MIN: Record<string, number> = { competitive: 38, premier: 38, unrated: 34, swiftplay: 16, spikerush: 12, deathmatch: 8,
  teamdeathmatch: 10, escalation: 12, replication: 16, snowball: 12, custom: 30, newmap: 34 };
// deno-lint-ignore no-explicit-any
function valPlaytime(list: any) {
  if (!Array.isArray(list) || !list.length) return null;
  let min = 0;
  const by: Record<string, number> = {};
  // deno-lint-ignore no-explicit-any
  list.forEach((m: any) => {
    const mode = String(m?.meta?.mode || '').toLowerCase().replace(/[^a-z]/g, '') || 'unrated';
    min += MODE_MIN[mode] ?? 25; by[mode] = (by[mode] || 0) + 1;
  });
  return { hours: Math.round(min / 6) / 10, matches: list.length, byMode: by, estimate: true };
}
async function valorant(handle: string, region: string) {
  const m = handle.trim().match(/^(.{2,})#(.{2,})$/);
  if (!m) throw new Fail('bad_handle');
  if (!HENRIK) throw new Fail('not_configured');
  const reg = ['eu', 'na', 'ap', 'kr', 'latam', 'br'].includes(region) ? region : 'eu';
  const name = encodeURIComponent(m[1].trim()), tag = encodeURIComponent(m[2].trim());
  const H = { headers: { Authorization: HENRIK } };
  const api = (p: string) => getJson('https://api.henrikdev.xyz/valorant' + p, H).then((j) => (j && j.data !== undefined ? j.data : j));
  const account = normAccount(await api(`/v2/account/${name}/${tag}`).catch((e) => { if (e.code === 'not_found') throw e; return api(`/v1/account/${name}/${tag}`); }));
  const rank = normRank(await api(`/v3/mmr/${reg}/pc/${name}/${tag}`).catch(() => api(`/v2/mmr/${reg}/${name}/${tag}`)).catch(() => null));
  const [stored, all] = await Promise.all([
    api(`/v1/stored-matches/${reg}/${name}/${tag}?mode=competitive&size=30`).catch(() => []),
    api(`/v1/stored-matches/${reg}/${name}/${tag}`).catch(() => null),
  ]);
  const matches = normMatches(stored);
  const playtime = valPlaytime(all);
  const sum = (f: (x: typeof matches[0]) => number) => matches.reduce((n: number, x: typeof matches[0]) => n + f(x), 0);
  const k = sum((x) => x.k), d = sum((x) => x.d), a = sum((x) => x.a), shots = sum((x) => x.head + x.body + x.leg), rounds = sum((x) => x.rounds);
  const wins = matches.filter((x: { won: boolean }) => x.won).length;
  const by: Record<string, { name: string; id: string; games: number; wins: number; k: number; d: number }> = {};
  matches.forEach((x: typeof matches[0]) => { const e = by[x.agent] = by[x.agent] || { name: x.agent, id: x.agentId, games: 0, wins: 0, k: 0, d: 0 }; e.games++; if (x.won) e.wins++; e.k += x.k; e.d += x.d; });
  const riot = `${account.name || m[1].trim()}#${account.tag || m[2].trim()}`;
  return {
    riotId: riot, name: account.name || m[1].trim(), tag: account.tag || m[2].trim(), region: reg,
    url: 'https://tracker.gg/valorant/profile/riot/' + encodeURIComponent(riot) + '/overview', level: account.level ?? null, card: account.card || null, rank, playtime,
    stats: matches.length ? { matches: matches.length, wins, winrate: Math.round(wins / matches.length * 100), kd: round(k / Math.max(1, d), 2), kda: round((k + a) / Math.max(1, d), 2),
      hs: shots ? Math.round(sum((x) => x.head) / shots * 100) : null, adr: rounds ? Math.round(sum((x) => x.dmg) / rounds) : null } : null,
    agents: Object.values(by).sort((x, y) => y.games - x.games || y.wins - x.wins).slice(0, 3).map((x) => ({
      name: x.name, games: x.games, winrate: Math.round(x.wins / x.games * 100), kd: round(x.k / Math.max(1, x.d), 2), icon: x.id ? `${MEDIA}/agents/${x.id}/displayicon.png` : '' })),
    recent: matches.slice(0, 5).map((x: typeof matches[0]) => ({ map: x.map, agent: x.agent, k: x.k, d: x.d, a: x.a, won: x.won, draw: x.draw, score: x.own + ':' + x.other, date: x.date,
      icon: x.agentId ? `${MEDIA}/agents/${x.agentId}/displayicon.png` : '' })),
  };
}

// ---------------------------------------------------------------- Steam (Web API, sonst XML-Profilseite)
const store = (id: string | number) => 'https://store.steampowered.com/app/' + id;
const header = (id: string | number) => 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + id + '/header.jpg';
// Profil-URL, 17-stellige ID oder Benutzername -> Basis-URL der Community-Seite
function steamBase(handle: string) {
  const h = handle.trim();
  const id = h.match(/(?:profiles\/)?(7656\d{13})/);
  if (id) return { id: id[1], base: 'https://steamcommunity.com/profiles/' + id[1] };
  const v = h.match(/(?:steamcommunity\.com\/id\/)?([A-Za-z0-9_-]{2,32})\/?$/);
  if (!v) throw new Fail('bad_handle');
  return { vanity: v[1], base: 'https://steamcommunity.com/id/' + v[1] };
}
const xtag = (x: string, t: string) => { const m = x.match(new RegExp('<' + t + '>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</' + t + '>')); return m ? m[1].trim() : ''; };
const xblocks = (x: string, t: string) => x.match(new RegExp('<' + t + '>[\\s\\S]*?</' + t + '>', 'g')) || [];
type Game = { id: string; name: string; hours: number; recent: number };
function steamOut(base: { steamId: string; url: string; name: string; avatar: string }, games: Game[], extra: Record<string, unknown>) {
  const card = (g: Game) => ({ appid: Number(g.id), name: g.name, url: store(g.id), image: header(g.id), hours: g.hours, recent: g.recent });
  return { ...base, ...extra,
    recent: games.filter((g) => g.recent > 0).sort((a, b) => b.recent - a.recent).slice(0, 4).map(card),
    top: games.filter((g) => g.hours > 0).sort((a, b) => b.hours - a.hours).slice(0, 6).map(card),
    // fuer die Auswahl der Lieblingsspiele (nach Spielzeit)
    library: games.slice().sort((a, b) => b.hours - a.hours).slice(0, 300).map((g) => ({ appid: Number(g.id), name: g.name, hours: g.hours })) };
}
// Wert der Bibliothek (wie tools/fetch-steam.js): Summe der Shop-Preise aller Spiele im deutschen Shop (Euro). "initial" ist der
// regulaere Preis, "final" der gerade gueltige (Angebot). Kostenlose und nicht mehr verkaufte Spiele zaehlen nicht mit.
// Abgefragt in Paketen zu 40 Spielen, hoechstens 800 Spiele; scheitert ein Paket, bleibt es ungezaehlt.
async function steamValue(games: Game[]) {
  const ids = games.map((g) => g.id).slice(0, 800);
  // deno-lint-ignore no-explicit-any
  const price: Record<string, any> = {};
  for (let i = 0; i < ids.length; i += 40) {
    const part = ids.slice(i, i + 40);
    try {
      const j = await getJson(`https://store.steampowered.com/api/appdetails?appids=${part.join(',')}&filters=price_overview&cc=de`);
      part.forEach((id) => { const d = j?.[id]?.success && j[id].data; if (d && d.price_overview) price[id] = d.price_overview; });
    } catch (e) { if (i === 0) throw e; }   // erstes Paket gescheitert: gar kein Wert (der alte bleibt stehen)
    if (i + 40 < ids.length) await new Promise((r) => setTimeout(r, 1200));
  }
  let eur = 0, eurNow = 0, priced = 0;
  const rows: { name: string; eur: number; hours: number }[] = [];
  games.forEach((g) => {
    const p = price[g.id];
    if (!p || p.currency !== 'EUR' || !(p.initial > 0)) return;
    priced++; eur += p.initial / 100; eurNow += (p.final || p.initial) / 100;
    rows.push({ name: g.name, eur: Math.round(p.initial) / 100, hours: g.hours });
  });
  if (!priced) return null;
  rows.sort((a, b) => b.eur - a.eur);
  const hours = games.reduce((a, g) => a + g.hours, 0);
  return { eur: Math.round(eur), eurNow: Math.round(eurNow), priced, unpriced: games.length - priced, count: games.length,
    perHour: hours > 0 ? Math.round(eur / hours * 100) / 100 : null, top: rows.slice(0, 8) };
}
async function steam(handle: string, withValue = false) {
  const out = await steamProfile(handle);
  // beim Verknuepfen (check) ohne Wert, das dauert bei grossen Bibliotheken einige Sekunden
  // value: null = berechnet, aber kein Preis gefunden (oder Bibliothek nicht oeffentlich); so wird nicht staendig neu gerechnet
  if (withValue) out.data.value = out.games.length ? await steamValue(out.games).catch(() => null) : null;
  return out.data;
}
async function steamProfile(handle: string): Promise<{ data: Record<string, unknown>; games: Game[] }> {
  const s = steamBase(handle);
  if (STEAM_KEY) {
    let id = s.id;
    if (!id) {
      const r = await getJson(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_KEY}&vanityurl=${encodeURIComponent(s.vanity!)}`);
      if (!r?.response?.steamid) throw new Fail('not_found');
      id = r.response.steamid;
    }
    const q = (iface: string, p = '') => getJson(`https://api.steampowered.com/${iface}?key=${STEAM_KEY}&steamid=${id}&steamids=${id}${p}&format=json`);
    const [sum, owned, level] = await Promise.all([
      q('ISteamUser/GetPlayerSummaries/v2/'),
      q('IPlayerService/GetOwnedGames/v1/', '&include_appinfo=1&include_played_free_games=1').catch(() => ({})),
      q('IPlayerService/GetSteamLevel/v1/').catch(() => null),
    ]);
    const p = sum?.response?.players?.[0];
    if (!p) throw new Fail('not_found');
    // deno-lint-ignore no-explicit-any
    const list: any[] = owned?.response?.games || [];
    const games = list.filter((g) => g.name).map((g) => ({ id: String(g.appid), name: g.name, hours: Math.round((g.playtime_forever || 0) / 6) / 10, recent: Math.round((g.playtime_2weeks || 0) / 6) / 10 }));
    const extra: Record<string, unknown> = { private: !list.length };
    if (list.length) { extra.gameCount = owned.response.game_count || list.length; extra.totalHours = Math.round(games.reduce((a, g) => a + g.hours, 0)); }
    if (level?.response?.player_level != null) extra.level = level.response.player_level;
    return { data: steamOut({ steamId: id!, url: p.profileurl || 'https://steamcommunity.com/profiles/' + id + '/', name: p.personaname, avatar: p.avatarfull }, games, extra), games };
  }
  const prof = await (await fetchRaw(s.base + '/?xml=1')).text();
  if (/<error>/i.test(prof) || !xtag(prof, 'steamID64')) throw new Fail('not_found');
  const id = xtag(prof, 'steamID64'), url = 'https://steamcommunity.com/profiles/' + id + '/';
  const base = { steamId: id, url, name: xtag(prof, 'steamID'), avatar: xtag(prof, 'avatarFull') };
  if (xtag(prof, 'privacyState') && xtag(prof, 'privacyState') !== 'public') return { data: steamOut(base, [], { private: true }), games: [] };
  const gx = await fetchRaw(url + 'games?tab=all&xml=1').then((r) => r.text()).catch(() => '');
  let games: Game[] = xblocks(gx, 'game').map((g) => ({ id: xtag(g, 'appID'), name: xtag(g, 'name'), hours: num(xtag(g, 'hoursOnRecord').replace(/,/g, '')), recent: num(xtag(g, 'hoursLast2Weeks').replace(/,/g, '')) })).filter((g) => g.id && g.name);
  const extra: Record<string, unknown> = {}, full = games.length > 0;   // nur mit ganzer Bibliothek einen Wert berechnen
  if (games.length) { extra.gameCount = games.length; extra.totalHours = Math.round(games.reduce((a, g) => a + g.hours, 0)); }
  else games = xblocks(prof, 'mostPlayedGame').map((g) => ({ id: (xtag(g, 'gameLink').match(/app\/(\d+)/) || [])[1] || '', name: xtag(g, 'gameName'), hours: num(xtag(g, 'hoursOnRecord')), recent: num(xtag(g, 'hoursPlayed')) })).filter((g) => g.id && g.name);
  extra.private = !games.length;
  return { data: steamOut(base, games, extra), games: full ? games : [] };
}
async function steamSearch(q: string) {
  const term = q.trim().slice(0, 60);
  if (term.length < 2) return [];
  const r = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=german&cc=DE`);
  // deno-lint-ignore no-explicit-any
  return ((r?.items || []) as any[]).filter((x) => x.type === 'app' || !x.type).slice(0, 12)
    .map((x) => ({ appid: x.id, name: x.name, image: header(x.id) }));
}

// Errungenschaften eines Spiels (nur mit Schluessel und oeffentlichen Spieldetails); key: "<steamid>|<appid>"
async function achievements(key: string) {
  const [id, appid] = key.split('|');
  if (!STEAM_KEY) throw new Fail('not_configured');
  if (!/^7656\d{13}$/.test(id || '') || !/^\d{1,9}$/.test(appid || '')) throw new Fail('bad_handle');
  const base = 'https://api.steampowered.com/ISteamUserStats/';
  const [mine, schema] = await Promise.all([
    getJson(`${base}GetPlayerAchievements/v1/?key=${STEAM_KEY}&steamid=${id}&appid=${appid}&l=german`),
    getJson(`${base}GetSchemaForGame/v2/?key=${STEAM_KEY}&appid=${appid}&l=german`).catch(() => null),
  ]);
  // deno-lint-ignore no-explicit-any
  const got: any[] = mine?.playerstats?.achievements || [];
  if (!mine?.playerstats?.success && !got.length) throw new Fail('not_found');
  // deno-lint-ignore no-explicit-any
  const info: Record<string, any> = {};
  // deno-lint-ignore no-explicit-any
  ((schema?.game?.availableGameStats?.achievements || []) as any[]).forEach((a) => { info[a.name] = a; });
  const list = got.map((a) => {
    const i = info[a.apiname] || {};
    return { n: String(i.displayName || a.name || a.apiname).slice(0, 80), d: String(i.description || a.description || '').slice(0, 140),
      i: (a.achieved ? i.icon : i.icongray) || '', done: !!a.achieved, at: a.achieved && a.unlocktime ? new Date(a.unlocktime * 1000).toISOString().slice(0, 10) : '' };
  });
  list.sort((a, b) => Number(b.done) - Number(a.done) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { appid: Number(appid), game: mine?.playerstats?.gameName || '', total: list.length, done: list.filter((a) => a.done).length, list: list.slice(0, 200) };
}

// ---------------------------------------------------------------- Minecraft (Mojang) und Server (mcsrvstat.us)
function b64(buf: ArrayBuffer) {
  let s = ''; const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
async function minecraft(handle: string) {
  const name = handle.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Fail('bad_handle');
  const p = await getJson('https://api.mojang.com/users/profiles/minecraft/' + name);
  if (!p?.id) throw new Fail('not_found');
  let skin: string | null = null, model = 'classic';
  try {
    const s = await getJson('https://sessionserver.mojang.com/session/minecraft/profile/' + p.id);
    // deno-lint-ignore no-explicit-any
    const tex = JSON.parse(atob((s?.properties || []).find((x: any) => x.name === 'textures')?.value || 'e30='));
    const url = tex?.textures?.SKIN?.url;
    if (url && /^https?:\/\/textures\.minecraft\.net\//.test(url)) {
      const png = await (await fetchRaw(url.replace(/^http:/, 'https:'))).arrayBuffer();
      if (png.byteLength < 30000) skin = 'data:image/png;base64,' + b64(png);
      if (tex.textures.SKIN.metadata?.model === 'slim') model = 'slim';
    }
  } catch { /* Skin ist nur Zugabe */ }
  return { name: p.name, uuid: p.id, skin, model, url: 'https://namemc.com/profile/' + p.name };
}
async function mcserver(address: string) {
  const a = address.trim().toLowerCase();
  if (!/^[a-z0-9.-]{3,80}(:\d{2,5})?$/.test(a)) throw new Fail('bad_handle');
  const s = await getJson('https://api.mcsrvstat.us/3/' + encodeURIComponent(a), { headers: { 'user-agent': 'skeison-gaming/1.0 (Gaming-Profil)' } });
  if (!s?.ip || s.ip === '127.0.0.1') throw new Fail('not_found');
  return { address: a, online: !!s.online, motd: (s.motd?.clean || []).join('\n').slice(0, 200), version: s.version || '',
    players: num(s.players?.online), max: num(s.players?.max), names: (s.players?.list || []).slice(0, 12).map((p: { name: string }) => p.name),
    icon: typeof s.icon === 'string' && s.icon.startsWith('data:image/png;base64,') && s.icon.length < 20000 ? s.icon : null };
}

// ---------------------------------------------------------------- Discord (Einladung)
async function discord(handle: string) {
  const code = (handle.trim().match(/(?:discord(?:app)?\.(?:gg|com)\/(?:invite\/)?)?([A-Za-z0-9-]{2,32})\/?$/) || [])[1];
  if (!code) throw new Fail('bad_handle');
  const d = await getJson(`https://discord.com/api/v10/invites/${code}?with_counts=true`);
  if (!d?.guild) throw new Fail('not_found');
  return { code, name: d.guild.name, members: num(d.approximate_member_count), online: num(d.approximate_presence_count),
    icon: d.guild.icon ? `https://cdn.discordapp.com/icons/${d.guild.id}/${d.guild.icon}.png?size=128` : null, url: 'https://discord.gg/' + code };
}

// deno-lint-ignore no-explicit-any
// full: Live-Daten fuers Profil (mit Wert der Steam-Bibliothek); ohne full nur die schnelle Pruefung beim Verknuepfen
function load(kind: string, handle: string, extra: any, full = false) {
  if (kind.startsWith('ach:')) return achievements(handle);
  kind = baseKind(kind);
  if (kind === 'valorant') return valorant(handle, String(extra?.region || 'eu'));
  if (kind === 'steam') return steam(handle, full);
  if (kind === 'minecraft') return minecraft(handle);
  if (kind === 'mcserver') return mcserver(handle);
  if (kind === 'discord') return discord(handle);
  throw new Fail('bad_kind');
}

// ---------------------------------------------------------------- Datenbank
const rest = (path: string, init: RequestInit = {}) => fetch(`${SUPA}/rest/v1/${path}`, {
  ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
});
async function saveCache(row: Record<string, unknown>) {
  await rest('gp_cache?on_conflict=owner,kind', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
}

// einfache Bremse je Nutzer (pro Instanz): hoechstens 40 Aufrufe pro Minute
const hits = new Map<string, number[]>();
function limited(uid: string) {
  const now = Date.now(), list = (hits.get(uid) || []).filter((t) => now - t < 60e3);
  list.push(now); hits.set(uid, list);
  return list.length > 40;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const auth = req.headers.get('authorization') ?? '';
  const who = await fetch(`${SUPA}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } }).catch(() => null);
  if (!who?.ok) return json({ error: 'unauthorized' }, 401);
  const me = (await who.json()).id as string;
  if (limited(me)) return json({ error: 'rate_limited' }, 429);
  const b = await req.json().catch(() => null);
  const action = String(b?.action || '');

  try {
    if (action === 'steam-search') return json({ items: await steamSearch(String(b?.q || '')) });

    if (action === 'check') {
      const kind = String(b?.kind || ''), handle = String(b?.handle || '').slice(0, 100);
      try {
        const data = await load(kind, handle, b?.extra);
        // Vorschau fuer den Dialog; die Bibliothek wird fuer Lieblingsspiele mitgegeben
        return json({ ok: true, data });
      } catch (e) {
        const code = e instanceof Fail ? e.code : 'failed';
        // Ohne Schluessel laesst sich Valorant nicht pruefen: Format ok -> trotzdem speichern lassen
        if (code === 'not_configured') return json({ ok: true, unchecked: true });
        return json({ ok: false, error: code });
      }
    }

    if (action === 'refresh') {
      const owner = String(b?.owner || '');
      if (!uuid(owner)) return json({ error: 'bad_owner' }, 400);
      // gp_view mit dem Zugang des Nutzers: prueft, ob er das Profil sehen darf, und liefert am Ende den gefilterten Cache
      const view = () => fetch(`${SUPA}/rest/v1/rpc/gp_view`, { method: 'POST', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_owner: owner }) });
      const pr = await view();
      if (!pr.ok) return json({ error: 'no_access' }, 403);
      await pr.text().catch(() => '');
      const mine = owner === me, force = !!b?.force && mine, now = Date.now();
      // Konten, Server und eigene Reiter mit Service-Role (echte Namen; gp_view kuerzt sie fuer oeffentliche Profile)
      // deno-lint-ignore no-explicit-any
      const sel = (q: string): Promise<any[]> => rest(q).then((r) => r.json()).then((x) => (Array.isArray(x) ? x : [])).catch(() => []);
      const [accs, profs, customs] = await Promise.all([
        sel(`gp_accounts?owner=eq.${owner}&select=kind,handle,extra&order=sort,created_at`),
        sel(`gp_profiles?id=eq.${owner}&select=mc_server`),
        sel(`gp_custom_games?owner=eq.${owner}&appid=not.is.null&select=appid&order=sort&limit=8`),
      ]);
      // deno-lint-ignore no-explicit-any
      const jobs: { kind: string; handle: string; extra: any }[] = accs
        .filter((a) => LIVE.includes(baseKind(a.kind)) && (baseKind(a.kind) !== 'discord' || /discord(?:app)?\.(?:gg|com)\//i.test(a.handle)))   // Discord nur mit Einladung
        .map((a) => ({ kind: a.kind, handle: a.handle, extra: a.extra }));
      if (profs[0]?.mc_server) jobs.push({ kind: 'mcserver', handle: profs[0].mc_server, extra: {} });
      // Zwischenstand mit allen Zeitstempeln
      const rows = await sel(`gp_cache?owner=eq.${owner}&select=kind,data,error,fetched_at,tried_at,forced_at`);
      // deno-lint-ignore no-explicit-any
      const cache: Record<string, any> = {};
      rows.forEach((c) => { cache[c.kind] = c; });
      // Errungenschaften: Steam-ID aus dem Cache des ersten Steam-Kontos
      const sid = String(cache.steam?.data?.steamId || '');
      if (STEAM_KEY && /^7656\d{13}$/.test(sid)) customs.forEach((c) => { if (c.appid) jobs.push({ kind: 'ach:' + c.appid, handle: sid + '|' + c.appid, extra: {} }); });
      const ts = (v: unknown) => (v ? Date.parse(String(v)) : 0);
      const keyOf = (j: { handle: string; extra: { region?: string } }) => j.handle.trim() + '|' + String(j.extra?.region || '');
      const due = jobs.filter((j) => {
        const c = cache[j.kind];
        if (!c) return true;
        if ((c.data?._key ?? '') !== keyOf(j)) return true;                         // Konto oder Region geaendert
        if (baseKind(j.kind) === 'steam' && c.data && !('value' in c.data) && !(c.error && now - ts(c.tried_at) < RETRY_GAP)) return true;   // Stand von vor der Wertberechnung
        if (baseKind(j.kind) === 'valorant' && c.data && !('playtime' in c.data) && !(c.error && now - ts(c.tried_at) < RETRY_GAP)) return true;   // Stand von vor der Spielzeit-Schaetzung
        const fetched = ts(c.fetched_at), tried = ts(c.tried_at ?? c.fetched_at);
        if (force && now - Math.max(ts(c.forced_at), 0) > FORCE_GAP) return true;
        if (c.error && now - tried < RETRY_GAP) return false;
        return now - fetched > (j.kind === 'mcserver' || baseKind(j.kind) === 'discord' ? 15 * 60e3 : TTL);
      });
      const stamp = new Date().toISOString();
      await Promise.allSettled(due.map(async (j) => {
        try {
          // deno-lint-ignore no-explicit-any
          const data: any = { ...(await load(j.kind, j.handle, j.extra, true)), _key: keyOf(j) };
          // Steam-Preise nicht abrufbar: den letzten berechneten Wert behalten (gleiches Konto)
          const prev = cache[j.kind]?.data;
          if (baseKind(j.kind) === 'steam' && !data.value && prev?.value && prev._key === data._key) data.value = prev.value;
          await saveCache({ owner, kind: j.kind, data, error: null, fetched_at: stamp, tried_at: stamp, ...(force ? { forced_at: stamp } : {}) });
        } catch (e) {
          await saveCache({ owner, kind: j.kind, error: e instanceof Fail ? e.code : 'failed', tried_at: stamp, ...(force ? { forced_at: stamp } : {}) });
        }
      }));
      // deno-lint-ignore no-explicit-any
      const fresh: any = await view().then((r) => (r.ok ? r.json() : null)).catch(() => null);
      return json({ cache: fresh?.cache || {}, updated: due.map((j) => j.kind), configured: { valorant: !!HENRIK, steam: !!STEAM_KEY } });
    }
    return json({ error: 'bad_action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Fail ? e.code : 'failed' }, 200);
  }
});
