// Wunschliste: Startseite, Uebersicht, Listen mit Wunschkarten, Reservierungen, Freunde, Gruppen und Profil.
// Seiten werden per Adresse gewaehlt (./?liste=…, ./?seite=freunde …), damit Links und Zurueck-Taste funktionieren.
(function () {
  'use strict';
  var FX = window.FX || { reduced: false, toast: function () {}, reveal: function (e) { e.classList.add('in'); } };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var app = $('#app'), dlg = $('#dlg');
  var me = null, isAdmin = false, seq = 0;
  var authEl = $('#auth'), authHome = authEl.parentNode;
  var DISCORD = 'https://discord.gg/tjVKFGMRw7';

  // Benachrichtigungen gibt es nur in der Android-App (window.__wlApp kommt aus deren bridge.js)
  var NATIVE = /SkeisonWunschlisteApp\//.test(navigator.userAgent) || !!window.WL_FORCE_APP;
  // App-Modus: Android-App (Kennung im User-Agent) oder installierte Web-App; dort entfallen die Hinweise "Als App"
  var APP_MODE = NATIVE || !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  document.documentElement.classList.toggle('app-mode', APP_MODE);
  // Menueleiste unten wie in Social-Media-Apps: in der App und im Browser auf schmalen Bildschirmen (Handy).
  // TABS steuert auch den Aufbau der Uebersicht ("Aktuelle Listen" oben statt der Profilkarte).
  var MQ_NARROW = window.matchMedia ? matchMedia('(max-width: 760px)') : { matches: false };
  var TABS = false;
  function syncTabs() {
    var on = APP_MODE || MQ_NARROW.matches;
    if (on === TABS) return false;
    TABS = on; document.documentElement.classList.toggle('tabs', on);
    return true;
  }
  syncTabs();
  // Verknuepfte Wuensche (gleiche link_id auf mehreren eigenen Listen): erst verfuegbar, wenn die Datenbank
  // die Spalte kennt (supabase/wunschliste_linked_items.sql); bis dahin verhaelt sich alles wie frueher
  var LINKS = false;
  // Ausgeblendete Listen ("nicht mehr ankuendigen"): erscheinen nicht unter "Aktuelle Listen", "Bald anstehend" und in den
  // Erinnerungen, bleiben aber ueber die Listen-Uebersichten erreichbar. Gespeichert im Konto (wl_hidden_lists);
  // gibt es die Tabelle (noch) nicht, wie frueher nur auf diesem Geraet.
  var MUTE_KEY = 'wl-muted-lists', hiddenIds = null;
  function mutedLists() { try { return JSON.parse(localStorage.getItem(MUTE_KEY)) || []; } catch (e) { return []; } }
  function saveLocalMutes(m) { try { if (m.length) localStorage.setItem(MUTE_KEY, JSON.stringify(m)); else localStorage.removeItem(MUTE_KEY); } catch (e) {} }
  function isMuted(id) { return hiddenIds ? hiddenIds.indexOf(id) >= 0 : mutedLists().indexOf(id) >= 0; }
  async function loadHidden() {
    try {
      hiddenIds = (await Api.get('wl_hidden_lists', 'select=list_id')).map(function (x) { return x.list_id; });
      // Einmalig: bisher nur auf dem Geraet stumm geschaltete Listen ins Konto uebernehmen
      var local = mutedLists().filter(function (id) { return isId(id) && hiddenIds.indexOf(id) < 0; });
      if (local.length) {
        await Promise.all(local.map(function (id) {
          return Api.insert('wl_hidden_lists', { list_id: id }).then(function () { hiddenIds.push(id); }, function () {});
        }));
      }
      saveLocalMutes([]);
    } catch (e) { hiddenIds = null; }
  }
  async function setMuted(id, on) {
    if (hiddenIds) {
      if (on) await Api.insert('wl_hidden_lists', { list_id: id }); else await Api.remove('wl_hidden_lists', 'list_id=eq.' + id);
      hiddenIds = hiddenIds.filter(function (x) { return x !== id; });
      if (on) hiddenIds.push(id);
      return;
    }
    var m = mutedLists().filter(function (x) { return x !== id; });
    if (on) m.push(id);
    saveLocalMutes(m);
  }

  var THEMES = [
    { id: 'polarlicht', name: 'Polarlicht', desc: 'Nachthimmel mit Nordlicht und Glas-Karten' },
    { id: 'geschenkpapier', name: 'Geschenkpapier', desc: 'Packpapier, Schleife und Wünsche als Anhänger' },
    { id: 'pixel', name: 'Pixel-Inventar', desc: 'Retro-Pixel wie im Spiel, Herzenswünsche sind verzaubert' },
    { id: 'kaufhaus', name: 'Concept Store', desc: 'Klar und edel wie ein Online-Shop' },
    { id: 'magazin', name: 'Magazin', desc: 'Große Typo wie im Hochglanz-Katalog' },
    { id: 'weihnacht', name: 'Weihnachten', desc: 'Tannengrün, Rot und Gold mit Lichterkette' },
    { id: 'ostern', name: 'Ostern', desc: 'Zarte Pastellfarben und bunte Eier' },
    { id: 'herbst', name: 'Herbst', desc: 'Warme Laubfarben und fallende Blätter' },
    { id: 'winter', name: 'Verschneiter Winter', desc: 'Eisblau mit leise fallendem Schnee' },
    { id: 'gold', name: 'Schwarz & Gold', desc: 'Hochwertiges Schwarz mit goldenen Akzenten' },
    { id: 'sommer', name: 'Sommer', desc: 'Sonne, Himmelblau und sandige Wärme' },
    { id: 'barbie', name: 'Barbie-Pink', desc: 'Knallig pink, glitzernd und verspielt' }
  ];
  var CATEGORIES = ['Technik', 'Mode', 'Schuhe', 'Bücher', 'Spiele', 'Haushalt', 'Küche', 'Deko', 'Beauty', 'Sport', 'Outdoor', 'Hobby', 'Erlebnis', 'Gutschein', 'Spielzeug', 'Schmuck', 'Sonstiges'];
  // Grobe Vorkategorisierung: Stichwoerter im Titel (auch in zusammengesetzten Woertern wie "Wanderrucksack") und
  // typische Shops. Reihenfolge = Vorrang bei Gleichstand (z. B. "Laufschuhe" -> Schuhe statt Sport).
  var CAT_RULES = [
    ['Gutschein', /gutschein|gift ?card|geschenkkarte|guthabenkarte/, /^$/],
    ['Erlebnis', /erlebnis|ticket|konzert|eintritt|workshop|kochkurs|reise|urlaub|hotel|wellness|massage|kino|musical|festival|escape|fallschirm|ballonfahrt|freizeitpark|therme/, /jochen-schweizer|mydays|eventim|ticketmaster|booking|airbnb/],
    ['Schuhe', /schuh|sneaker|stiefel|boots|sandale|pantoffel|slipper|loafer|pumps|crocs|birkenstock/, /^$/],
    ['Spielzeug', /lego|duplo|playmobil|puppe|plüsch|kuscheltier|spielzeug|holzspiel|ferngesteuert|rc-auto|bauklötze|schleich|barbie|hot wheels|tonie/, /lego\.com|mytoys|smyths|tonies/],
    ['Spiele', /\bspiel\b|spiele\b|brettspiel|kartenspiel|puzzle|game|ps5|ps4|playstation|xbox|nintendo|switch 2|konsole|controller|gamepad|steam deck/, /steampowered|nintendo|playstation|xbox|spiele-offensive/],
    ['Bücher', /buch|bücher|roman|book|comic|manga|hörbuch|bildband|thriller|biografie|taschenbuch|hardcover/, /thalia|hugendubel|buecher|weltbild|audible/],
    ['Schmuck', /schmuck|\bkette\b|halskette|armband|\bring\b|ohrring|anhänger|armreif|brosche|perlen|\buhr\b|armbanduhr/, /pandora|thomas-?sabo|christ\.de|swarovski|purelei/],
    ['Beauty', /parf[uü]m|duft|creme|lippenstift|make-?up|mascara|nagellack|shampoo|serum|kosmetik|pflege|bodylotion|lidschatten|haartrockner|glätteisen|lockenstab/, /douglas|flaconi|sephora|rossmann|dm\.de|notino/],
    ['Technik', /kopfhörer|headphone|earbuds|airpods|laptop|notebook|tablet|ipad|iphone|smartphone|handy|kamera|camera|objektiv|monitor|tastatur|\bmaus\b|lautsprecher|speaker|bluetooth|\busb\b|ladegerät|powerbank|smartwatch|fernseher|\btv\b|beamer|drucker|router|\bssd\b|festplatte|grafikkarte|e-?reader|kindle|drohne|apple watch|garmin|echo dot|alexa|webcam|mikrofon/, /mediamarkt|saturn|cyberport|notebooksbilliger|alternate|apple\.com|conrad|galaxus/],
    ['Küche', /küche|kochtopf|\btopf\b|pfanne|messer|kaffeemaschine|espresso|siebträger|mixer|wasserkocher|toaster|airfryer|heißluftfritteuse|geschirr|tasse|becher|besteck|backform|schneidebrett|thermomix|kitchenaid|gewürz|teekanne|mühle/, /wmf|fissler|kochform/],
    ['Outdoor', /wander|zelt|schlafsack|rucksack|outdoor|camping|trekking|isomatte|stirnlampe|taschenlampe|kompass|hängematte|campingkocher|trinkflasche/, /globetrotter|bergfreunde|tatonka|deuter|jack-?wolfskin|campz/],
    ['Sport', /sport|fitness|hantel|kettlebell|yoga|fahrrad|\bbike\b|trikot|fußball|basketball|tennis|schläger|golf|\bski\b|snowboard|helm|protein|laufband|boxhandschuh|klettergurt|skateboard|inliner/, /decathlon|sportscheck|bike-discount|rose-?bikes/],
    ['Mode', /shirt|hemd|bluse|pullover|pulli|hoodie|jacke|mantel|\bhose\b|jeans|kleid|\brock\b|socken|mütze|\bschal\b|handschuhe|gürtel|handtasche|unterwäsche|\bbh\b|sweatshirt|cardigan|weste|kleidung|bademantel|pyjama|schlafanzug/, /zalando|aboutyou|asos|h&m|hm\.com|zara|uniqlo|snipes|bonprix/],
    ['Haushalt', /staubsauger|saugroboter|bügeleisen|handtuch|bettwäsche|bettdecke|kopfkissen|aufbewahrung|wäschekorb|putz|reinigung|werkzeug|bohrmaschine|akkuschrauber|luftreiniger|ventilator|heizlüfter/, /ikea|obi\.de|hornbach|bauhaus|toom/],
    ['Deko', /deko|kerze|vase|poster|bilderrahmen|\bbild\b|pflanze|monstera|lampe|leuchte|lichterkette|teppich|zierkissen|figur|wanduhr|kunstdruck|blumen/, /desenio|juniqe|depot|butlers|westwing/],
    ['Hobby', /malen|leinwand|pinsel|acrylfarbe|stricken|wolle|nähen|nähmaschine|gitarre|klavier|e-?piano|ukulele|instrument|modellbau|basteln|fotografie|garten|aquarium|teleskop|mikroskop|lötkolben|3d-drucker|angel/, /thomann|gerstaecker|idee-shop/]
  ];
  // Liefert die wahrscheinlichste Kategorie fuer Titel und Link oder '' (dann bleibt das Feld leer)
  function guessCategory(title, url) {
    var t = String(title || '').toLowerCase(), h = '', best = '', score = 0;
    try { var u = new URL(url); h = u.hostname.replace(/^www\./, ''); t += ' ' + decodeURIComponent(u.pathname).toLowerCase().replace(/[-_/]+/g, ' '); } catch (e) { /* kein Link */ }
    CAT_RULES.forEach(function (r) {
      var sc = (t.match(new RegExp(r[1].source, 'g')) || []).length * 2 + (h && r[2].source !== '^$' && r[2].test(h) ? 3 : 0);
      if (sc > score) { score = sc; best = r[0]; }
    });
    return best;
  }
  var PRICE_BANDS = [['', 'Jeder Preis'], ['0-25', 'bis 25 €'], ['25-50', '25 – 50 €'], ['50-100', '50 – 100 €'], ['100-250', '100 – 250 €'], ['250-', 'über 250 €'], ['none', 'ohne Preis']];
  var SORTS = [['prio', 'Wichtigste zuerst'], ['value', 'Wichtig & wertvoll zuerst'], ['cheap', 'Preis aufsteigend'], ['pricey', 'Preis absteigend'], ['cat', 'Nach Kategorie'], ['az', 'A – Z'], ['new', 'Neueste zuerst']];
  // Profil-Symbole: Gruppen mit Auswahl; Eintraege mit Varianten (Farben, Hauttoene) klappen nach dem Anklicken eine Auswahl auf
  var HEARTS = ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '🩷', '🩵', '🩶'];
  var VARIANTS = {
    '❤️': HEARTS, '💖': ['💖', '💗', '💓', '💞', '💕', '💘', '💝'], '⭐': ['⭐', '🌟', '💫', '✨', '🌠', '⚡'],
    '🔴': ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤'], '🟥': ['🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫'],
    '🌸': ['🌸', '🌹', '🌺', '🌻', '🌼', '🌷', '🪻', '💐'], '🦋': ['🦋', '🐝', '🐞', '🐛'],
    '👍': ['👍', '👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿'], '👋': ['👋', '👋🏻', '👋🏼', '👋🏽', '👋🏾', '👋🏿'], '🙌': ['🙌', '🙌🏻', '🙌🏼', '🙌🏽', '🙌🏾', '🙌🏿'],
    '💪': ['💪', '💪🏻', '💪🏼', '💪🏽', '💪🏾', '💪🏿'], '🧑': ['🧑', '🧑🏻', '🧑🏼', '🧑🏽', '🧑🏾', '🧑🏿'], '🧁': ['🧁', '🍰', '🎂', '🍩', '🍪']
  };
  var GLYPHS = '★ ♥ ✦ ✿ ❀ ☀ ☾ ♪ ♛ ✈ ☘ ❄ ♠ ♣ ♦ ✚ ☯ ✧ ❖ ✪ ⚑ ☂ ✂ ✎'.split(' ').map(function (g) { return g + '︎'; });
  var GLYPH_COLORS = ['#ffcb05', '#ff9f43', '#ff4d6d', '#ff5fa2', '#a55eea', '#5b85ff', '#2ec4ff', '#1abc9c', '#2ecc71', '#b8e35a', '#f5f5f5', '#8395a7'];
  var AV_CATS = [
    { id: 'top', label: '⭐ Beliebt', items: '🎁 🦊 🐻 🐼 🦄 🐙 🌻 🍀 🌈 🔥 ⚡ 🎮 🎧 📚 🎨 ⚽ 🚲 ✈️ 🍕 ☕ 👾 🧸 🐸'.split(' ') },
    { id: 'party', label: '🎉 Anlässe', items: '🎁 🎄 🎂 🎉 🎈 🎊 💍 🍼 🏡 🎓 🐣 🎃 🎅 ⛄ 💐 🥂'.split(' ') },
    { id: 'heart', label: '❤️ Herzen', items: ['❤️', '💖', '💝', '🧁', '💌', '💞'] },
    { id: 'star', label: '⭐ Sterne', items: ['⭐', '✨', '🌙', '☀️', '🌈', '☄️', '🪐', '🔮'] },
    { id: 'shape', label: '🔴 Farben', items: ['🔴', '🟥', '🔶', '🔷', '💠', '🔰', '🏵️', '🎯'] },
    { id: 'glyph', label: '✦ Symbole', glyphs: true },
    { id: 'face', label: '😀 Gesichter', items: '😀 😄 😎 🤩 😇 🥳 😴 🤓 🥰 😺 🤠 🧐 😈 👻 🤖 👽 🧑 🧙 🧚 🦸'.split(' ') },
    { id: 'hand', label: '👍 Hände', items: ['👍', '👋', '🙌', '💪', '🤞', '✌️', '🤟', '🫶'] },
    { id: 'animal', label: '🐾 Tiere', items: '🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐰 🐱 🐶 🦄 🐙 🦉 🦋 🐢 🐬 🦈 🐧 🦆 🦔 🐝'.split(' ') },
    { id: 'nature', label: '🌸 Natur', items: ['🌸', '🌻', '🍀', '🌵', '🌴', '🍁', '🍄', '🌊', '⛰️', '🌋', '🌲', '🪴'] },
    { id: 'food', label: '🍕 Essen', items: '🍕 🍔 🍟 🌮 🍣 🍜 🍩 🍪 🍫 🍓 🍒 🍉 🥑 🧀 ☕ 🍵 🍷 🍺'.split(' ') },
    { id: 'hobby', label: '🎮 Hobby', items: '🎮 🎧 🎸 🎹 🎬 📚 🎨 ⚽ 🏀 🎾 🚲 🏊 🎯 🎲 ♟️ 🧶 📷 ✈️ 🚗 🏕️'.split(' ') }
  ];
  var GROUP_EMOJIS = '👪 ❤️ 🏠 🎓 💼 ⚽ 🎮 🍻 🌍 ⭐ 👵 🧑‍🤝‍🧑'.split(' ');
  var COLORS = ['#ffcb05', '#ff6b6b', '#ff9f43', '#2ecc71', '#1abc9c', '#5b85ff', '#a55eea', '#ff5fa2', '#8395a7', '#e1b12c'];
  var RELATIONS = ['Mutter', 'Vater', 'Schwester', 'Bruder', 'Oma', 'Opa', 'Tante', 'Onkel', 'Cousin', 'Cousine', 'Nichte', 'Neffe',
    'Partner/in', 'Kind', 'Schwager', 'Schwägerin', 'Schwiegermutter', 'Schwiegervater', 'Pate/Patin', 'Beste/r Freund/in', 'Freund/in', 'Kolleg/in', 'Nachbar/in'];
  var OCCASIONS = ['Geburtstag', 'Weihnachten', 'Hochzeit', 'Ostern', 'Einzug', 'Baby', 'Jubiläum', 'Abschluss', 'Einfach so'];
  var PRIO = { 1: 'Wäre nett', 2: 'Wünsche ich mir', 3: 'Herzenswunsch' };
  var VIS = { private: '🔒 Nur du', friends: '👥 Alle Freunde', custom: '🎯 Ausgewählte' };
  // Profilspalten, die andere sehen duerfen (der Freundescode gehoert nicht dazu; den eigenen liefert wl_my_code)
  var PCOLS = 'id,name,avatar,color,theme,discoverable';

  // ---------- Helfer ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Geteilter Text aus Apps ("Echo Dot (5. Gen.) https://amzn.eu/d/abc"): Link herausziehen, Text davor als Titel-Vorschlag
  function splitShared(text) {
    text = String(text || '');
    var m = text.match(/https?:\/\/[^\s<>"']+/i);
    if (!m) return null;
    var before = text.slice(0, m.index).replace(/\s+/g, ' ').trim()
      .replace(/^(schau( dir)?( mal)?|sieh dir|guck( mal)?|check out|look at)[^:]{0,40}:\s*/i, '')
      .replace(/[\s:|–-]+$/, '').replace(/^["„“'»«]+|["„“'»«]+$/g, '').trim();
    return { url: m[0].replace(/[.,;!)\]]+$/, ''), title: before.length >= 3 ? before.slice(0, 120) : '' };
  }
  function safeUrl(u) { return /^https?:\/\/[^\s]+$/i.test(u || '') ? u : ''; }
  function isId(s) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || ''); }
  function money(v, cur) {
    if (v == null || v === '') return '';
    v = Number(v);
    try { return new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur || 'EUR', minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v); }
    catch (e) { return v + ' ' + cur; }
  }
  // Betraege je Waehrung addieren und als "120 € + 40 $" anzeigen (nie verschiedene Waehrungen zusammenwerfen)
  function sumCur(rows, val) { var o = {}; rows.forEach(function (r) { var v = val(r), c = r.currency || 'EUR'; if (v) o[c] = (o[c] || 0) + v; }); return o; }
  function fmtSums(o) {
    return Object.keys(o).sort(function (a, b) { return a === 'EUR' ? -1 : b === 'EUR' ? 1 : a < b ? -1 : 1; })
      .map(function (c) { return money(Math.round(o[c] * 100) / 100, c); }).join(' + ');
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function today() { var t = new Date(); t.setHours(0, 0, 0, 0); return t; }
  function asDate(s) { return new Date(s + 'T00:00:00'); }
  function daysUntil(s) { return Math.round((asDate(s) - today()) / 86400000); }
  function nextBirthday(s) {
    var b = asDate(s), t = today();
    // 29.02. wird in Nicht-Schaltjahren am 28.02. gefeiert (statt automatisch am 1. Maerz)
    function on(y) { var leap = new Date(y, 1, 29).getMonth() === 1; return new Date(y, b.getMonth(), b.getMonth() === 1 && b.getDate() === 29 && !leap ? 28 : b.getDate()); }
    var n = on(t.getFullYear());
    if (n < t) n = on(t.getFullYear() + 1);
    return { date: n, days: Math.round((n - t) / 86400000), age: n.getFullYear() - b.getFullYear() };
  }
  function fmtDate(d, year) { return (typeof d === 'string' ? asDate(d) : d).toLocaleDateString('de-DE', year ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' }); }
  function inDays(n) { return n === 0 ? 'heute' : n === 1 ? 'morgen' : n < 0 ? 'vor ' + -n + ' Tagen' : 'in ' + n + ' Tagen'; }
  function hue(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }
  // Symbole koennen eine Farbe tragen: "★|#ff4d6d"
  function glyph(v) {
    v = String(v || '🎁'); var i = v.indexOf('|');
    if (i > 0 && /^#[0-9a-fA-F]{6}$/.test(v.slice(i + 1))) return '<i class="g" style="color:' + v.slice(i + 1) + '">' + esc(v.slice(0, i)) + '</i>';
    return esc(v);
  }
  function avatar(p, cls) { return '<span class="av ' + (cls || '') + '" style="--c:' + esc(p.color) + '" aria-hidden="true">' + glyph(p.avatar) + '</span>'; }
  // Codes nur fuer das eigene Profil und die Admin-Uebersicht zeigen (withCode); bei Freunden bleiben sie verborgen,
  // damit niemand sie weitergeben kann
  function handle(p, withCode) { return esc(p.name) + (withCode && p.code ? '<span class="code">#' + esc(p.code) + '</span>' : ''); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function parsePrice(s) {
    s = String(s || '').replace(/[^\d.,]/g, '');
    if (!s) return null;
    // "1.500" und "1.234.567" sind deutsche Tausenderpunkte, "49,99" ein deutsches Komma, "1,299.00" englisch
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    else if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
    var n = parseFloat(s); return isFinite(n) && n >= 0 && n < 1e8 ? Math.round(n * 100) / 100 : null;
  }
  function vals(form) {
    var o = {};
    $$('input, select, textarea', form).forEach(function (el) {
      if (!el.name) return;
      if (el.type === 'checkbox') { if (el.hasAttribute('value')) { (o[el.name] = o[el.name] || []); if (el.checked) o[el.name].push(el.value); } else o[el.name] = el.checked; }
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
      else o[el.name] = el.value.trim();
    });
    return o;
  }

  var ERR = {
    invalid_credentials: 'E-Mail oder Passwort stimmt nicht.', 'Invalid login credentials': 'E-Mail oder Passwort stimmt nicht.',
    network: 'Keine Verbindung. Bitte später erneut versuchen.', exists: 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.',
    email: 'Bitte gib eine gültige E-Mail-Adresse ein.', password: 'Das Passwort braucht mindestens 8 Zeichen.', weak_password: 'Das Passwort ist zu schwach.',
    name: 'Der Anzeigename braucht 2–24 Zeichen und darf kein # enthalten.', invite: 'Der Einladungscode stimmt nicht.',
    rate: 'Zu viele Versuche. Bitte in einer Stunde erneut probieren.', already_reserved: 'Das hat gerade jemand anderes reserviert.',
    no_access: 'Diese Liste ist für dich nicht (mehr) freigegeben.', own_item: 'Eigene Wünsche kannst du nicht reservieren.',
    received: 'Dieser Wunsch wurde schon erfüllt.', bad_quantity: 'Diese Anzahl ist nicht möglich.', not_authenticated: 'Bitte melde dich erneut an.',
    not_friend: 'Vorschläge können nur Freunde machen, nicht Bekannte.', too_many_sizes: 'Mehr als 12 Größen sind nicht möglich.', too_many: 'Du hast hier schon 10 offene Vorschläge.',
    no_profile: 'Dein Profil wurde nicht gefunden. Bitte melde dich ab und wieder an.',
    not_admin: 'Dafür brauchst du Admin-Rechte.', self: 'Dein eigenes Konto kannst du hier nicht löschen.', is_admin: 'Admin-Konten können hier nicht gelöscht oder zurückgesetzt werden.',
    over_email_send_rate_limit: 'Zu viele Versuche. Bitte später erneut probieren.', same_password: 'Das ist schon dein aktuelles Passwort.'
  };
  function errText(e) {
    var c = (e && e.code) || '';
    if (ERR[c]) return ERR[c];
    if (/check constraint|violates/i.test(c)) return 'Eine Eingabe ist ungültig oder zu lang.';
    if (/relation .* does not exist|Could not find/i.test(c)) return 'Die Wunschliste ist noch nicht eingerichtet.';
    return 'Das hat nicht geklappt. Bitte erneut versuchen.';
  }
  // Nur ok/err umschalten; weitere Klassen (z. B. fetch-msg) bleiben, damit das Feld wiedergefunden wird
  function say(el, text, ok) { if (!el) return; el.textContent = text; el.classList.add('msg'); el.classList.toggle('ok', !!text && !!ok); el.classList.toggle('err', !!text && !ok); }
  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } finally { if (btn) btn.disabled = false; }
  }
  function copy(text, label) {
    var done = function () { FX.toast((label || 'Kopiert') + ': ' + text); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, function () { FX.toast(text); });
    else FX.toast(text);
  }
  // Design der Seite setzen; die Browserleiste (theme-color) uebernimmt die Hintergrundfarbe des Designs
  var metaColor = $('meta[name="theme-color"]');
  function syncChrome() {
    if (!metaColor) return;
    var c = getComputedStyle(document.body).getPropertyValue('--bg').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(c)) metaColor.setAttribute('content', c);
  }
  function modePref() { return window.WLMode ? WLMode.get() : 'auto'; }
  function setTheme(t) {
    if (t) document.body.setAttribute('data-theme', t); else document.body.removeAttribute('data-theme');
    syncChrome();
  }
  document.addEventListener('wl:mode', syncChrome);
  // Meldungen bleiben sichtbar, wenn ein Dialog oder die Swipe-Ansicht offen ist (die liegen ueber der Seite)
  var fxToast = FX.toast;
  FX.toast = function (text) {
    fxToast(text);
    var el = $('.toast:not(.act)'), top = layers.filter(function (l) { return l.open; }).pop() || document.body;
    if (el && el.parentNode !== top) top.appendChild(el);
  };
  // Kurzes Vibrieren als Rueckmeldung (Reservieren, Abhaken); ohne Unterstuetzung passiert nichts
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) {} }

  // Bilder, die nicht laden, durch einen Platzhalter ersetzen
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t.tagName === 'IMG' && t.hasAttribute('data-ph')) t.outerHTML = placeholder(t.getAttribute('data-ph'), t.getAttribute('alt'));
  }, true);
  function placeholder(emoji, seed) { return '<div class="ph" style="--h:' + hue(seed) + '" aria-hidden="true"><span>' + esc(emoji || '🎁') + '</span></div>'; }

  // ---------- Dialoge und Ebenen ----------
  // Zwei Ebenen: der Dialog (#dlg, auf dem Handy ein Blatt von unten) und die Swipe-Ansicht (#feed).
  // Jede offene Ebene bekommt einen Eintrag im Browser-Verlauf, damit "Zurueck" (Taste, Wischgeste) zuerst
  // die Ebene schliesst, statt die Seite zu verlassen.
  var feed = $('#feed'), layers = [], ignorePop = 0;
  function navState(extra) {
    var o = { k: Date.now().toString(36) + (++navSeq), g: guardOn ? 1 : 0 };
    if (extra) for (var x in extra) o[x] = extra[x];
    return o;
  }
  function openLayer(el) {
    if (!el.open) el.showModal();
    if (layers.indexOf(el) >= 0) return;
    layers.push(el);
    var st = history.state || {};
    history.pushState({ dlg: layers.length, k: st.k, g: st.g }, '');
  }
  function closeLayer(el) { var i = layers.indexOf(el); if (i >= 0) layers.splice(i, 1); if (el.open) el.close(); }
  function closeLayers() { layers.slice().reverse().forEach(closeLayer); }
  [dlg, feed].forEach(function (el) {
    el.addEventListener('close', function () {
      var depth = layers.indexOf(el) + 1;
      // kurz warten: eine Rueckfrage schliesst den Dialog und oeffnet ihn sofort wieder, dann bleibt der Eintrag
      setTimeout(function () {
        if (el.open) return;
        var i = layers.indexOf(el); if (i >= 0) { depth = i + 1; layers.splice(i, 1); }
        if (depth && (history.state || {}).dlg === depth) { ignorePop++; history.back(); }
      }, 0);
    });
    el.addEventListener('click', function (e) { if (e.target === el || e.target.closest('[data-close]')) el.close(); });
  });
  function openDlg(html, cls) {
    dlg.className = 'dlg ' + (cls || '');
    dlg.innerHTML = '<div class="dlg-grab" aria-hidden="true"></div><div class="dlg-in">' + html + '</div>';
    dlg.style.transform = '';
    openLayer(dlg);
    dlg.scrollTop = 0;
    var f = $('[autofocus]', dlg); if (f && !TABS) f.focus();
    return dlg;
  }
  function dlgHead(title) { return '<div class="dlg-head"><h2>' + title + '</h2><button type="button" class="x" data-close aria-label="Schließen">✕</button></div>'; }
  function confirmDlg(text, ok) {
    return new Promise(function (resolve) {
      openDlg(dlgHead('Sicher?') + '<p>' + esc(text) + '</p><div class="dlg-actions"><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="button" class="btn danger" id="cfOk">' + esc(ok) + '</button></div>', 'small');
      var answered = false;
      $('#cfOk', dlg).addEventListener('click', function () { answered = true; dlg.close(); resolve(true); });
      dlg.addEventListener('close', function once() { dlg.removeEventListener('close', once); if (!answered) resolve(false); });
    });
  }
  // Auswahlblatt wie in Social-Media-Apps: Liste grosser Eintraege, liefert die gewaehlte Aktion (oder null)
  function sheet(title, items) {
    return new Promise(function (resolve) {
      openDlg(dlgHead(title) + '<div class="sheet-list">' + items.map(function (x) {
        if (x.href) return '<a class="sheet-item" href="' + esc(x.href) + '" target="_blank" rel="noopener noreferrer" data-close><span>' + x.ico + '</span><b>' + x.label + '</b>' + (x.sub ? '<small>' + x.sub + '</small>' : '') + '</a>';
        return '<button type="button" class="sheet-item' + (x.danger ? ' danger-text' : '') + '" data-pick="' + esc(x.act) + '"><span>' + x.ico + '</span><b>' + x.label + '</b>' + (x.sub ? '<small>' + x.sub + '</small>' : '') + '</button>';
      }).join('') + '</div>', 'small sheet');
      var picked = null;
      $('.sheet-list', dlg).addEventListener('click', function (e) { var b = e.target.closest('[data-pick]'); if (!b) return; picked = b.dataset.pick; dlg.close(); });
      dlg.addEventListener('close', function once() { dlg.removeEventListener('close', once); resolve(picked); });
    });
  }
  // Blatt am Handy nach unten wegwischen (am Griff oder an der Kopfzeile)
  (function () {
    var y0 = null, dy = 0;
    dlg.addEventListener('touchstart', function (e) {
      if (!TABS || !e.target.closest('.dlg-grab, .dlg-head') || e.target.closest('button, a, input')) return;
      y0 = e.touches[0].clientY; dy = 0; dlg.style.transition = 'none';
    }, { passive: true });
    dlg.addEventListener('touchmove', function (e) {
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0); dlg.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: true });
    function end() {
      if (y0 === null) return;
      y0 = null; dlg.style.transition = '';
      if (dy > 90) dlg.close(); 
      dlg.style.transform = '';
    }
    dlg.addEventListener('touchend', end); dlg.addEventListener('touchcancel', end);
  })();

  // ---------- Navigation ----------
  var navSeq = 0, guardOn = !!(history.state && history.state.g), exitAt = 0, curPage = '', lastSearch = location.search, scrollMem = {};
  try { history.scrollRestoration = 'manual'; } catch (e) {}
  function route() {
    var q = new URLSearchParams(location.search);
    if (q.get('teilen')) return { page: 'teilen', id: q.get('teilen') };
    if (q.get('einladung')) return { page: 'einladung', id: q.get('einladung') };
    if (q.get('liste')) return { page: 'liste', id: q.get('liste') };
    return { page: q.get('seite') || 'home', id: q.get('id') };
  }
  function saveScroll() { var st = history.state; if (st && st.k) scrollMem[st.k] = window.scrollY; }
  function go(href, replace) {
    var st = history.state || {};
    saveScroll();
    // Steht gerade der Eintrag eines Dialogs oben (er wird fuer den Seitenwechsel geschlossen), wird er ersetzt
    if (replace || st.dlg) history.replaceState(navState(replace && st.guard ? { guard: 1 } : null), '', href); else history.pushState(navState(), '', href);
    lastSearch = location.search;
    render();
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="./"]');
    if (!a || e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || a.target) return;
    e.preventDefault();
    // Antippen des aktiven Reiters (oder der Marke auf der Uebersicht): nach oben scrollen statt neu laden
    var same = new URL(a.href, location.href).search === location.search && !layers.length;
    closeLayers();
    if (same && a.closest('.tabbar, .brand') && window.scrollY > 0) return window.scrollTo({ top: 0, behavior: FX.reduced ? 'auto' : 'smooth' });
    go(a.getAttribute('href'), same);   // dieselbe Seite: auffrischen, ohne den Verlauf zu stapeln
  });
  // Sprungmarken (#meine) scrollen nur; ein eigener Verlaufseintrag wuerde "Zurueck" scheinbar wirkungslos machen
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('#app a[href^="#"]');
    if (!a || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    var t = document.getElementById(a.getAttribute('href').slice(1));
    if (!t) return;
    e.preventDefault();
    t.scrollIntoView({ behavior: FX.reduced ? 'auto' : 'smooth' });
  }, true);
  window.addEventListener('popstate', function (e) {
    if (ignorePop) { ignorePop--; return; }
    var st = e.state || {};
    // Von der App ausgeloest (Rueckkehr in die App): nur Daten auffrischen
    if (!e.isTrusted) { if (!layers.length) render(); return; }
    // "Zurueck" bei offener Ebene: die oberste(n) schliessen
    if (layers.length > (st.dlg || 0)) {
      while (layers.length > (st.dlg || 0)) closeLayer(layers[layers.length - 1]);
      if (location.search === lastSearch) return;
    } else if (st.dlg) { history.back(); return; }      // uebrig gebliebener Dialog-Eintrag: ueberspringen
    if (st.guard && Api.user) return onGuard();
    if (location.search === lastSearch) return;         // nur eine Sprungmarke (#meine) hat sich geaendert
    lastSearch = location.search;
    var y = st.k ? scrollMem[st.k] : null;
    render().then(function () { if (y != null) window.scrollTo(0, y); });
  });

  // In der Wunschliste bleiben: Unter der ersten Seite liegt ein Waechter-Eintrag. "Zurueck" fuehrt von einer
  // Unterseite immer erst zur Uebersicht; erst ein zweites "Zurueck" dort verlaesst die Wunschliste (mit Hinweis).
  // Angelegt wird er bei der ersten Beruehrung (Browser lassen Verlaufs-Eintraege ohne Nutzeraktion ueberspringen).
  // In der Android-App gibt es nur die Uebersicht darunter: dort schliesst "Zurueck" auf der Uebersicht die App.
  function armGuard() {
    if (guardOn || !Api.user || !me || layers.length) return;
    var st = history.state || {};
    if (st.dlg || st.guard) return;
    var r = route();
    if (r.page === 'teilen' || r.page === 'einladung') return;
    guardOn = true;
    var url = location.pathname + location.search, k = st.k, deep = r.page !== 'home';
    if (!NATIVE) { history.replaceState({ guard: 1 }, '', './'); history.pushState(navState(), '', './'); }
    else if (deep) history.replaceState(navState(), '', './');
    if (deep) history.pushState(navState(), '', url);
    else if (NATIVE) history.replaceState(navState(), '', url);
    if (k && history.state) scrollMem[history.state.k] = scrollMem[k];
  }
  ['pointerup', 'keydown', 'touchend'].forEach(function (ev) { document.addEventListener(ev, armGuard, { passive: true, capture: true }); });
  function onGuard() {
    if (curPage !== 'home') {                           // von einer Unterseite: zur Uebersicht statt hinaus
      history.pushState(navState(), '', './'); lastSearch = location.search;
      render(); window.scrollTo(0, 0); return;
    }
    if (Date.now() - exitAt < 2600) { exitAt = 0; history.back(); return; }
    exitAt = Date.now();
    history.pushState(navState(), '', './'); lastSearch = location.search;
    FX.toast('Noch einmal zurück, um die Wunschliste zu verlassen');
  }
  MQ_NARROW.addEventListener && MQ_NARROW.addEventListener('change', function () { if (syncTabs() && Api.user && me && !layers.length) render(); });

  Api.onAuthChange(function () {
    me = null; isAdmin = false; lastSync = 0;
    if (!Api.user) sendNotify(null);   // abgemeldet: keine Erinnerungen mehr auf diesem Geraet
    closeLayers();
    lastSearch = location.search;
    render();
  });

  // App-Inhalte erscheinen sofort: Einblenden bei jedem Seitenwechsel hielt Listen und Wuensche zurueck
  // (data-stagger wird entfernt, damit nichts unsichtbar auf eine Einblendung wartet)
  function view(ctx, html) {
    if (ctx.stale()) return false;
    app.innerHTML = html.replace(/ data-stagger/g, '');
    return true;
  }
  function loading() { return '<div class="loading"><div class="sk" style="height:180px"></div><div class="grid3"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div></div>'; }

  async function render() {
    var my = ++seq, ctx = { stale: function () { return my !== seq; } };
    var signedIn = !!Api.user;
    document.body.classList.toggle('is-in', signedIn);
    if (!signedIn) document.body.classList.remove('is-locked');
    var r = route(), preview = !signedIn && (r.page === 'teilen' || r.page === 'einladung');
    curPage = r.page;
    document.body.classList.toggle('is-preview', preview);
    if (authEl.parentNode !== authHome) authHome.appendChild(authEl);
    if (preview) { app.onclick = app.onchange = app.oninput = app.onsubmit = null; app.setAttribute('data-page', r.page); return r.page === 'teilen' ? previewPage(ctx, r.id) : invitePreview(ctx, r.id); }
    if (!signedIn) { setTheme(null); landing(); return; }
    $$('[data-nav]').forEach(function (a) {
      var on = a.getAttribute('data-nav') === r.page || (r.page === 'freund' && a.getAttribute('data-nav') === 'freunde');
      a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var tab = { freund: 'freunde', freunde: 'freunde', geschenke: 'geschenke', profil: 'profil' }[r.page] || 'home';
    $$('#tabbar [data-tab]').forEach(function (a) {
      var on = a.getAttribute('data-tab') === tab;
      a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    app.onclick = app.onchange = app.oninput = app.onsubmit = app.onkeydown = null;
    if (!app.firstChild || app.getAttribute('data-page') !== r.page) app.innerHTML = loading();
    app.setAttribute('data-page', r.page);
    try {
      if (!me) {
        var uid = Api.user.id;
        var got = await Promise.all([Api.get('wl_profiles', 'id=eq.' + uid + '&select=' + PCOLS + ',must_change_password'), Api.rpc('wl_my_code'),
          Api.get('wl_admins', 'select=user_id&user_id=eq.' + uid)]);
        if (!got[0].length) throw Object.assign(new Error('no_profile'), { code: 'no_profile' });
        me = got[0][0]; me.code = got[1] || ''; isAdmin = got[2].length > 0;
        await Promise.all([loadMyExtras(), loadHidden(),
          Api.get('wl_items', 'select=link_id&limit=1').then(function () { LINKS = true; }, function () { LINKS = false; })]);
      }
      if (ctx.stale()) return;
      $('#adminLink').hidden = !isAdmin;
      document.body.classList.toggle('is-locked', me.must_change_password);
      if (me.must_change_password) return forcePassword(ctx);
      $('#meLink').innerHTML = avatar(me, 'xs') + '<span>' + esc(me.name) + '</span>';
      $('#tabAv').innerHTML = avatar(me, 'xs');
      $('#adminTop').hidden = !isAdmin;
      refreshBadge();
      await (VIEWS[r.page] || VIEWS.home)(ctx, r);
      if (!ctx.stale()) syncTabbar(r);
      syncNotifications(false);
    } catch (e) {
      if (ctx.stale() || !Api.user) return;
      setTheme(me && me.theme);
      app.innerHTML = '<div class="empty big"><span class="e-ico">😕</span><h2>Da ist etwas schiefgelaufen</h2><p>' + esc(errText(e)) + '</p><a class="btn" href="./">Zur Übersicht</a></div>';
    }
  }
  function refreshBadge() {
    Api.get('wl_friendships', 'select=requester&status=eq.pending&addressee=eq.' + me.id).then(function (rows) {
      [$('#reqBadge'), $('#tabReq')].forEach(function (b) { b.textContent = rows.length; b.hidden = !rows.length; });
    }).catch(function () {});
  }

  // ---------- Menueleiste unten (App) ----------
  // Das "+" passt sich der Seite an: in der eigenen Liste ein neuer Wunsch, in der Liste eines Freundes ein Vorschlag,
  // sonst eine neue Liste
  function plusTarget() {
    if (route().page !== 'liste') return null;
    return $('[data-act="add-item"]', app) || $('[data-act="suggest"]', app);
  }
  function syncTabbar() {
    var t = plusTarget(), b = $('#tabPlus');
    var label = t ? (t.dataset.act === 'add-item' ? 'Wunsch hinzufügen' : 'Vorschlag machen') : 'Neue Liste';
    b.setAttribute('aria-label', label); b.title = label;
  }
  $('#tabPlus').addEventListener('click', function () {
    if (!Api.user || !me) return;
    var t = plusTarget();
    if (t) t.click(); else listDialog(null);
  });

  // ---------- Daten ----------
  async function loadFriends() {
    var res = await Promise.all([Api.get('wl_friendships', 'select=*'), Api.get('wl_profiles', 'id=neq.' + me.id + '&select=' + PCOLS), Api.get('wl_contacts', 'select=*'), Api.get('wl_trust', 'select=person,level'),
      Api.get('wl_profile_private', 'id=neq.' + me.id), Api.get('wl_profile_sizes', 'profile=neq.' + me.id + '&order=sort.asc,created_at.asc')]);
    var byId = {}, cById = {}, lvl = {}, priv = {}, sizes = {}, out = { friends: [], incoming: [], outgoing: [] };
    res[4].forEach(function (x) { priv[x.id] = x; });
    res[5].forEach(function (x) { (sizes[x.profile] = sizes[x.profile] || []).push(x); });
    res[3].forEach(function (t) { lvl[t.person] = t.level; });
    res[1].forEach(function (p) { byId[p.id] = p; });
    res[2].forEach(function (c) { cById[c.friend] = c; });
    res[0].forEach(function (f) {
      var other = f.requester === me.id ? f.addressee : f.requester, p = byId[other];
      if (!p) return;
      p.contact = cById[other] || { relation: '', tags: [], note: '' };
      p.level = lvl[other] || 'friend';
      // Persönliches sieht man nur als Freund; Größen sehen auch Bekannte
      var pr = priv[other]; p.restricted = !pr;
      p.bio = pr ? pr.bio : ''; p.birthday = pr ? pr.birthday : null; p.likes = pr ? pr.likes : ''; p.dislikes = pr ? pr.dislikes : '';
      p.sizesList = sizes[other] || [];
      if (f.status === 'accepted') out.friends.push(p); else if (f.addressee === me.id) out.incoming.push(p); else out.outgoing.push(p);
    });
    out.friends.sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    return out;
  }
  async function loadMyExtras() {
    var r = await Promise.all([Api.get('wl_profile_private', 'id=eq.' + me.id), Api.get('wl_profile_sizes', 'profile=eq.' + me.id + '&order=sort.asc,created_at.asc')]);
    var pr = r[0][0] || {};
    me.bio = pr.bio || ''; me.birthday = pr.birthday || null; me.likes = pr.likes || ''; me.dislikes = pr.dislikes || ''; me.sizesList = r[1];
  }
  function loadGroups() { return Api.get('wl_groups', 'select=*,wl_group_members(member)&order=created_at'); }

  // ---------- Bausteine ----------
  function profileCard(p, opt) {
    opt = opt || {};
    var chips = [];
    if (p.birthday) { var b = nextBirthday(p.birthday); chips.push('<li><span>🎂</span>' + fmtDate(p.birthday) + ' <small>' + (b.days === 0 ? 'heute!' : inDays(b.days)) + '</small></li>'); }
    if (p.sizesList && p.sizesList.length) chips.push('<li><span>👕</span>' + p.sizesList.map(function (s) { return '<b>' + esc(s.label) + '</b> ' + esc(s.value); }).join(' · ') + '</li>');
    if (p.likes) chips.push('<li><span>💚</span>' + esc(p.likes) + '</li>');
    if (p.dislikes) chips.push('<li><span>🚫</span>' + esc(p.dislikes) + '</li>');
    if (p.restricted && !opt.self) chips.push('<li><span>🔒</span><small>Mehr zeigt ' + esc(p.name) + ' dir erst als Freund.</small></li>');
    var c = p.contact, label = c && (c.relation || (c.tags && c.tags.length))
      ? '<div class="pc-label" title="Nur für dich sichtbar">' + (c.relation ? '<b>' + esc(c.relation) + '</b>' : '') + (c.tags || []).map(function (t) { return '<span class="tagchip">' + esc(t) + '</span>'; }).join('') + '<small>🔒 nur für dich</small></div>' : '';
    return '<article class="pcard2 ' + (opt.big ? 'big' : '') + '" data-theme="' + esc(p.theme) + '">' +
      '<div class="pc-banner"><i></i><i></i></div>' +
      '<div class="pc-main">' + avatar(p, 'xl') +
      '<div class="pc-name"><h3>' + handle(p, opt.self) + '</h3>' + (opt.copy ? '<button type="button" class="link-btn" data-act="copy-handle">Code kopieren</button>' : '') + '</div>' +
      (p.bio ? '<p class="pc-bio">' + esc(p.bio) + '</p>' : opt.self ? '<p class="pc-bio muted">Noch keine Beschreibung. <a href="./?seite=profil">Profil ausfüllen</a></p>' : '') +
      label + (chips.length ? '<ul class="pc-facts">' + chips.join('') + '</ul>' : '') + '</div></article>';
  }

  // mode: 'mine' zeigt die Sichtbarkeit, 'owner' den Besitzer, sonst nichts davon
  function listCard(l, mode) {
    var n = l.wl_items && l.wl_items[0] ? l.wl_items[0].count : 0, d = l.event_date ? daysUntil(l.event_date) : null;
    return '<a class="lcard' + (l.archived ? ' archived' : '') + '" data-theme="' + esc(l.theme) + '" href="./?liste=' + l.id + '">' +
      '<span class="lc-emoji">' + esc(l.emoji) + '</span>' +
      '<span class="lc-body"><b>' + esc(l.title) + (isMuted(l.id) ? ' <span class="lc-muted" title="Ausgeblendet: wird nicht angekündigt">🔕</span>' : '') + '</b>' +
      '<small>' + [l.occasion && esc(l.occasion), l.event_date && (d >= 0 ? fmtDate(l.event_date) + ' · ' + inDays(d) : fmtDate(l.event_date, true)), plural(n, 'Wunsch', 'Wünsche')].filter(Boolean).join(' · ') + '</small>' +
      (mode === 'owner' ? '<span class="lc-owner">' + avatar(l.owner, 'xs') + esc(l.owner.name) + '</span>' : mode === 'mine' ? '<span class="lc-vis">' + (l.archived ? '📦 Archiviert' : VIS[l.visibility]) + '</span>' : '') +
      '</span>' + (d !== null && d >= 0 && d <= 30 ? '<span class="lc-cd"><b>' + d + '</b>' + (d === 1 ? 'Tag' : 'Tage') + '</span>' : '') + '</a>';
  }

  // Stand eines Wunsches aus Sicht des Betrachters: wer hat reserviert, wie viel ist noch frei
  function wishState(it, res) {
    var s = { res: res || [], mine: null, taken: 0, viaLink: false };
    s.res.forEach(function (r) { s.taken += r.quantity; if (r.mine) { s.mine = r; if (r.linked) s.viaLink = true; } });
    s.full = !it.group_gift && s.taken >= it.quantity;
    s.free = !it.received && (it.group_gift || s.taken < it.quantity);
    return s;
  }
  function wishCard(it, o) {
    o = o || {};
    var url = safeUrl(it.url), img = /^https:\/\//.test(it.image_url || '') ? it.image_url : '';
    var s = wishState(it, o.res), res = s.res, mine = s.mine, taken = s.taken, full = s.full;
    var title = url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(it.title) + '</a>' : esc(it.title);
    var more = '<button type="button" class="icon-btn more" data-act="more" aria-label="Weitere Aktionen" title="Weitere Aktionen">⋯</button>';
    var act = '';
    if (o.demo) act = '<button type="button" class="btn small" tabindex="-1">Reservieren</button>';
    else if (o.preview) act = it.received ? '<span class="state done">🎉 Schon erfüllt</span>' : '<button type="button" class="btn small" data-act="login">🔒 Anmelden zum ' + (it.group_gift ? 'Mitmachen' : 'Reservieren') + '</button>';
    else if (o.owner) {
      act = '<button type="button" class="btn small ghost" data-act="edit-item">Bearbeiten</button>' +
        '<button type="button" class="btn small ghost" data-act="toggle-received" title="Als erhalten markieren">' + (it.received ? '↩︎ Doch nicht' : '✓ Erhalten') + '</button>' + more;
    } else if (it.received) act = '<span class="state done">🎉 Schon erfüllt</span>' + more;
    else if (it.group_gift) {
      var names = res.map(function (r) { return r.mine ? 'du' : r.name; });
      act = (names.length ? '<span class="state gg">🧩 ' + esc(names.join(', ')) + (names.length === 1 && !mine ? ' macht' : ' machen') + ' mit</span>' : '') +
        (mine ? '<button type="button" class="btn small ghost" data-act="unreserve">Nicht mehr mitmachen</button>' : '<button type="button" class="btn small" data-act="reserve">Mitmachen</button>') + more;
    } else if (mine) {
      act = '<span class="state mine">✓ Von dir reserviert' + (it.quantity > 1 ? ' (' + mine.quantity + '×)' : '') + (s.viaLink ? ' <small>über eine andere Liste</small>' : '') + '</span>' +
        (taken < it.quantity ? '<button type="button" class="btn small ghost" data-act="reserve-more">+1</button>' : '') +
        '<button type="button" class="btn small ghost" data-act="unreserve">Freigeben</button>' + more;
    } else if (full) {
      act = '<span class="state taken">🔒 Reserviert von ' + esc(res.map(function (r) { return r.name; }).join(', ')) + '</span>' + more;
    } else {
      act = (taken ? '<span class="state part">Noch ' + (it.quantity - taken) + ' von ' + it.quantity + ' frei</span>' : '') + '<button type="button" class="btn small" data-act="reserve">🎁 Reservieren</button>' + more;
    }
    // Verknuepft: derselbe Wunsch steht auf weiteren eigenen Listen (nur der Besitzer sieht, auf welchen)
    var linkN = o.links ? o.links.length : 0;
    var live = !o.demo && !o.preview;
    return '<article class="wish p' + it.priority + (it.received ? ' got' : '') + (full && !o.owner && !mine ? ' taken' : '') + (mine ? ' mine' : '') + '" data-id="' + esc(it.id) + '">' +
      '<div class="wish-media"' + (live ? ' data-act="open" role="button" tabindex="0" aria-label="' + esc(it.title) + ' groß ansehen"' : '') + '>' +
      (img ? '<img src="' + esc(img) + '" alt="' + (live ? '' : esc(it.title)) + '" loading="lazy" referrerpolicy="no-referrer" data-ph="' + esc(o.emoji || '🎁') + '">' : placeholder(o.emoji, it.title)) +
      (it.price != null ? '<span class="price">' + esc(money(it.price, it.currency)) + '</span>' : '') +
      (it.priority === 3 ? '<span class="prio">♥ Herzenswunsch</span>' : '') +
      (it.quantity > 1 ? '<span class="qty">' + it.quantity + '×</span>' : '') + '</div>' +
      '<div class="wish-body"><h3>' + title + '</h3>' +
      (it.price != null ? '<p class="price-line">' + esc(money(it.price, it.currency)) + '</p>' : '') +
      (it.note ? '<p class="use"><span>Wofür</span>' + esc(it.note) + '</p>' : '') +
      '<div class="wish-meta"><span class="dots" title="' + PRIO[it.priority] + '">' + '●●●'.slice(0, it.priority) + '<i>' + '●●●'.slice(it.priority) + '</i> ' + PRIO[it.priority] + '</span>' +
      (url ? '<a class="shop" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(host(url)) + ' ↗</a>' : '') +
      (it.category ? '<span class="cat-tag">' + esc(it.category) + '</span>' : '') + (it.group_gift ? '<span class="gg-tag">🧩 Gruppengeschenk</span>' : '') +
      (linkN ? '<button type="button" class="link-tag" data-act="links" title="Derselbe Wunsch steht auf weiteren Listen. Wird er dort reserviert, gilt er auch hier als vergeben.">🔗 auch auf ' + plural(linkN, 'Liste', 'Listen') + '</button>' : '') + '</div>' +
      '<div class="wish-act">' + act + '</div></div></article>';
  }

  function themePicker(name, current) {
    return '<div class="tpicks">' + THEMES.map(function (t) {
      return '<label class="tpick" data-theme="' + t.id + '"><input type="radio" name="' + name + '" value="' + t.id + '"' + (t.id === current ? ' checked' : '') + '>' +
        '<span class="tp-prev"><i></i><i></i><i></i></span><b>' + t.name + '</b><small>' + t.desc + '</small></label>';
    }).join('') + '</div>';
  }
  function emojiPicker(name, list, current) {
    if (list.indexOf(current) < 0) list = [current].concat(list);
    return '<div class="epick">' + list.map(function (e) { return '<label><input type="radio" name="' + name + '" value="' + esc(e) + '"' + (e === current ? ' checked' : '') + '><span>' + esc(e) + '</span></label>'; }).join('') + '</div>';
  }
  // Auswahl mit Gruppen; nach dem Anklicken von Herzen, Sternen, Haenden usw. erscheint eine Variantenauswahl (Farben/Hauttoene),
  // bei Symbolen eine Farbauswahl. opt.glyphs = false blendet die farbigen Symbole aus (z. B. fuer Listen).
  function richPicker(name, current, opt) {
    opt = opt || {};
    var cats = AV_CATS.filter(function (c) { return opt.glyphs !== false || !c.glyphs; });
    return '<div class="rpick" data-glyphs="' + (opt.glyphs === false ? '0' : '1') + '" data-start="' + esc(opt.start || '') + '"><input type="hidden" name="' + name + '" value="' + esc(current) + '">' +
      '<div class="rhead"><span class="rcur" aria-live="polite"></span><div class="rtabs" role="tablist">' + cats.map(function (c, i) {
        return '<button type="button" role="tab" class="rtab' + (i ? '' : ' on') + '" data-cat="' + c.id + '">' + esc(c.label) + '</button>'; }).join('') + '</div></div>' +
      '<div class="rgrid"></div><div class="rvar" hidden></div></div>';
  }
  function bindPickers(scope) {
    $$('.rpick', scope).forEach(function (root) {
      var input = $('input', root), grid = $('.rgrid', root), vr = $('.rvar', root), cur = $('.rcur', root);
      var cats = AV_CATS.filter(function (c) { return root.dataset.glyphs !== '0' || !c.glyphs; }), catId = cats[0].id, base = null;
      function btn(v, label, extra) { return '<button type="button" class="ri' + (input.value === v ? ' on' : '') + '" data-v="' + esc(v) + '"' + (extra || '') + ' aria-pressed="' + (input.value === v) + '">' + label + '</button>'; }
      function paint() {
        var c = cats.filter(function (x) { return x.id === catId; })[0];
        grid.innerHTML = c.glyphs ? GLYPHS.map(function (g) { return btn(g, g, ' data-glyph="1"'); }).join('')
          : c.items.map(function (e) { return btn(e, esc(e), VARIANTS[e] ? ' data-var="1" title="Antippen für Varianten"' : ''); }).join('');
        cur.innerHTML = '<span class="av lg" style="--c:var(--accent)">' + glyph(input.value) + '</span>';
        $$('.rtab', root).forEach(function (t) { t.classList.toggle('on', t.dataset.cat === catId); });
      }
      function set(v) { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); paint(); }
      function variants(v) {
        if (!VARIANTS[v] && !/︎$/.test(v)) { vr.hidden = true; return; }
        vr.hidden = false;
        if (VARIANTS[v]) vr.innerHTML = '<small class="muted">Variante wählen</small>' + VARIANTS[v].map(function (x) { return '<button type="button" class="ri sm' + (input.value === x ? ' on' : '') + '" data-v="' + esc(x) + '">' + esc(x) + '</button>'; }).join('');
        else vr.innerHTML = '<small class="muted">Farbe wählen</small>' + GLYPH_COLORS.map(function (c) { return '<button type="button" class="ri sm col' + (input.value === v + '|' + c ? ' on' : '') + '" data-c="' + c + '" style="--c:' + c + '" aria-label="Farbe ' + c + '"><i style="background:' + c + '"></i></button>'; }).join('');
        vr.dataset.base = v;
      }
      root.addEventListener('click', function (e) {
        var t = e.target.closest('button'); if (!t) return;
        if (t.classList.contains('rtab')) { catId = t.dataset.cat; vr.hidden = true; return paint(); }
        if (t.dataset.c) { set(vr.dataset.base + '|' + t.dataset.c); return variants(vr.dataset.base); }
        if (t.dataset.v == null) return;
        var v = t.dataset.v, inVar = !!t.closest('.rvar');
        if (t.dataset.glyph) { set(v + '|' + GLYPH_COLORS[0]); return variants(v); }
        set(v); if (!inVar) variants(v); else { $$('.rvar .ri', root).forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); }); }
      });
      // Start-Reiter: der mit dem aktuellen Symbol (bevorzugt der gewuenschte Start-Reiter), sonst der Start-Reiter
      function has(c, v) { return !!c.items && c.items.some(function (e) { return e === v || (VARIANTS[e] && VARIANTS[e].indexOf(v) >= 0); }); }
      var start = cats.filter(function (c) { return c.id === root.dataset.start; })[0] || cats[0];
      var cv = input.value, glyphCat = cats.filter(function (c) { return c.glyphs; })[0];
      if (cv.indexOf('|') > 0 && glyphCat) { catId = glyphCat.id; base = cv.split('|')[0]; }
      else catId = (has(start, cv) ? start : cats.filter(function (c) { return has(c, cv); })[0] || start).id;
      paint(); if (base) variants(base);
    });
  }
  function colorPicker(name, current) {
    return '<div class="cpick">' + COLORS.map(function (c) { return '<label style="--c:' + c + '"><input type="radio" name="' + name + '" value="' + c + '"' + (c === current ? ' checked' : '') + ' aria-label="Farbe ' + c + '"><span></span></label>'; }).join('') + '</div>';
  }
  function emptyBox(ico, title, text, action) { return '<div class="empty"><span class="e-ico">' + ico + '</span><h3>' + title + '</h3><p>' + text + '</p>' + (action || '') + '</div>'; }

  // ---------- Uebersicht ----------
  async function home(ctx) {
    var res = await Promise.all([
      Api.get('wl_lists', 'owner=eq.' + me.id + '&select=*,wl_items(count)&order=archived.asc,created_at.desc'),
      Api.get('wl_lists', 'owner=neq.' + me.id + '&archived=is.false&select=*,owner:wl_profiles!wl_lists_owner_fkey(id,name,avatar,color),wl_items(count)&order=event_date.asc.nullslast,created_at.desc'),
      loadFriends(), Api.rpc('wl_my_reservations')
    ]);
    var mine = res[0], others = res[1], fr = res[2], gifts = res[3];
    setTheme(me.theme);
    var open = gifts.filter(function (g) { return !g.purchased; }).length;
    var ev = [];
    fr.friends.forEach(function (f) {
      if (!f.birthday) return;
      var b = nextBirthday(f.birthday);
      if (b.days <= 60) ev.push({ days: b.days, ico: f.avatar, color: f.color, title: esc(f.name) + ' hat Geburtstag', sub: fmtDate(b.date), href: './?seite=freund&id=' + f.id });
    });
    var active = others.concat(mine.filter(function (l) { return !l.archived; })).filter(function (l) { return !isMuted(l.id); });
    active.forEach(function (l) {
      if (!l.event_date) return;
      var d = daysUntil(l.event_date);
      if (d >= 0 && d <= 90) ev.push({ days: d, ico: l.emoji, title: esc(l.title), sub: (l.owner && l.owner.name ? esc(l.owner.name) + ' · ' : 'Deine Liste · ') + fmtDate(l.event_date), href: './?liste=' + l.id });
    });
    ev.sort(function (a, b) { return a.days - b.days; });

    // App: oben die Listen, die gerade wichtig sind (naechstes Datum zuerst), statt der Profilkarte (die steht unter "Profil").
    // Ohne kommende Termine die zuletzt angelegten. Ausgeblendete und archivierte Listen fehlen hier bewusst.
    var current = '';
    if (TABS) {
      var soon = active.filter(function (l) { return l.event_date && daysUntil(l.event_date) >= 0; })
        .sort(function (a, b) { return a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : 0; });
      var pick = soon.length ? soon.slice(0, 6) : active.slice().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }).slice(0, 4);
      current = '<section class="current"><div class="sec-head"><h2>' + (soon.length ? '📅 Aktuelle Listen' : '🆕 Zuletzt angelegt') + '</h2>' +
        (active.length > pick.length ? '<a class="more-link" href="#meine">Alle Listen <span class="arr">→</span></a>' : '') + '</div>' +
        (pick.length ? '<div class="lgrid" data-stagger>' + pick.map(function (l) { return listCard(l, l.owner && l.owner.id !== me.id ? 'owner' : 'mine'); }).join('') + '</div>'
          : emptyBox('📝', 'Gerade nichts angekündigt', 'Leg eine Liste an oder schau bei deinen Freunden vorbei.', '<button type="button" class="btn" data-act="new-list">+ Neue Liste</button>')) + '</section>';
    }
    var hello = new Date().getHours() < 11 ? 'Guten Morgen' : new Date().getHours() < 18 ? 'Hallo' : 'Guten Abend';
    view(ctx,
      '<header class="page-head"><p class="eyebrow">' + hello + ', ' + esc(me.name) + '</p><h1>Deine Wunschwelt</h1></header>' +
      (fr.incoming.length ? '<a class="banner" href="./?seite=freunde"><span>🤝</span><b>' + plural(fr.incoming.length, 'neue Freundschaftsanfrage', 'neue Freundschaftsanfragen') + '</b><span class="arr">→</span></a>' : '') +
      current +
      '<div class="home-top' + (TABS ? ' solo' : '') + '" data-stagger>' + (TABS ? '' : profileCard(me, { self: true, copy: true })) +
      '<div class="tiles">' +
      '<a class="tile" href="#meine"><b>' + mine.length + '</b><span>' + (mine.length === 1 ? 'Liste' : 'Listen') + '</span></a>' +
      '<a class="tile" href="./?seite=freunde"><b>' + fr.friends.length + '</b><span>' + (fr.friends.length === 1 ? 'Freund' : 'Freunde') + '</span></a>' +
      '<a class="tile" href="./?seite=geschenke"><b>' + open + '</b><span>noch zu besorgen</span></a>' +
      '<div class="tile soon"><h3>Bald anstehend</h3>' + (ev.length ? '<ul class="events">' + ev.slice(0, 5).map(function (e) {
        return '<li><a href="' + e.href + '"><span class="ev-ico"' + (e.color ? ' style="--c:' + esc(e.color) + '"' : '') + '>' + glyph(e.ico) + '</span><span><b>' + e.title + '</b><small>' + e.sub + '</small></span><em>' + inDays(e.days) + '</em></a></li>';
      }).join('') + '</ul>' : '<p class="muted">Keine Anlässe in den nächsten Wochen. Trag Geburtstage im Profil und Daten bei Listen ein.</p>') + '</div>' +
      '</div></div>' +
      '<section id="meine"><div class="sec-head"><h2>Meine Listen</h2><button type="button" class="btn" data-act="new-list">+ Neue Liste</button></div>' +
      (mine.length ? '<div class="lgrid" data-stagger>' + mine.map(function (l) { return listCard(l, 'mine'); }).join('') + '</div>'
        : emptyBox('📝', 'Noch keine Liste', 'Leg deine erste Wunschliste an, z. B. für deinen Geburtstag oder Weihnachten.', '<button type="button" class="btn" data-act="new-list">Erste Liste anlegen</button>')) + '</section>' +
      '<section><div class="sec-head"><h2>Listen deiner Freunde</h2><a class="more-link" href="./?seite=freunde">Freunde verwalten <span class="arr">→</span></a></div>' +
      (others.length ? '<div class="lgrid" data-stagger>' + others.map(function (l) { return listCard(l, 'owner'); }).join('') + '</div>'
        : emptyBox('🔭', 'Noch nichts zu sehen', fr.friends.length ? 'Deine Freunde haben noch keine Liste für dich freigegeben.' : 'Füge Freunde mit ihrem Namen und Code hinzu, dann siehst du hier ihre freigegebenen Listen.', '<a class="btn ghost" href="./?seite=freunde">Freunde hinzufügen</a>')) + '</section>');
    app.onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'new-list') listDialog(null);
      if (b.dataset.act === 'copy-handle') copy(me.name + '#' + me.code, 'Code kopiert');
    };
  }

  // ---------- Liste ----------
  // Fehlende Bilder automatisch nachladen: Auf eigenen Listen fragt die Seite fuer Wuensche mit Link, aber ohne Bild,
  // im Hintergrund die Link-Vorschau und traegt ein gefundenes Bild ein, nur wenn noch keins existiert.
  // Hoechstens 6 pro Aufruf; was nichts liefert, wird auf diesem Geraet 3 Tage lang nicht erneut versucht.
  var IMG_TRIED_KEY = 'wl-img-tried';
  function triedImages() { try { return JSON.parse(localStorage.getItem(IMG_TRIED_KEY)) || {}; } catch (e) { return {}; } }
  async function fillMissingImages(st) {
    var tried = triedImages(), now = Date.now(), changed = 0;
    Object.keys(tried).forEach(function (id) { if (now - tried[id] > 3 * 864e5) delete tried[id]; });
    var todo = st.items.filter(function (it) { return !it.image_url && safeUrl(it.url) && !tried[it.id]; }).slice(0, 6);
    for (var i = 0; i < todo.length; i++) {
      if (st.ctx.stale()) break;
      var it = todo[i];
      try {
        var p = await Api.fn('wl-link-preview', { url: it.url });
        if (p && /^https:\/\//.test(p.image || '') && p.image.length <= 2000) {
          var out = await Api.update('wl_items', 'id=eq.' + it.id + '&image_url=is.null', { image_url: p.image });
          if (out && out.length) { it.image_url = p.image; changed++; continue; }
        }
      } catch (e) { /* zaehlt als Versuch, in 3 Tagen erneut */ }
      tried[it.id] = now;
    }
    try { localStorage.setItem(IMG_TRIED_KEY, JSON.stringify(tried)); } catch (e) {}
    if (changed && !st.ctx.stale()) {
      paintResults(st);
      FX.toast('🖼 ' + plural(changed, 'Bild', 'Bilder') + ' automatisch ergänzt');
    }
  }

  async function listPage(ctx, r) {
    if (!isId(r.id)) throw Object.assign(new Error('no_access'), { code: 'no_access' });
    var rows = await Api.get('wl_lists', 'id=eq.' + r.id + '&select=*,owner:wl_profiles!wl_lists_owner_fkey(id,name,avatar,color,theme)');
    if (!rows.length) throw Object.assign(new Error('no_access'), { code: 'no_access' });
    var st = { list: rows[0], sort: 'prio', f: { q: '', cat: '', prio: '', price: '', only: false }, ctx: ctx, links: {}, dups: [] };
    st.owner = st.list.owner.id === me.id;
    await loadListData(st);
    paintList(st, false);
    if (st.owner) { fillMissingImages(st); findDuplicates(st); }
    app.onclick = function (e) { listAction(e, st); };
    app.onkeydown = function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.wish-media[data-act]')) { e.preventDefault(); listAction(e, st); }
    };
    app.onchange = function (e) {
      var n = e.target.name;
      if (n === 'sort') st.sort = e.target.value;
      else if (n === 'only') st.f.only = e.target.checked;
      else if (n === 'prio' || n === 'price') st.f[n] = e.target.value;
      else return;
      paintList(st, true);
    };
    app.oninput = function (e) {
      if (e.target.name !== 'q') return;
      st.f.q = e.target.value; paintResults(st);
    };
  }
  async function loadListData(st) {
    var res = await Promise.all([
      Api.get('wl_items', 'list_id=eq.' + st.list.id + '&order=priority.desc,created_at.asc'),
      st.owner ? Promise.resolve([]) : Api.rpc('wl_list_reservations', { p_list: st.list.id }),
      st.owner && st.list.visibility !== 'private' ? Promise.all([
        Api.get('wl_list_groups', 'list_id=eq.' + st.list.id + '&select=group:wl_groups(name,emoji)'),
        Api.get('wl_list_people', 'list_id=eq.' + st.list.id + '&select=person:wl_profiles(name)')]) : Promise.resolve(null),
      st.owner ? Api.get('wl_suggestions', 'list_id=eq.' + st.list.id + '&select=*,author:wl_profiles!wl_suggestions_author_fkey(name,avatar,color)&order=created_at') : Promise.resolve([]),
      st.owner ? Promise.resolve(false) : Api.rpc('wl_can_suggest', { p_list: st.list.id }).catch(function () { return false; })
    ]);
    st.sugg = res[3]; st.canSuggest = !!res[4];
    st.items = res[0];
    st.res = {};
    res[1].forEach(function (x) { (st.res[x.item_id] = st.res[x.item_id] || []).push(x); });
    st.share = res[2] ? res[2][0].map(function (g) { return g.group.emoji + ' ' + g.group.name; }).concat(res[2][1].map(function (p) { return p.person.name; })) : null;
    // Verknuepfte Kopien auf den anderen eigenen Listen (nur der Besitzer sieht, wo ein Wunsch noch steht)
    st.links = {};
    var lids = [];
    st.items.forEach(function (it) { if (it.link_id && lids.indexOf(it.link_id) < 0) lids.push(it.link_id); });
    if (st.owner && LINKS && lids.length) {
      var others = await Api.get('wl_items', 'link_id=in.(' + lids.join(',') + ')&list_id=neq.' + st.list.id + '&select=id,list_id,link_id,list:wl_lists(id,title,emoji,owner)').catch(function () { return []; });
      others.forEach(function (x) { if (x.list && x.list.owner === me.id) (st.links[x.link_id] = st.links[x.link_id] || []).push(x); });
    }
  }
  function linksOf(st, it) { return (it && it.link_id && st.links[it.link_id]) || []; }
  // Liste und (falls offen) die Swipe-Ansicht nach einer Aenderung neu laden und zeichnen
  async function refreshList(st) {
    await loadListData(st).catch(function () {});
    if (st.ctx.stale()) return;
    if (st.dups.length) st.dups = st.dups.filter(function (d) { var it = st.items.filter(function (x) { return x.id === d.it.id; })[0]; if (it) d.it = it; return !!it; });
    paintList(st, true);
    if (feed.open && feedSt === st) paintFeed(st, feedCurrent());
  }

  // ---------- Doppelte Wuensche finden: gleicher Link oder gleicher Titel auf einer anderen eigenen Liste ----------
  var DUP_KEY = 'wl-dup-ignored';
  function dupIgnored() { try { return JSON.parse(localStorage.getItem(DUP_KEY)) || []; } catch (e) { return []; } }
  function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function urlKey(u) {
    try {
      var x = new URL(u), q = [];
      x.searchParams.forEach(function (v, k) { if (!/^(utm_|ref|tag$|fbclid|gclid|mc_|pf_rd|psc$|th$|linkCode|_encoding|smid|spm|aff)/i.test(k)) q.push(k + '=' + v); });
      return x.hostname.replace(/^www\./, '').toLowerCase() + x.pathname.replace(/\/+$/, '') + (q.length ? '?' + q.sort().join('&') : '');
    } catch (e) { return ''; }
  }
  function titleKey(t) { t = String(t || '').toLowerCase().replace(/\s+/g, ' ').trim(); return t.length >= 4 ? t : ''; }
  async function findDuplicates(st) {
    if (!LINKS || !st.items.length) return;
    try {
      var lists = (await Api.get('wl_lists', 'owner=eq.' + me.id + '&select=id,title,emoji')).filter(function (l) { return l.id !== st.list.id; });
      if (!lists.length) return;
      var byList = {}; lists.forEach(function (l) { byList[l.id] = l; });
      var others = await Api.get('wl_items', 'list_id=in.(' + lists.map(function (l) { return l.id; }).join(',') + ')&select=id,list_id,title,url,link_id');
      if (st.ctx.stale()) return;
      var ign = dupIgnored(), dups = [];
      st.items.forEach(function (it) {
        var uk = urlKey(it.url), tk = titleKey(it.title);
        var m = others.filter(function (o) {
          if (it.link_id && o.link_id === it.link_id) return false;
          if (ign.indexOf(pairKey(it.id, o.id)) >= 0) return false;
          return (uk && uk === urlKey(o.url)) || (tk && tk === titleKey(o.title));
        }).map(function (o) { return { id: o.id, title: o.title, list: byList[o.list_id] }; });
        if (m.length) dups.push({ it: it, others: m });
      });
      st.dups = dups;
      if (dups.length) paintList(st, true);
    } catch (e) { /* nur ein Hinweis; ohne ihn funktioniert alles weiter */ }
  }
  function dupDialog(st) {
    function paint() {
      if (!st.dups.length) { if (dlg.open) dlg.close(); return; }
      openDlg(dlgHead('🔗 Gleiche Wünsche verknüpfen') +
        '<p class="muted">Diese Wünsche stehen auch auf einer anderen deiner Listen. <b>Verknüpft</b> zählen sie als ein Wunsch: Reserviert ihn jemand auf einer Liste, gilt er überall als vergeben und du bekommst ihn nicht doppelt.</p>' +
        '<ul class="plist dup-list">' + st.dups.map(function (d) {
          return d.others.map(function (o) {
            return '<li data-a="' + esc(d.it.id) + '" data-b="' + esc(o.id) + '"><span class="dup-ico">🔗</span><span><b>' + esc(d.it.title) + '</b><small>auch auf ' + esc(o.list.emoji) + ' ' + esc(o.list.title) +
              (titleKey(o.title) !== titleKey(d.it.title) ? ' als „' + esc(o.title) + '“' : '') + '</small></span><span class="sp"></span>' +
              '<button type="button" class="btn small" data-act="link">Verknüpfen</button><button type="button" class="btn small ghost" data-act="skip" title="Das sind zwei verschiedene Wünsche">Nicht derselbe</button></li>';
          }).join('');
        }).join('') + '</ul><p class="msg"></p>' +
        '<div class="dlg-actions"><button type="button" class="btn ghost" data-close>Später</button><button type="button" class="btn" data-act="all">Alle verknüpfen</button></div>');
      dlg.onclick = onClick;
      dlg.addEventListener('close', function once() { dlg.removeEventListener('close', once); if (!dlg.open && dlg.onclick === onClick) dlg.onclick = null; });
    }
    function drop(a, b) {
      st.dups = st.dups.map(function (d) { if (d.it.id === a) d.others = d.others.filter(function (o) { return o.id !== b; }); return d; }).filter(function (d) { return d.others.length; });
    }
    async function onClick(e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var li = b.closest('li'), act = b.dataset.act;
      try {
        if (act === 'link') {
          await busy(b, function () { return Api.rpc('wl_link_items', { p_a: li.dataset.a, p_b: li.dataset.b }); });
          drop(li.dataset.a, li.dataset.b); FX.toast('Verknüpft 🔗');
        } else if (act === 'skip') {
          var ign = dupIgnored(); ign.push(pairKey(li.dataset.a, li.dataset.b));
          try { localStorage.setItem(DUP_KEY, JSON.stringify(ign.slice(-400))); } catch (err) {}
          drop(li.dataset.a, li.dataset.b);
        } else if (act === 'all') {
          var pairs = []; st.dups.forEach(function (d) { d.others.forEach(function (o) { pairs.push([d.it.id, o.id]); }); });
          await busy(b, async function () { for (var i = 0; i < pairs.length; i++) await Api.rpc('wl_link_items', { p_a: pairs[i][0], p_b: pairs[i][1] }); });
          st.dups = []; FX.toast(plural(pairs.length, 'Wunsch', 'Wünsche') + ' verknüpft 🔗');
        } else return;
      } catch (err) { return say($('.msg', dlg), errText(err), false); }
      paint();
      refreshList(st);
    }
    paint();
  }

  // Verknuepfung eines eigenen Wunsches ansehen, loesen oder mit einem gleichen Wunsch herstellen
  function linkDialog2(st, it) {
    var ls = linksOf(st, it), cand = (st.dups.filter(function (d) { return d.it.id === it.id; })[0] || { others: [] }).others;
    openDlg(dlgHead('🔗 Verknüpfung') + '<p class="muted">„' + esc(it.title) + '“</p>' +
      (ls.length ? '<p>Dieser Wunsch ist verknüpft und steht auch auf:</p><div class="sheet-list">' + ls.map(function (x) {
        return '<a class="sheet-item" href="./?liste=' + esc(x.list.id) + '"><span>' + esc(x.list.emoji) + '</span><b>' + esc(x.list.title) + '</b><small>öffnen →</small></a>';
      }).join('') + '</div><p class="muted small">Reserviert jemand den Wunsch auf einer dieser Listen, gilt er überall als vergeben. „Erhalten“ gilt ebenfalls für alle.</p>'
        : '<p>Dieser Wunsch ist mit keinem anderen verknüpft.</p><p class="muted small">Steht er auf mehreren Listen, verknüpfe die Kopien: Dann zählt er als ein Wunsch und wird dir nicht doppelt geschenkt. Am einfachsten über „In andere Liste kopieren“.</p>') +
      (cand.length ? '<p class="eyebrow">Gleicher Wunsch gefunden</p><div class="sheet-list">' + cand.map(function (o) {
        return '<button type="button" class="sheet-item" data-link="' + esc(o.id) + '"><span>🔗</span><b>' + esc(o.list.emoji) + ' ' + esc(o.list.title) + '</b><small>verknüpfen</small></button>';
      }).join('') + '</div>' : '') +
      '<p class="msg"></p><div class="dlg-actions">' + (ls.length ? '<button type="button" class="btn ghost danger-text" data-act="unlink">Verknüpfung lösen</button><span class="sp"></span>' : '') +
      '<button type="button" class="btn ghost" data-act="copy">⧉ In andere Liste kopieren</button><button type="button" class="btn" data-close>Fertig</button></div>', 'small');
    var box = $('.dlg-in', dlg);
    box.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-link], [data-act]'); if (!b) return;
      try {
        if (b.dataset.link) {
          await busy(b, function () { return Api.rpc('wl_link_items', { p_a: it.id, p_b: b.dataset.link }); });
          st.dups = st.dups.filter(function (d) { return d.it.id !== it.id; });
          dlg.close(); FX.toast('Verknüpft 🔗'); return refreshList(st);
        }
        if (b.dataset.act === 'copy') return copyDialog(st, it);
        if (b.dataset.act === 'unlink') {
          await busy(b, function () { return Api.rpc('wl_unlink_item', { p_item: it.id }); });
          dlg.close(); FX.toast('Verknüpfung gelöst'); return refreshList(st);
        }
      } catch (err) { say($('.msg', dlg), errText(err), false); }
    });
  }

  // Sortierte und gefilterte Wuensche samt Summe (fuer die ganze Seite und fuer die Suche)
  function listView(st) {
    var items = st.items.slice();
    var pr = function (it) { return it.price == null ? -1 : it.price; };
    var cmp = {
      prio: function (a, b) { return b.priority - a.priority; },
      value: function (a, b) { return (b.priority - a.priority) || (pr(b) - pr(a)); },
      cheap: function (a, b) { return (a.price == null ? 1e9 : a.price) - (b.price == null ? 1e9 : b.price); },
      pricey: function (a, b) { return pr(b) - pr(a); },
      cat: function (a, b) { return (!a.category - !b.category) || (a.category || '').localeCompare(b.category || '', 'de') || (b.priority - a.priority); },
      az: function (a, b) { return a.title.localeCompare(b.title, 'de'); },
      new: function (a, b) { return a.created_at < b.created_at ? 1 : -1; }
    }[st.sort];
    items.sort(function (a, b) { return (a.received - b.received) || cmp(a, b); });
    var F = st.f, qq = F.q.trim().toLowerCase();
    var filtered = !!(qq || F.cat || F.prio || F.price || F.only);
    items = items.filter(function (it) {
      if (qq && (it.title + ' ' + it.note + ' ' + it.category).toLowerCase().indexOf(qq) < 0) return false;
      if (F.cat && it.category !== F.cat) return false;
      if (F.prio && String(it.priority) !== F.prio) return false;
      if (F.price) {
        if (F.price === 'none') { if (it.price != null) return false; }
        else { var b = F.price.split('-'); if (it.price == null || it.price < +b[0] || (b[1] && it.price >= +b[1])) return false; }
      }
      if (F.only && (st.owner ? it.received : !isFree(it, st.res[it.id]))) return false;
      return true;
    });
    var total = fmtSums(sumCur(items, function (it) { return it.received || it.price == null ? 0 : it.price * it.quantity; }));
    return { items: items, filtered: filtered, total: total };
  }
  function listCount(st, v) {
    return (v.filtered ? v.items.length + ' von ' : '') + plural(st.items.length, 'Wunsch', 'Wünsche') + (v.total ? ' · zusammen ca. ' + esc(v.total) : '');
  }
  function listResults(st, v) {
    var l = st.list;
    return v.items.length ? '<div class="wishes" data-stagger>' + v.items.map(function (it) { return wishCard(it, { owner: st.owner, res: st.res[it.id], emoji: l.emoji, links: linksOf(st, it) }); }).join('') + '</div>'
      : st.items.length ? (v.filtered ? emptyBox('🔎', 'Nichts gefunden', 'Mit diesen Filtern passt gerade kein Wunsch.', '<button type="button" class="btn ghost" data-act="reset-filters">Filter zurücksetzen</button>') : emptyBox('🎉', 'Alles vergeben', 'Mit diesem Filter ist gerade nichts übrig.'))
        : st.owner ? emptyBox('✨', 'Füge deinen ersten Wunsch hinzu', 'Produktlink einfügen genügt: Bild, Titel und Preis werden automatisch übernommen.', '<button type="button" class="btn" data-act="add-item">+ Wunsch hinzufügen</button>')
          : emptyBox('🕊️', 'Noch leer', esc(l.owner.name) + ' hat hier noch keine Wünsche eingetragen.');
  }
  // Nur Ergebnisse und Zaehler neu zeichnen; das Suchfeld bleibt stehen (Cursor und Eingabe per IME bleiben erhalten)
  function paintResults(st) {
    var v = listView(st), box = $('#wishRes', app);
    if (!box) return paintList(st, true);
    box.innerHTML = listResults(st, v).replace(/ data-stagger/g, '');
    var c = $('.tb-count', app); if (c) c.innerHTML = listCount(st, v);
    var r = $('.tb2 [data-act="reset-filters"]', app); if (r) r.hidden = !v.filtered;
  }
  function paintList(st, quiet) {
    var l = st.list, d = l.event_date ? daysUntil(l.event_date) : null;
    setTheme(l.theme);
    var v = listView(st), F = st.f, filtered = v.filtered;
    var free = st.items.filter(function (it) { return isFree(it, st.res[it.id]); }).length;
    var catCount = {}; st.items.forEach(function (it) { if (it.category) catCount[it.category] = (catCount[it.category] || 0) + 1; });
    var uncats = st.owner ? st.items.filter(function (it) { return !it.category; }).length : 0;
    var autoBtn = uncats ? '<button type="button" class="cc auto" data-act="auto-cat" title="Kategorien anhand von Titel und Shop vorschlagen">✨ Kategorien vorschlagen <small>' + uncats + ' ohne</small></button>' : '';
    var cats = Object.keys(catCount).sort(function (x, y) { return x.localeCompare(y, 'de'); });
    var nF = (F.prio ? 1 : 0) + (F.price ? 1 : 0) + (F.only ? 1 : 0) + (st.sort !== 'prio' ? 1 : 0);
    var nDup = st.dups.reduce(function (n, x) { return n + x.others.length; }, 0);

    // Bei "Alle Freunde" zusaetzlich die einzeln Freigeschalteten (z. B. per Link) zeigen, damit nichts unsichtbar bleibt
    var shared = st.share && st.share.length ? esc(st.share.join(', ')) : '';
    var vis = l.visibility === 'custom' ? '🎯 ' + (shared || 'noch niemand ausgewählt') : VIS[l.visibility] + (l.visibility === 'friends' && shared ? ' + ' + shared : '');
    view(st.ctx,
      '<header class="list-head" data-theme="' + esc(l.theme) + '">' +
      '<p class="back"><a href="' + (st.owner ? './' : './?seite=freund&id=' + l.owner.id) + '"><span class="arr">←</span> ' + (st.owner ? 'Übersicht' : esc(l.owner.name)) + '</a></p>' +
      '<div class="lh-main"><span class="lh-emoji">' + esc(l.emoji) + '</span><div>' +
      '<p class="eyebrow">' + [l.occasion && esc(l.occasion), l.event_date && fmtDate(l.event_date, true)].filter(Boolean).join(' · ') + (l.archived ? ' · 📦 Archiviert' : '') + '</p>' +
      '<h1>' + esc(l.title) + '</h1>' + (l.description ? '<p class="lead">' + esc(l.description) + '</p>' : '') + '</div>' +
      (d !== null && d >= 0 ? '<div class="lh-cd"><b>' + d + '</b><span>' + (d === 1 ? 'Tag' : 'Tage') + (l.occasion ? ' bis ' + esc(l.occasion) : '') + '</span></div>' : '') + '</div>' +
      '<div class="lh-bar">' + (st.owner
        ? '<span class="pill" title="Wer diese Liste sehen kann">' + vis + '</span><span class="sp"></span>' + hideBtn(l) + '<button type="button" class="btn ghost" data-act="share">🔗 Teilen</button><button type="button" class="btn ghost" data-act="edit-list">⚙ Liste bearbeiten</button><button type="button" class="btn lh-add" data-act="add-item">+ Wunsch hinzufügen</button>'
        : '<a class="owner-chip" href="./?seite=freund&id=' + l.owner.id + '">' + avatar(l.owner, 'sm') + '<span>Liste von <b>' + esc(l.owner.name) + '</b></span></a><span class="sp"></span><span class="pill">' + free + ' von ' + st.items.length + ' Wünschen noch frei</span>' +
          hideBtn(l) + (st.canSuggest ? '<button type="button" class="btn lh-add" data-act="suggest">💡 Vorschlag machen</button>' : '')) + '</div>' +
      (st.owner ? '<p class="surprise">🙈 <b>Überraschungsschutz:</b> Was reserviert wurde, siehst du auf deinen eigenen Listen nicht.</p>' : '') +
      '</header>' +
      (nDup ? '<button type="button" class="banner dup" data-act="dups"><span>🔗</span><b>' + plural(nDup, 'Wunsch steht', 'Wünsche stehen') + ' auch auf einer anderen Liste <small>Verknüpfen, damit nichts doppelt geschenkt wird</small></b><span class="arr">→</span></button>' : '') +
      (st.owner && st.sugg && st.sugg.length ? '<section class="sugg panel"><h2>💡 Vorschläge von Freunden <small class="muted">' + st.sugg.length + '</small></h2>' +
        '<p class="muted small">🔒 Nur du siehst diese Vorschläge. Übernimm sie in deine Liste oder verwirf sie.</p><ul class="plist">' + st.sugg.map(function (s) {
          var au = s.author || { name: 'Unbekannt', avatar: '👤', color: '#8395a7' };
          return '<li data-sid="' + s.id + '">' + avatar(au, 'sm') + '<span><b>' + esc(s.title) + '</b><small>von ' + esc(au.name) + [s.price != null ? ' · ' + esc(money(s.price, s.currency)) : '', s.category ? ' · ' + esc(s.category) : '', s.note ? ' · ' + esc(s.note) : ''].join('') + '</small></span><span class="sp"></span>' +
            (safeUrl(s.url) ? '<a class="link-btn" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(host(s.url)) + ' ↗</a>' : '') +
            '<button type="button" class="btn small" data-act="sugg-ok">✓ Übernehmen</button><button type="button" class="btn small ghost" data-act="sugg-no">Verwerfen</button></li>';
        }).join('') + '</ul></section>' : '') +
      (st.items.length ? '<div class="toolbar tb2"><input type="search" name="q" value="' + esc(F.q) + '" placeholder="Wünsche durchsuchen …" aria-label="Wünsche durchsuchen" autocomplete="off">' +
        '<button type="button" class="btn small ghost tb-filter" data-act="filters">⚙︎ Filter' + (nF ? ' <b class="badge">' + nF + '</b>' : '') + '</button>' +
        '<label class="tb-wide">Sortieren <select name="sort">' + SORTS.map(function (o) { return '<option value="' + o[0] + '"' + (st.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
        '<label class="tb-wide">Wichtigkeit <select name="prio"><option value="">Alle</option>' + [3, 2, 1].map(function (p) { return '<option value="' + p + '"' + (F.prio === String(p) ? ' selected' : '') + '>' + '●●●'.slice(0, p) + ' ' + PRIO[p] + '</option>'; }).join('') + '</select></label>' +
        '<label class="tb-wide">Preis <select name="price">' + PRICE_BANDS.map(function (o) { return '<option value="' + o[0] + '"' + (F.price === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
        '<label class="check tb-wide"><input type="checkbox" name="only"' + (F.only ? ' checked' : '') + '> ' + (st.owner ? 'Erhaltene ausblenden' : 'Nur freie Wünsche') + '</label>' +
        '<button type="button" class="btn small ghost tb-swipe" data-act="feed" title="Wünsche einzeln im Vollbild durchblättern">▶ Durchblättern</button>' +
        '<button type="button" class="link-btn" data-act="reset-filters"' + (filtered ? '' : ' hidden') + '>Filter zurücksetzen</button>' +
        '<span class="sp"></span><span class="muted tb-count">' + listCount(st, v) + '</span></div>' +
        (cats.length || autoBtn ? '<div class="catchips" role="group" aria-label="Kategorien">' + (cats.length ? '<button type="button" class="cc' + (F.cat ? '' : ' on') + '" data-act="cat" data-cat="">Alle</button>' +
          cats.map(function (c) { return '<button type="button" class="cc' + (F.cat === c ? ' on' : '') + '" data-act="cat" data-cat="' + esc(c) + '">' + esc(c) + ' <small>' + catCount[c] + '</small></button>'; }).join('') : '') + autoBtn + '</div>' : '') : '') +
      '<div id="wishRes">' + listResults(st, v) + '</div>', quiet);
  }
  // Sortieren und Filtern als Blatt (Handy): grosse Auswahlfelder statt kleiner Aufklappmenues
  function filterSheet(st) {
    var F = st.f;
    function group(name, legend, opts, cur) {
      return '<fieldset class="fchips"><legend>' + legend + '</legend>' + opts.map(function (o) {
        return '<label><input type="radio" name="' + name + '" value="' + esc(o[0]) + '"' + (cur === o[0] ? ' checked' : '') + '><span>' + esc(o[1]) + '</span></label>'; }).join('') + '</fieldset>';
    }
    openDlg(dlgHead('Sortieren &amp; filtern') + '<form class="form" novalidate>' + group('sort', 'Sortieren', SORTS, st.sort) +
      group('prio', 'Wichtigkeit', [['', 'Alle']].concat([3, 2, 1].map(function (p) { return [String(p), '●●●'.slice(0, p) + ' ' + PRIO[p]]; })), F.prio) +
      group('price', 'Preis', PRICE_BANDS, F.price) +
      '<label class="check big"><input type="checkbox" name="only"' + (F.only ? ' checked' : '') + '> ' + (st.owner ? 'Erhaltene ausblenden' : 'Nur freie Wünsche') + '</label>' +
      '<div class="dlg-actions"><button type="button" class="btn ghost" data-act="reset">Zurücksetzen</button><button type="button" class="btn" data-close>Fertig</button></div></form>', 'small');
    var f = $('form', dlg);
    f.addEventListener('change', function () {
      var v = vals(f); st.sort = v.sort || 'prio'; F.prio = v.prio || ''; F.price = v.price || ''; F.only = !!v.only;
      paintList(st, true);
    });
    $('[data-act="reset"]', f).addEventListener('click', function () {
      st.sort = 'prio'; st.f = { q: F.q, cat: '', prio: '', price: '', only: false }; dlg.close(); paintList(st, true);
    });
  }
  // Ausblenden-Knopf: Liste wird nicht mehr angekuendigt, bleibt aber erreichbar
  function hideBtn(l) {
    return isMuted(l.id)
      ? '<button type="button" class="btn ghost bell off" data-act="mute" aria-pressed="true" title="Wieder unter „Aktuelle Listen“, „Bald anstehend“ und in Erinnerungen zeigen">🔕 Ausgeblendet</button>'
      : '<button type="button" class="btn ghost bell" data-act="mute" aria-pressed="false" title="Nicht mehr unter „Aktuelle Listen“, „Bald anstehend“ und in Erinnerungen zeigen">🙈 Ausblenden</button>';
  }
  function isFree(it, res) { return wishState(it, res).free; }
  function listAction(e, st) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var card = b.closest('.wish'), it = card && st.items.filter(function (x) { return x.id === card.getAttribute('data-id'); })[0];
    return doAct(st, b.dataset.act, it, b);
  }
  // Meldung mit Knopf (z. B. "Rueckgaengig"); verschwindet nach ein paar Sekunden von selbst
  var actToast = null, actToastT = 0;
  function toastAct(text, label, fn) {
    if (!actToast) { actToast = document.createElement('div'); actToast.className = 'toast act'; actToast.setAttribute('role', 'status'); }
    // im Dialog-Stapel (Top-Layer) sichtbar bleiben: an die oberste offene Ebene haengen
    (layers.filter(function (l) { return l.open; }).pop() || document.body).appendChild(actToast);
    actToast.innerHTML = '<span>' + esc(text) + '</span><button type="button">' + esc(label) + '</button>';
    $('button', actToast).onclick = function () { actToast.classList.remove('show'); fn(); };
    requestAnimationFrame(function () { actToast.classList.add('show'); });
    clearTimeout(actToastT); actToastT = setTimeout(function () { actToast.classList.remove('show'); }, 5000);
  }
  // Alle Aktionen einer Liste: aus der Kartenansicht, dem "⋯"-Blatt und der Swipe-Ansicht
  async function doAct(st, act, it, b) {
    if (act === 'add-item') return itemDialog(st, null);
    if (act === 'open') return it && openFeed(st, it.id);
    if (act === 'feed') return openFeed(st, null);
    if (act === 'filters') return filterSheet(st);
    if (act === 'dups') return dupDialog(st);
    if (act === 'links') return it && linkDialog2(st, it);
    if (act === 'copy-item') return copyDialog(st, it);
    if (act === 'auto-cat') return autoCategorize(st);
    if (act === 'edit-item') return itemDialog(st, it);
    if (act === 'edit-list') return listDialog(st.list);
    if (act === 'share') return shareDialog(st);
    if (act === 'suggest') return itemDialog(st, null, { suggest: true });
    if (act === 'more') {
      if (!it) return;
      var url = safeUrl(it.url), items = [];
      if (st.owner) {
        items.push({ ico: '✏️', label: 'Bearbeiten', act: 'edit-item' });
        items.push({ ico: it.received ? '↩︎' : '✅', label: it.received ? 'Doch nicht erhalten' : 'Als erhalten markieren', act: 'toggle-received' });
        items.push({ ico: '⧉', label: 'In andere Liste kopieren', sub: LINKS ? 'auf Wunsch verknüpft' : '', act: 'copy-item' });
        if (LINKS) items.push({ ico: '🔗', label: 'Verknüpfung', sub: linksOf(st, it).length ? 'auf ' + plural(linksOf(st, it).length, 'weiteren Liste', 'weiteren Listen') : 'keine', act: 'links' });
      } else items.push({ ico: '⧉', label: 'Auf meine Liste übernehmen', sub: 'als eigener Wunsch', act: 'copy-item' });
      if (url) items.push({ ico: '🛒', label: 'Im Shop ansehen', sub: esc(host(url)) + ' ↗', href: url });
      if (!feed.open) items.push({ ico: '▶', label: 'Groß ansehen', act: 'open' });
      if (st.owner) items.push({ ico: '🗑', label: 'Löschen', act: 'del-item', danger: true });
      var pick = await sheet(esc(it.title), items);
      return pick ? doAct(st, pick, it, null) : null;
    }
    if (act === 'mute') {
      var off = !isMuted(st.list.id);
      try { await busy(b, function () { return setMuted(st.list.id, off); }); } catch (err) { return FX.toast(errText(err)); }
      FX.toast(off ? '🔕 Ausgeblendet: nicht mehr unter „Aktuelle Listen“ und „Bald anstehend“' + (NATIVE ? ', keine Erinnerungen' : '')
        : '🔔 Wieder eingeblendet');
      syncNotifications(true);
      return paintList(st, true);
    }
    if (act === 'cat') { st.f.cat = b.dataset.cat === st.f.cat ? '' : b.dataset.cat; return paintList(st, true); }
    if (act === 'reset-filters') { st.sort = 'prio'; st.f = { q: '', cat: '', prio: '', price: '', only: false }; return paintList(st, true); }
    try {
      if (act === 'del-item') {
        var nL = linksOf(st, it).length;
        if (!(await confirmDlg('„' + it.title + '“ wirklich löschen? Schon bekommen? Dann markiere ihn lieber als „Erhalten“, so wissen alle Schenkenden Bescheid.' +
          (nL ? ' Die verknüpfte Kopie auf ' + plural(nL, 'anderer Liste', 'anderen Listen') + ' bleibt bestehen.' : ''), 'Löschen'))) return;
        await Api.remove('wl_items', 'id=eq.' + it.id); FX.toast('Wunsch gelöscht');
      } else if (act === 'toggle-received') {
        await busy(b, function () { return Api.update('wl_items', 'id=eq.' + it.id, { received: !it.received }); });
        buzz();
        FX.toast(it.received ? 'Wieder offen' : 'Als erhalten markiert 🎉' + (linksOf(st, it).length ? ' (gilt auch für die verknüpften Listen)' : ''));
      } else if (act === 'reserve' || act === 'reserve-more') {
        var mine = wishState(it, st.res[it.id]).mine;
        await busy(b, function () { return Api.rpc('wl_reserve', { p_item: it.id, p_qty: act === 'reserve-more' && mine ? mine.quantity + 1 : 1 }); });
        buzz(18);
        if (act === 'reserve') toastAct(it.group_gift ? 'Du machst beim Gruppengeschenk mit 🧩' : 'Reserviert! Steht jetzt in „Besorgen“ 🎁', 'Rückgängig', function () { doAct(st, 'unreserve', it, null); });
        else FX.toast('Noch eins reserviert 🎁');
      } else if (act === 'unreserve') {
        await busy(b, function () { return Api.rpc('wl_unreserve', { p_item: it.id }); });
        FX.toast('Reservierung freigegeben');
      } else if (act === 'sugg-ok') {
        await busy(b, function () { return Api.rpc('wl_suggestion_accept', { p_id: b.closest('[data-sid]').dataset.sid }); });
        FX.toast('Zur Liste hinzugefügt ✨');
      } else if (act === 'sugg-no') {
        await busy(b, function () { return Api.rpc('wl_suggestion_dismiss', { p_id: b.closest('[data-sid]').dataset.sid }); });
        FX.toast('Vorschlag verworfen');
      } else return;
    } catch (err) { FX.toast(errText(err)); }
    await refreshList(st);
  }

  // ---------- Swipe-Ansicht: Wuensche einzeln im Vollbild, nach oben wischen fuer den naechsten ----------
  // Rechts die Aktionen wie in Social-Media-Apps; Doppeltipp auf das Bild reserviert einen freien Wunsch.
  var feedSt = null, feedTap = { t: 0, id: '' };
  function feedSlide(st, it) {
    var url = safeUrl(it.url), img = /^https:\/\//.test(it.image_url || '') ? it.image_url : '', s = wishState(it, st.res[it.id]), l = st.list;
    var rail = [], line = '';
    function rb(act, ico, label, cls) { return '<button type="button" class="rail-btn ' + (cls || '') + '" data-act="' + act + '"><span>' + ico + '</span><small>' + label + '</small></button>'; }
    if (st.owner) {
      rail.push(rb('edit-item', '✏️', 'Bearbeiten'));
      rail.push(rb('toggle-received', it.received ? '↩︎' : '✓', it.received ? 'Doch nicht' : 'Erhalten', it.received ? 'on' : ''));
      if (linksOf(st, it).length) line = '<span class="state part">🔗 auch auf ' + plural(linksOf(st, it).length, 'Liste', 'Listen') + '</span>';
    } else if (it.received) line = '<span class="state done">🎉 Schon erfüllt</span>';
    else if (it.group_gift) {
      var names = s.res.map(function (r) { return r.mine ? 'du' : r.name; });
      line = '<span class="state gg">🧩 ' + (names.length ? esc(names.join(', ')) + (names.length === 1 && !s.mine ? ' macht mit' : ' machen mit') : 'Gruppengeschenk: mehrere legen zusammen') + '</span>';
      rail.push(s.mine ? rb('unreserve', '✓', 'Dabei', 'on') : rb('reserve', '🧩', 'Mitmachen', 'main'));
    } else if (s.mine) {
      line = '<span class="state mine">✓ Von dir reserviert' + (it.quantity > 1 ? ' (' + s.mine.quantity + '×)' : '') + (s.viaLink ? ' <small>über eine andere Liste</small>' : '') + '</span>';
      rail.push(rb('unreserve', '✓', 'Reserviert', 'on'));
      if (s.taken < it.quantity) rail.push(rb('reserve-more', '+1', 'Noch eins'));
    } else if (s.full) line = '<span class="state taken">🔒 Reserviert von ' + esc(s.res.map(function (r) { return r.name; }).join(', ')) + '</span>';
    else {
      if (s.taken) line = '<span class="state part">Noch ' + (it.quantity - s.taken) + ' von ' + it.quantity + ' frei</span>';
      rail.push(rb('reserve', '🎁', 'Reservieren', 'main'));
    }
    if (url) rail.push('<a class="rail-btn" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"><span>🛒</span><small>Shop</small></a>');
    rail.push(rb('more', '⋯', 'Mehr'));
    var meta = [it.price != null ? '<b>' + esc(money(it.price, it.currency)) + '</b>' : '', it.quantity > 1 ? it.quantity + '×' : '', it.category ? esc(it.category) : '', url ? esc(host(url)) : ''].filter(Boolean).join(' · ');
    return '<section class="fslide p' + it.priority + (it.received ? ' got' : '') + (s.full && !st.owner && !s.mine ? ' taken' : '') + '" data-id="' + esc(it.id) + '">' +
      '<div class="fs-stage">' + (img ? '<img src="' + esc(img) + '" alt="" referrerpolicy="no-referrer" data-ph="' + esc(l.emoji || '🎁') + '">' : placeholder(l.emoji, it.title)) + '</div>' +
      '<div class="fs-rail">' + rail.join('') + '</div>' +
      '<div class="fs-info">' + (it.priority === 3 ? '<span class="fs-prio">♥ Herzenswunsch</span>' : '') + '<h2>' + esc(it.title) + '</h2>' +
      (meta ? '<p class="fs-meta">' + meta + '</p>' : '') + (it.note ? '<p class="use"><span>Wofür</span>' + esc(it.note) + '</p>' : '') + line + '</div></section>';
  }
  function feedCurrent() {
    var sc = $('.feed-scroll', feed), slides = $$('.fslide', feed);
    if (!sc || !slides.length) return null;
    var i = Math.max(0, Math.min(slides.length - 1, Math.round(sc.scrollTop / Math.max(1, sc.clientHeight))));
    return slides[i].getAttribute('data-id');
  }
  function paintFeed(st, keepId) {
    var items = listView(st).items, l = st.list;
    if (!items.length) { if (feed.open) feed.close(); return; }
    var seen = false; try { seen = localStorage.getItem('wl-feed-hint') === '1'; } catch (e) {}
    feed.innerHTML = '<div class="feed-top"><button type="button" class="x" data-close aria-label="Schließen">✕</button><span class="feed-title">' + esc(l.emoji) + ' ' + esc(l.title) + '</span><span class="feed-count" aria-live="polite"></span></div>' +
      '<div class="feed-scroll" tabindex="0" aria-label="Wünsche, nach oben wischen für den nächsten">' + items.map(function (it) { return feedSlide(st, it); }).join('') + '</div>' +
      (seen || items.length < 2 ? '' : '<p class="feed-hint" aria-hidden="true"><span>↑</span> Nach oben wischen für den nächsten Wunsch' + (st.owner ? '' : ' · Doppeltipp reserviert') + '</p>');
    var sc = $('.feed-scroll', feed), count = $('.feed-count', feed), idx = 0;
    items.forEach(function (it, i) { if (it.id === keepId) idx = i; });
    sc.scrollTop = idx * sc.clientHeight;
    function upd() {
      var i = Math.round(sc.scrollTop / Math.max(1, sc.clientHeight));
      count.textContent = (i + 1) + ' / ' + items.length;
      if (i !== idx) { var h = $('.feed-hint', feed); if (h) { h.remove(); try { localStorage.setItem('wl-feed-hint', '1'); } catch (e) {} } idx = i; }
    }
    sc.addEventListener('scroll', upd, { passive: true });
    upd();
  }
  function openFeed(st, id) {
    if (!listView(st).items.length) return;
    feedSt = st;
    openLayer(feed);
    paintFeed(st, id);
    var sc = $('.feed-scroll', feed); if (sc) sc.focus({ preventScroll: true });
  }
  feed.addEventListener('click', function (e) {
    var st = feedSt; if (!st) return;
    var slide = e.target.closest('.fslide'), b = e.target.closest('[data-act]');
    var it = slide && st.items.filter(function (x) { return x.id === slide.getAttribute('data-id'); })[0];
    if (b) return doAct(st, b.dataset.act, it, b);
    // Doppeltipp auf das Bild: freien Wunsch eines Freundes reservieren
    if (!it || !e.target.closest('.fs-stage')) return;
    var now = Date.now(), dbl = now - feedTap.t < 340 && feedTap.id === it.id;
    feedTap = { t: dbl ? 0 : now, id: it.id };
    if (!dbl || st.owner) return;
    var s = wishState(it, st.res[it.id]);
    var burst = document.createElement('span'); burst.className = 'burst'; burst.textContent = s.mine ? '✓' : s.free ? '🎁' : '🔒';
    burst.style.left = e.clientX + 'px'; burst.style.top = e.clientY + 'px';
    feed.appendChild(burst); setTimeout(function () { burst.remove(); }, 800);
    if (s.free && !s.mine) doAct(st, 'reserve', it, null);
  });
  feed.addEventListener('keydown', function (e) {
    var sc = $('.feed-scroll', feed); if (!sc || e.target.closest('button, a')) return;
    var dir = e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ' ? 1 : e.key === 'ArrowUp' || e.key === 'PageUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault(); sc.scrollBy({ top: dir * sc.clientHeight, behavior: FX.reduced ? 'auto' : 'smooth' });
  });

  // Wunsch in andere eigene Listen kopieren oder von einer Freundesliste auf die eigene uebernehmen.
  // Eigene Kopien werden auf Wunsch verknuepft: Sie zaehlen dann beim Reservieren als ein Wunsch (nichts wird doppelt
  // geschenkt). Reservierungen werden nie mitkopiert; bei fremden Wuenschen auch nicht deren Notiz "Wofuer".
  async function copyDialog(st, it) {
    if (!it) return;
    var lists, linked = [];
    try {
      lists = await Api.get('wl_lists', 'owner=eq.' + me.id + '&select=id,title,emoji,archived&order=archived.asc,created_at.desc');
      if (st.owner && LINKS && it.link_id) linked = (await Api.get('wl_items', 'link_id=eq.' + it.link_id + '&select=list_id')).map(function (x) { return x.list_id; });
    } catch (e) { return FX.toast(errText(e)); }
    lists = lists.filter(function (l) { return l.id !== st.list.id; });
    var foreign = !st.owner, canLink = !foreign && LINKS;
    var free = lists.filter(function (l) { return linked.indexOf(l.id) < 0; });
    openDlg(dlgHead(foreign ? '⧉ Auf meine Liste übernehmen' : '⧉ Wunsch kopieren') +
      '<form class="form" novalidate><p class="muted">„' + esc(it.title) + '“ ' + (foreign
        ? 'kommt als neuer Wunsch auf deine Liste. ' + esc(st.list.owner.name) + ' erfährt davon nichts; die Notiz „Wofür“ wird nicht übernommen.'
        : 'wird in die gewählten Listen kopiert, mit Bild, Preis, Kategorie und Notiz. Das Original bleibt hier.') + '</p>' +
      (lists.length ? '<p class="eyebrow">In welche Liste?</p><div class="checks">' + lists.map(function (l) {
        var has = linked.indexOf(l.id) >= 0;
        return '<label class="cchip' + (has ? ' has' : '') + '"><input type="checkbox" name="to" value="' + esc(l.id) + '"' + (has ? ' disabled' : '') + '><span>' + esc(l.emoji) + ' ' + esc(l.title) +
          (has ? ' <small>🔗 schon verknüpft</small>' : l.archived ? ' <small>archiviert</small>' : '') + '</span></label>';
      }).join('') + '</div>' : '<p class="muted">' + (foreign ? 'Du hast noch keine eigene Liste.' : 'Du hast noch keine andere Liste.') + ' Leg auf der <a href="./">Übersicht</a> eine an, dann kannst du hierher kopieren.</p>') +
      (canLink && free.length ? '<fieldset class="vis link-pick"><legend>Ist es derselbe Wunsch?</legend>' +
        '<label class="vopt"><input type="radio" name="link" value="1" checked><span><b>🔗 Ja, verknüpfen <em>empfohlen</em></b><small>Du möchtest ihn nur einmal bekommen. Reserviert ihn jemand auf einer Liste, gilt er auf allen als vergeben.</small></span></label>' +
        '<label class="vopt"><input type="radio" name="link" value="0"><span><b>Nein, eigenständige Kopie</b><small>Jede Liste zählt für sich. Der Wunsch kann dann auf jeder Liste einzeln reserviert werden, du könntest ihn also mehrfach bekommen.</small></span></label></fieldset>' : '') +
      '<p class="msg"></p><div class="dlg-actions"><button type="button" class="btn ghost" data-close>Abbrechen</button>' + (free.length ? '<button type="submit" class="btn">Kopieren</button>' : '') + '</div></form>', 'small');
    var f = $('form', dlg);
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = vals(f), to = v.to || [], m = $('.msg', f), link = canLink && v.link !== '0';
      if (!to.length) return say(m, 'Bitte wähle mindestens eine Liste.', false);
      try {
        await busy($('[type=submit]', f), function () {
          if (canLink) return Api.rpc('wl_copy_item', { p_item: it.id, p_lists: to, p_link: link });
          return Api.insert('wl_items', to.map(function (id) {   // ein Aufruf: alle oder keine
            return { list_id: id, title: it.title, url: it.url, image_url: it.image_url, price: it.price, currency: it.currency, note: foreign ? '' : it.note,
              category: it.category || guessCategory(it.title, it.url), priority: foreign ? 2 : it.priority, quantity: it.quantity, group_gift: it.group_gift };
          }));
        });
        var names = lists.filter(function (l) { return to.indexOf(l.id) >= 0; }).map(function (l) { return l.title; });
        dlg.close(); FX.toast((link ? 'Kopiert und verknüpft mit ' : 'Kopiert nach ') + names.join(', ') + (link ? ' 🔗' : ' ✨'));
        if (st.owner) refreshList(st);
      } catch (err) { say(m, errText(err), false); }
    });
  }

  // Grobe Vorkategorisierung fuer bestehende Wuensche ohne Kategorie (nur eigene Listen)
  async function autoCategorize(st) {
    var todo = st.items.filter(function (it) { return !it.category; }).map(function (it) { return { it: it, cat: guessCategory(it.title, it.url) }; })
      .filter(function (x) { return x.cat; });
    var rest = st.items.filter(function (it) { return !it.category; }).length - todo.length;
    if (!todo.length) return FX.toast('Für die Wünsche ohne Kategorie habe ich keinen passenden Vorschlag gefunden.');
    var sample = todo.slice(0, 4).map(function (x) { return x.it.title.slice(0, 40) + ' → ' + x.cat; }).join(', ');
    if (!(await confirmDlg(plural(todo.length, 'Wunsch bekommt', 'Wünsche bekommen') + ' eine Kategorie, z. B. ' + sample + (todo.length > 4 ? ' …' : '') + '.' +
      (rest ? ' ' + plural(rest, 'Wunsch bleibt', 'Wünsche bleiben') + ' ohne, weil nichts eindeutig passt.' : '') + ' Du kannst alles danach beim Bearbeiten ändern.', 'Übernehmen'))) return;
    var res = await Promise.all(todo.map(function (x) {
      return Api.update('wl_items', 'id=eq.' + x.it.id, { category: x.cat }).then(function () { return true; }, function () { return false; });
    }));
    var ok = res.filter(Boolean).length;
    FX.toast(ok === todo.length ? 'Kategorien vergeben ✨' : ok + ' von ' + todo.length + ' Kategorien gespeichert. Bitte später erneut versuchen.');
    await refreshList(st);
  }

  function itemDialog(st, it, opt) {
    var sug = !!(opt && opt.suggest), x = it || { title: '', url: '', image_url: '', price: null, currency: 'EUR', note: '', category: '', priority: 2, quantity: 1, group_gift: false };
    var ls = it ? linksOf(st, it) : [];
    var catList = CATEGORIES.slice(); st.items.forEach(function (i) { if (i.category && catList.indexOf(i.category) < 0) catList.push(i.category); });
    openDlg(dlgHead(sug ? '💡 Vorschlag für ' + esc(st.list.owner.name) : it ? 'Wunsch bearbeiten' : 'Neuer Wunsch') + (sug ? '<p class="muted small">🔒 Nur ' + esc(st.list.owner.name) + ' sieht deinen Vorschlag und entscheidet, ob er in die Liste kommt.</p>' : '') +
      '<form class="form item-form" novalidate><div class="item-grid"><div>' +
      '<label>Produktlink <small class="muted">optional</small><span class="url-row"><input name="url" type="url" inputmode="url" placeholder="https://…" value="' + esc(x.url || '') + '" autofocus><button type="button" class="btn small ghost" data-act="fetch">Vorschau laden</button></span></label>' +
      '<p class="msg fetch-msg"></p>' +
      '<label>' + (sug ? 'Was schlägst du vor?' : 'Was wünschst du dir?') + '<input name="title" required maxlength="120" value="' + esc(x.title) + '" placeholder="z. B. Wanderrucksack 30 l"></label>' +
      '<label>' + (sug ? 'Warum passt das?' : 'Wofür?') + ' <small class="muted">kurzer Einsatzzweck</small><textarea name="note" rows="2" maxlength="400" placeholder="z. B. Für Tagestouren in den Alpen">' + esc(x.note) + '</textarea></label>' +
      '<div class="row2"><label>Preis<input name="price" inputmode="decimal" placeholder="z. B. 49,99" value="' + (x.price != null ? esc(String(x.price).replace('.', ',')) : '') + '"></label>' +
      '<label>Währung<select name="currency">' + ['EUR', 'USD', 'GBP', 'CHF'].map(function (c) { return '<option' + (c === x.currency ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label></div>' +
      '<label>Bildadresse <small class="muted">wird mit der Vorschau gefüllt</small><input name="image_url" type="url" placeholder="https://…/bild.jpg" value="' + esc(x.image_url || '') + '"></label>' +
      '<label>Kategorie <small class="muted cat-hint">zum Filtern und Sortieren</small><input name="category" list="itemCats" maxlength="30" value="' + esc(x.category || '') + '" placeholder="z. B. Technik"></label>' +
      '<datalist id="itemCats">' + catList.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
      (sug ? '' : '<fieldset class="prio-pick"><legend>Wie sehr wünschst du es dir?</legend>' + [1, 2, 3].map(function (p) {
        return '<label><input type="radio" name="priority" value="' + p + '"' + (x.priority === p ? ' checked' : '') + '><span>' + '●●●'.slice(0, p) + ' ' + PRIO[p] + '</span></label>';
      }).join('') + '</fieldset>' +
      '<div class="row2"><label>Anzahl<input name="quantity" type="number" min="1" max="99" value="' + x.quantity + '"></label>' +
      '<label class="check"><input type="checkbox" name="group_gift"' + (x.group_gift ? ' checked' : '') + '> 🧩 Gruppengeschenk <small class="muted">mehrere legen zusammen</small></label></div>' +
      (ls.length ? '<label class="check sync"><input type="checkbox" name="sync" checked> 🔗 Auch auf den verknüpften Listen ändern <small class="muted">' + esc(ls.map(function (l) { return l.list.emoji + ' ' + l.list.title; }).join(', ')) +
        ' · Titel, Link, Bild, Preis, Kategorie und Anzahl</small></label>' : '')) +
      '</div><div class="item-preview"><p class="eyebrow">Vorschau</p><div class="pv"></div></div></div>' +
      '<p class="msg save-msg"></p><div class="dlg-actions"><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="submit" class="btn">' + (sug ? 'Vorschlag senden' : it ? 'Speichern' : 'Hinzufügen') + '</button></div></form>', 'wide');
    var f = $('form', dlg), pv = $('.pv', dlg), hint = $('.cat-hint', dlg), autoCat = '';
    // Kategorie vorschlagen, solange sie leer ist oder nur unser eigener Vorschlag drinsteht (eigene Eingaben bleiben)
    function suggestCat() {
      var cur = f.category.value.trim();
      if (cur && cur !== autoCat) return;
      var g = guessCategory(f.title.value, f.url.value.trim());
      if (g === cur) return;
      f.category.value = autoCat = g;
      hint.textContent = g ? '✨ automatisch vorgeschlagen, gern ändern' : 'zum Filtern und Sortieren';
    }
    function data() {
      var v = vals(f);
      return { title: v.title, url: safeUrl(v.url) || null, image_url: /^https:\/\//.test(v.image_url) ? v.image_url : null, price: parsePrice(v.price),
        currency: v.currency, note: v.note, category: v.category || '', priority: +v.priority || 2, quantity: Math.min(99, Math.max(1, +v.quantity || 1)), group_gift: v.group_gift };
    }
    function preview() { var d = data(); d.id = 'pv'; d.title = d.title || 'Dein Wunsch'; pv.innerHTML = wishCard(d, { demo: true, emoji: st.list.emoji }); }
    async function fetchPreview(btn) {
      tidyUrl();
      var u = safeUrl(f.url.value.trim()), m = $('.fetch-msg', dlg);
      if (!u) return say(m, 'Bitte zuerst einen Link mit https:// einfügen.', false);
      say(m, 'Lese Produktseite …', true);
      try {
        var p = await busy(btn, function () { return Api.fn('wl-link-preview', { url: u }); });
        if (p.error) throw Object.assign(new Error(p.error), { code: p.error });
        if (p.title && (!f.title.value || btn)) f.title.value = p.title.slice(0, 120);
        suggestCat();
        if (p.image) f.image_url.value = p.image;
        if (p.price != null && (!f.price.value || btn)) { f.price.value = String(p.price).replace('.', ','); f.currency.value = ['EUR', 'USD', 'GBP', 'CHF'].indexOf(p.currency) >= 0 ? p.currency : 'EUR'; }
        if (p.description && !f.note.value) f.note.placeholder = p.description.slice(0, 120) + ' …';
        var got = [p.title && 'Titel', p.image && 'Bild', p.price != null && 'Preis'].filter(Boolean);
        say(m, !got.length ? 'Der Shop gibt keine Vorschau heraus. Trag Titel, Preis und ggf. Bildadresse selbst ein.'
          : '✓ Übernommen: ' + got.join(', ') + '.' + (p.partial ? ' Der Shop zeigt die Seite gerade nicht vollständig, bitte ' + (p.price == null ? 'Preis ' : '') + (f.title.value ? '' : 'und Titel ') + 'selbst ergänzen.' : ' Prüf kurz und ergänze den Einsatzzweck.'), true);
      } catch (err) { say(m, 'Der Shop lässt sich gerade nicht auslesen. Trag die Angaben einfach selbst ein.', false); }
      preview();
    }
    f.addEventListener('input', function (e) {
      if (e.target.name === 'title' || e.target.name === 'url') suggestCat();
      if (e.target.name === 'category') hint.textContent = 'zum Filtern und Sortieren';
      preview();
    });
    f.addEventListener('change', preview);
    // Link-Feld aufraeumen: steht geteilter Text drin, nur den Link behalten und den Text als Titel vorschlagen
    function tidyUrl() {
      var v = f.url.value.trim();
      if (safeUrl(v)) return true;
      var sh = splitShared(v);
      if (!sh || !safeUrl(sh.url)) return false;
      f.url.value = sh.url;
      if (sh.title && !f.title.value.trim()) { f.title.value = sh.title; suggestCat(); }
      preview();
      return true;
    }
    f.url.addEventListener('paste', function () { setTimeout(function () { if (tidyUrl()) fetchPreview(null); }, 0); });
    f.url.addEventListener('change', tidyUrl);
    $('[data-act="fetch"]', f).addEventListener('click', function (e) { fetchPreview(e.currentTarget); });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var d = data(), m = $('.save-msg', dlg);
      if (!d.title) return say(m, 'Bitte gib an, was du dir wünschst.', false);
      if (f.url.value.trim() && !d.url) return say(m, 'Der Link muss mit https:// beginnen.', false);
      try {
        await busy($('[type=submit]', f), function () {
          if (sug) return Api.rpc('wl_suggest', { p_list: st.list.id, p_title: d.title, p_url: d.url, p_image: d.image_url, p_price: d.price, p_currency: d.currency, p_note: d.note, p_category: d.category });
          return it ? Api.update('wl_items', 'id=eq.' + it.id, d) : Api.insert('wl_items', Object.assign({ list_id: st.list.id }, d));
        });
        // Verknuepfte Kopien bleiben derselbe Wunsch: gemeinsame Angaben mitziehen (Notiz und Wichtigkeit bleiben je Liste)
        var synced = true;
        if (it && ls.length && vals(f).sync) {
          synced = await Api.update('wl_items', 'link_id=eq.' + it.link_id + '&id=neq.' + it.id,
            { title: d.title, url: d.url, image_url: d.image_url, price: d.price, currency: d.currency, category: d.category, quantity: d.quantity, group_gift: d.group_gift })
            .then(function () { return true; }, function () { return false; });
        }
        dlg.close(); FX.toast(sug ? 'Vorschlag gesendet 💡' : !synced ? 'Gespeichert, aber die verknüpften Listen ließen sich nicht ändern.' : it ? 'Gespeichert' : 'Wunsch hinzugefügt ✨');
        await refreshList(st);
      } catch (err) { say(m, errText(err), false); }
    });
    preview();
  }

  async function listDialog(l) {
    var res = await Promise.all([loadFriends(), loadGroups(), l ? Api.get('wl_list_groups', 'list_id=eq.' + l.id) : [], l ? Api.get('wl_list_people', 'list_id=eq.' + l.id) : []]).catch(function (e) { FX.toast(errText(e)); return null; });
    if (!res) return;
    var friends = res[0].friends, groups = res[1];
    var gSel = res[2].map(function (x) { return x.group_id; }), pSel = res[3].map(function (x) { return x.person; });
    var x = l || { title: '', description: '', emoji: '🎁', theme: me.theme, occasion: '', event_date: null, visibility: 'friends', archived: false };
    openDlg(dlgHead(l ? 'Liste bearbeiten' : 'Neue Wunschliste') +
      '<form class="form" novalidate>' +
      '<div class="row2 wide-first"><label>Titel<input name="title" required maxlength="60" value="' + esc(x.title) + '" placeholder="z. B. Mein 30. Geburtstag" autofocus></label>' +
      '<label>Anlass<input name="occasion" maxlength="40" list="occasions" value="' + esc(x.occasion) + '" placeholder="Geburtstag"></label></div>' +
      '<datalist id="occasions">' + OCCASIONS.map(function (o) { return '<option value="' + o + '">'; }).join('') + '</datalist>' +
      '<div class="row2"><label>Datum <small class="muted">für den Countdown</small><input name="event_date" type="date" value="' + esc(x.event_date || '') + '"></label>' +
      '<label class="check"><input type="checkbox" name="archived"' + (x.archived ? ' checked' : '') + '> 📦 Archiviert <small class="muted">ausgeblendet bei Freunden</small></label></div>' +
      '<label>Beschreibung <small class="muted">optional</small><textarea name="description" rows="2" maxlength="500" placeholder="Ein paar Worte an alle, die schenken wollen">' + esc(x.description) + '</textarea></label>' +
      '<fieldset><legend>Symbol</legend>' + richPicker('emoji', x.emoji, { glyphs: false, start: 'party' }) + '</fieldset>' +
      '<fieldset><legend>Design</legend>' + themePicker('theme', x.theme) + '</fieldset>' +
      '<fieldset class="vis"><legend>Wer darf die Liste sehen und reservieren?</legend>' +
      [['private', '🔒 Nur ich', 'Entwurf, für niemanden sichtbar'], ['friends', '👥 Alle Freunde', 'Jeder Freund (nicht nur Bekannte)'], ['custom', '🎯 Ausgewählte', 'Nur bestimmte Gruppen und Personen']].map(function (o) {
        return '<label class="vopt"><input type="radio" name="visibility" value="' + o[0] + '"' + (x.visibility === o[0] ? ' checked' : '') + '><span><b>' + o[1] + '</b><small>' + o[2] + '</small></span></label>';
      }).join('') +
      '<div class="pick-who"' + (x.visibility === 'custom' ? '' : ' hidden') + '>' +
      '<p class="eyebrow">Gruppen</p>' + (groups.length ? '<div class="checks">' + groups.map(function (g) {
        return '<label class="cchip"><input type="checkbox" name="groups" value="' + g.id + '"' + (gSel.indexOf(g.id) >= 0 ? ' checked' : '') + '><span style="--c:' + esc(g.color) + '">' + esc(g.emoji) + ' ' + esc(g.name) + ' <small>' + g.wl_group_members.length + '</small></span></label>';
      }).join('') + '</div>' : '<p class="muted small">Noch keine Gruppen. Lege sie unter <a href="./?seite=freunde">Freunde</a> an.</p>') +
      '<p class="eyebrow">Einzelne Personen</p>' + (friends.length ? '<div class="checks">' + friends.map(function (p) {
        return '<label class="cchip"><input type="checkbox" name="people" value="' + p.id + '"' + (pSel.indexOf(p.id) >= 0 ? ' checked' : '') + '><span>' + avatar(p, 'xs') + esc(p.name) + (p.contact.relation ? ' <small>' + esc(p.contact.relation) + '</small>' : '') + '</span></label>';
      }).join('') + '</div>' : '<p class="muted small">Noch keine Freunde.</p>') + '</div></fieldset>' +
      '<p class="msg"></p><div class="dlg-actions">' + (l ? '<button type="button" class="btn ghost danger-text" data-act="del-list">Liste löschen</button><span class="sp"></span>' : '') +
      '<button type="button" class="btn ghost" data-close>Abbrechen</button><button type="submit" class="btn">' + (l ? 'Speichern' : 'Liste anlegen') + '</button></div></form>', 'wide');
    var f = $('form', dlg);
    bindPickers(f);
    f.addEventListener('change', function () { $('.pick-who', f).hidden = vals(f).visibility !== 'custom'; });
    if (l) $('[data-act="del-list"]', f).addEventListener('click', async function () {
      if (!(await confirmDlg('Die Liste „' + l.title + '“ mit allen Wünschen und Reservierungen löschen?', 'Endgültig löschen'))) return;
      try { await Api.remove('wl_lists', 'id=eq.' + l.id); FX.toast('Liste gelöscht'); go('./', true); } catch (err) { FX.toast(errText(err)); }
    });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = vals(f), m = $('.msg', f);
      if (!v.title) return say(m, 'Bitte gib der Liste einen Titel.', false);
      var row = { title: v.title, occasion: v.occasion, event_date: v.event_date || null, description: v.description, emoji: v.emoji || '🎁', theme: v.theme || 'polarlicht', visibility: v.visibility || 'private', archived: !!v.archived };
      try {
        var saved = await busy($('[type=submit]', f), async function () {
          var out = l ? await Api.update('wl_lists', 'id=eq.' + l.id, row) : await Api.insert('wl_lists', row);
          var id = out[0].id;
          // In einem Schritt: Gruppen gelten nur bei "Ausgewaehlte". Einzelne Personen bleiben sonst erhalten (null),
          // damit per Link freigeschaltete Gaeste ihren Zugriff behalten (sie stehen dann im Sichtbarkeits-Hinweis).
          var custom = row.visibility === 'custom';
          await Api.rpc('wl_set_list_shares', { p_list: id, p_groups: custom ? v.groups || [] : [], p_people: custom ? v.people || [] : null });
          return out[0];
        });
        dlg.close(); FX.toast(l ? 'Liste gespeichert' : 'Liste angelegt 🎉');
        if (l) render(); else go('./?liste=' + saved.id);
      } catch (err) { say(m, errText(err), false); }
    });
  }

  // ---------- Freunde & Gruppen ----------
  async function friendsPage(ctx) {
    var res = await Promise.all([loadFriends(), loadGroups()]);
    var fr = res[0], groups = res[1], q = '', filter = '';
    setTheme(me.theme);
    var byId = {}; fr.friends.forEach(function (f) { byId[f.id] = f; });
    var labels = {};
    fr.friends.forEach(function (f) { if (f.contact.relation) labels[f.contact.relation] = 1; (f.contact.tags || []).forEach(function (t) { labels[t] = 1; }); });
    labels = Object.keys(labels).sort(function (a, b) { return a.localeCompare(b, 'de'); });

    function friendCard(p) {
      var b = p.birthday ? nextBirthday(p.birthday) : null;
      return '<article class="fcard" data-id="' + p.id + '">' +
        '<a class="fc-main" href="./?seite=freund&id=' + p.id + '">' + avatar(p, 'lg') + '<span><b>' + handle(p) + '</b>' +
        (p.contact.relation ? '<em>' + esc(p.contact.relation) + '</em>' : '') + (p.level === 'known' ? '<em class="lvl">Bekannt</em>' : '') +
        (b && b.days <= 30 ? '<small>🎂 ' + (b.days === 0 ? 'Heute Geburtstag!' : 'Geburtstag ' + inDays(b.days)) + '</small>' : p.bio ? '<small>' + esc(p.bio) + '</small>' : '') + '</span></a>' +
        ((p.contact.tags || []).length ? '<div class="tags">' + p.contact.tags.map(function (t) { return '<span class="tagchip">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
        '<button type="button" class="link-btn" data-act="label">🏷 Kennzeichnen</button></article>';
    }
    function paintGrid() {
      var list = fr.friends.filter(function (p) {
        var hay = (p.name + ' ' + p.contact.relation + ' ' + (p.contact.tags || []).join(' ')).toLowerCase();
        return (!q || hay.indexOf(q) >= 0) && (!filter || p.contact.relation === filter || (p.contact.tags || []).indexOf(filter) >= 0);
      });
      $('#fgrid').innerHTML = list.length ? list.map(friendCard).join('') : '<p class="muted">Keine Treffer.</p>';
    }
    function person(p, btns) { return '<li>' + avatar(p, 'sm') + '<span><b>' + handle(p) + '</b>' + (p.bio ? '<small>' + esc(p.bio) + '</small>' : '') + '</span><span class="sp"></span>' + btns + '</li>'; }

    view(ctx,
      '<header class="page-head"><p class="eyebrow">Nur Freunde sehen sich gegenseitig</p><h1>Freunde &amp; Gruppen</h1></header>' +
      '<div class="friends-top" data-stagger>' +
      '<div class="panel handle-box"><p class="eyebrow">Dein Freundescode</p><button type="button" class="handle-big" data-act="copy-handle">' + handle(me, true) + ' <small>kopieren</small></button>' +
      '<p class="muted small">Schick ihn Freunden und Familie. Sie geben ihn bei sich ein, du bestätigst die Anfrage, fertig. Die Codes deiner Freunde siehst du nicht, damit niemand sie weitergeben kann.</p>' +
      '<button type="button" class="btn ghost wide" data-act="invite">🔗 Einladungslink &amp; QR-Code</button></div>' +
      '<form class="panel add-friend" novalidate><label>Freund hinzufügen<span class="url-row"><input name="handle" placeholder="Name#CODE" autocomplete="off" maxlength="40" required><button type="submit" class="btn">Anfrage senden</button></span></label><p class="msg"></p></form>' +
      '</div>' +
      (fr.incoming.length || fr.outgoing.length ? '<section class="requests"><h2>Anfragen</h2><ul class="plist">' +
        fr.incoming.map(function (p) { return person(p, '<button type="button" class="btn small" data-act="accept" data-id="' + p.id + '">Annehmen</button><button type="button" class="btn small ghost" data-act="decline" data-id="' + p.id + '">Ablehnen</button>'); }).join('') +
        fr.outgoing.map(function (p) { return person(p, '<span class="muted small">wartet auf Bestätigung</span><button type="button" class="btn small ghost" data-act="decline" data-id="' + p.id + '">Zurückziehen</button>'); }).join('') +
        '</ul></section>' : '') +
      '<section><div class="sec-head"><h2>Deine Freunde <small class="muted">' + fr.friends.length + '</small></h2>' +
      (fr.friends.length ? '<div class="filters"><input type="search" name="q" placeholder="Suchen …" aria-label="Freunde suchen">' +
        (labels.length ? '<select name="filter" aria-label="Nach Rolle oder Tag filtern"><option value="">Alle Rollen &amp; Tags</option>' + labels.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select>' : '') + '</div>' : '') + '</div>' +
      (fr.friends.length ? '<div class="fgrid" id="fgrid"></div>' : emptyBox('🤝', 'Noch keine Freunde', 'Gib oben den Namen mit Code eines Freundes ein, z. B. <code>Anna#4F7KD</code>.')) + '</section>' +
      '<section><div class="sec-head"><h2>Gruppen</h2><button type="button" class="btn" data-act="new-group"' + (fr.friends.length ? '' : ' disabled') + '>+ Neue Gruppe</button></div>' +
      '<p class="muted">Nur du siehst deine Gruppen. Mitglieder erfahren nicht, in welcher Gruppe sie sind. Gib Listen für ganze Gruppen frei.</p>' +
      (groups.length ? '<div class="ggrid" data-stagger>' + groups.map(function (g) {
        var ms = g.wl_group_members.map(function (m) { return byId[m.member]; }).filter(Boolean);
        return '<article class="gcard" style="--c:' + esc(g.color) + '" data-id="' + g.id + '"><div class="gc-head"><span class="gc-ico">' + esc(g.emoji) + '</span><b>' + esc(g.name) + '</b><button type="button" class="link-btn" data-act="edit-group">Bearbeiten</button></div>' +
          '<div class="stack">' + (ms.length ? ms.slice(0, 8).map(function (p) { return avatar(p, 'sm'); }).join('') + (ms.length > 8 ? '<span class="more">+' + (ms.length - 8) + '</span>' : '') : '<span class="muted small">Noch leer</span>') + '</div>' +
          '<small class="muted">' + (ms.length ? esc(ms.map(function (p) { return p.name; }).join(', ')) : '') + '</small></article>';
      }).join('') + '</div>' : emptyBox('👪', 'Noch keine Gruppen', 'z. B. „Familie“, „Uni“ oder „Wichtel 2026“.')) + '</section>');
    if (fr.friends.length) paintGrid();

    app.oninput = function (e) {
      if (e.target.name === 'q') { q = e.target.value.trim().toLowerCase(); paintGrid(); }
    };
    app.onchange = function (e) { if (e.target.name === 'filter') { filter = e.target.value; paintGrid(); } };
    app.onsubmit = async function (e) {
      e.preventDefault();
      var f = e.target, m = $('.msg', f), h = f.handle.value.trim();
      if (!/^.{2,24}#[A-Za-z0-9]{5}$/.test(h)) return say(m, 'Bitte im Format Name#CODE eingeben, z. B. Anna#4F7KD.', false);
      try {
        var r = await busy($('[type=submit]', f), function () { return Api.rpc('wl_add_friend', { p_handle: h }); });
        var txt = { requested: ['Anfrage gesendet! Sobald sie bestätigt ist, seht ihr euch.', true], accepted: ['Ihr seid jetzt befreundet 🎉', true],
          not_found: ['Niemanden mit diesem Namen und Code gefunden.', false], self: ['Das bist du selbst 😉', false],
          already_friends: ['Ihr seid schon befreundet.', true], already_requested: ['Anfrage wurde schon gesendet.', true], invalid: ['Bitte im Format Name#CODE eingeben.', false] }[r] || ['Erledigt.', true];
        if (r === 'requested' || r === 'accepted') { FX.toast(txt[0]); render(); } else say(m, txt[0], txt[1]);
      } catch (err) { say(m, errText(err), false); }
    };
    app.onclick = async function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var holder = b.closest('[data-id]'), act = b.dataset.act, id = holder && holder.getAttribute('data-id');
      if (act === 'copy-handle') return copy(me.name + '#' + me.code, 'Code kopiert');
      if (act === 'invite') return inviteDialog();
      if (act === 'label') return labelDialog(byId[id], render);
      if (act === 'new-group') return groupDialog(null, fr.friends);
      if (act === 'edit-group') return groupDialog(groups.filter(function (g) { return g.id === id; })[0], fr.friends);
      try {
        if (act === 'accept') { await busy(b, function () { return Api.rpc('wl_accept_friend', { p_other: id }); }); FX.toast('Freundschaft bestätigt 🎉'); }
        if (act === 'decline') { await busy(b, function () { return Api.rpc('wl_remove_friend', { p_other: id }); }); FX.toast('Anfrage entfernt'); }
        render();
      } catch (err) { FX.toast(errText(err)); }
    };
  }

  function labelDialog(p, done) {
    var c = p.contact;
    openDlg(dlgHead('Kennzeichnung für ' + esc(p.name)) +
      '<form class="form" novalidate><p class="muted small">🔒 Nur du siehst diese Angaben. ' + esc(p.name) + ' erfährt davon nichts.</p>' +
      '<label>Rolle / Verwandtschaft<input name="relation" list="relations" maxlength="40" value="' + esc(c.relation) + '" placeholder="z. B. Schwester, Kollegin …" autofocus></label>' +
      '<datalist id="relations">' + RELATIONS.map(function (r) { return '<option value="' + esc(r) + '">'; }).join('') + '</datalist>' +
      '<div class="quick">' + ['Mutter', 'Vater', 'Schwester', 'Bruder', 'Oma', 'Opa', 'Partner/in', 'Freund/in'].map(function (r) { return '<button type="button" class="chip" data-rel="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>' +
      '<label>Eigene Tags <small class="muted">mit Komma trennen</small><input name="tags" maxlength="300" value="' + esc((c.tags || []).join(', ')) + '" placeholder="z. B. Wichteln, Uni, Fußball"></label>' +
      '<label>Notiz <small class="muted">z. B. Geschenkideen</small><textarea name="note" rows="3" maxlength="300">' + esc(c.note) + '</textarea></label>' +
      '<p class="msg"></p><div class="dlg-actions"><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="submit" class="btn">Speichern</button></div></form>', 'small');
    var f = $('form', dlg);
    f.addEventListener('click', function (e) { var r = e.target.closest('[data-rel]'); if (r) f.relation.value = r.getAttribute('data-rel'); });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = vals(f), tags = v.tags.split(',').map(function (t) { return t.trim().slice(0, 30); }).filter(Boolean).slice(0, 12);
      try {
        await busy($('[type=submit]', f), function () { return Api.upsert('wl_contacts', { owner: me.id, friend: p.id, relation: v.relation, tags: tags, note: v.note }); });
        dlg.close(); FX.toast('Gespeichert'); done();
      } catch (err) { say($('.msg', f), errText(err), false); }
    });
  }

  function groupDialog(g, friends) {
    var x = g || { name: '', emoji: '👪', color: '#5b85ff', wl_group_members: [] }, sel = x.wl_group_members.map(function (m) { return m.member; });
    openDlg(dlgHead(g ? 'Gruppe bearbeiten' : 'Neue Gruppe') +
      '<form class="form" novalidate><label>Name<input name="name" required maxlength="40" value="' + esc(x.name) + '" placeholder="z. B. Familie" autofocus></label>' +
      '<fieldset><legend>Symbol</legend>' + emojiPicker('emoji', GROUP_EMOJIS, x.emoji) + '</fieldset>' +
      '<fieldset><legend>Farbe</legend>' + colorPicker('color', x.color) + '</fieldset>' +
      '<fieldset><legend>Mitglieder</legend><div class="checks">' + friends.map(function (p) {
        return '<label class="cchip"><input type="checkbox" name="members" value="' + p.id + '"' + (sel.indexOf(p.id) >= 0 ? ' checked' : '') + '><span>' + avatar(p, 'xs') + esc(p.name) + (p.contact.relation ? ' <small>' + esc(p.contact.relation) + '</small>' : '') + '</span></label>';
      }).join('') + '</div></fieldset>' +
      '<p class="msg"></p><div class="dlg-actions">' + (g ? '<button type="button" class="btn ghost danger-text" data-act="del-group">Gruppe löschen</button><span class="sp"></span>' : '') +
      '<button type="button" class="btn ghost" data-close>Abbrechen</button><button type="submit" class="btn">Speichern</button></div></form>');
    var f = $('form', dlg);
    if (g) $('[data-act="del-group"]', f).addEventListener('click', async function () {
      if (!(await confirmDlg('Gruppe „' + g.name + '“ löschen? Listen, die nur für diese Gruppe freigegeben waren, sehen deren Mitglieder dann nicht mehr.', 'Löschen'))) return;
      try { await Api.remove('wl_groups', 'id=eq.' + g.id); FX.toast('Gruppe gelöscht'); render(); } catch (err) { FX.toast(errText(err)); }
    });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = vals(f), m = $('.msg', f);
      if (!v.name) return say(m, 'Bitte gib der Gruppe einen Namen.', false);
      try {
        await busy($('[type=submit]', f), async function () {
          var row = { name: v.name, emoji: v.emoji || '👪', color: v.color || '#5b85ff' };
          var out = g ? await Api.update('wl_groups', 'id=eq.' + g.id, row) : await Api.insert('wl_groups', row);
          await Api.rpc('wl_set_group_members', { p_group: out[0].id, p_members: v.members || [] });
        });
        dlg.close(); FX.toast('Gruppe gespeichert'); render();
      } catch (err) { say(m, errText(err), false); }
    });
  }

  async function friendPage(ctx, r) {
    if (!isId(r.id)) throw Object.assign(new Error('no_access'), { code: 'no_access' });
    if (r.id === me.id) return go('./?seite=profil', true);
    var res = await Promise.all([loadFriends(), Api.get('wl_lists', 'owner=eq.' + r.id + '&archived=is.false&select=*,wl_items(count)&order=event_date.asc.nullslast'), loadGroups(),
      // Freunde dieses Freundes (nur wenn er mich als Freund fuehrt und nur, wer das erlaubt); sonst kein Abschnitt
      Api.rpc('wl_friends_of', { p_via: r.id }).catch(function () { return null; })]);
    var fr = res[0], p = fr.friends.filter(function (x) { return x.id === r.id; })[0];
    if (!p) throw Object.assign(new Error('no_access'), { code: 'no_access' });
    var groups = res[2], fof = res[3] || [];
    function fofRow(x) {
      var act = x.status === 'friends' ? '<a class="btn small ghost" href="./?seite=freund&id=' + esc(x.id) + '">Befreundet</a>'
        : x.status === 'requested' ? '<span class="muted small">Angefragt</span>'
        : x.status === 'incoming' ? '<button type="button" class="btn small" data-act="fof-accept" data-pid="' + esc(x.id) + '">Anfrage annehmen</button>'
        : '<button type="button" class="btn small" data-act="fof-req" data-pid="' + esc(x.id) + '">Anfrage senden</button>';
      return '<li>' + avatar(x, 'sm') + '<span><b>' + esc(x.name) + '</b></span><span class="sp"></span>' + act + '</li>';
    }
    setTheme(p.theme);
    view(ctx,
      '<p class="back"><a href="./?seite=freunde"><span class="arr">←</span> Freunde</a></p>' +
      '<div class="friend-top" data-stagger>' + profileCard(p, { big: true }) +
      '<div class="panel"><h3>Deine Kennzeichnung</h3><p class="muted small">🔒 Nur für dich sichtbar.</p>' +
      '<p>' + (p.contact.relation ? '<b>' + esc(p.contact.relation) + '</b> ' : '<span class="muted">Keine Rolle</span> ') + (p.contact.tags || []).map(function (t) { return '<span class="tagchip">' + esc(t) + '</span>'; }).join('') + '</p>' +
      (p.contact.note ? '<p class="note">📝 ' + esc(p.contact.note) + '</p>' : '') +
      '<button type="button" class="btn small ghost" data-act="label">🏷 Bearbeiten</button>' +
      '<h3>Stufe</h3><p class="muted small">' + (p.level === 'known'
        ? esc(p.name) + ' ist für dich <b>Bekannt</b> und sieht nur Listen, die du gezielt freigibst (z. B. per Link), nicht „Alle Freunde“.'
        : esc(p.name) + ' ist für dich <b>Freund</b> und sieht alle Listen, die du für „Alle Freunde“ freigibst.') + '</p>' +
      '<button type="button" class="btn small ghost" data-act="level">' + (p.level === 'known' ? '⭐ Zum Freund machen' : '↓ Zu Bekanntem machen') + '</button>' +
      (groups.length ? '<h3>In deinen Gruppen</h3><div class="checks">' + groups.map(function (g) {
        var on = g.wl_group_members.some(function (m) { return m.member === p.id; });
        return '<label class="cchip"><input type="checkbox" data-group="' + g.id + '"' + (on ? ' checked' : '') + '><span style="--c:' + esc(g.color) + '">' + esc(g.emoji) + ' ' + esc(g.name) + '</span></label>';
      }).join('') + '</div>' : '') +
      '<button type="button" class="link-btn danger-text" data-act="unfriend">Freundschaft beenden</button></div></div>' +
      '<section><div class="sec-head"><h2>Listen von ' + esc(p.name) + '</h2></div>' +
      (res[1].length ? '<div class="lgrid" data-stagger>' + res[1].map(function (l) { return listCard(l); }).join('') + '</div>'
        : emptyBox('🎈', 'Keine Listen für dich', esc(p.name) + ' hat (noch) keine Liste für dich freigegeben.')) + '</section>' +
      (fof.length ? '<section><div class="sec-head"><h2>Freunde von ' + esc(p.name) + ' <small class="muted">' + fof.length + '</small></h2></div>' +
        '<p class="muted small">Hier stehen nur Freunde von ' + esc(p.name) + ', die das in ihrem Profil erlauben. Codes bleiben verborgen. Ob du hier bei anderen auftauchst, stellst du in deinem <a href="./?seite=profil">Profil</a> ein.</p>' +
        '<ul class="plist">' + fof.map(fofRow).join('') + '</ul></section>' : ''));
    app.onchange = async function (e) {
      var gid = e.target.getAttribute('data-group'); if (!gid) return;
      try {
        if (e.target.checked) await Api.insert('wl_group_members', { group_id: gid, member: p.id });
        else await Api.remove('wl_group_members', 'group_id=eq.' + gid + '&member=eq.' + p.id);
        FX.toast(e.target.checked ? 'Zur Gruppe hinzugefügt' : 'Aus Gruppe entfernt');
      } catch (err) { e.target.checked = !e.target.checked; FX.toast(errText(err)); }
    };
    app.onclick = async function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'label') labelDialog(p, render);
      if (b.dataset.act === 'fof-req' || b.dataset.act === 'fof-accept') {
        try {
          var out = await busy(b, function () {
            return b.dataset.act === 'fof-req' ? Api.rpc('wl_request_via', { p_via: p.id, p_other: b.dataset.pid }) : Api.rpc('wl_accept_friend', { p_other: b.dataset.pid }).then(function () { return 'accepted'; });
          });
          FX.toast(out === 'accepted' || out === 'already_friends' ? 'Ihr seid jetzt befreundet 🎉' : 'Anfrage gesendet');
          render();
        } catch (err) { FX.toast(errText(err)); }
      }
      if (b.dataset.act === 'level') {
        try { await busy(b, function () { return Api.rpc('wl_set_level', { p_other: p.id, p_level: p.level === 'known' ? 'friend' : 'known' }); }); FX.toast(p.level === 'known' ? p.name + ' ist jetzt Freund ⭐' : p.name + ' ist jetzt Bekannt'); render(); } catch (err) { FX.toast(errText(err)); }
      }
      if (b.dataset.act === 'unfriend') {
        if (!(await confirmDlg('Freundschaft mit ' + p.name + ' beenden? Ihr seht dann gegenseitig keine Listen mehr, Gruppen, Kennzeichnungen und Vorschläge werden entfernt. Über deine Freigabe-Links kann ' + p.name + ' sich nicht wieder verbinden.', 'Beenden'))) return;
        try { await Api.rpc('wl_remove_friend', { p_other: p.id }); FX.toast('Freundschaft beendet'); go('./?seite=freunde', true); } catch (err) { FX.toast(errText(err)); }
      }
    };
  }

  // ---------- Meine Geschenke ----------
  async function giftsPage(ctx, r, quiet) {
    var res = await Promise.all([Api.rpc('wl_my_reservations'), Api.get('wl_orphan_gifts', 'order=deleted_at.desc').catch(function () { return []; })]);
    var rows = res[0], orphans = res[1];
    setTheme(me.theme);
    var done = 0, groups = {}, order = [];
    function cost(g) { return g.price == null || g.group_gift ? 0 : g.price * g.quantity; }
    var budget = fmtSums(sumCur(rows, cost)) || money(0, 'EUR'), open = fmtSums(sumCur(rows, function (g) { return g.purchased ? 0 : cost(g); })) || money(0, 'EUR');
    rows.forEach(function (g) {
      if (g.purchased) done++;
      if (!groups[g.list_id]) { groups[g.list_id] = []; order.push(g.list_id); }
      groups[g.list_id].push(g);
    });
    // Geschenke, die schon gekauft waren, deren Wunsch aber geloescht wurde
    var orphanBox = orphans.length ? '<section class="gift-group orphans"><div class="gg-head"><span>🗑</span><span><b>Gelöschte Wünsche, die du schon gekauft hast</b> <small>Der Wunsch wurde von der Liste entfernt. Vielleicht kurz nachfragen, ob das Geschenk noch passt.</small></span></div>' +
      '<ul class="gift-rows">' + orphans.map(function (o) {
        return '<li data-oid="' + esc(o.id) + '"><span class="thumb">' + placeholder('🎁', o.title) + '</span><span class="gr-main"><b>' + esc(o.title) + '</b><small>' +
          [o.owner_name ? 'für ' + esc(o.owner_name) : '', o.list_title ? esc(o.list_title) : '', o.quantity > 1 ? o.quantity + '×' : '', 'gelöscht am ' + fmtDate(new Date(o.deleted_at), true)].filter(Boolean).join(' · ') + '</small></span>' +
          '<span class="gr-price">' + esc(money(o.price, o.currency)) + '</span><button type="button" class="icon-btn" data-act="orphan-ok" aria-label="Hinweis entfernen" title="Erledigt">✓</button></li>';
      }).join('') + '</ul></section>' : '';
    var pct = rows.length ? Math.round(done / rows.length * 100) : 0;
    view(ctx,
      '<header class="page-head"><p class="eyebrow">Deine Einkaufsliste</p><h1>Meine Geschenke</h1><p class="lead">Alles, was du für andere reserviert hast. Hak ab, was du schon besorgt hast.</p></header>' +
      (rows.length ? '<div class="gift-stats" data-stagger><div class="tile"><b>' + rows.length + '</b><span>reserviert</span></div><div class="tile"><b>' + done + '</b><span>schon gekauft</span></div>' +
        '<div class="tile"><b>' + esc(budget) + '</b><span>Budget (ohne Gruppengeschenke)</span></div>' +
        '<div class="tile prog"><span>Fortschritt ' + pct + ' %</span><div class="bar"><i style="width:' + pct + '%"></i></div><small class="muted">' + esc(open) + ' noch offen</small></div></div>' + orphanBox +
        order.map(function (id) {
          var gs = groups[id], g0 = gs[0], d = g0.event_date ? daysUntil(g0.event_date) : null;
          return '<section class="gift-group"><a class="gg-head" href="./?liste=' + id + '">' + avatar({ avatar: g0.owner_avatar, color: g0.owner_color }, 'sm') +
            '<span><b>' + esc(g0.owner_name) + '</b> · ' + esc(g0.list_emoji) + ' ' + esc(g0.list_title) + (d !== null && d >= 0 ? ' <small>' + fmtDate(g0.event_date) + ', ' + inDays(d) + '</small>' : '') + '</span><span class="arr">→</span></a>' +
            '<ul class="gift-rows">' + gs.map(function (g) {
              var img = /^https:\/\//.test(g.image_url || '') ? '<img src="' + esc(g.image_url) + '" alt="' + esc(g.title) + '" loading="lazy" referrerpolicy="no-referrer" data-ph="' + esc(g.list_emoji) + '">' : placeholder(g.list_emoji, g.title);
              var url = safeUrl(g.url);
              return '<li class="' + (g.purchased ? 'bought' : '') + '" data-id="' + g.item_id + '"><label class="buy"><input type="checkbox" data-act="bought"' + (g.purchased ? ' checked' : '') + '><span>Gekauft</span></label>' +
                '<span class="thumb">' + img + '</span><span class="gr-main"><b>' + esc(g.title) + '</b><small>' + [g.quantity > 1 ? g.quantity + '×' : '', g.group_gift ? '🧩 Gruppengeschenk' : '', g.received ? '🎉 schon erfüllt' : '', g.note ? esc(g.note) : ''].filter(Boolean).join(' · ') + '</small></span>' +
                '<span class="gr-price">' + esc(money(g.price, g.currency)) + '</span>' +
                (url ? '<a class="btn small ghost" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Shop ↗</a>' : '') +
                '<button type="button" class="icon-btn" data-act="unreserve" aria-label="Reservierung freigeben" title="Freigeben">✕</button></li>';
            }).join('') + '</ul></section>';
        }).join('')
        : orphanBox + emptyBox('🛍️', 'Noch nichts reserviert', 'Öffne eine Liste deiner Freunde und reserviere einen Wunsch. Dann erscheint er hier.', '<a class="btn" href="./">Zur Übersicht</a>')), quiet);
    app.onchange = async function (e) {
      if (e.target.getAttribute('data-act') !== 'bought') return;
      var id = e.target.closest('[data-id]').getAttribute('data-id');
      try { await Api.rpc('wl_set_purchased', { p_item: id, p_purchased: e.target.checked }); buzz(); giftsPage(ctx, r, true); } catch (err) { FX.toast(errText(err)); }
    };
    app.onclick = async function (e) {
      var ok = e.target.closest('[data-act="orphan-ok"]');
      if (ok) { try { await Api.remove('wl_orphan_gifts', 'id=eq.' + ok.closest('[data-oid]').getAttribute('data-oid')); giftsPage(ctx, r, true); } catch (err) { FX.toast(errText(err)); } return; }
      var b = e.target.closest('[data-act="unreserve"]'); if (!b) return;
      if (!(await confirmDlg('Reservierung freigeben? Dann können andere diesen Wunsch wieder reservieren.', 'Freigeben'))) return;
      try { await Api.rpc('wl_unreserve', { p_item: b.closest('[data-id]').getAttribute('data-id') }); FX.toast('Freigegeben'); giftsPage(ctx, r, true); } catch (err) { FX.toast(errText(err)); }
    };
  }

  // ---------- Profil ----------
  async function profilePage(ctx) {
    setTheme(me.theme);
    view(ctx,
      '<header class="page-head"><p class="eyebrow">So sehen dich deine Freunde</p><h1>Dein Profil</h1></header>' +
      '<div class="profile-grid"><form class="panel form" id="pform" novalidate>' +
      '<label>Anzeigename<input name="name" required minlength="2" maxlength="24" value="' + esc(me.name) + '"></label>' +
      '<p class="muted small">Dein Code <b>#' + esc(me.code) + '</b> bleibt immer gleich. Freunde finden dich mit Name und Code.</p>' +
      '<fieldset><legend>Avatar</legend>' + richPicker('avatar', me.avatar) + '</fieldset>' +
      '<fieldset><legend>Farbe</legend>' + colorPicker('color', me.color) + '</fieldset>' +
      '<fieldset><legend>Design deiner Profilkarte und Seiten</legend>' + themePicker('theme', me.theme) + '</fieldset>' +
      '<fieldset class="priv-sec"><legend>👕 Größen <small class="muted">sichtbar für alle, die du kennst (Bekannte und Freunde)</small></legend>' +
      '<div id="sizeRows">' + (me.sizesList || []).map(sizeRow).join('') + '</div>' +
      '<datalist id="sizeLabels">' + SIZE_LABELS.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>' +
      '<button type="button" class="btn small ghost" data-act="add-size">+ Größe hinzufügen</button></fieldset>' +
      '<fieldset class="priv-sec"><legend>🔒 Persönliches <small class="muted">nur für deine Freunde sichtbar, nicht für Bekannte</small></legend>' +
      '<div class="row2"><label>Geburtstag<input name="birthday" type="date" value="' + esc(me.birthday || '') + '"></label>' +
      '<label>Über mich<input name="bio" maxlength="160" value="' + esc(me.bio) + '" placeholder="z. B. Kaffee, Bücher und Bergtouren"></label></div>' +
      '<div class="row2"><label>💚 Mag ich<input name="likes" maxlength="200" value="' + esc(me.likes) + '" placeholder="Lieblingsfarbe, Hobbys …"></label>' +
      '<label>🚫 Lieber nicht<input name="dislikes" maxlength="200" value="' + esc(me.dislikes) + '" placeholder="z. B. Deko, Süßes"></label></div></fieldset>' +
      '<fieldset class="priv-sec"><legend>🤝 Über Freunde gefunden werden</legend>' +
      '<label class="check"><input type="checkbox" name="discoverable"' + (me.discoverable !== false ? ' checked' : '') + '> Freunde meiner Freunde dürfen mich auf deren Profil sehen und mir eine Anfrage schicken</label>' +
      '<p class="muted small">Ausgeschaltet findet dich nur, wer deinen Namen mit Code kennt.</p></fieldset>' +
      '<p class="msg"></p><div class="dlg-actions"><button type="submit" class="btn">Profil speichern</button></div></form>' +
      '<aside class="sticky"><p class="eyebrow">Vorschau</p><div id="pcPrev"></div>' +
      '<div class="panel account"><h3>Konto</h3><p class="muted small">Angemeldet als ' + esc(Api.user.email) + '</p>' +
      '<form id="pwForm" class="form" novalidate><label>Neues Passwort<input name="pw" type="password" autocomplete="new-password" minlength="8" maxlength="72"></label>' +
      '<label>Wiederholen<input name="pw2" type="password" autocomplete="new-password" minlength="8" maxlength="72"></label><p class="msg"></p>' +
      '<button type="submit" class="btn small ghost">Passwort ändern</button></form>' +
      '<button type="button" class="btn ghost wide" data-act="logout">Abmelden</button></div>' +
      '<div class="panel account"><h3>Darstellung</h3><p class="muted small">Jedes Design gibt es hell und dunkel. „Automatisch“ folgt deinem Gerät.</p>' +
      '<div class="mode-seg" role="group" aria-label="Hell oder dunkel">' + [['auto', 'Automatisch'], ['light', '☀️ Hell'], ['dark', '🌙 Dunkel']].map(function (o) {
        return '<button type="button" data-mode="' + o[0] + '" class="' + (modePref() === o[0] ? 'on' : '') + '" aria-pressed="' + (modePref() === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>' +
      '<label class="check"><input type="checkbox" data-act="still"' + (FX.still ? ' checked' : '') + '> Animationen pausieren <small class="muted">Schnee, Blätter und Lichter stehen still</small></label></div>' +
      '<div class="panel account more-links"><h3>Mehr</h3>' +
      '<a class="web-only" href="app.html">📱 Wunschliste als App</a>' +
      '<a href="' + DISCORD + '" target="_blank" rel="noopener">💬 Hilfe im Discord</a>' +
      '<a class="exit" href="../">Zur Skeison-Hauptseite <span class="arr">↗</span></a></div></aside></div>');
    var f = $('#pform');
    bindPickers(f);
    function sizes() {
      return $$('.size-row', f).map(function (r, i) { return { label: $('.sz-l', r).value.trim(), value: $('.sz-v', r).value.trim(), sort: i }; })
        .filter(function (s) { return s.label && s.value; });
    }
    function draft() { var v = vals(f); return Object.assign({}, me, v, { birthday: v.birthday || null, sizesList: sizes() }); }
    function prev() { var d = draft(); $('#pcPrev').innerHTML = profileCard(d, { self: true }); setTheme(d.theme); }
    prev();
    app.oninput = function (e) { if (e.target.form === f) prev(); };
    app.onchange = app.oninput;
    app.onsubmit = async function (e) {
      e.preventDefault();
      if (e.target.id === 'pwForm') {
        if (await savePassword(e.target)) say($('.msg', e.target), 'Passwort geändert ✓', true);
        return;
      }
      var d = draft(), m = $('.msg', f);
      if (d.name.length < 2 || d.name.indexOf('#') >= 0) return say(m, ERR.name, false);
      try {
        // Ein Aufruf, eine Transaktion: Profil, Persoenliches und Groessen werden gemeinsam gespeichert oder gar nicht
        var out = await busy($('[type=submit]', f), function () {
          return Api.rpc('wl_save_profile', { p_name: d.name, p_avatar: d.avatar, p_color: d.color, p_theme: d.theme, p_bio: d.bio, p_birthday: d.birthday,
            p_likes: d.likes, p_dislikes: d.dislikes, p_sizes: d.sizesList.map(function (s) { return { label: s.label, value: s.value }; }), p_discoverable: !!d.discoverable });
        });
        me = Object.assign(me, out, { code: me.code, bio: d.bio, birthday: d.birthday, likes: d.likes, dislikes: d.dislikes, sizesList: d.sizesList }); $('#meLink').innerHTML = avatar(me, 'xs') + '<span>' + esc(me.name) + '</span>';
        say(m, 'Gespeichert ✓', true); FX.toast('Profil gespeichert');
      } catch (err) { say(m, errText(err), false); }
    };
    app.onclick = function (e) {
      var b = e.target.closest('[data-act], [data-mode]'); if (!b) return;
      if (b.dataset.act === 'logout') { Api.signOut(); history.replaceState(null, '', './'); }
      if (b.dataset.mode) {
        if (window.WLMode) WLMode.set(b.dataset.mode);
        $$('.mode-seg button', app).forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
        return;
      }
      if (b.dataset.act === 'still') { var mb = $('.motion-btn'); if (mb && (mb.getAttribute('aria-pressed') === 'true') !== b.checked) mb.click(); return; }
      if (b.dataset.act === 'add-size') {
        if ($$('.size-row', f).length >= 12) return FX.toast('Mehr als 12 Größen sind nicht möglich.');
        $('#sizeRows').insertAdjacentHTML('beforeend', sizeRow({ label: '', value: '' })); $$('.sz-l', f).pop().focus();
      }
      if (b.dataset.act === 'rm-size') { b.closest('.size-row').remove(); prev(); }
    };
  }
  var SIZE_LABELS = ['Kleidergröße', 'Shirt', 'Pullover', 'Hose', 'Jeans', 'Jacke', 'Schuhe', 'Socken', 'Handschuhe', 'Mütze', 'Ring', 'BH', 'Unterwäsche', 'Körpergröße'];
  function sizeRow(s) {
    return '<div class="size-row"><input class="sz-l" list="sizeLabels" maxlength="24" placeholder="z. B. Schuhe" value="' + esc(s.label) + '" aria-label="Bezeichnung">' +
      '<input class="sz-v" maxlength="40" placeholder="z. B. 43" value="' + esc(s.value) + '" aria-label="Größe"><button type="button" class="icon-btn" data-act="rm-size" aria-label="Zeile entfernen">✕</button></div>';
  }

  // Neues Passwort speichern (Formular mit pw und pw2); hebt auch den Zwang nach einem Admin-Reset auf
  async function savePassword(pf) {
    var pm = $('.msg', pf);
    if (pf.pw.value.length < 8) return say(pm, ERR.password, false);
    if (pf.pw.value !== pf.pw2.value) return say(pm, 'Die Passwörter stimmen nicht überein.', false);
    try {
      var r = await busy($('[type=submit]', pf), function () { return Api.fn('wl-account', { action: 'set-password', password: pf.pw.value }); });
      if (r && r.error) throw Object.assign(new Error(r.error), { code: r.error });
      pf.reset(); return true;
    } catch (err) { say(pm, errText(err), false); return false; }
  }

  // Nach einem Admin-Reset: erst ein eigenes Passwort festlegen
  function forcePassword(ctx) {
    setTheme(me.theme);
    view(ctx, '<div class="force-pw"><div class="panel"><span class="e-ico">🔑</span><h1>Neues Passwort festlegen</h1>' +
      '<p class="lead">Dein Passwort wurde zurückgesetzt. Lege jetzt ein eigenes fest, danach geht es ganz normal weiter.</p>' +
      '<form class="form" novalidate><label>Neues Passwort <small class="muted">mindestens 8 Zeichen</small><input name="pw" type="password" autocomplete="new-password" minlength="8" maxlength="72" autofocus></label>' +
      '<label>Wiederholen<input name="pw2" type="password" autocomplete="new-password" minlength="8" maxlength="72"></label><p class="msg"></p>' +
      '<button type="submit" class="btn wide">Passwort speichern</button></form>' +
      '<p class="muted small">Probleme? Schreib im <a href="' + DISCORD + '" target="_blank" rel="noopener">Discord</a> der Rolle <b>@Admin</b> oder Skeison direkt.</p>' +
      '<button type="button" class="link-btn" data-act="logout">Abmelden</button></div></div>');
    var f = $('input', app); if (f) f.focus();
    app.onsubmit = async function (e) {
      e.preventDefault();
      if (!(await savePassword(e.target))) return;
      me.must_change_password = false; FX.toast('Passwort gespeichert. Willkommen zurück!'); render();
    };
    app.onclick = function (e) { if (e.target.closest('[data-act="logout"]')) Api.signOut(); };
  }

  // ---------- Admin ----------
  async function adminPage(ctx) {
    if (!isAdmin) return go('./', true);
    var users = await Api.rpc('wl_admin_users'), q = '';
    setTheme(me.theme);
    var byId = {}; users.forEach(function (u) { byId[u.id] = u; });
    function sum(k) { return users.reduce(function (s, u) { return s + Number(u[k]); }, 0); }
    function when(t) { return t ? new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' }) : 'nie'; }
    function row(u) {
      return '<li data-id="' + u.id + '">' + avatar(u, 'sm') +
        '<span class="au-main"><b>' + handle(u, true) + (u.is_admin ? ' <span class="tagchip">Admin</span>' : '') + (u.must_change_password ? ' <span class="tagchip warn">muss Passwort ändern</span>' : '') + '</b><small>' + esc(u.email) + '</small></span>' +
        '<span class="au-stats"><small>Seit ' + when(u.created_at) + ' · zuletzt da: ' + when(u.last_sign_in_at) + '</small><small>' +
        [plural(+u.lists, 'Liste', 'Listen'), plural(+u.items, 'Wunsch', 'Wünsche'), plural(+u.friends, 'Freund', 'Freunde'), +u.reservations + ' reserviert'].join(' · ') + '</small></span>' +
        '<span class="au-act">' + (u.is_admin ? '<small class="muted">geschützt</small>' : '<button type="button" class="btn small" data-act="reset">🔑 Passwort zurücksetzen</button>' +
        '<button type="button" class="icon-btn" data-act="delete" aria-label="Konto löschen" title="Konto löschen">🗑</button>') + '</span></li>';
    }
    function paintRows() {
      var list = users.filter(function (u) { return !q || (u.name + '#' + u.code + ' ' + u.email).toLowerCase().indexOf(q) >= 0; });
      $('#ulist').innerHTML = list.length ? list.map(row).join('') : '<li class="muted">Keine Treffer.</li>';
    }
    view(ctx,
      '<header class="page-head"><p class="eyebrow">Nur für Admins</p><h1>Verwaltung</h1><p class="lead">Konten im Überblick. Passwörter setzt du hier zurück: Der Nutzer bekommt ein Einmal-Passwort und muss beim nächsten Anmelden ein eigenes festlegen.</p></header>' +
      '<div class="gift-stats" data-stagger>' + [[users.length, 'Konten'], [sum('lists'), 'Listen'], [sum('items'), 'Wünsche'], [sum('reservations'), 'Reservierungen']].map(function (t) {
        return '<div class="tile"><b>' + t[0] + '</b><span>' + t[1] + '</span></div>';
      }).join('') + '</div>' +
      '<section><div class="sec-head"><h2>Konten</h2><div class="filters"><input type="search" name="q" placeholder="Name, Code oder E-Mail …" aria-label="Konten suchen"></div></div>' +
      '<ul class="ulist" id="ulist"></ul></section>');
    paintRows();
    app.oninput = function (e) { if (e.target.name === 'q') { q = e.target.value.trim().toLowerCase(); paintRows(); } };
    app.onclick = async function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var u = byId[b.closest('[data-id]').getAttribute('data-id')];
      if (b.dataset.act === 'reset') return resetDialog(u);
      if (b.dataset.act === 'delete') {
        if (!(await confirmDlg('Konto von ' + u.name + '#' + u.code + ' (' + u.email + ') mit allen Listen, Wünschen und Reservierungen endgültig löschen?', 'Endgültig löschen'))) return;
        try {
          var r = await Api.fn('wl-account', { action: 'admin-delete', user_id: u.id });
          if (r && r.error) throw Object.assign(new Error(r.error), { code: r.error });
          FX.toast('Konto gelöscht'); render();
        } catch (err) { FX.toast(errText(err)); }
      }
    };
  }
  function resetDialog(u) {
    openDlg(dlgHead('Passwort zurücksetzen') +
      '<form class="form" novalidate><p class="muted">Für <b>' + handle(u, true) + '</b> (' + esc(u.email) + '). Beim nächsten Anmelden muss ein eigenes Passwort festgelegt werden.</p>' +
      '<label class="vopt"><input type="radio" name="mode" value="random" checked><span><b>🎲 Einmal-Passwort erzeugen</b><small>Zufällig; du siehst es gleich und gibst es weiter.</small></span></label>' +
      '<label class="vopt"><input type="radio" name="mode" value="own"><span><b>✍️ Standardpasswort vergeben</b><small>Ein Passwort deiner Wahl, z. B. dein übliches Reset-Passwort.</small></span></label>' +
      '<label class="own-pw" hidden>Standardpasswort <small class="muted">mindestens 8 Zeichen</small><input name="password" minlength="8" maxlength="72" autocomplete="off"></label>' +
      '<p class="msg"></p><div class="dlg-actions"><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="submit" class="btn">Zurücksetzen</button></div></form>', 'small');
    var f = $('form', dlg);
    f.addEventListener('change', function () { $('.own-pw', f).hidden = vals(f).mode !== 'own'; });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = vals(f), m = $('.msg', f), body = { action: 'admin-reset', user_id: u.id };
      if (v.mode === 'own') { if (v.password.length < 8) return say(m, ERR.password, false); body.password = v.password; }
      try {
        var r = await busy($('[type=submit]', f), function () { return Api.fn('wl-account', body); });
        if (r.error) throw Object.assign(new Error(r.error), { code: r.error });
        openDlg(dlgHead('Passwort zurückgesetzt') + '<p>Gib dieses Passwort an <b>' + esc(u.name) + '</b> weiter, am besten per Discord-Direktnachricht:</p>' +
          '<button type="button" class="handle-big" id="pwCopy">' + esc(r.password) + ' <small>kopieren</small></button>' +
          '<p class="muted small">Beim nächsten Anmelden muss ' + esc(u.name) + ' ein eigenes Passwort festlegen.</p>' +
          '<div class="dlg-actions"><button type="button" class="btn" data-close>Fertig</button></div>', 'small');
        $('#pwCopy', dlg).addEventListener('click', function () { copy(r.password, 'Passwort kopiert'); });
        dlg.addEventListener('close', function once() { dlg.removeEventListener('close', once); render(); });
      } catch (err) { say(m, errText(err), false); }
    });
  }


  // ---------- Links mit QR-Code (Liste teilen, Freunde einladen) ----------
  function pageUrl(param, token) { return location.origin + location.pathname + '?' + param + '=' + token; }
  function qrSvg(url) { var q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
  function saveQr(svg, file) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    a.download = file; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  // Gemeinsamer Dialog: Link anlegen, anzeigen (mit QR-Code), kopieren, teilen, speichern, erneuern, abschalten
  async function linkDialog(cfg) {
    var token = null;
    try { token = await cfg.load(); } catch (e) { return FX.toast(errText(e)); }
    function paint() {
      var url = token && cfg.urlOf(token);
      openDlg(dlgHead(cfg.title) + '<p class="muted">' + cfg.intro + '</p>' +
        (url ? '<div class="share-box"><div class="share-qr" aria-label="QR-Code zum Scannen">' + qrSvg(url) + '</div><div class="share-side">' +
          '<label>' + cfg.label + '<input readonly value="' + esc(url) + '" data-sel></label>' +
          '<div class="dlg-actions start"><button type="button" class="btn" data-act="copy">Link kopieren</button>' +
          (navigator.share ? '<button type="button" class="btn ghost" data-act="native">Teilen …</button>' : '') +
          '<button type="button" class="btn ghost" data-act="qr-save">QR speichern</button></div>' +
          (cfg.extra ? cfg.extra() : '') +
          '<div class="dlg-actions start">' + (cfg.resetText ? '<button type="button" class="link-btn" data-act="reset">↻ Neuen Link erzeugen</button>' : '') +
          '<button type="button" class="link-btn danger-text" data-act="off">Link deaktivieren</button></div></div></div>'
          : '<div class="dlg-actions start"><button type="button" class="btn" data-act="on">🔗 Link erstellen</button></div>') +
        '<div class="dlg-actions"><button type="button" class="btn ghost" data-close>Fertig</button></div>', 'wide');
      // Die Sicherheitsabfrage nutzt denselben Dialog und schliesst ihn; danach den Handler wieder anhaengen
      dlg.onclick = onClick;
      dlg.removeEventListener('close', onClose); dlg.addEventListener('close', onClose);
    }
    // "close" kommt asynchron: ist der Dialog bis dahin schon wieder offen (nach der Abfrage), nichts abbauen
    function onClose() {
      if (dlg.open) return;
      dlg.removeEventListener('close', onClose); if (dlg.onclick === onClick) dlg.onclick = null;
    }
    async function onClick(e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.dataset.act;
      try {
        if (act === 'on') {
          token = await busy(b, function () { return cfg.enable(false); });
          paint(); if (cfg.onEnable) cfg.onEnable();
        } else if (act === 'reset') {
          if (!(await confirmDlg(cfg.resetText, 'Neuen Link erzeugen'))) return paint();
          token = await cfg.enable(true); FX.toast('Neuer Link erstellt'); paint();
        } else if (act === 'off') {
          if (!(await confirmDlg(cfg.offText, 'Deaktivieren'))) return paint();
          await cfg.disable(); token = null; FX.toast('Link deaktiviert'); paint();
        } else if (act === 'copy') copy(cfg.urlOf(token), 'Link kopiert');
        else if (act === 'native') navigator.share({ title: cfg.shareTitle, text: cfg.shareText, url: cfg.urlOf(token) }).catch(function () {});
        else if (act === 'qr-save') saveQr($('.share-qr svg', dlg), cfg.file);
      } catch (err) { FX.toast(errText(err)); }
    }
    paint();
  }

  function shareDialog(st) {
    var l = st.list;
    return linkDialog({
      title: 'Liste teilen', label: 'Dein Freigabe-Link', file: 'wunschliste-qr.svg', shareTitle: l.title, shareText: 'Meine Wunschliste: ' + l.title,
      intro: 'Schick den Link oder zeige den QR-Code. Wer ihn öffnet, sieht <b>ohne Anmeldung nur eine Vorschau</b>. Zum Reservieren meldet man sich an und ist danach bei dir <b>Bekannt</b>: sieht nur diese Liste, nicht deine anderen.',
      load: function () { return Api.get('wl_share_links', 'list_id=eq.' + l.id + '&select=token').then(function (rows) { return rows[0] && rows[0].token; }); },
      enable: function () { return Api.rpc('wl_share_enable', { p_list: l.id }); },
      disable: function () { return Api.rpc('wl_share_disable', { p_list: l.id }); },
      urlOf: function (t) { return pageUrl('teilen', t); },
      extra: function () { return l.visibility === 'private' ? '<p class="msg err">Die Liste ist noch auf „Nur ich“. Bitte stelle sie unter „Liste bearbeiten“ auf „Alle Freunde“ oder „Ausgewählte“, sonst sehen Gäste nichts.</p>' : ''; },
      onEnable: function () { if (l.visibility === 'private') l.visibility = 'custom'; render(); },
      offText: 'Der Link und der QR-Code funktionieren danach nicht mehr. Wer die Liste schon freigeschaltet bekam, behält den Zugriff.'
    });
  }

  // Persoenlicher Einladungslink: befreunden ohne Code
  function inviteDialog() {
    return linkDialog({
      title: '🤝 Freunde per Link einladen', label: 'Dein Einladungslink', file: 'freundschaft-qr.svg', shareTitle: 'Wunschliste',
      shareText: me.name + ' lädt dich ein, auf der Wunschliste befreundet zu sein',
      intro: 'Wer den Link öffnet oder den QR-Code scannt, kann sich mit einem Klick mit dir befreunden, ganz ohne deinen Code. Ihr seid dann <b>Freunde</b> und seht alles, was ihr für „Alle Freunde“ freigebt. <b>Teile ihn nur mit Leuten, die du kennst.</b> Mit „Neuen Link erzeugen“ machst du einen weitergegebenen Link jederzeit ungültig.',
      load: function () { return Api.get('wl_friend_links', 'select=token').then(function (rows) { return rows[0] && rows[0].token; }); },
      enable: function (reset) { return Api.rpc('wl_friend_link_enable', { p_reset: !!reset }); },
      disable: function () { return Api.rpc('wl_friend_link_disable'); },
      urlOf: function (t) { return pageUrl('einladung', t); },
      resetText: 'Neuen Link erzeugen? Der bisherige Link und QR-Code funktionieren dann nicht mehr. Bestehende Freundschaften bleiben.',
      offText: 'Einladungslink deaktivieren? Niemand kann sich dann mehr darüber mit dir befreunden. Bestehende Freundschaften bleiben.'
    });
  }

  // Einladung ansehen, ohne angemeldet zu sein: wer lädt ein, darunter Anmelden oder Registrieren
  async function invitePreview(ctx, token) {
    app.innerHTML = loading();
    var d = null;
    try { d = /^[0-9a-f]{32}$/.test(token) ? await Api.pub('wl_friend_link_preview', { p_token: token }) : null; } catch (e) { d = null; }
    if (ctx.stale()) return;
    if (!d) { setTheme(null); app.innerHTML = inviteGone(); return; }
    setTheme(d.theme);
    app.innerHTML = '<div class="invite-card panel" data-theme="' + esc(d.theme) + '">' + avatar(d, 'xl') +
      '<p class="eyebrow">Einladung</p><h1>' + esc(d.name) + ' möchte mit dir befreundet sein</h1>' +
      '<p class="lead">Melde dich an oder erstelle kostenlos ein Konto. Danach bestätigst du die Freundschaft mit einem Klick.</p></div><div id="authSlot"></div>';
    $('#authSlot', app).appendChild(authEl);
    setTab('register');
  }
  function inviteGone() {
    return '<div class="empty big"><span class="e-ico">🔗</span><h2>Diese Einladung ist nicht mehr gültig</h2><p>Der Link wurde erneuert oder abgeschaltet. Frag die Person nach einem neuen Link.</p><a class="btn" href="./">Zur Wunschliste</a></div>';
  }

  // Einladung angemeldet: erst nach einem Klick befreunden (nur das Oeffnen eines Links befreundet niemanden)
  async function invitePage(ctx, r) {
    var d = /^[0-9a-f]{32}$/.test(r.id || '') ? await Api.rpc('wl_friend_link_preview', { p_token: r.id }) : null;
    if (ctx.stale()) return;
    setTheme(d ? d.theme : me.theme);
    if (!d) return view(ctx, inviteGone());
    var body = d.status === 'self'
      ? '<h1>Das ist dein eigener Einladungslink</h1><p class="lead">Schick ihn an Leute, mit denen du befreundet sein möchtest, oder zeig ihnen den QR-Code.</p><div class="dlg-actions"><button type="button" class="btn" data-act="invite">Link &amp; QR-Code zeigen</button></div>'
      : d.status === 'friends'
        ? '<h1>Ihr seid schon befreundet</h1><p class="lead">Du und ' + esc(d.name) + ' seid bereits Freunde.</p><div class="dlg-actions"><a class="btn" href="./?seite=freund&id=' + esc(d.id) + '">Zum Profil</a></div>'
        : '<p class="eyebrow">Einladung</p><h1>' + esc(d.name) + ' möchte mit dir befreundet sein</h1><p class="lead">' + (d.status === 'known' ? 'Ihr seid bisher Bekannte. ' : '') +
          'Als Freunde seht ihr gegenseitig eure Profile und alle Listen, die für „Alle Freunde“ freigegeben sind.</p>' +
          '<div class="dlg-actions"><a class="btn ghost" href="./">Nicht jetzt</a><button type="button" class="btn" data-act="befriend">🤝 Freunde werden</button></div>';
    view(ctx, '<div class="invite-card panel" data-theme="' + esc(d.theme) + '">' + avatar(d, 'xl') + body + '</div>');
    app.onclick = async function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'invite') return inviteDialog();
      if (b.dataset.act === 'befriend') {
        try {
          var id = await busy(b, function () { return Api.rpc('wl_friend_link_redeem', { p_token: r.id }); });
          FX.toast('Ihr seid jetzt befreundet 🎉'); go('./?seite=freund&id=' + id, true);
        } catch (err) { FX.toast(errText(err)); }
      }
    };
  }

  // Vorschau fuer Abgemeldete: nur lesen, zum Reservieren anmelden
  async function previewPage(ctx, token) {
    app.innerHTML = loading();
    var d = null;
    try { d = /^[0-9a-f]{32}$/.test(token) ? await Api.pub('wl_preview', { p_token: token }) : null; } catch (e) { d = null; }
    if (ctx.stale()) return;
    if (!d) {
      setTheme(null);
      app.innerHTML = '<div class="empty big"><span class="e-ico">🔗</span><h2>Dieser Link ist nicht mehr gültig</h2><p>Die Liste wurde nicht gefunden oder der Link wurde deaktiviert. Frag die Person nach einem neuen Link.</p><a class="btn" href="./">Zur Wunschliste</a></div>';
      return;
    }
    var l = d.list, o = d.owner, items = d.items;
    setTheme(l.theme);
    var dd = l.event_date ? daysUntil(l.event_date) : null;
    app.innerHTML =
      '<header class="list-head" data-theme="' + esc(l.theme) + '"><div class="lh-main"><span class="lh-emoji">' + esc(l.emoji) + '</span><div>' +
      '<p class="eyebrow">' + [l.occasion && esc(l.occasion), l.event_date && fmtDate(l.event_date, true)].filter(Boolean).join(' · ') + '</p>' +
      '<h1>' + esc(l.title) + '</h1>' + (l.description ? '<p class="lead">' + esc(l.description) + '</p>' : '') + '</div>' +
      (dd !== null && dd >= 0 ? '<div class="lh-cd"><b>' + dd + '</b><span>' + (dd === 1 ? 'Tag' : 'Tage') + '</span></div>' : '') + '</div>' +
      '<div class="lh-bar"><span class="owner-chip">' + avatar(o, 'sm') + '<span>Liste von <b>' + esc(o.name) + '</b></span></span><span class="sp"></span><span class="pill">👀 Vorschau</span></div>' +
      '<p class="surprise">🔒 Das ist nur eine Vorschau. <b>Melde dich an oder erstelle ein Konto</b>, um Wünsche zu reservieren. ' + esc(o.name) + ' wird dann für dich als Bekannte/r hinterlegt.</p></header>' +
      (items.length ? '<div class="wishes">' + items.map(function (it) { return wishCard(it, { preview: true, emoji: l.emoji }); }).join('') + '</div>'
        : emptyBox('🕊️', 'Noch leer', esc(o.name) + ' hat hier noch keine Wünsche eingetragen.')) +
      '<div id="authSlot"></div>';
    $('#authSlot', app).appendChild(authEl);
    setTab('login');
    app.onclick = function (e) {
      if (e.target.closest('[data-act="login"]')) authEl.scrollIntoView({ behavior: FX.reduced ? 'auto' : 'smooth', block: 'center' });
    };
  }

  // Link einloesen (angemeldet): Bekanntschaft herstellen und zur Liste gehen
  async function redeemPage(ctx, r) {
    var id = await Api.rpc('wl_redeem', { p_token: r.id });
    if (ctx.stale()) return;
    FX.toast('Liste freigeschaltet 🎉');
    go('./?liste=' + id, true);
  }

  // ---------- Anlaesse: Listen mit demselben Datum gehoeren zusammen (z. B. alle Listen fuer Weihnachten) ----------
  var THEME_COLORS = { polarlicht: '#5b85ff', geschenkpapier: '#c0392b', pixel: '#3ddc84', kaufhaus: '#222222', magazin: '#e63946', weihnacht: '#c0392b',
    ostern: '#f49ac1', herbst: '#d35400', winter: '#5dade2', gold: '#d4af37', sommer: '#f39c12', barbie: '#ff2d95' };
  function isoDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function mostCommon(arr) {
    var n = {}, best = null;
    arr.forEach(function (x) { if (!x) return; n[x] = (n[x] || 0) + 1; if (!best || n[x] > n[best]) best = x; });
    return best;
  }
  // Name, Design und Symbol eines Anlasses aus seinen Listen
  function eventInfo(date, lists) {
    var md = date.slice(5), name = mostCommon(lists.map(function (l) { return (l.occasion || '').trim(); }));
    if (!name) name = md >= '12-24' && md <= '12-26' ? 'Weihnachten' : md === '12-31' ? 'Silvester' : md === '12-06' ? 'Nikolaus' : lists.length === 1 ? lists[0].title : 'Anlass am ' + fmtDate(date);
    // Persoenlicher Anlass einer einzelnen Person: "Geburtstag von Oma"
    else if (lists.length === 1 && lists[0].owner && lists[0].owner.name && !/weihnacht|ostern|silvester|nikolaus|advent/i.test(name)) name += ' von ' + lists[0].owner.name;
    var theme = /weihnacht|christmas|xmas|advent|nikolaus/i.test(name) ? 'weihnacht' : /ostern|easter/i.test(name) ? 'ostern'
      : mostCommon(lists.map(function (l) { return l.theme; })) || (me && me.theme) || 'polarlicht';
    var emoji = theme === 'weihnacht' ? '🎄' : theme === 'ostern' ? '🐣' : /geburtstag|birthday/i.test(name) ? '🎂' : (lists[0] && lists[0].emoji) || '🎁';
    return { date: date, name: name, theme: theme, emoji: emoji, color: THEME_COLORS[theme] || '#ffcb05' };
  }

  // ---------- Benachrichtigungen (Android-App) ----------
  // Die Webseite stellt zusammen, woran erinnert werden soll; die App plant daraus die Benachrichtigungen,
  // auch wenn sie geschlossen ist. Aktualisiert wird bei jedem Oeffnen und Seitenwechsel (hoechstens jede Minute).
  var lastSync = 0, syncing = false;
  function sendNotify(data) {
    if (window.__wlApp && window.__wlApp.notify) { window.__wlApp.notify(data); return true; }
    return false;
  }
  window.addEventListener('wlapp-ready', function () { lastSync = 0; if (Api.user && me) syncNotifications(true); });
  async function syncNotifications(force) {
    if (!NATIVE || !Api.user || !me || syncing) return;
    if (!force && Date.now() - lastSync < 60000) return;
    syncing = true;
    try {
      var t = isoDate(today());
      var res = await Promise.all([
        Api.get('wl_lists', 'owner=neq.' + me.id + '&archived=is.false&event_date=gte.' + t + '&select=id,title,emoji,theme,occasion,event_date,owner:wl_profiles!wl_lists_owner_fkey(name)&order=event_date.asc'),
        Api.rpc('wl_my_reservations')
      ]);
      var open = res[1].filter(function (g) { return !g.purchased && !g.received; });
      setTabCount(open.length);
      var byDate = {}, undated = 0;
      function slot(d) { return byDate[d] = byDate[d] || { lists: [], gifts: [] }; }
      res[0].forEach(function (l) { if (!isMuted(l.id)) slot(l.event_date).lists.push(l); });
      open.forEach(function (g) {
        if (isMuted(g.list_id)) return;
        if (!g.event_date) undated++;
        else if (g.event_date >= t) slot(g.event_date).gifts.push(g);
      });
      var groups = Object.keys(byDate).sort().filter(function (d) { return daysUntil(d) <= 60; }).map(function (d) {
        var s = byDate[d], info = eventInfo(d, s.lists.length ? s.lists : s.gifts.map(function (g) { return { title: g.list_title, emoji: g.list_emoji }; }));
        info.lists = s.lists.map(function (l) { return { title: l.title, emoji: l.emoji, owner: l.owner ? l.owner.name : '' }; });
        info.open = s.gifts.length;
        info.gifts = s.gifts.slice(0, 8).map(function (g) { return { title: g.title, owner: g.owner_name }; });
        return info;
      });
      if (sendNotify({ v: 1, user: me.id, today: t, groups: groups, undated: undated })) lastSync = Date.now();
    } catch (e) { /* naechster Versuch beim naechsten Seitenwechsel */ }
    finally { syncing = false; }
  }
  function setTabCount(n) { var b = $('#tabBuy'); b.textContent = n; b.hidden = !n; }

  // ---------- Anlass-Seite: alle Listen eines Datums im Design des Anlasses (Ziel der Benachrichtigung) ----------
  async function eventPage(ctx, r) {
    var date = /^\d{4}-\d{2}-\d{2}$/.test(r.id || '') ? r.id : null;
    if (!date) return go('./', true);
    var res = await Promise.all([
      Api.get('wl_lists', 'archived=is.false&event_date=eq.' + date + '&select=*,owner:wl_profiles!wl_lists_owner_fkey(id,name,avatar,color),wl_items(count)&order=created_at'),
      Api.rpc('wl_my_reservations')
    ]);
    var lists = res[0], others = lists.filter(function (l) { return l.owner.id !== me.id; }), mine = lists.filter(function (l) { return l.owner.id === me.id; });
    var gifts = res[1].filter(function (g) { return g.event_date === date && !g.received; });
    var todo = gifts.filter(function (g) { return !g.purchased; });
    var info = eventInfo(date, others.length ? others : lists), d = daysUntil(date);
    setTheme(info.theme);
    view(ctx,
      '<header class="list-head ev-head" data-theme="' + info.theme + '">' +
      '<p class="back"><a href="./"><span class="arr">←</span> Übersicht</a></p>' +
      '<div class="lh-main"><span class="lh-emoji">' + esc(info.emoji) + '</span><div>' +
      '<p class="eyebrow">' + esc(asDate(date).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</p>' +
      '<h1>' + esc(info.name) + '</h1><p class="lead">' + plural(lists.length, 'Liste', 'Listen') + (todo.length ? ' · noch ' + plural(todo.length, 'Geschenk', 'Geschenke') + ' zu besorgen' : gifts.length ? ' · alle Geschenke besorgt 🎉' : '') + '</p></div>' +
      (d >= 0 ? '<div class="lh-cd"><b>' + d + '</b><span>' + (d === 0 ? 'Heute!' : d === 1 ? 'Tag' : 'Tage') + '</span></div>' : '') + '</div></header>' +
      (todo.length ? '<section class="panel ev-todo"><h2>🛒 Noch zu besorgen</h2><ul class="plist">' + todo.map(function (g) {
        return '<li>' + avatar({ avatar: g.owner_avatar, color: g.owner_color }, 'sm') + '<span><b>' + esc(g.title) + '</b><small>für ' + esc(g.owner_name) + ' · ' + esc(g.list_title) +
          (g.price != null && !g.group_gift ? ' · ' + esc(money(g.price * g.quantity, g.currency)) : '') + '</small></span><span class="sp"></span><a class="btn small ghost" href="./?seite=geschenke">Abhaken</a></li>';
      }).join('') + '</ul></section>' : '') +
      (others.length ? '<section><div class="sec-head"><h2>Listen deiner Freunde</h2></div><div class="lgrid">' + others.map(function (l) { return listCard(l, 'owner'); }).join('') + '</div></section>' : '') +
      (mine.length ? '<section><div class="sec-head"><h2>Deine Listen</h2></div><div class="lgrid">' + mine.map(function (l) { return listCard(l, 'mine'); }).join('') + '</div></section>' : '') +
      (lists.length ? '' : emptyBox('🗓️', 'Keine Listen an diesem Tag', 'Für dieses Datum ist gerade keine Liste für dich sichtbar.', '<a class="btn" href="./">Zur Übersicht</a>')));
  }

  var VIEWS = { teilen: redeemPage, einladung: invitePage, home: home, liste: listPage, freunde: friendsPage, freund: friendPage, geschenke: giftsPage, profil: profilePage, admin: adminPage, anlass: eventPage };

  // ---------- Startseite fuer Abgemeldete ----------
  var DEMO = [
    { title: 'Kopfhörer mit Geräuschunterdrückung', note: 'Für die Bahnfahrten zur Arbeit', price: 129, priority: 3, emoji: '🎧' },
    { title: 'Kochbuch „Italien vegetarisch“', note: 'Für gemütliche Sonntage', price: 28, priority: 2, emoji: '📖' },
    { title: 'Retro-Konsole mit 2 Controllern', note: 'Für Spieleabende mit Freunden', price: 89.99, priority: 3, emoji: '🕹️' },
    { title: 'Ledersneaker in Weiß', note: 'Für jeden Tag', price: 119, priority: 3, emoji: '👟' },
    { title: 'Bildband Architektur', note: 'Fürs Wohnzimmer-Regal', price: 59, priority: 2, emoji: '🏛️' }
  ];
  $('#themeShow').innerHTML = THEMES.map(function (t, i) {
    var d = DEMO[i % DEMO.length];
    return '<figure class="tshow" data-theme="' + t.id + '"><div class="ts-stage">' + wishCard({ id: 'demo' + i, title: d.title, note: d.note, price: d.price, currency: 'EUR', priority: d.priority, quantity: 1 }, { demo: true, emoji: d.emoji }) + '</div>' +
      '<figcaption><b>' + t.name + '</b><span>' + t.desc + '</span></figcaption></figure>';
  }).join('');

  function setTab(tab) {
    $$('.auth-tabs button').forEach(function (b) { var on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    $('#loginForm').hidden = tab !== 'login'; $('#registerForm').hidden = tab !== 'register';
  }
  $$('.auth-tabs button').forEach(function (b) { b.addEventListener('click', function () { setTab(b.dataset.tab); }); });
  function landing() {
    var q = location.search;
    if (/registrieren|login/.test(q)) {
      setTab(/registrieren/.test(q) ? 'register' : 'login');
      requestAnimationFrame(function () { $('#auth').scrollIntoView({ behavior: FX.reduced ? 'auto' : 'smooth', block: 'center' }); });
    }
  }
  $('#loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var f = e.target, m = $('.msg', f), email = f.email.value.trim(), pw = f.password.value;
    if (!email || !pw) return say(m, 'Bitte E-Mail und Passwort eingeben.', false);
    say(m, 'Anmelden …', true);
    try { await busy($('[type=submit]', f), function () { return Api.signIn(email, pw); }); f.reset(); say(m, '', true); history.replaceState(null, '', /liste=|seite=|teilen=|einladung=/.test(location.search) ? location.search : './'); render(); }
    catch (err) { say(m, errText(err), false); }
  });
  $('#registerForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var f = e.target, m = $('.msg', f), v = vals(f);
    if (v.name.length < 2 || v.name.indexOf('#') >= 0) return say(m, ERR.name, false);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) return say(m, ERR.email, false);
    if (f.password.value.length < 8) return say(m, ERR.password, false);
    if (f.password.value !== f.password2.value) return say(m, 'Die Passwörter stimmen nicht überein.', false);
    say(m, 'Konto wird erstellt …', true);
    try {
      await busy($('[type=submit]', f), async function () {
        await Api.signUp({ name: v.name, email: v.email, password: f.password.value, invite: v.invite });
        await Api.signIn(v.email, f.password.value);
      });
      f.reset(); say(m, '', true); history.replaceState(null, '', /teilen=|einladung=/.test(location.search) ? location.search : './'); FX.toast('Willkommen, ' + v.name + '! 🎉'); render();
    } catch (err) {
      if (err.code === 'invite') $('.invite', f).hidden = false;
      say(m, errText(err), false);
    }
  });

  render();
})();
