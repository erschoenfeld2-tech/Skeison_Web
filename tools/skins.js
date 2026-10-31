// Laedt die Skins der Spieler von Mojang und legt sie als <ordner>/<name-klein>.png ab (landen im Branch "data").
// Die Webseite schneidet daraus den Kopf aus. Ablauf je Spieler:
//   1. Skin-Adresse ueber die UUID (Session-Server), bei Servern ohne Online-Modus ueber den Namen -> UUID -> Session-Server
//   2. PNG herunterladen und pruefen
// Hoechstens ein Abruf pro Spieler und Tag (Mojang bremst sonst mit 429); bei Fehlern bleibt der alte Skin liegen.
'use strict';
const fs = require('fs'), path = require('path');

const UA = { 'user-agent': 'skeison-web-sync' };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const isPng = (b) => b.length > 8 && b.length < 200000 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

async function getJson(url) {
  const r = await fetch(url, { headers: UA });
  if (r.status === 204 || r.status === 404) return null;
  if (!r.ok) throw new Error(url.split('?')[0] + ' -> ' + r.status);
  return r.json();
}

// Adresse der Skin-Textur zu einer UUID (null: Spieler unbekannt oder ohne Skin)
async function skinUrl(uuid) {
  const prof = await getJson('https://sessionserver.mojang.com/session/minecraft/profile/' + uuid.replace(/-/g, ''));
  const tex = prof && (prof.properties || []).find((p) => p.name === 'textures');
  if (!tex) return null;
  const j = JSON.parse(Buffer.from(tex.value, 'base64').toString('utf8'));
  const u = j.textures && j.textures.SKIN && j.textures.SKIN.url;
  return u ? u.replace(/^http:/, 'https:') : null;
}

// UUID zu einem Namen (fuer Server im Offline-Modus, deren UUIDs nicht von Mojang stammen)
async function uuidByName(name) {
  const n = encodeURIComponent(name);
  const j = (await getJson('https://api.minecraftservices.com/minecraft/profile/lookup/name/' + n).catch(() => null))
    || (await getJson('https://api.mojang.com/users/profiles/minecraft/' + n).catch(() => null));
  return j && j.id ? j.id : null;
}

async function download(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error('Skin-Download -> ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

// players: [{ name, uuid }]; state-Datei merkt sich, wann zuletzt geprueft wurde (auch bei Spielern ohne Skin)
async function syncSkins(players, dir, opts) {
  const o = Object.assign({ stateFile: null, log: () => {}, max: 12, maxAgeMs: 24 * 3600e3, retryMs: 3600e3, delayMs: 1500 }, opts);
  fs.mkdirSync(dir, { recursive: true });
  let state = {}; try { state = JSON.parse(fs.readFileSync(o.stateFile, 'utf8')); } catch (e) {}
  const now = Date.now(); let tried = 0, got = 0, missing = [];
  for (const p of players) {
    const key = String(p.name || '').toLowerCase();
    if (!/^[a-z0-9_]{1,16}$/.test(key)) continue;
    const st = state[key];
    if (st && now - st.t < o.maxAgeMs) continue;
    if (tried >= o.max) break;
    tried++;
    try {
      let url = p.uuid ? await skinUrl(p.uuid).catch((e) => { if (/429/.test(e.message)) throw e; return null; }) : null;
      if (!url) { const id = await uuidByName(p.name); if (id) url = await skinUrl(id); }
      if (!url) { state[key] = { t: now, ok: false }; missing.push(p.name); }
      else {
        const png = await download(url);
        if (!isPng(png)) throw new Error('keine gueltige PNG-Datei');
        fs.writeFileSync(path.join(dir, key + '.png'), png); state[key] = { t: now, ok: true }; got++;
      }
    } catch (e) {
      if (/429/.test(e.message)) { o.log('Skins: Mojang bremst (429), es geht spaeter weiter.'); break; }
      o.log('Skins: ' + p.name + ' nicht geladen (' + e.message + '), neuer Versuch in einer Stunde.');
      state[key] = { t: now - o.maxAgeMs + o.retryMs, ok: false };
    }
    await sleep(o.delayMs);
  }
  if (o.stateFile) { fs.mkdirSync(path.dirname(o.stateFile), { recursive: true }); fs.writeFileSync(o.stateFile, JSON.stringify(state)); }
  if (got || missing.length) o.log('Skins: ' + got + ' geladen' + (missing.length ? ', kein Skin gefunden fuer ' + missing.join(', ') + ' (Buchstabe als Ersatz)' : '') + '.');
  return { tried, got, missing };
}

module.exports = { syncSkins, skinUrl, uuidByName };
