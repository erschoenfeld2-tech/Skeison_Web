// Valorant-Katalog fuer die Gaming-Profile: alle Skins, Bundles, Battlepaesse und Agenten von valorant-api.com (ohne Schluessel).
// Bundles: welche Skins dazugehoeren, steht nicht in der Schnittstelle. Zugeordnet wird ueber den internen Codenamen
// (Bundle "StorefrontItem_Ninja2ThemeBundle" -> Theme "Theme_Ninja2_PrimaryAsset" -> alle Skins mit diesem Theme). So
// bleiben z. B. Kuronami (Ninja) und Kuronami 2 (Ninja2) getrennt, obwohl beide gleich heissen. Ohne Codenamen-Treffer:
// ein eindeutiges Theme gleichen Namens, sonst Skins, deren Name alle Woerter des Bundles enthaelt. Bundles ohne Skins
// (Kaertchen, Anhaenger, Sammel-Bundles) fallen weg.
// Battlepaesse (Vertraege der Saisons) listen ihre Skins selbst; sie werden wie Bundles gespeichert (gp_val_items, kind
// "bundle", Vertrags-UUID), damit die Datenbank unveraendert bleibt.
// Sprache: Deutsch oder Englisch (Namen von Riot), je Geraet gemerkt (localStorage gp-val-lang). Der verkleinerte Katalog
// wird je Sprache eine Woche im Browser gespeichert. Der Wert ist eine grobe Schaetzung, kein Verkaufswert.
(function () {
  'use strict';
  var API = 'https://valorant-api.com/v1', KEY = 'gp-valcat-v2-', AGE = 7 * 864e5, LANGS = { de: 'de-DE', en: 'en-US' };
  // uebliche Shop-Preise in VP je Seltenheitsstufe [Waffe, Nahkampf]; Battlepass: premiumVPCost des Vertrags (sonst 1000)
  var PREISE = { select: [875, 1750], deluxe: [1275, 2550], premium: [1775, 3550], exclusive: [2175, 4350], ultra: [2475, 4950] };
  var PASS_VP = 1000;
  // rund 100 Euro fuer 11.000 VP (groesstes VP-Paket im Shop)
  var EUR_JE_100_VP = 100 / 110;
  var norm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/[^a-z0-9]+/g, ' ').trim(); };
  var https = function (u) { return /^https:\/\//.test(u || '') ? u : ''; };
  var code = function (path, rx) { var m = String(path || '').split('/').pop().match(rx); return m ? m[1].toLowerCase().replace(/[^a-z0-9]/g, '') : ''; };
  function get(p) { return fetch(API + p).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) { return (j && j.data) || []; }); }

  var lang = 'de';
  try { if (localStorage.getItem('gp-val-lang') === 'en') lang = 'en'; } catch (e) { /* Standard Deutsch */ }

  // Namen lesbar machen: "ZÜNDUNG: AKT 1" -> "Zündung: Akt 1"; deutsche Skins heissen "Phantom – Kuronami" (Waffe zuerst),
  // angezeigt wird dann "Kuronami" mit der Waffe darunter
  function title(s) { s = String(s || '').trim(); return s === s.toUpperCase() && /[A-ZÄÖÜ]{3}/.test(s) ? s.toLowerCase().replace(/(^|[\s:(\/-])(\S)/g, function (m, a, b) { return a + b.toUpperCase(); }) : s; }
  // -> [Name, Waffe zum Anzeigen]; bei Nahkampf steht die Art vorne ("Messer – Prime" -> "Prime", "Messer")
  function short(name, weapon, melee) {
    var m = String(name).match(/^(.+?)\s+[–-]\s+(.+)$/);
    if (m && (melee || norm(m[1]) === norm(weapon))) return [m[2].trim(), melee ? m[1].trim() : weapon];
    return [String(name).trim(), weapon];
  }
  // Standard-Skins und "Zufaelliger Lieblingsskin" gehoeren nicht in die Auswahl
  var DEFAULT = /^(standard|zuf[aä]lliger (favorit|lieblingsskin)|random favorite)|[–-]\s*standard$/i;

  function build(r) {
    var weapons = r[0], tiers = r[1], bundles = r[2], agents = r[3], themes = r[4], contracts = r[5], seasons = r[6];
    var tier = {};
    (tiers || []).forEach(function (t) {
      if (t && t.uuid) tier[t.uuid.toLowerCase()] = { k: String(t.devName || '').toLowerCase(), n: String(t.displayName || t.devName || '').replace(/[-\s]?edition$/i, ''),
        c: /^[0-9a-f]{6}/i.test(t.highlightColor || '') ? '#' + t.highlightColor.slice(0, 6) : '', r: Number(t.rank) || 0 };
    });
    var skins = [], lvl = {};
    (weapons || []).forEach(function (w) {
      var melee = /melee/i.test(w.category || '');
      (w.skins || []).forEach(function (s) {
        if (!s || !s.uuid || !s.displayName || DEFAULT.test(s.displayName.trim()) || norm(s.displayName) === norm(w.displayName)) return;
        var id = s.uuid.toLowerCase(), ch = (s.chromas || [])[0] || {}, lv = (s.levels || [])[0] || {}, t = tier[String(s.contentTierUuid || '').toLowerCase()] || {};
        (s.levels || []).forEach(function (l) { if (l && l.uuid) lvl[l.uuid.toLowerCase()] = id; });
        var nm = short(s.displayName, w.displayName, melee);
        skins.push({ id: id, n: nm[0], wl: nm[1], full: s.displayName.trim(), w: w.displayName || '', i: https(s.displayIcon) || https(ch.fullRender) || https(ch.displayIcon) || https(lv.displayIcon),
          t: t.n || '', p: t.k || '', c: t.c || '', r: t.r || 0, m: melee ? 1 : 0, th: String(s.themeUuid || '').toLowerCase() });
      });
    });
    // Themes: Codename und Name -> Skins
    var byTheme = {}; skins.forEach(function (s) { if (s.th) (byTheme[s.th] = byTheme[s.th] || []).push(s.id); });
    var themeByCode = {}, themeByName = {};
    (themes || []).forEach(function (t) {
      var u = String(t.uuid || '').toLowerCase(); if (!byTheme[u]) return;
      var c = code(t.assetPath, /^Theme_(.+?)_PrimaryAsset/i); if (c) (themeByCode[c] = themeByCode[c] || []).push(u);
      var n = norm(t.displayName); if (n) (themeByName[n] = themeByName[n] || []).push(u);
    });
    var words = function (n) { return norm(n).split(' ').filter(Boolean); };
    var skinWords = skins.map(function (s) { return words(s.full + ' ' + s.n); });
    function bundleSkins(b) {
      var us = themeByCode[code(b.assetPath, /^StorefrontItem_(.+?)_?(?:Theme)?_?Bundle/i)] || [];
      if (!us.length) { var byN = themeByName[norm(b.displayName)] || []; if (byN.length === 1) us = byN; }
      if (us.length) return [].concat.apply([], us.map(function (u) { return byTheme[u]; }));
      var ws = words(b.displayName); if (!ws.length) return [];
      return skins.filter(function (s, i) { return ws.every(function (w) { return skinWords[i].indexOf(w) >= 0; }); }).map(function (s) { return s.id; });
    }
    var start = {}; (seasons || []).forEach(function (s) { if (s && s.uuid) start[s.uuid.toLowerCase()] = s.startTime || ''; });
    var passes = (contracts || []).filter(function (c) { return c && c.uuid && c.content && c.content.relationType === 'Season'; }).map(function (c) {
      var ids = [];
      (c.content.chapters || []).forEach(function (ch) {
        var rw = (ch.freeRewards || []).slice(); (ch.levels || []).forEach(function (l) { if (l.reward) rw.push(l.reward); });
        rw.forEach(function (x) { var s = x && x.type === 'EquippableSkinLevel' && lvl[String(x.uuid || '').toLowerCase()]; if (s && ids.indexOf(s) < 0) ids.push(s); });
      });
      return { id: c.uuid.toLowerCase(), n: title(c.displayName), i: https(c.displayIcon), s: ids, vp: Number(c.content.premiumVPCost) > 0 ? Number(c.content.premiumVPCost) : PASS_VP, at: start[String(c.content.relationUuid || '').toLowerCase()] || '' };
    }).filter(function (p) { return p.s.length; }).sort(function (a, b) { return b.at.localeCompare(a.at); });
    // Bild: der letzte Skin des Passes (meist der Nahkampf-Skin, das Highlight); die Vertragsbilder fehlen bei neueren Akten
    var skinById = {}; skins.forEach(function (s) { skinById[s.id] = s; });
    passes.forEach(function (p) { var last = skinById[p.s[p.s.length - 1]] || skinById[p.s[0]]; p.i = (last && last.i) || p.i; });
    return { at: Date.now(), skins: skins.map(function (s) { delete s.th; return s; }), passes: passes,
      bundles: (bundles || []).filter(function (b) { return b && b.uuid && b.displayName; })
        .map(function (b) { return { id: b.uuid.toLowerCase(), n: b.displayName.trim(), i: https(b.displayIcon) || https(b.displayIcon2), s: bundleSkins(b) }; })
        .filter(function (b) { return b.s.length; }),
      agents: (agents || []).filter(function (a) { return a && a.uuid && a.isPlayableCharacter !== false; }).map(function (a) { return { id: a.uuid.toLowerCase(), n: a.displayName, i: https(a.displayIcon), p: https(a.fullPortrait) || https(a.fullPortraitV2) }; })
        .sort(function (a, b) { return a.n.localeCompare(b.n, 'de'); }) };
  }

  var pending = {};
  function load(l) {
    l = LANGS[l] ? l : lang;
    if (pending[l]) return pending[l];
    try { var c = JSON.parse(localStorage.getItem(KEY + l)); if (c && c.skins && c.passes && Date.now() - c.at < AGE) return (pending[l] = Promise.resolve(index(c, l))); } catch (e) { /* neu laden */ }
    var q = '?language=' + LANGS[l];
    pending[l] = Promise.all([get('/weapons' + q), get('/contenttiers' + q), get('/bundles' + q), get('/agents?isPlayableCharacter=true&language=' + LANGS[l]), get('/themes'), get('/contracts' + q), get('/seasons')])
      .then(function (r) {
        var c = build(r);
        try { localStorage.removeItem('gp-valcat-v1'); localStorage.setItem(KEY + l, JSON.stringify(c)); } catch (e) { /* zu gross oder gesperrt */ }
        return index(c, l);
      })
      .catch(function (e) { pending[l] = null; throw e; });
    return pending[l];
  }
  function index(c, l) {
    c.lang = l;
    c.byId = {}; c.skins.forEach(function (s) { s.k = norm(s.full + ' ' + s.n + ' ' + s.w); c.byId[s.id] = s; });
    c.bundleById = {}; c.bundles.concat(c.passes).forEach(function (b) { b.k = norm(b.n); c.bundleById[b.id] = b; });
    c.passes.forEach(function (p) { p.pass = 1; });
    c.agentById = {}; c.agents.forEach(function (a) { c.agentById[a.id] = a; });
    c.weapons = []; c.skins.forEach(function (s) { if (s.w && c.weapons.indexOf(s.w) < 0) c.weapons.push(s.w); });
    c.weapons.sort(function (a, b) { return a.localeCompare(b, l); });
    return c;
  }
  // Suchwoerter der anderen Sprache dazunehmen (Suche nach "Vandal" oder "Kuronami" klappt in beiden Sprachen)
  function addAlt(c, other) {
    c.skins.forEach(function (s) { var o = other.byId[s.id]; if (o && s.k.indexOf(o.k) < 0) s.k += ' ' + o.k; });
    Object.keys(c.bundleById).forEach(function (id) { var o = other.bundleById[id], b = c.bundleById[id]; if (o && b.k.indexOf(o.k) < 0) b.k += ' ' + o.k; });
    return c;
  }
  function bundleSkins(c, b) { return (b && b.s || []).map(function (id) { return c.byId[id]; }).filter(Boolean); }
  function price(s) { var p = PREISE[s.p]; return p ? p[s.m ? 1 : 0] : 0; }
  // Auswahl (gp_val_items) -> Format von valorant-skins.json: { skins: [...], value: {...} }
  function resolve(c, items) {
    var seen = {}, skins = [], fromPass = {}, passes = [];
    var add = function (s) { if (!s || seen[s.id]) return; seen[s.id] = 1; skins.push(s); };
    (items || []).forEach(function (x) {
      if (x.kind === 'skin') add(c.byId[x.item]);
      else if (x.kind === 'bundle' && c.bundleById[x.item]) {
        var b = c.bundleById[x.item];
        if (b.pass) { passes.push(b); b.s.forEach(function (id) { fromPass[id] = 1; }); }
        bundleSkins(c, b).forEach(add);
      }
    });
    skins.sort(function (a, b) { return b.r - a.r || a.w.localeCompare(b.w, c.lang) || a.n.localeCompare(b.n, c.lang); });
    var byTier = {}, vp = 0, priced = 0, unpriced = 0;
    skins.forEach(function (s) {
      var p = fromPass[s.id] ? 0 : price(s);
      if (!p) { if (!fromPass[s.id]) unpriced++; return; }
      vp += p; priced++; var t = byTier[s.t] || (byTier[s.t] = { tier: s.t, color: s.c, count: 0, vp: 0 }); t.count++; t.vp += p;
    });
    if (passes.length) { var pv = passes.reduce(function (a, p) { return a + p.vp; }, 0); vp += pv; byTier.__pass = { tier: 'Battlepass', color: '', count: passes.length, vp: pv }; }
    return {
      skins: skins.map(function (s) { return { name: s.n, weapon: s.wl || s.w, group: s.w, tier: fromPass[s.id] ? 'Battlepass' : s.t, color: s.c, image: s.i, vp: fromPass[s.id] ? 0 : price(s) }; }),
      value: { vp: vp, eur: Math.round(vp * EUR_JE_100_VP / 100), priced: priced, passes: passes.length, unpriced: unpriced, eurPer100Vp: Math.round(EUR_JE_100_VP * 100) / 100,
        tiers: Object.keys(byTier).map(function (k) { return byTier[k]; }).sort(function (a, b) { return b.vp - a.vp; }) }
    };
  }
  window.ValCat = {
    load: load, resolve: resolve, bundleSkins: bundleSkins, norm: norm, addAlt: addAlt, price: price, PASS_VP: PASS_VP, EUR_JE_100_VP: EUR_JE_100_VP,
    get lang() { return lang; },
    setLang: function (l) { if (!LANGS[l]) return; lang = l; try { localStorage.setItem('gp-val-lang', l); } catch (e) { /* nur fuer diese Sitzung */ } }
  };
})();
