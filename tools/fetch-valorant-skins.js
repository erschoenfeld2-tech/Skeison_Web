// Ergaenzt die Liste der eigenen Valorant-Skins (site/gaming/meine-skins.json, von Hand gepflegt) um Bild, Waffe,
// Seltenheit und einen geschaetzten Wert und schreibt site/valorant-skins.json fuer das Gaming-Profil. Laeuft im Pages-Workflow.
// Warum von Hand? Welche Skins ein Konto besitzt, gibt Riot nur dem angemeldeten Spiel-Client heraus, nicht ueber eine
// oeffentliche Schnittstelle (auch nicht ueber die HenrikDev-API). Die Namen stehen deshalb in meine-skins.json:
//   "skins":      einzelne Skins ("Prime Vandal"; Nahkampfwaffen als "<Bundle> Melee", weil sie im Spiel eigene Namen haben)
//   "sammlungen": ganze Bundles ("Blackspire" = alle Skins, deren Name diese Woerter enthaelt)
// Bilder und Daten kommen von valorant-api.com (ohne Schluessel). Namen werden deutsch und englisch erkannt, kleine
// Tippfehler werden verziehen; was nicht gefunden wird, steht in der Zusammenfassung des Workflow-Laufs.
// Wert: Die Schnittstelle nennt keine Preise. Geschaetzt wird ueber die Seltenheitsstufe mit den ueblichen Shop-Preisen
// in Valorant Points (PREISE unten) und einem Kurs VP -> Euro (EUR_JE_100_VP). Das ist eine grobe Schaetzung dessen, was
// die Skins im Shop kosten wuerden, kein Verkaufswert (Konten und Skins lassen sich nicht verkaufen).
// Start: node tools/fetch-valorant-skins.js [Eingabe] [Ausgabe]
'use strict';
const fs = require('fs'), path = require('path');
const IN = process.argv[2] || path.join(__dirname, '..', 'site', 'gaming', 'meine-skins.json');
const OUT = process.argv[3] || path.join(__dirname, '..', 'site', 'valorant-skins.json');
const CACHE = process.env.VALORANT_SKIN_CACHE || path.join(__dirname, '..', '.valorant-cache', 'skins.json');
const API = 'https://valorant-api.com/v1';
// Uebliche Shop-Preise je Seltenheitsstufe in Valorant Points: [Schusswaffe, Nahkampfwaffe]. Einzelne Bundles weichen ab.
const PREISE = { select: [875, 1750], deluxe: [1275, 2550], premium: [1775, 3550], exclusive: [2175, 4350], ultra: [2475, 4950] };
const EUR_JE_100_VP = Number(process.env.VALORANT_EUR_PER_100VP) || 1.05; // rund 10 Euro fuer knapp 1000 VP
const MELEE_WORDS = ['melee', 'messer', 'knife', 'nahkampf', 'nahkampfwaffe', 'sword', 'schwert', 'blade', 'klinge', 'dolch', 'dagger', 'karambit', 'axt', 'axe'];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const https = (u) => (/^https:\/\//.test(u || '') ? u : '');
// Bearbeitungsabstand zweier Woerter (fuer Tippfehler wie "Specre" statt "Spectre")
function dist(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}
// Wort passt: gleich, oder (ab 5 Buchstaben) ein Tippfehler, oder Einzahl/Mehrzahl ("key"/"keys")
function sameWord(w, n) {
  if (w === n || w + 's' === n || n + 's' === w) return true;
  if (/^\d/.test(w) || /^\d/.test(n)) return false;
  return w.length >= 5 && dist(w, n) <= (w.length >= 8 ? 2 : 1);
}
const hasAll = (words, name) => { const ns = name.split(' '); return words.every((w) => ns.some((n) => sameWord(w, n))); };

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
      const melee = /melee/i.test(w.category || '') || /^(melee|nahkampf)/i.test(w.displayName || '');
      (w.skins || []).forEach((s) => {
        if (!s || !s.uuid || !s.displayName) return;
        const x = byId[s.uuid] || (byId[s.uuid] = { names: [], name: '', weapon: '', image: '', tier: '', color: '', rank: 0, melee: false });
        x.names.push(norm(s.displayName));
        x.melee = x.melee || melee;
        if (lang === 'de-DE' || !x.name) { x.name = s.displayName; x.weapon = w.displayName || x.weapon; }
        const chroma = (s.chromas || [])[0] || {}, level = (s.levels || [])[0] || {};
        x.image = x.image || https(s.displayIcon) || https(chroma.fullRender) || https(chroma.displayIcon) || https(level.displayIcon);
        const t = tier[String(s.contentTierUuid || '').toLowerCase()];
        if (t) { x.tier = t.name; x.color = t.color; x.rank = t.rank; }
      });
    });
  });
  // Standard-Skins der Waffen und Zufalls-Favoriten gehoeren nicht in eine Sammlung
  return Object.keys(byId).map((k) => byId[k]).filter((x) => !x.names.some((n) => /^(standard|random favorite|zufalliger favorit)/.test(n)));
}
// Einen eingetragenen Namen im Katalog finden: erst genau, dann "alle Woerter kommen vor" (kuerzester Treffer gewinnt).
// "<Bundle> Melee" (oder Sword, Messer ...) sucht unter den Nahkampfwaffen nach den uebrigen Woertern.
function find(cat, wanted) {
  const n = norm(wanted); if (!n) return null;
  const exact = cat.find((x) => x.names.indexOf(n) >= 0);
  if (exact) return exact;
  const words = n.split(' ');
  const pick = (list, ws) => list.filter((x) => x.names.some((nm) => hasAll(ws, nm))).sort((a, b) => a.names[0].length - b.names[0].length)[0] || null;
  const hit = pick(cat, words);
  if (hit) return hit;
  const rest = words.filter((w) => MELEE_WORDS.indexOf(w) < 0 && w !== 'of' && w !== 'to');
  if (rest.length && rest.length < words.length) return pick(cat.filter((x) => x.melee), rest) || pick(cat.filter((x) => x.melee), rest.slice(0, 1));
  return null;
}
// Alle Skins einer Sammlung: Name enthaelt alle Woerter der Sammlung. Faellt ein Zusatz wie "2.0" durch, zaehlt der Rest.
function findAll(cat, wanted) {
  const words = norm(wanted).split(' ').filter(Boolean); if (!words.length) return [];
  let hits = cat.filter((x) => x.names.some((nm) => hasAll(words, nm)));
  if (!hits.length) { const core = words.filter((w) => !/^\d+$/.test(w)); if (core.length && core.length < words.length) hits = cat.filter((x) => x.names.some((nm) => hasAll(core, nm))); }
  return hits;
}
function price(x) { const p = PREISE[String(x.tier || '').toLowerCase()]; return p ? p[x.melee ? 1 : 0] : 0; }
function resolve(cat, wantedList, collections) {
  const skins = [], missing = [], seen = {};
  const add = (hit) => { if (seen[hit.name]) return; seen[hit.name] = 1; skins.push({ name: hit.name, weapon: hit.weapon, tier: hit.tier, color: hit.color, image: hit.image, rank: hit.rank, vp: price(hit) }); };
  (collections || []).forEach((c) => { const hits = findAll(cat, c); if (!hits.length) missing.push('Sammlung ' + c); hits.forEach(add); });
  (wantedList || []).forEach((w) => {
    const name = typeof w === 'string' ? w : w && w.name; if (!name || !String(name).trim()) return;
    const hit = find(cat, name);
    if (hit) return add(hit);
    missing.push(String(name));
    if (!seen[name]) { seen[name] = 1; skins.push({ name: String(name).trim(), weapon: '', tier: '', color: '', image: '', rank: 0, vp: 0 }); }
  });
  // Seltenste zuerst, darin nach Waffe und Name
  skins.sort((a, b) => b.rank - a.rank || a.weapon.localeCompare(b.weapon, 'de') || a.name.localeCompare(b.name, 'de'));
  // Geschaetzter Wert: Summe der ueblichen Shop-Preise; Skins ohne bekannte Stufe (z. B. Battlepass) zaehlen nicht mit
  const byTier = {}; let vp = 0, priced = 0;
  skins.forEach((s) => { if (!s.vp) return; vp += s.vp; priced++; const t = byTier[s.tier] || (byTier[s.tier] = { tier: s.tier, color: s.color, count: 0, vp: 0 }); t.count++; t.vp += s.vp; });
  const value = { vp, eur: Math.round(vp * EUR_JE_100_VP / 100), priced, unpriced: skins.length - priced, eurPer100Vp: EUR_JE_100_VP,
    tiers: Object.keys(byTier).map((k) => byTier[k]).sort((a, b) => b.vp - a.vp) };
  return { skins: skins.map((s) => ({ name: s.name, weapon: s.weapon, tier: s.tier, color: s.color, image: s.image, vp: s.vp })), missing, value };
}

const write = (file, s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 1) + '\n'); };
const summary = (lines) => { if (process.env.GITHUB_STEP_SUMMARY) try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Valorant-Skins\n' + lines.map((l) => '- ' + l).join('\n') + '\n'); } catch (e) { /* nur Hinweis */ } };

module.exports = { norm, catalog, find, findAll, resolve, sameWord };
if (require.main === module) (async () => {
  let wanted = [], collections = [];
  try { const j = JSON.parse(fs.readFileSync(IN, 'utf8')); wanted = Array.isArray(j) ? j : (j.skins || []); collections = (!Array.isArray(j) && j.sammlungen) || []; } catch (e) { console.log('meine-skins.json nicht lesbar: ' + e.message); }
  if (!wanted.length && !collections.length) { write(OUT, { skins: [] }); console.log('Keine Skins eingetragen (site/gaming/meine-skins.json).'); summary(['Keine Skins eingetragen (site/gaming/meine-skins.json)']); return; }
  try {
    const [de, en, tiers] = await Promise.all([get('/weapons?language=de-DE'), get('/weapons?language=en-US'), get('/contenttiers')]);
    const out = resolve(catalog({ 'de-DE': de, 'en-US': en }, tiers), wanted, collections);
    const data = { updated: new Date().toISOString(), skins: out.skins, missing: out.missing, value: out.value };
    write(OUT, data); write(CACHE, data);
    console.log('valorant-skins.json geschrieben: ' + out.skins.length + ' Skins, geschaetzt ' + out.value.vp + ' VP' + (out.missing.length ? ', nicht gefunden: ' + out.missing.join(', ') : ''));
    summary([out.skins.length + ' Skins, geschaetzter Wert ' + out.value.vp + ' VP (rund ' + out.value.eur + ' Euro)', out.missing.length ? 'Nicht gefunden (Schreibweise pruefen): ' + out.missing.join(', ') : 'Alle Namen gefunden']);
  } catch (e) {
    // Abruf gescheitert: letzter erfolgreicher Stand, sonst die Namen ohne Bild
    let cached = null; try { cached = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (x) { /* kein Stand */ }
    write(OUT, cached && cached.skins && cached.skins.length ? cached : { skins: wanted.map((w) => ({ name: typeof w === 'string' ? w : w.name, weapon: '', tier: '', color: '', image: '' })) });
    console.log('Valorant-Skins nicht aktualisiert: ' + e.message);
    summary(['Fehler: ' + e.message, cached ? 'Gezeigt wird der letzte Stand' : 'Gezeigt werden die Namen ohne Bild']);
  }
})();
