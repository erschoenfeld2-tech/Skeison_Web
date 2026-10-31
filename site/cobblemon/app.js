(function () {
  'use strict';
  // Daten kommen aus dem Branch "data" (vom Server-PC synchronisiert); lokale Kopie als Fallback.
  var DATA_BASE = 'https://raw.githubusercontent.com/erschoenfeld2-tech/Skeison_Web/data/';
  // Bewerbungen laufen ueber Supabase (nur oeffentlicher Schluessel; Einfuegen erlaubt, Lesen nicht).
  var SUPABASE_URL = 'https://pumdupjmmvimlxqvuymg.supabase.co', SUPABASE_KEY = 'sb_publishable_VcunJmqIHajV3s2gfUMWSQ_MlIpmkas';
  // Zeitplan (alle Zeiten deutsche Zeit): Nether und End oeffnen jeweils nach den angegebenen Tagen.
  var START = new Date('2026-10-30T15:00:00+01:00').getTime(), DAY = 86400000;
  var MILESTONES = [
    { id: 'start', icon: '🚀', title: 'Serverstart', at: START, text: 'Der Server geht online, die Wertungen beginnen.' },
    { id: 'nether', icon: '🔥', title: 'Nether öffnet', at: START + 7 * DAY, text: 'Eine Woche nach Serverstart wird der Nether freigeschaltet.' },
    { id: 'end', icon: '🌌', title: 'End öffnet', at: START + 14 * DAY, text: 'Eine Woche nach dem Nether folgt das End mit dem schwereren Enderdrachen.' }
  ];
  // Anzeigenamen der Ranglisten (ueberschreiben die Texte aus leaderboards.json)
  var BOARD_META = {
    collector: { title: 'Pokédex Collector', desc: 'Die meisten Pokédex-Einträge', icon: '📖' },
    caught: { title: 'Collector', desc: 'Die meisten verschiedenen gefangenen Pokémon', icon: '🎒', unit: 'Arten' }
  };
  function applyBoardMeta(d) {
    d.boards.forEach(function (b) { var m = BOARD_META[b.id]; if (m) { b.title = m.title; b.desc = m.desc; b.icon = m.icon; if (m.unit && !b.unit) b.unit = m.unit; } });
    if (!d.boards.some(function (b) { return b.id === 'caught'; })) { // Daten kommen erst mit dem aktualisierten Sync-Skript
      var at = d.boards.map(function (b) { return b.id; }).indexOf('collector');
      d.boards.splice(at < 0 ? d.boards.length : at, 0, { id: 'caught', title: BOARD_META.caught.title, desc: BOARD_META.caught.desc, icon: BOARD_META.caught.icon, unit: 'Arten', week: [], total: [], pending: true });
    }
  }
  // sync-status.json: Das Sync-Skript auf dem Server-PC meldet dort, was es tut und warum etwas fehlt (undefined = noch nicht geladen, null = Datei fehlt)
  var syncStatus;
  function loadSyncStatus() {
    return fetchJson('data/sync-status.json').then(function (j) { syncStatus = j; }, function () { syncStatus = null; }).then(function () { if (data) renderBoards(); });
  }
  function pendingText() {
    if (syncStatus === undefined) return 'Die Daten folgen mit dem nächsten Server-Update.';
    if (syncStatus === null) return 'Das Sync-Skript auf dem Server-PC ist noch nicht auf dem neuesten Stand.';
    if (syncStatus.updated && Date.now() - new Date(syncStatus.updated).getTime() > 60 * 60000) return 'Das Sync-Skript auf dem Server-PC hat sich seit über einer Stunde nicht gemeldet.';
    var c = syncStatus.collector || {};
    if (c.status === 'keine-dateien' || c.status === 'keine-welt') return 'Das Sync-Skript findet die Pokédex-Dateien nicht (Details in sync-status.json).';
    if (c.status === 'ok') return 'Die Rangliste wird gerade berechnet und erscheint gleich.';
    return 'Die Daten folgen mit dem nächsten Server-Update.';
  }
  var mode = 'week', data = null, hist = null, openBoardId = null, phase = null;
  var STALE_MS = 45 * 60000; // aelter: Status unbekannt (Sync laedt ohne Aenderung nur alle 30 min hoch)
  function live() { return Date.now() >= START; }
  // Wochen laufen Montag bis Sonntag; Woche 1 ist die Woche des Serverstarts
  var WEEK1 = (function () {
    var d = new Date(new Date(START).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' }) + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.getTime();
  })();
  function weekNo(weekStart) { return Math.round((Date.parse(weekStart + 'T12:00:00Z') - WEEK1) / (7 * DAY)) + 1; }
  function weekRange(weekStart) {
    var a = new Date(weekStart + 'T12:00:00Z'), b = new Date(a.getTime() + 6 * DAY), o = { day: '2-digit', month: '2-digit', timeZone: 'UTC' };
    return a.toLocaleDateString('de-DE', o) + '–' + b.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  }
  var $ = function (id) { return document.getElementById(id); };
  var FX = window.FX || { roll: function (e, v) { e.textContent = v; }, toast: function () {} };
  var nf = new Intl.NumberFormat('de-DE');
  var COLORS = ['#ffcb05', '#7fb5ff', '#ff8a8a', '#7be0b0', '#c9a0ff', '#ffb36b', '#6fd6e8', '#f0a0d0'];

  function hue(name) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; }
  // Spieler-Koepfe. Ein Skin wird in dieser Reihenfolge gesucht (der erste, der sich laden laesst, gewinnt):
  //  1. der eigene Skin aus der Seite (nur Skeison), 2. die Kopie aus dem Branch "data" (skins/<name>.png, vom Sync-Skript von Mojang geholt),
  //  3. oeffentliche Skin-Dienste, die den Mojang-Skin per Spielername liefern ({name} wird ersetzt). Damit erscheinen Koepfe auch ohne
  //  Vorarbeit auf dem Server-PC. Die Liste leer lassen, wenn keine Fremddienste angefragt werden sollen.
  var SKIN_FALLBACKS = ['https://minotar.net/skin/{name}', 'https://mc-heads.net/skin/{name}'];
  var LOCAL_SKINS = { skeison: new URL('../skin/skeison.png', document.baseURI).href };
  var skinCache = {}, skinBust = 0, pendingHeads = [], lastHeadRetry = Date.now();
  // Ergebnis: { url, legacy } oder null; legacy = altes 64x32-Format (Kopf liegt dort in anderer Hoehe, siehe .av .skin.legacy im CSS)
  function loadSkin(name) {
    var k = name.toLowerCase(); if (skinCache[k]) return skinCache[k];
    var list = []; if (LOCAL_SKINS[k]) list.push(LOCAL_SKINS[k]);
    list.push(DATA_BASE + 'skins/' + encodeURIComponent(k) + '.png' + (skinBust ? '?r=' + skinBust : ''));
    if (/^[A-Za-z0-9_]{1,16}$/.test(name)) SKIN_FALLBACKS.forEach(function (t) { list.push(t.replace('{name}', encodeURIComponent(name))); });
    skinCache[k] = new Promise(function (done) {
      (function next(n) {
        if (n >= list.length) return done(null);
        var im = new Image();
        im.onload = function () { // nur echte Skin-Dateien (quadratisch oder doppelt so breit wie hoch, mind. 64 Pixel) zaehlen
          var w = im.naturalWidth, h = im.naturalHeight, ok = w >= 64 && (h === w || h * 2 === w);
          if (ok) done({ url: list[n], legacy: h * 2 === w }); else next(n + 1);
        };
        im.onerror = function () { next(n + 1); };
        im.src = list[n];
      })(0);
    });
    return skinCache[k];
  }
  // Buchstabe in der Spielerfarbe als Ersatz, bis (oder falls) ein Skin gefunden ist; Kopf und Hut-Ebene schneidet das CSS aus (.av .skin)
  function avatar(name, small) {
    var a = el('span', 'av' + (small ? ' sm' : ''), name.charAt(0).toUpperCase()); a.style.background = hue(name);
    var h = el('i', 'skin'); a.appendChild(h);
    loadSkin(name).then(function (r) { if (r) showSkin(h, r); else pendingHeads.push({ name: name, h: h }); });
    return a;
  }
  function showSkin(h, r) { h.style.setProperty('--skin', 'url("' + r.url + '")'); if (r.legacy) h.classList.add('legacy'); }
  // Neue Spieler: Ihr Skin ist oft erst nach einigen Minuten verfuegbar (das Sync-Skript holt ihn alle 10 Minuten). Koepfe ohne Skin werden
  // deshalb alle 5 Minuten erneut versucht und erscheinen dann ohne Neuladen der Seite.
  function retryHeads() {
    pendingHeads = pendingHeads.filter(function (p) { return document.body.contains(p.h); });
    if (!pendingHeads.length) return;
    var names = {}; pendingHeads.forEach(function (p) { names[p.name.toLowerCase()] = p.name; });
    skinBust++;
    Object.keys(names).forEach(function (k) {
      delete skinCache[k];
      loadSkin(names[k]).then(function (r) {
        if (!r) return;
        pendingHeads = pendingHeads.filter(function (p) { if (p.name.toLowerCase() !== k) return true; if (document.body.contains(p.h)) showSkin(p.h, r); return false; });
      });
    });
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function getJson(url) { return fetch(url + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function fetchJson(url) { return getJson(DATA_BASE + url.replace(/^data\//, '')).catch(function () { return getJson(url); }); }

  function renderStatus(s, updated) {
    var pill = $('pill'), stale = !updated || Date.now() - new Date(updated).getTime() > STALE_MS;
    if (s && stale) { pill.className = 'pill unk'; pill.textContent = 'Status unbekannt'; }
    else if (s && s.up) { pill.className = 'pill on'; pill.textContent = 'Aktiv · ' + s.online + '/' + s.max + ' Spieler online'; }
    else { pill.className = 'pill off'; pill.textContent = 'Offline'; }
    $('addr').textContent = (s && s.address) || '–';
    var box = $('players'); box.textContent = '';
    if (s && !stale && s.names && s.names.length) {
      box.appendChild(el('span', 'who-label', 'Gerade online:'));
      s.names.forEach(function (n) { var c = el('span', 'who'); c.appendChild(avatar(n, true)); c.appendChild(document.createTextNode(n)); box.appendChild(c); });
    }
  }

  function renderBoards() {
    var cards = $('cards'); cards.textContent = '';
    if (!data) return;
    data.boards.forEach(function (b) {
      var card = el('article', 'card'), head = el('header');
      card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', b.title + ' – alle Einträge anzeigen');
      card.addEventListener('click', function () { openBoard(b.id); });
      card.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openBoard(b.id); } });
      head.appendChild(el('div', 'ico', b.icon));
      var t = el('div'); t.appendChild(el('h3', '', b.title)); t.appendChild(el('p', '', b.desc)); head.appendChild(t);
      card.appendChild(head);
      var list = b[mode] || [];
      if (!list.length) card.appendChild(el('p', 'empty', !live() ? 'Startet mit dem Serverstart.' : b.pending ? pendingText() : mode === 'week' ? 'Diese Woche noch keine Einträge.' : 'Noch keine Einträge.'));
      else {
        var ul = el('ul', 'rows');
        list.slice(0, 3).forEach(function (e, i) {
          var li = el('li', 'row r' + (i + 1)); li.style.setProperty('--i', i);
          li.appendChild(el('span', 'rank', String(i + 1)));
          li.appendChild(avatar(e.name));
          li.appendChild(el('span', 'name', e.name));
          var v = el('span', 'val', nf.format(e.value)); v.appendChild(el('small', '', b.unit)); li.appendChild(v);
          ul.appendChild(li);
        });
        card.appendChild(ul);
        card.appendChild(el('p', 'more', list.length > 3 ? 'Alle ' + list.length + ' anzeigen →' : 'Details →'));
      }
      cards.appendChild(card);
    });
  }

  function rowsInto(ul, list, b) {
    ul.textContent = '';
    list.forEach(function (e, i) {
      var li = el('li', 'row r' + (e.rank <= 3 ? e.rank : '')); li.style.setProperty('--i', Math.min(i, 15));
      li.appendChild(el('span', 'rank', String(e.rank)));
      li.appendChild(avatar(e.name));
      li.appendChild(el('span', 'name', e.name));
      var v = el('span', 'val', nf.format(e.value)); v.appendChild(el('small', '', b.unit)); li.appendChild(v);
      ul.appendChild(li);
    });
    if (!list.length) ul.appendChild(el('li', 'empty', 'Keine Treffer.'));
  }
  function renderBoardDlg() {
    var b = data && data.boards.filter(function (x) { return x.id === openBoardId; })[0];
    if (!b) return;
    $('bdTitle').textContent = b.icon + ' ' + b.title; $('bdDesc').textContent = b.desc;
    var q = $('bdSearch').value.trim().toLowerCase();
    var all = (b[mode] || []).map(function (e, i) { return { name: e.name, value: e.value, rank: i + 1 }; });
    rowsInto($('bdList'), q ? all.filter(function (e) { return e.name.toLowerCase().indexOf(q) >= 0; }) : all, b);
    document.querySelectorAll('[data-bmode]').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-bmode') === mode); });
  }
  function openBoard(id) { openBoardId = id; $('bdSearch').value = ''; renderBoardDlg(); $('boardDlg').showModal(); }
  function setMode(m) {
    mode = m;
    document.querySelectorAll('.seg button[data-mode]').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-mode') === m); });
    renderBoards(); weekInfo();
    if ($('boardDlg').open) renderBoardDlg();
  }

  // "Woche N" in den Umschaltern und darunter, wie lange die Woche noch laeuft
  function weekInfo() {
    if (!data) return;
    var n = data.weekStart && live() ? weekNo(data.weekStart) : 0;
    document.querySelectorAll('[data-mode="week"], [data-bmode="week"]').forEach(function (b) { b.textContent = n >= 1 ? 'Woche ' + n : 'Diese Woche'; });
    if (!live()) { $('weekInfo').textContent = 'Die Wertung startet mit dem Serverstart.'; return; }
    if (mode === 'total') { $('weekInfo').textContent = 'Gesamtstand seit Serverstart.'; return; }
    var left = Math.ceil((new Date(data.weekEnd).getTime() - Date.now()) / DAY);
    $('weekInfo').textContent = (n >= 1 ? 'Woche ' + n + ' seit Serverstart' : 'Diese Woche') + ' · endet Sonntag um 24:00 Uhr' + (left > 1 ? ' (noch ' + left + ' Tage)' : '') + '. Danach beginnt eine neue Wertung.';
  }

  function fmtDate(s) { var d = new Date(s + (s.length === 10 ? 'T00:00:00' : '')); return isNaN(d) ? s : d.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }); }

  function renderNews(list) {
    var box = $('newsList'); box.textContent = '';
    $('news').hidden = !list.length;
    if (!list.length) return;
    list.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).forEach(function (n) {
      var p = el('article', 'post ' + (n.type || 'news')), h = el('h3', '', n.title || '');
      if (n.type === 'event') h.appendChild(el('span', 'badge', 'Event')); else if (n.type === 'wartung') h.appendChild(el('span', 'badge', 'Wartung'));
      p.appendChild(h); p.appendChild(el('div', 'meta', fmtDate(n.date || ''))); p.appendChild(el('p', '', n.text || ''));
      box.appendChild(p);
    });
  }

  function renderWinners() {
    var box = $('winnerList'); box.textContent = '';
    if (!hist || !data) return;
    var weeks = live() ? hist.filter(function (w) { return w.weekStart && weekNo(w.weekStart) >= 1; }) : []; // Wochen vor dem Serverstart ausblenden
    if (!weeks.length) { var e = el('div', 'empty-box'); e.appendChild(el('p', '', 'Die ersten Wochensieger stehen am Ende der ersten Woche hier.')); box.appendChild(e); return; }
    weeks.slice(0, 6).forEach(function (w) {
      var c = el('div', 'win'), h = el('h3'), btn = el('button', 'wk', 'Woche ' + weekNo(w.weekStart)), when = el('span', 'wk-date', weekRange(w.weekStart));
      btn.type = 'button'; btn.setAttribute('aria-expanded', 'false'); when.hidden = true;
      btn.addEventListener('click', function () { when.hidden = !when.hidden; btn.setAttribute('aria-expanded', String(!when.hidden)); });
      h.appendChild(btn); h.appendChild(when); c.appendChild(h);
      var ul = el('ul');
      data.boards.filter(function (b) { return !b.pending; }).forEach(function (b) {
        var first = (w.winners[b.id] || [])[0];
        var li = el('li'); li.appendChild(el('span', '', b.icon + ' ' + b.title));
        var win = el('strong', 'who-inline');
        if (first) { win.appendChild(avatar(first.name, true)); win.appendChild(document.createTextNode(first.name + ' (' + nf.format(first.value) + ')')); } else win.textContent = '–';
        li.appendChild(win); ul.appendChild(li);
      });
      c.appendChild(ul); box.appendChild(c);
    });
  }

  // Daten alle 60 s neu laden, aber nur wenn der Tab sichtbar ist; neu gezeichnet wird nur bei echten Aenderungen
  var lastLoad = 0, lastKey = '';
  function maybeLoad() {
    if (document.hidden) return;
    if (stats && dailyDay && dailyDay !== berlinDay()) ensureStats().then(renderDaily, function () {}); // neuer Tag: neue Tagesstatistiken
    if (Date.now() - lastHeadRetry >= 300000) { lastHeadRetry = Date.now(); retryHeads(); }
    if (Date.now() - lastLoad >= 55000) load();
  }
  function load() {
    lastLoad = Date.now();
    fetchJson('data/leaderboards.json').then(function (d) {
      applyBoardMeta(d);
      if (!live()) { // vor dem Serverstart gibt es keine Wertung (Testdaten werden ausgeblendet)
        d.boards.forEach(function (b) { b.week = []; b.total = []; }); d.server.names = [];
      }
      var key = JSON.stringify([d.boards, d.weekStart, d.weekEnd, phase]), changed = key !== lastKey; lastKey = key;
      data = d; renderStatus(d.server, d.updated); weekInfo();
      if (changed) { renderBoards(); renderWinners(); }
      if (d.boards.some(function (b) { return b.pending; })) loadSyncStatus(); // Grund fuer die leere Karte holen
      var upd = new Date(d.updated), stale = Date.now() - upd.getTime() > STALE_MS;
      $('updated').textContent = (stale ? 'Daten seit ' : 'Zuletzt aktualisiert: ') + upd.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' Uhr' + (stale ? ' nicht aktualisiert' : '');
    }).catch(function () { renderStatus(null); $('updated').textContent = 'Daten momentan nicht verfügbar.'; });
    fetchJson('data/history.json').then(function (h) { hist = Array.isArray(h) ? h : []; renderWinners(); }).catch(function () { hist = []; renderWinners(); });
  }

  document.querySelectorAll('.seg button[data-mode]').forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); }); });
  document.querySelectorAll('[data-bmode]').forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-bmode')); }); });
  $('bdSearch').addEventListener('input', renderBoardDlg);
  // Dialoge schliessen mit kurzer Ausblend-Animation (Klick daneben, Schliessen-Knopf oder Escape)
  function closeDlg(d) {
    if (!d.open || d.classList.contains('closing')) return;
    if (FX.reduced || !window.FX) return d.close();
    d.classList.add('closing');
    setTimeout(function () { d.classList.remove('closing'); d.close(); }, 220);
  }
  document.querySelectorAll('dialog').forEach(function (d) {
    d.addEventListener('click', function (ev) { if (ev.target === d || ev.target.hasAttribute('data-close')) closeDlg(d); });
    d.addEventListener('cancel', function (ev) { ev.preventDefault(); closeDlg(d); });
  });

  // Whitelist-Bewerbung
  var msg = $('applyMsg');
  function say(t, ok) { msg.textContent = t; msg.className = 'msg ' + (ok ? 'ok' : 'err'); }
  function openApply() { if ($('applyDlg').open) return; say('', true); $('applyDlg').showModal(); $('fMc').focus(); }
  document.querySelectorAll('[data-apply]').forEach(function (b) { b.addEventListener('click', function (ev) { ev.preventDefault(); openApply(); }); });
  // Direktlink von der Hauptseite: cobblemon/#bewerben oeffnet die Bewerbung
  if (location.hash === '#bewerben') openApply();
  window.addEventListener('hashchange', function () { if (location.hash === '#bewerben') openApply(); });
  $('applyForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var mc = $('fMc').value.trim(), dc = $('fDc').value.trim().replace(/^@/, '');
    if ($('fHp').value) { say('Danke! Wir melden uns.', true); return; }
    if (!/^[A-Za-z0-9_]{3,16}$/.test(mc)) return say('Minecraft-Name: 3–16 Zeichen (Buchstaben, Zahlen, _).', false);
    if (dc.length < 2 || dc.length > 32) return say('Discord-Name: 2–32 Zeichen.', false);
    if (!SUPABASE_URL || !SUPABASE_KEY) return say('Bewerbungen sind noch nicht freigeschaltet. Bitte melde dich direkt bei uns.', false);
    var last = 0; try { last = +localStorage.getItem('applyAt') || 0; } catch (e) {}
    if (Date.now() - last < 60000) return say('Bitte warte kurz, bevor du erneut sendest.', false);
    var btn = $('applySend'); btn.disabled = true; say('Wird gesendet …', true);
    fetch(SUPABASE_URL + '/rest/v1/whitelist_applications', {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ minecraft_name: mc, discord_name: dc })
    }).then(function (r) {
      if (r.status === 409) return say('Für diesen Namen liegt bereits eine Bewerbung vor.', false);
      if (!r.ok) throw new Error(r.status);
      try { localStorage.setItem('applyAt', String(Date.now())); } catch (e) {}
      say('Bewerbung gesendet! Wir schalten dich nach Prüfung frei.', true); $('applyForm').reset();
    }).catch(function () { say('Senden fehlgeschlagen. Bitte später erneut versuchen.', false); })
      .then(function () { btn.disabled = false; });
  });
  // Serveradresse kopieren (mit Rueckfall fuer Browser ohne Clipboard-API)
  function copyAddr() {
    var a = $('addr').textContent, small = $('copy').querySelector('small');
    if (!a || a === '–') return FX.toast('Adresse noch nicht verfügbar');
    var done = function () { small.textContent = 'kopiert!'; $('copy').classList.add('copied'); FX.toast('Adresse kopiert: ' + a); setTimeout(function () { small.textContent = 'kopieren'; $('copy').classList.remove('copied'); }, 1600); };
    var legacy = function () {
      var t = document.createElement('textarea'); t.value = a; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} t.remove();
      if (ok) done(); else FX.toast('Kopieren nicht möglich – Adresse: ' + a);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(a).then(done, legacy); else legacy();
  }
  $('copy').addEventListener('click', copyAddr);
  document.querySelectorAll('[data-copy]').forEach(function (b) { b.addEventListener('click', copyAddr); });

  function current() { // naechster Meilenstein und zugehoerige Phase
    var now = Date.now();
    for (var i = 0; i < MILESTONES.length; i++) if (now < MILESTONES[i].at) return MILESTONES[i];
    return null;
  }
  var LABELS = { start: 'Server-Start in', nether: 'Nether öffnet in', end: 'End öffnet in' };
  function renderTimeline() {
    var ol = $('timeline'), now = Date.now(), next = current();
    ol.textContent = '';
    MILESTONES.forEach(function (m) {
      var active = m.id === 'start' && m.at <= now;
      var li = el('li', 'ms ' + m.id + (active ? ' active' : m.at <= now ? ' done' : m === next ? ' next' : ''));
      li.appendChild(el('span', 'ms-ico', m.icon));
      var b = el('div'); b.appendChild(el('h3', '', m.title));
      b.appendChild(el('div', 'ms-date', new Date(m.at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' Uhr'));
      b.appendChild(el('p', '', m.text)); li.appendChild(b);
      li.appendChild(el('span', 'ms-state', active ? 'Aktiv' : m.at <= now ? 'Offen' : m === next ? 'Als Nächstes' : 'Geplant'));
      ol.appendChild(li);
    });
  }
  function tick() {
    var next = current(), ph = next ? next.id : 'done';
    if (ph !== phase) { // Phasenwechsel: Farben, Beschriftung, Zeitplan und (nach Serverstart) Ranglisten neu
      var first = phase === null; phase = ph;
      $('hero').setAttribute('data-phase', ph);
      $('cdBox').hidden = !next;
      if (next) $('cdLabel').textContent = LABELS[ph];
      renderTimeline();
      if (!first) load();
    }
    if (!next) return;
    var left = next.at - Date.now(), p = function (n) { return String(n).padStart(2, '0'); }, s = Math.floor(Math.max(left, 0) / 1000);
    FX.roll($('cd-d'), Math.floor(s / 86400)); FX.roll($('cd-h'), p(Math.floor(s % 86400 / 3600)));
    FX.roll($('cd-m'), p(Math.floor(s % 3600 / 60))); FX.roll($('cd-s'), p(s % 60));
  }
  tick(); setInterval(tick, 1000);

  // Alle Statistiken: Rohdaten aus stats.json (vom Sync-Skript aus world/stats exportiert), Suche und Rangliste je Statistik
  var CATS = [['minecraft:custom', 'Allgemein'], ['minecraft:mined', 'Abgebaut'], ['minecraft:used', 'Benutzt'], ['minecraft:crafted', 'Hergestellt'],
    ['minecraft:broken', 'Verbraucht'], ['minecraft:picked_up', 'Aufgehoben'], ['minecraft:dropped', 'Fallen gelassen'], ['minecraft:killed', 'Getötet'], ['minecraft:killed_by', 'Getötet von']];
  var CAT_DE = {}; CATS.forEach(function (c) { CAT_DE[c[0]] = c[1]; });
  var CUSTOM_DE = {
    play_time: 'Spielzeit', total_world_time: 'Zeit in der Welt', time_since_death: 'Zeit seit dem letzten Tod', time_since_rest: 'Zeit seit dem letzten Schlaf',
    sneak_time: 'Schleichzeit', leave_game: 'Spiel verlassen', deaths: 'Tode', mob_kills: 'Getötete Kreaturen', player_kills: 'Getötete Spieler', jump: 'Sprünge',
    damage_dealt: 'Verursachter Schaden', damage_taken: 'Erlittener Schaden', damage_blocked_by_shield: 'Mit Schild geblockter Schaden', damage_absorbed: 'Absorbierter Schaden',
    damage_resisted: 'Abgewehrter Schaden', damage_dealt_absorbed: 'Verursachter Schaden (absorbiert)', damage_dealt_resisted: 'Verursachter Schaden (abgewehrt)',
    walk_one_cm: 'Gelaufene Strecke', sprint_one_cm: 'Gesprintete Strecke', crouch_one_cm: 'Geschlichene Strecke', swim_one_cm: 'Geschwommene Strecke',
    fall_one_cm: 'Gefallene Strecke', climb_one_cm: 'Geklettert', fly_one_cm: 'Geflogene Strecke', walk_on_water_one_cm: 'Auf Wasser gelaufen',
    walk_under_water_one_cm: 'Unter Wasser gelaufen', boat_one_cm: 'Mit dem Boot gefahren', horse_one_cm: 'Geritten (Pferd)', minecart_one_cm: 'Mit der Lore gefahren',
    pig_one_cm: 'Auf dem Schwein geritten', strider_one_cm: 'Auf dem Schreiter geritten', aviate_one_cm: 'Mit Elytren geflogen', happy_ghast_one_cm: 'Auf dem Happy Ghast geflogen',
    fish_caught: 'Gefangene Fische', animals_bred: 'Gezüchtete Tiere', traded_with_villager: 'Mit Dorfbewohnern gehandelt', talked_to_villager: 'Mit Dorfbewohnern gesprochen',
    sleep_in_bed: 'Im Bett geschlafen', open_chest: 'Truhen geöffnet', open_enderchest: 'Endertruhen geöffnet', open_shulker_box: 'Shulkerkisten geöffnet',
    open_barrel: 'Fässer geöffnet', interact_with_crafting_table: 'Werkbank benutzt', interact_with_furnace: 'Ofen benutzt', interact_with_blast_furnace: 'Schmelzofen benutzt',
    interact_with_smoker: 'Räucherofen benutzt', interact_with_anvil: 'Amboss benutzt', interact_with_brewingstand: 'Braustand benutzt', interact_with_beacon: 'Leuchtfeuer benutzt',
    interact_with_smithing_table: 'Schmiedetisch benutzt', interact_with_stonecutter: 'Steinsäge benutzt', interact_with_grindstone: 'Schleifstein benutzt',
    interact_with_loom: 'Webstuhl benutzt', interact_with_cartography_table: 'Kartentisch benutzt', interact_with_lectern: 'Lesepult benutzt', interact_with_campfire: 'Lagerfeuer benutzt',
    enchant_item: 'Gegenstände verzaubert', drop: 'Gegenstände fallen gelassen', eat_cake_slice: 'Kuchenstücke gegessen', play_record: 'Schallplatten abgespielt',
    play_noteblock: 'Notenblöcke gespielt', tune_noteblock: 'Notenblöcke gestimmt', bell_ring: 'Glocken geläutet', raid_win: 'Überfälle gewonnen', raid_trigger: 'Überfälle ausgelöst',
    target_hit: 'Zielblock getroffen', pot_flower: 'Pflanzen eingetopft', fill_cauldron: 'Kessel gefüllt', use_cauldron: 'Wasser aus Kessel genommen',
    clean_armor: 'Rüstung gereinigt', clean_banner: 'Banner gereinigt', clean_shulker_box: 'Shulkerkiste gereinigt', inspect_hopper: 'Trichter untersucht',
    inspect_dropper: 'Spender untersucht', inspect_dispenser: 'Werfer untersucht', trigger_trapped_chest: 'Redstone-Truhe ausgelöst',
    'cobblemon:captured': 'Pokémon gefangen', 'cobblemon:shinies_captured': 'Shinys gefangen', 'cobblemon:dex_entries': 'Pokédex-Einträge', 'cobblemon:evolved': 'Entwicklungen',
    'cobblemon:level_up': 'Level-Ups', 'cobblemon:traded': 'Pokémon getauscht', 'cobblemon:battles_total': 'Kämpfe gesamt', 'cobblemon:battles_won': 'Kämpfe gewonnen',
    'cobblemon:battles_fled': 'Kämpfe geflohen', 'cobblemon:times_ridden': 'Mal auf Pokémon geritten', 'cobblemon:riding_land': 'An Land geritten',
    'cobblemon:riding_air': 'In der Luft geritten', 'cobblemon:riding_liquid': 'Im Wasser geritten',
    'rad_gyms:gyms_beaten': 'Arenen besiegt', 'rad_gyms:gyms_failed': 'Arenen verloren', 'rad_gyms:gyms_visited': 'Arenen besucht', 'rad_gyms:entrances_used': 'Arena-Eingänge benutzt',
    'rad_gyms:ropes_used': 'Seile benutzt', 'waystones:waystone_activated': 'Wegsteine aktiviert'
  };
  // Deutsche Suchbegriffe fuer die (englischen) Namen von Bloecken, Gegenstaenden und Kreaturen
  var DE2EN = { diamant: 'diamond', smaragd: 'emerald', eisen: 'iron', kupfer: 'copper', kohle: 'coal', erz: 'ore', stein: 'stone', bruchstein: 'cobblestone',
    tiefenschiefer: 'deepslate', erde: 'dirt', gras: 'grass', kies: 'gravel', holz: 'wood', stamm: 'log', bretter: 'planks', eiche: 'oak', fichte: 'spruce', birke: 'birch',
    laub: 'leaves', fackel: 'torch', truhe: 'chest', ofen: 'furnace', werkbank: 'crafting', bett: 'bed', tuer: 'door', glas: 'glass', wolle: 'wool', ziegel: 'brick',
    schwert: 'sword', spitzhacke: 'pickaxe', axt: 'axe', schaufel: 'shovel', hacke: 'hoe', bogen: 'bow', pfeil: 'arrow', schild: 'shield', angel: 'fishing_rod',
    brot: 'bread', apfel: 'apple', karotte: 'carrot', kartoffel: 'potato', weizen: 'wheat', fisch: 'fish', kabeljau: 'cod', lachs: 'salmon',
    fleisch: 'beef', steak: 'beef', huhn: 'chicken', schwein: 'pig', kuh: 'cow', schaf: 'sheep', pferd: 'horse', wolf: 'wolf', katze: 'cat', spinne: 'spider',
    skelett: 'skeleton', hexe: 'witch', dorfbewohner: 'villager', drache: 'dragon', schleim: 'slime', lohe: 'blaze', ghast: 'ghast', zombie: 'zombie',
    pokeball: 'poke_ball', 'poké': 'poke', beere: 'berry', aprikorn: 'apricorn', trank: 'potion', perle: 'pearl', sand: 'sand', lehm: 'clay', schnee: 'snow', eis: 'ice' };
  function matchWord(x, w) {
    if (x.q.indexOf(w) >= 0) return true;
    for (var k in DE2EN) if (w.length >= 3 && k.indexOf(w) === 0 && x.q.indexOf(DE2EN[k]) >= 0) return true;
    return false;
  }
  function pretty(id) {
    var p = id.split(':'), ns = p.length > 1 ? p[0] : 'minecraft', name = (p[1] || p[0]).replace(/[_/.]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    return ns === 'minecraft' ? name : ns.charAt(0).toUpperCase() + ns.slice(1) + ' · ' + name;
  }
  function statLabel(cat, key) {
    var short = key.replace(/^minecraft:/, '');
    if (cat === 'minecraft:custom' && CUSTOM_DE[short]) return CUSTOM_DE[short];
    if (key === 'cobblemon:pokemon') return 'Pokémon';
    return pretty(key);
  }
  function unitOf(cat, key) {
    if (cat !== 'minecraft:custom') return '';
    if (/_one_cm$/.test(key) || /^cobblemon:riding_(land|air|liquid)$/.test(key)) return 'cm';
    if (/(play_time|total_world_time|time_since_death|time_since_rest|sneak_time)$/.test(key)) return 'ticks';
    if (/damage_/.test(key)) return 'dmg';
    return '';
  }
  function fmtStat(v, unit) {
    var f1 = function (x) { return x.toLocaleString('de-DE', { maximumFractionDigits: 1 }); };
    if (unit === 'cm') return v >= 100000 ? f1(v / 100000) + ' km' : nf.format(Math.round(v / 100)) + ' m';
    if (unit === 'ticks') return v >= 72000 ? f1(v / 72000) + ' Std' : nf.format(Math.round(v / 1200)) + ' Min';
    if (unit === 'dmg') return f1(v / 20) + ' Herzen';
    return nf.format(v);
  }
  // Aufbau wie der Statistik-Bildschirm in Minecraft: Allgemein, Blöcke & Items (je Spalte eine Zaehlart), Kreaturen
  var ITEM_COLS = [['minecraft:mined', 'Abgebaut'], ['minecraft:crafted', 'Hergestellt'], ['minecraft:used', 'Benutzt'], ['minecraft:broken', 'Kaputtgegangen'], ['minecraft:picked_up', 'Aufgehoben'], ['minecraft:dropped', 'Fallen gelassen']];
  var TABS = [
    { id: 'general', name: 'Allgemein', cols: [['minecraft:custom', 'Wert']], sort: { col: 'name', dir: 1 } },
    { id: 'items', name: 'Blöcke & Items', cols: ITEM_COLS, sort: { col: 'sum', dir: -1 } },
    { id: 'mobs', name: 'Kreaturen', cols: [['minecraft:killed', 'Getötet'], ['minecraft:killed_by', 'Getötet von']], sort: { col: 'sum', dir: -1 } }
  ];
  var AGG_MAX = /time_since_/; // "Zeit seit ..." ergibt als Summe keinen Sinn: bei allen Spielern zaehlt der Hoechstwert
  var BORING = /(leave_game|total_world_time|time_since_|inspect_)/; // fuer die Tagesstatistik ungeeignet
  var stats = null, S = {}, stIndex = [], stTab = 'general', stPlayer = 'all', stLimit = 100, stLoadedAt = 0, stPromise = null, stSort = {}, dailyDay = '';
  TABS.forEach(function (t) { stSort[t.id] = { col: t.sort.col, dir: t.sort.dir }; });

  function buildStats(d) {
    stats = d; S = {}; stIndex = []; stLoadedAt = Date.now();
    Object.keys(d.stats || {}).forEach(function (cat) {
      S[cat] = {};
      Object.keys(d.stats[cat]).forEach(function (key) {
        var list = d.stats[cat][key], by = {}, sum = 0, max = 0;
        list.forEach(function (e) { by[e[0]] = e[1]; sum += e[1]; if (e[1] > max) max = e[1]; });
        var x = { cat: cat, key: key, list: list, by: by, sum: sum, max: max, label: statLabel(cat, key), catName: CAT_DE[cat] || pretty(cat) };
        x.q = (x.label + ' ' + x.catName + ' ' + key).toLowerCase();
        S[cat][key] = x; stIndex.push(x);
      });
    });
    // Spielerauswahl (alphabetisch)
    var sel = $('stPlayer'), keep = stPlayer; sel.textContent = '';
    var all = el('option', '', 'Alle Spieler (Summe)'); all.value = 'all'; sel.appendChild(all);
    d.players.map(function (n, i) { return [n, i]; }).sort(function (a, b) { return a[0].toLowerCase().localeCompare(b[0].toLowerCase(), 'de'); }).forEach(function (p) {
      var o = el('option', '', p[0]); o.value = String(p[1]); sel.appendChild(o);
    });
    sel.value = keep; if (sel.value !== keep) { stPlayer = 'all'; sel.value = 'all'; }
    showSelectedHead();
  }
  function showSelectedHead() { var h = $('stHead'); h.textContent = ''; if (stats && stPlayer !== 'all') h.appendChild(avatar(stats.players[+stPlayer])); }
  // stats.json laden (hoechstens alle 5 Minuten neu)
  function ensureStats() {
    if (stats && Date.now() - stLoadedAt < 300000) return Promise.resolve(stats);
    if (!stPromise) stPromise = fetchJson('data/stats.json').then(function (d) { buildStats(d); stPromise = null; return d; }, function (e) { stPromise = null; throw e; });
    return stPromise;
  }
  function valueOf(x) { if (!x) return 0; return stPlayer === 'all' ? (AGG_MAX.test(x.key) ? x.max : x.sum) : (x.by[stPlayer] || 0); }
  function fmtCell(x, v) { return fmtStat(v, x ? unitOf(x.cat, x.key) : ''); }
  function rankOf(x) { var v = x.by[stPlayer] || 0, r = 1; x.list.forEach(function (e) { if (e[1] > v) r++; }); return r; }

  function tabRows(tab) {
    var map = {};
    tab.cols.forEach(function (c, ci) {
      var cat = S[c[0]] || {};
      Object.keys(cat).forEach(function (key) {
        var r = map[key] || (map[key] = { key: key, cells: [], label: statLabel(tab.cols[0][0], key), q: cat[key].q });
        r.cells[ci] = cat[key];
      });
    });
    var q = $('stSearch').value.trim().toLowerCase(), words = q ? q.split(/\s+/) : [], rows = [];
    Object.keys(map).forEach(function (key) {
      var r = map[key];
      if (words.length && !words.every(function (w) { return matchWord(r, w); })) return;
      r.v = tab.cols.map(function (c, ci) { return valueOf(r.cells[ci]); });
      r.sum = r.v.reduce(function (a, b) { return a + b; }, 0);
      if (stPlayer !== 'all' && !r.sum) return;     // beim Spielerfilter nur, was der Spieler wirklich getan hat
      if (tab.id === 'general') { var x = r.cells[0]; r.lead = stPlayer === 'all' ? (x.list[0] ? x.list[0][1] : 0) : rankOf(x); }
      rows.push(r);
    });
    var so = stSort[tab.id], dir = so.dir;
    rows.sort(function (a, b) {
      var d = so.col === 'name' ? a.label.localeCompare(b.label, 'de') : so.col === 'sum' ? a.sum - b.sum : so.col === 'lead' ? a.lead - b.lead : a.v[so.col] - b.v[so.col];
      return (d * dir) || a.label.localeCompare(b.label, 'de');
    });
    return rows;
  }

  function currentTab() { return TABS.filter(function (t) { return t.id === stTab; })[0]; }
  function headCell(text, col, num) {
    var th = el('th', num ? 'num' : ''), so = stSort[stTab], on = so.col === col;
    var b = el('button', 'hbtn', text); b.type = 'button';
    if (on) { b.setAttribute('data-dir', so.dir > 0 ? ' ▲' : ' ▼'); th.setAttribute('aria-sort', so.dir > 0 ? 'ascending' : 'descending'); }
    b.addEventListener('click', function () {
      var asc = col === 'name' || (col === 'lead' && stPlayer !== 'all'); // Name A-Z und Rang 1,2,3 beginnen aufsteigend, Zahlen absteigend
      so.dir = on ? -so.dir : (asc ? 1 : -1); so.col = col; stLimit = 100; renderTable();
    });
    th.appendChild(b); return th;
  }
  function cellButton(x, text, name) {
    var b = el('button', 'cell', name ? '' : text); b.type = 'button'; b.title = 'Rangliste ansehen';
    if (name) { b.classList.add('with-head'); b.appendChild(avatar(name, true)); b.appendChild(document.createTextNode(text)); }
    b.addEventListener('click', function () { openStat(x); }); return b;
  }
  function renderTable() {
    var tab = currentTab(), table = $('stTable'), rows = tabRows(tab);
    table.textContent = '';
    var thead = el('thead'), hr = el('tr');
    hr.appendChild(headCell('Name', 'name'));
    tab.cols.forEach(function (c, ci) { hr.appendChild(headCell(c[1], ci, true)); });
    if (tab.id === 'general') hr.appendChild(headCell(stPlayer === 'all' ? 'Spitzenreiter' : 'Rang', 'lead', stPlayer !== 'all'));
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = el('tbody');
    rows.slice(0, stLimit).forEach(function (r) {
      var tr = el('tr'), name = el('td', 'nm', r.label); name.title = r.key; tr.appendChild(name);
      tab.cols.forEach(function (c, ci) {
        var td = el('td', 'num'), x = r.cells[ci], v = r.v[ci];
        if (!x || !v) td.appendChild(el('span', 'zero', '–')); else td.appendChild(cellButton(x, fmtCell(x, v)));
        tr.appendChild(td);
      });
      if (tab.id === 'general') {
        var x0 = r.cells[0], td = el('td', stPlayer === 'all' ? 'lead' : 'num');
        if (stPlayer === 'all') { var top = x0.list[0]; td.appendChild(top ? cellButton(x0, stats.players[top[0]] + ' · ' + fmtCell(x0, top[1]), stats.players[top[0]]) : el('span', 'zero', '–')); }
        else td.appendChild(el('span', '', r.lead + '. von ' + x0.list.length));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    var who = stPlayer === 'all' ? 'Summe aller Spieler' : stats.players[+stPlayer];
    $('stInfo').textContent = rows.length ? nf.format(rows.length) + (rows.length === 1 ? ' Eintrag' : ' Einträge') + ' · ' + who + (tab.id === 'general' && stPlayer === 'all' ? ' · „Zeit seit …“: Höchstwert' : '') : 'Keine passenden Statistiken gefunden.';
    var more = $('stMore'); more.hidden = rows.length <= stLimit; more.textContent = 'Mehr anzeigen (' + nf.format(rows.length - stLimit) + ' weitere)';
  }
  function renderTabs() {
    var box = $('stTabs'); box.textContent = '';
    TABS.forEach(function (t) {
      var b = el('button', 'tab' + (t.id === stTab ? ' on' : ''), t.name); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(t.id === stTab));
      b.addEventListener('click', function () { stTab = t.id; stLimit = 100; renderTabs(); renderTable(); });
      box.appendChild(b);
    });
  }

  // Rangliste einer einzelnen Statistik (aus der Tabelle oder von einer Tagesstatistik)
  function openStat(x) {
    $('stPick').hidden = true; $('stBoard').hidden = false;
    $('stTitle').textContent = x.label; $('stDesc').textContent = x.catName + ' · ' + x.key + ' · ' + x.list.length + ' Spieler';
    var ul = $('stRows'), unit = unitOf(x.cat, x.key); ul.textContent = '';
    x.list.forEach(function (e, i) {
      var name = stats.players[e[0]] || '?', li = el('li', 'row r' + (i < 3 ? i + 1 : '') + (String(e[0]) === stPlayer ? ' me' : '')); li.style.setProperty('--i', Math.min(i, 15));
      li.appendChild(el('span', 'rank', String(i + 1)));
      li.appendChild(avatar(name));
      li.appendChild(el('span', 'name', name)); li.appendChild(el('span', 'val', fmtStat(e[1], unit)));
      ul.appendChild(li);
    });
    $('stBack').focus();
  }
  function showPick() { $('stBoard').hidden = true; $('stPick').hidden = false; $('stTitle').textContent = 'Statistiken'; }
  function openStats(then) {
    showPick(); if (!$('statsDlg').open) $('statsDlg').showModal();
    $('stInfo').textContent = 'Statistiken werden geladen …';
    return ensureStats().then(function () { renderTabs(); renderTable(); if (then) then(); }).catch(function () {
      $('stInfo').textContent = 'Die Statistiken sind noch nicht verfügbar. Sie werden vom Server-PC mit hochgeladen, sobald das aktualisierte Sync-Skript läuft.';
    });
  }
  $('statsBtn').addEventListener('click', function () { openStats(function () { $('stSearch').focus(); }); });
  $('stSearch').addEventListener('input', function () { if (stats) { stLimit = 100; renderTable(); } });
  $('stPlayer').addEventListener('change', function () { stPlayer = this.value; stLimit = 100; showSelectedHead(); if (stats) renderTable(); });
  $('stMore').addEventListener('click', function () { stLimit += 200; renderTable(); });
  $('stBack').addEventListener('click', function () { showPick(); });

  // Statistiken des Tages: drei zufaellige, fuer alle Besucher gleiche Statistiken, die jeden Tag (0 Uhr deutscher Zeit) wechseln
  function berlinDay() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' }); }
  function seeded(str) { // feste Zufallszahl 0..1 aus einem Text (xmur3 + mulberry32): gleicher Text = gleiche Zahl
    var h = 1779033703 ^ str.length; for (var i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    var a = (Math.imul(h ^ (h >>> 16), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0;
    a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function groupOf(x) {
    if (/^(cobblemon|rad_gyms):/.test(x.key)) return 'cobblemon';
    if (x.cat === 'minecraft:custom') return /_one_cm$/.test(x.key) ? 'bewegung' : 'allgemein';
    return x.cat;
  }
  var GROUP_ICON = { cobblemon: '🐾', bewegung: '👣', allgemein: '📈', 'minecraft:mined': '⛏️', 'minecraft:crafted': '🔨', 'minecraft:used': '🖐️', 'minecraft:broken': '💔', 'minecraft:picked_up': '🧲', 'minecraft:dropped': '📦', 'minecraft:killed': '⚔️', 'minecraft:killed_by': '💀' };
  function dailyPicks() {
    var day = berlinDay(), ok = function (x) { return !BORING.test(x.key); }, pool;
    // Nur Statistiken, bei denen es etwas zu vergleichen gibt: mind. 3 Spieler und ein Spitzenwert ab 5; sonst schrittweise lockerer
    [function (x) { return x.list.length >= 3 && x.max >= 5; }, function (x) { return x.list.length >= 2; }, function () { return true; }].some(function (f) {
      pool = stIndex.filter(function (x) { return ok(x) && f(x); }); return pool.length >= 3;
    });
    // Jede Statistik bekommt pro Tag eine feste Zufallszahl; die ersten drei aus verschiedenen Bereichen werden gezeigt.
    // So haengt die Auswahl nur vom Tag ab (nicht von der Reihenfolge der Daten) und bleibt tagsueber stabil.
    pool = pool.map(function (x) { return { x: x, r: seeded(day + '|' + x.cat + '|' + x.key) }; }).sort(function (a, b) { return a.r - b.r; }).map(function (o) { return o.x; });
    var out = [], used = {};
    pool.forEach(function (x) { var g = groupOf(x); if (out.length < 3 && !used[g]) { used[g] = 1; out.push(x); } });
    pool.forEach(function (x) { if (out.length < 3 && out.indexOf(x) < 0) out.push(x); });
    return out;
  }
  function renderDaily() {
    var box = $('dailyList'), sec = $('daily'), picks = dailyPicks(); box.textContent = ''; dailyDay = berlinDay();
    sec.hidden = !picks.length; if (!picks.length) return;
    $('dailyDate').textContent = new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: 'numeric', month: 'long' });
    picks.forEach(function (x) {
      var card = el('article', 'card'), head = el('header'), unit = unitOf(x.cat, x.key);
      card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', x.label + ' – Rangliste anzeigen');
      var open = function () { stPlayer = 'all'; $('stPlayer').value = 'all'; showSelectedHead(); openStats(function () { openStat(x); }); };
      card.addEventListener('click', open);
      card.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
      head.appendChild(el('div', 'ico', GROUP_ICON[groupOf(x)] || '📊'));
      var t = el('div'); t.appendChild(el('h3', '', x.label)); t.appendChild(el('p', '', x.catName)); head.appendChild(t); card.appendChild(head);
      var ul = el('ul', 'rows');
      x.list.slice(0, 3).forEach(function (e, i) {
        var name = stats.players[e[0]] || '?', li = el('li', 'row r' + (i + 1)); li.style.setProperty('--i', i);
        li.appendChild(el('span', 'rank', String(i + 1)));
        li.appendChild(avatar(name));
        li.appendChild(el('span', 'name', name)); li.appendChild(el('span', 'val', fmtStat(e[1], unit)));
        ul.appendChild(li);
      });
      card.appendChild(ul);
      card.appendChild(el('p', 'more', x.list.length > 3 ? 'Alle ' + x.list.length + ' anzeigen →' : 'Details →'));
      box.appendChild(card);
    });
  }
  ensureStats().then(renderDaily).catch(function (e) { if (window.console) console.warn('Statistiken des Tages:', e); }); // fehlt stats.json, bleibt der Bereich einfach ausgeblendet

  fetchJson('announcements.json').then(renderNews).catch(function () { renderNews([]); });
  load(); setInterval(maybeLoad, 15000); document.addEventListener('visibilitychange', maybeLoad);
})();
