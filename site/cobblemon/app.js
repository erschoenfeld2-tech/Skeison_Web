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
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function getJson(url) { return fetch(url + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function fetchJson(url) { return getJson(DATA_BASE + url.replace(/^data\//, '')).catch(function () { return getJson(url); }); }

  function renderStatus(s, updated) {
    var pill = $('pill'), stale = !updated || Date.now() - new Date(updated).getTime() > STALE_MS;
    if (s && stale) { pill.className = 'pill unk'; pill.textContent = 'Status unbekannt'; }
    else if (s && s.up) { pill.className = 'pill on'; pill.textContent = 'Aktiv · ' + s.online + '/' + s.max + ' Spieler online'; }
    else { pill.className = 'pill off'; pill.textContent = 'Offline'; }
    $('addr').textContent = (s && s.address) || '–';
    $('players').textContent = s && !stale && s.names && s.names.length ? 'Gerade online: ' + s.names.join(', ') : '';
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
      if (!list.length) card.appendChild(el('p', 'empty', !live() ? 'Startet mit dem Serverstart.' : mode === 'week' ? 'Diese Woche noch keine Einträge.' : 'Noch keine Einträge.'));
      else {
        var ul = el('ul', 'rows');
        list.slice(0, 3).forEach(function (e, i) {
          var li = el('li', 'row r' + (i + 1)); li.style.setProperty('--i', i);
          li.appendChild(el('span', 'rank', String(i + 1)));
          var av = el('span', 'av', e.name.charAt(0).toUpperCase()); av.style.background = hue(e.name); li.appendChild(av);
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
      var av = el('span', 'av', e.name.charAt(0).toUpperCase()); av.style.background = hue(e.name); li.appendChild(av);
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
      data.boards.forEach(function (b) {
        var first = (w.winners[b.id] || [])[0];
        var li = el('li'); li.appendChild(el('span', '', b.icon + ' ' + b.title));
        li.appendChild(el('strong', '', first ? first.name + ' (' + nf.format(first.value) + ')' : '–')); ul.appendChild(li);
      });
      c.appendChild(ul); box.appendChild(c);
    });
  }

  function load() {
    fetchJson('data/leaderboards.json').then(function (d) {
      if (!live()) { // vor dem Serverstart gibt es keine Wertung (Testdaten werden ausgeblendet)
        d.boards.forEach(function (b) { b.week = []; b.total = []; }); d.server.names = [];
      }
      data = d; renderStatus(d.server, d.updated); renderBoards(); weekInfo(); renderWinners();
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
    inspect_dropper: 'Spender untersucht', inspect_dispenser: 'Werfer untersucht', trigger_trapped_chest: 'Redstone-Truhe ausgelöst'
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
  var stats = null, stCat = 'all', stIndex = [];
  function pretty(id) {
    var p = id.split(':'), ns = p.length > 1 ? p[0] : 'minecraft', name = (p[1] || p[0]).replace(/[_/.]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    return ns === 'minecraft' ? name : ns.charAt(0).toUpperCase() + ns.slice(1) + ' · ' + name;
  }
  function statLabel(cat, key) { var short = key.replace(/^minecraft:/, ''); return cat === 'minecraft:custom' && CUSTOM_DE[short] ? CUSTOM_DE[short] : pretty(key); }
  function unitOf(cat, key) {
    if (cat !== 'minecraft:custom') return '';
    if (/_one_cm$/.test(key)) return 'cm';
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
  function buildIndex() {
    stIndex = [];
    Object.keys(stats.stats || {}).forEach(function (cat) {
      Object.keys(stats.stats[cat]).forEach(function (key) {
        var label = statLabel(cat, key), catName = CAT_DE[cat] || pretty(cat);
        stIndex.push({ cat: cat, key: key, label: label, catName: catName, list: stats.stats[cat][key], q: (label + ' ' + catName + ' ' + key).toLowerCase() });
      });
    });
    var order = CATS.map(function (c) { return c[0]; });
    stIndex.sort(function (a, b) { var ca = order.indexOf(a.cat), cb = order.indexOf(b.cat); return (ca < 0 ? 99 : ca) - (cb < 0 ? 99 : cb) || a.label.localeCompare(b.label, 'de'); });
  }
  function renderCats() {
    var box = $('stCats'), present = {}; box.textContent = '';
    stIndex.forEach(function (x) { present[x.cat] = true; });
    [['all', 'Alle']].concat(CATS.filter(function (c) { return present[c[0]]; })).forEach(function (c) {
      var b = el('button', 'cat' + (stCat === c[0] ? ' on' : ''), c[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(stCat === c[0]));
      b.addEventListener('click', function () { stCat = c[0]; renderCats(); renderStatList(); });
      box.appendChild(b);
    });
  }
  function renderStatList() {
    var q = $('stSearch').value.trim().toLowerCase(), ul = $('stList'); ul.textContent = '';
    var hits = stIndex.filter(function (x) { return (stCat === 'all' || x.cat === stCat) && (!q || q.split(/\s+/).every(function (w) { return matchWord(x, w); })); });
    $('stInfo').textContent = hits.length ? nf.format(hits.length) + (hits.length === 1 ? ' Statistik' : ' Statistiken') + (hits.length > 200 ? ' · die ersten 200 werden angezeigt, Suche eingrenzen' : '') : 'Keine passende Statistik gefunden.';
    hits.slice(0, 200).forEach(function (x) {
      var li = el('li'), b = el('button', 'stat'), top = x.list[0];
      b.type = 'button';
      var t = el('span', 'st-name'); t.appendChild(el('b', '', x.label)); t.appendChild(el('small', '', x.catName)); b.appendChild(t);
      b.appendChild(el('span', 'st-lead', top ? stats.players[top[0]] + ' · ' + fmtStat(top[1], unitOf(x.cat, x.key)) : '–'));
      b.addEventListener('click', function () { openStat(x); });
      li.appendChild(b); ul.appendChild(li);
    });
  }
  function openStat(x) {
    $('stPick').hidden = true; $('stBoard').hidden = false;
    $('stTitle').textContent = x.label; $('stDesc').textContent = x.catName + ' · ' + x.key + ' · ' + x.list.length + ' Spieler';
    var ul = $('stRows'), unit = unitOf(x.cat, x.key); ul.textContent = '';
    x.list.forEach(function (e, i) {
      var name = stats.players[e[0]] || '?', li = el('li', 'row r' + (i < 3 ? i + 1 : '')); li.style.setProperty('--i', Math.min(i, 15));
      li.appendChild(el('span', 'rank', String(i + 1)));
      var av = el('span', 'av', name.charAt(0).toUpperCase()); av.style.background = hue(name); li.appendChild(av);
      li.appendChild(el('span', 'name', name)); li.appendChild(el('span', 'val', fmtStat(e[1], unit)));
      ul.appendChild(li);
    });
    $('stBack').focus();
  }
  function showPick() { $('stBoard').hidden = true; $('stPick').hidden = false; $('stTitle').textContent = 'Alle Statistiken'; }
  $('statsBtn').addEventListener('click', function () {
    showPick(); $('statsDlg').showModal(); $('stSearch').focus();
    if (stats) return;
    fetchJson('data/stats.json').then(function (d) {
      stats = d; buildIndex(); renderCats(); renderStatList();
      if (!stIndex.length) $('stInfo').textContent = 'Noch keine Statistiken vorhanden.';
    }).catch(function () { $('stInfo').textContent = 'Die Statistiken sind noch nicht verfügbar. Sie werden vom Server-PC mit hochgeladen, sobald das aktualisierte Sync-Skript läuft.'; });
  });
  $('stSearch').addEventListener('input', function () { if (stats) renderStatList(); });
  $('stBack').addEventListener('click', function () { showPick(); $('stSearch').focus(); });

  fetchJson('announcements.json').then(renderNews).catch(function () { renderNews([]); });
  load(); setInterval(load, 60000);
})();
