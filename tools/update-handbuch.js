// Gleicht die Mod-Liste des Handbuchs (site/cobblemon/handbuch/mods.json) mit dem Modpack ab.
// Neue Mods werden mit leerer Beschreibung ergaenzt, entfernte Mods gestrichen, Dateinamen und Seite (Server/Client) aktualisiert;
// von Hand gepflegte Felder (Name, Kategorie, Beschreibung, Links) bleiben erhalten.
// Start: node tools/update-handbuch.js [Modpack.mrpack] [mods.json]     (ohne Angaben: das Pack und die Datei im Repo)
// Die Modrinth-Seite jedes Mods wird auf der Webseite aus der Projekt-ID gebildet (steht in der Download-Adresse des Packs).
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const PACK = process.argv[2] || path.join(__dirname, '..', 'site', 'cobblemon', 'download', 'CobblemonServerPack.mrpack');
const OUT = process.argv[3] || path.join(__dirname, '..', 'site', 'cobblemon', 'handbuch', 'mods.json');

// Minimaler ZIP-Leser (mrpack ist ein ZIP): Liste der Dateien und Inhalt einzelner Dateien
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65600); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Keine gueltige ZIP-Datei: ' + PACK);
  const count = buf.readUInt16LE(eocd + 10), files = {};
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP-Verzeichnis beschaedigt');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    files[name] = () => {
      const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), raw = buf.subarray(start, start + csize);
      return method === 0 ? raw : zlib.inflateRawSync(raw);
    };
    p += 46 + nlen + elen + clen;
  }
  return files;
}

// "Cobblemon-neoforge-1.8.2+1.21.1.jar" -> "Cobblemon"; "yet_another_config_lib_v3-3.8.2..." -> "Yet Another Config Lib V3"
function guessName(file) {
  let b = file.replace(/\.(jar|zip)$/i, '').split(/[-_](?=\d|neoforge|NeoForge|mc\d)/)[0];
  return b.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

const zip = readZip(fs.readFileSync(PACK));
const index = JSON.parse(zip['modrinth.index.json']().toString('utf8'));
const found = []; // { id, file, side, kind }
for (const f of index.files) {
  const file = path.basename(f.path), m = (f.downloads && f.downloads[0] || '').match(/cdn\.modrinth\.com\/data\/([^/]+)\//);
  const server = f.env && f.env.server, client = f.env && f.env.client;
  const side = server === 'unsupported' ? 'client' : client === 'optional' ? 'optional-client' : 'both'; // nur Client | Server, Client optional | beide
  found.push({ id: m ? m[1] : 'file:' + file.replace(/[-_]?\d.*$/, '').toLowerCase(), file, side, kind: /^resourcepacks\//.test(f.path) ? 'resourcepack' : 'mod' });
}
for (const name of Object.keys(zip)) { // Mods, die direkt im Pack liegen (overrides), haben keine Modrinth-Adresse
  const m = name.match(/^overrides\/mods\/([^/]+\.jar)$/);
  if (m) found.push({ id: 'file:' + m[1].replace(/[-_]?\d.*$/, '').toLowerCase(), file: m[1], side: 'both', kind: 'mod', bundled: true });
}

let doc = { pack: {}, categories: [], mods: [] };
try { doc = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}
const byId = new Map(doc.mods.map((m) => [m.id, m]));
const added = [], removed = [], changed = [];
const mods = found.map((f) => {
  const old = byId.get(f.id);
  if (!old) { added.push(f.file); return { id: f.id, name: guessName(f.file), cat: 'other', side: f.side, kind: f.kind, file: f.file, text: '' }; }
  if (old.file !== f.file) changed.push(old.name + ': ' + old.file + ' -> ' + f.file);
  return Object.assign({}, old, { side: f.side, kind: f.kind, file: f.file });
});
for (const m of doc.mods) if (!found.some((f) => f.id === m.id)) removed.push(m.name);

doc.pack = { name: index.name, version: index.versionId, minecraft: index.dependencies.minecraft, neoforge: index.dependencies.neoforge };
doc.mods = mods;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
console.log(index.name + ' ' + index.versionId + ': ' + mods.length + ' Eintraege.');
if (added.length) console.log('NEU (bitte Name, Kategorie und Beschreibung in mods.json ergaenzen): ' + added.join(', '));
if (removed.length) console.log('Entfernt: ' + removed.join(', '));
if (changed.length) console.log('Neue Dateiversion: ' + changed.join('; '));
if (!added.length && !removed.length && !changed.length) console.log('Keine Aenderungen an der Mod-Liste.');
const blank = mods.filter((m) => !m.text).length;
if (blank) console.log(blank + ' Eintraege ohne Beschreibung.');
