// Valorant-Katalog fuer die Gaming-Profile: alle Skins, Bundles und Agenten von valorant-api.com (ohne Schluessel).
// Ein Bundle umfasst alle Skins, deren Name die Woerter des Bundles enthaelt (wie tools/fetch-valorant-skins.js).
// Der Wert ist eine grobe Schaetzung ueber die Seltenheitsstufe (uebliche Shop-Preise in VP), kein Verkaufswert.
// Der verkleinerte Katalog wird eine Woche im Browser gespeichert (localStorage), damit nicht jedes Mal 0,5 MB laden.
(function () {
  'use strict';
  var API = 'https://valorant-api.com/v1', KEY = 'gp-valcat-v1', AGE = 7 * 864e5;
  var PREISE = { select: [875, 1750], deluxe: [1275, 2550], premium: [1775, 3550], exclusive: [2175, 4350], ultra: [2475, 4950] };
  var EUR_JE_100_VP = 1.05;
  var norm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); };
  var https = function (u) { return /^https:\/\//.test(u || '') ? u : ''; };
  function get(p) { return fetch(API + p).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) { return (j && j.data) || []; }); }

  function build(weapons, tiers, bundles, agents) {
    var tier = {};
    (tiers || []).forEach(function (t) { if (t && t.uuid) tier[t.uuid.toLowerCase()] = { n: String(t.devName || ''), c: /^[0-9a-f]{6}/i.test(t.highlightColor || '') ? '#' + t.highlightColor.slice(0, 6) : '', r: Number(t.rank) || 0 }; });
    var skins = [];
    (weapons || []).forEach(function (w) {
      var melee = /melee/i.test(w.category || '');
      (w.skins || []).forEach(function (s) {
        if (!s || !s.uuid || !s.displayName || /^(standard|zufälliger favorit|random favorite)/i.test(s.displayName)) return;
        var ch = (s.chromas || [])[0] || {}, lv = (s.levels || [])[0] || {}, t = tier[String(s.contentTierUuid || '').toLowerCase()] || {};
        skins.push({ id: s.uuid.toLowerCase(), n: s.displayName, w: w.displayName || '', i: https(s.displayIcon) || https(ch.fullRender) || https(ch.displayIcon) || https(lv.displayIcon),
          t: t.n || '', c: t.c || '', r: t.r || 0, m: melee ? 1 : 0 });
      });
    });
    return { at: Date.now(), skins: skins,
      bundles: (bundles || []).filter(function (b) { return b && b.uuid && b.displayName; }).map(function (b) { return { id: b.uuid.toLowerCase(), n: b.displayName, i: https(b.displayIcon) || https(b.displayIcon2) }; }),
      agents: (agents || []).filter(function (a) { return a && a.uuid && a.isPlayableCharacter !== false; }).map(function (a) { return { id: a.uuid.toLowerCase(), n: a.displayName, i: https(a.displayIcon), p: https(a.fullPortrait) || https(a.fullPortraitV2) }; })
        .sort(function (a, b) { return a.n.localeCompare(b.n, 'de'); }) };
  }

  var pending = null;
  function load() {
    if (pending) return pending;
    try { var c = JSON.parse(localStorage.getItem(KEY)); if (c && c.skins && Date.now() - c.at < AGE) return (pending = Promise.resolve(index(c))); } catch (e) { /* neu laden */ }
    pending = Promise.all([get('/weapons?language=de-DE'), get('/contenttiers'), get('/bundles?language=de-DE'), get('/agents?isPlayableCharacter=true&language=de-DE')])
      .then(function (r) { var c = build(r[0], r[1], r[2], r[3]); try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* zu gross oder gesperrt */ } return index(c); })
      .catch(function (e) { pending = null; throw e; });
    return pending;
  }
  function index(c) {
    c.byId = {}; c.skins.forEach(function (s) { s.k = norm(s.n); c.byId[s.id] = s; });
    c.bundleById = {}; c.bundles.forEach(function (b) { c.bundleById[b.id] = b; });
    c.agentById = {}; c.agents.forEach(function (a) { c.agentById[a.id] = a; });
    c.weapons = []; c.skins.forEach(function (s) { if (s.w && c.weapons.indexOf(s.w) < 0) c.weapons.push(s.w); });
    c.weapons.sort(function (a, b) { return a.localeCompare(b, 'de'); });
    return c;
  }
  // Skins eines Bundles: Name enthaelt alle Woerter des Bundles; ohne Treffer ohne Zahlwoerter wie "2.0"
  function bundleSkins(c, b) {
    var words = norm(b.n).split(' ').filter(Boolean); if (!words.length) return [];
    var has = function (ws, s) { var ns = s.k.split(' '); return ws.every(function (w) { return ns.indexOf(w) >= 0; }); };
    var hits = c.skins.filter(function (s) { return has(words, s); });
    if (!hits.length) { var core = words.filter(function (w) { return !/^\d+$/.test(w); }); if (core.length && core.length < words.length) hits = c.skins.filter(function (s) { return has(core, s); }); }
    return hits;
  }
  function price(s) { var p = PREISE[String(s.t || '').toLowerCase()]; return p ? p[s.m ? 1 : 0] : 0; }
  // Auswahl (gp_val_items) -> Format von valorant-skins.json: { skins: [...], value: {...} }
  function resolve(c, items) {
    var seen = {}, skins = [];
    var add = function (s) { if (!s || seen[s.id]) return; seen[s.id] = 1; skins.push(s); };
    (items || []).forEach(function (x) {
      if (x.kind === 'skin') add(c.byId[x.item]);
      else if (x.kind === 'bundle' && c.bundleById[x.item]) bundleSkins(c, c.bundleById[x.item]).forEach(add);
    });
    skins.sort(function (a, b) { return b.r - a.r || a.w.localeCompare(b.w, 'de') || a.n.localeCompare(b.n, 'de'); });
    var byTier = {}, vp = 0, priced = 0;
    skins.forEach(function (s) { var p = price(s); if (!p) return; vp += p; priced++; var t = byTier[s.t] || (byTier[s.t] = { tier: s.t, color: s.c, count: 0, vp: 0 }); t.count++; t.vp += p; });
    return {
      skins: skins.map(function (s) { return { name: s.n, weapon: s.w, tier: s.t, color: s.c, image: s.i, vp: price(s) }; }),
      value: { vp: vp, eur: Math.round(vp * EUR_JE_100_VP / 100), priced: priced, unpriced: skins.length - priced, eurPer100Vp: EUR_JE_100_VP,
        tiers: Object.keys(byTier).map(function (k) { return byTier[k]; }).sort(function (a, b) { return b.vp - a.vp; }) }
    };
  }
  window.ValCat = { load: load, resolve: resolve, bundleSkins: bundleSkins, norm: norm };
})();
