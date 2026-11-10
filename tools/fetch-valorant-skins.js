// Ergaenzt die Liste der eigenen Valorant-Skins (site/gaming/meine-skins.json, von Hand gepflegt) um Bild, Waffe und
// Seltenheit und schreibt site/valorant-skins.json fuer das Gaming-Profil. Laeuft im GitHub-Pages-Workflow.
// Warum von Hand? Welche Skins ein Konto besitzt, gibt Riot nur dem angemeldeten Spiel-Client heraus, nicht ueber eine
// oeffentliche Schnittstelle (auch nicht ueber die HenrikDev-API). Die Namen stehen deshalb in meine-skins.json.
// Bilder und Daten kommen von valorant-api.com (ohne Schluessel). Namen werden deutsch und englisch erkannt; was nicht
// gefunden wird, steht danach in der Zusammenfassung des Workflow-Laufs und erscheint auf der Seite ohne Bild.
// Start: node tools/fetch-valorant-skins.js [Eingabe] [Ausgabe]
'use strict';
const fs = require('fs'), path = require('path');
const IN = process.argv[2] || path.join(__dirname, '..', 'site', 'gaming', 'meine-skins.json');
const OUT = process.argv[3] || path.join(__dirname, '..', 'site', 'valorant-skins.json');
const CACHE = process.env.VALORANT_SKIN_CACHE || path.join(__dirname, '..', '.valorant-cache', 'skins.json');
const API = 'https://valorant-api.com/v1';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const https = (u) => (/^https:\/\//.test(u || '') ? u : '');

async function get(p) {
  const r = await fetch(API + p, { headers: { 'user-agent': 'skeison-web-build' } });
  if (!r.ok) throw new Error(p + ' -> ' + r.status);
  const j = await r.json();
  return (j && j.data) || [];
}

// Katalog aus den Antworten von /weapons (je Sprache) und /contenttiers: ein Eintrag je Skin mit allen bekannten Namen
function catalog(weaponsByLang, tiers) {
  const tier = {};
  (tiers || []).forEach((t) => { if (t && t.uuid) tier[t.uuid.toLowerCase()] = { name: String(t.devName || t.displayName || ''), color: /^[0-9a-f]{6}/i.test(t.highlightColor || '') ? '#' + t.highlightColor.slice(0, 6) : '', rank: Number(t.rank) || 0 }; });
  const byId = {};
  Object.keys(weaponsByLang).forEach((lang) => {
    (weaponsByLang[lang] || []).forEach((w) => {
      (w.skins || []).forEach((s) => {
        if (!s || !s.uuid || !s.displayName) return;
        const x = byId[s.uuid] || (byId[s.uuid] = { names: [], name: '', weapon: '', image: '', tier: '', color: '', rank: 0 });
        x.names.push(norm(s.displayName));
        if (lang === 'de-DE' || !x.name) { x.name = s.displayName; x.weapon = w.displayName || x.weapon; }
        const chroma = (s.chromas || [])[0] || {}, level = (s.levels || [])[0] || {};
        x.image = x.image || https(s.displayIcon) || https(chroma.fullRender) || https(chroma.displayIcon) || https(level.displayIcon);
        const t = tier[String(s.contentTierUuid || '').toLowerCase()];
        if (t) { x.tier = t.name; x.color = t.color; x.rank = t.rank; }
      });
    });
  });
  return Object.keys(byId).map((k) => byId[k]);
}
// Einen eingetragenen Namen im Katalog finden: erst genau, dann "alle Woerter kommen vor" (kuerzester Treffer gewinnt)
function find(cat, wanted) {
  const n = norm(wanted); if (!n) return null;
  let hit = cat.find((x) => x.names.indexOf(n) >= 0);
  if (hit) return hit;
  const words = n.split(' ');
  const cands = cat.filter((x) => x.names.some((nm) => words.every((w) => (' ' + nm + ' ').indexOf(' ' + w + ' ') >= 0)));
  cands.sort((a, b) => a.names[0].length - b.names[0].length);
  return cands[0] || null;
}
function resolve(cat, wantedList) {
  const skins = [], missing = [], seen = {};
  wantedList.forEach((w) => {
    const name = typeof w === 'string' ? w : w && w.name; if (!name || !String(name).trim()) return;
    const hit = find(cat, name);
    if (!hit) { missing.push(String(name)); skins.push({ name: String(name).trim(), weapon: '', tier: '', color: '', image: '', rank: 0 }); return; }
    if (seen[hit.name]) return; seen[hit.name] = 1;
    skins.push({ name: hit.name, weapon: hit.weapon, tier: hit.tier, color: hit.color, image: hit.image, rank: hit.rank });
  });
  // Seltenste zuerst, darin nach Waffe und Name
  skins.sort((a, b) => b.rank - a.rank || a.weapon.localeCompare(b.weapon, 'de') || a.name.localeCompare(b.name, 'de'));
  return { skins: skins.map((s) => ({ name: s.name, weapon: s.weapon, tier: s.tier, color: s.color, image: s.image })), missing };
}

const write = (file, s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 1) + '\n'); };
const summary = (lines) => { if (process.env.GITHUB_STEP_SUMMARY) try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Valorant-Skins\n' + lines.map((l) => '- ' + l).join('\n') + '\n'); } catch (e) { /* nur Hinweis */ } };

module.exports = { norm, catalog, find, resolve };
if (require.main === module) (async () => {
  let wanted = [];
  try { const j = JSON.parse(fs.readFileSync(IN, 'utf8')); wanted = Array.isArray(j) ? j : (j.skins || []); } catch (e) { console.log('meine-skins.json nicht lesbar: ' + e.message); }
  if (!wanted.length) { write(OUT, { skins: [] }); console.log('Keine Skins eingetragen (site/gaming/meine-skins.json).'); summary(['Keine Skins eingetragen (site/gaming/meine-skins.json)']); return; }
  try {
    const [de, en, tiers] = await Promise.all([get('/weapons?language=de-DE'), get('/weapons?language=en-US'), get('/contenttiers')]);
    const out = resolve(catalog({ 'de-DE': de, 'en-US': en }, tiers), wanted);
    const data = { updated: new Date().toISOString(), skins: out.skins, missing: out.missing };
    write(OUT, data); write(CACHE, data);
    console.log('valorant-skins.json geschrieben: ' + out.skins.length + ' Skins' + (out.missing.length ? ', nicht gefunden: ' + out.missing.join(', ') : ''));
    summary([out.skins.length + ' Skins', out.missing.length ? 'Nicht gefunden (Schreibweise pruefen): ' + out.missing.join(', ') : 'Alle Namen gefunden']);
  } catch (e) {
    // Abruf gescheitert: letzter erfolgreicher Stand, sonst die Namen ohne Bild
    let cached = null; try { cached = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (x) { /* kein Stand */ }
    write(OUT, cached && cached.skins && cached.skins.length ? cached : { skins: wanted.map((w) => ({ name: typeof w === 'string' ? w : w.name, weapon: '', tier: '', color: '', image: '' })) });
    console.log('Valorant-Skins nicht aktualisiert: ' + e.message);
    summary(['Fehler: ' + e.message, cached ? 'Gezeigt wird der letzte Stand' : 'Gezeigt werden die Namen ohne Bild']);
  }
})();
