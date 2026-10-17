(function () {
  'use strict';
  // Bewerbungen laufen ueber Supabase (nur oeffentlicher Schluessel; Einfuegen erlaubt, Lesen nicht).
  var SUPABASE_URL = 'https://pumdupjmmvimlxqvuymg.supabase.co', SUPABASE_KEY = 'sb_publishable_VcunJmqIHajV3s2gfUMWSQ_MlIpmkas';
  var mode = 'week', data = null, openBoardId = null;
  var $ = function (id) { return document.getElementById(id); };
  var nf = new Intl.NumberFormat('de-DE');
  var COLORS = ['#ffcb05', '#7fb5ff', '#ff8a8a', '#7be0b0', '#c9a0ff', '#ffb36b', '#6fd6e8', '#f0a0d0'];

  function hue(name) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return COLORS[h % COLORS.length]; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function fetchJson(url) { return fetch(url + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }

  function renderStatus(s) {
    var pill = $('pill');
    if (s && s.up) { pill.className = 'pill on'; pill.textContent = 'Online · ' + s.online + '/' + s.max + ' Spieler'; }
    else { pill.className = 'pill off'; pill.textContent = 'Offline'; }
    $('addr').textContent = (s && s.address) || '–';
    $('players').textContent = s && s.names && s.names.length ? 'Gerade online: ' + s.names.join(', ') : '';
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
      if (!list.length) card.appendChild(el('p', 'empty', mode === 'week' ? 'Diese Woche noch keine Einträge.' : 'Noch keine Einträge.'));
      else {
        var ul = el('ul', 'rows');
        list.slice(0, 10).forEach(function (e, i) {
          var li = el('li', 'row r' + (i + 1));
          li.appendChild(el('span', 'rank', String(i + 1)));
          var av = el('span', 'av', e.name.charAt(0).toUpperCase()); av.style.background = hue(e.name); li.appendChild(av);
          li.appendChild(el('span', 'name', e.name));
          var v = el('span', 'val', nf.format(e.value)); v.appendChild(el('small', '', b.unit)); li.appendChild(v);
          ul.appendChild(li);
        });
        card.appendChild(ul);
        card.appendChild(el('p', 'more', 'Alle ' + list.length + ' anzeigen →'));
      }
      cards.appendChild(card);
    });
  }

  function rowsInto(ul, list, b) {
    ul.textContent = '';
    list.forEach(function (e) {
      var li = el('li', 'row r' + (e.rank <= 3 ? e.rank : ''));
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
    renderBoards(); if (data) $('weekInfo').textContent = m === 'week' ? 'Die Woche endet am ' + new Date(data.weekEnd).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' }) + ' um 00:00 Uhr. Danach beginnt eine neue Wertung.' : 'Gesamtstand seit Beginn der Welt.';
    if ($('boardDlg').open) renderBoardDlg();
  }

  function fmtDate(s) { var d = new Date(s + (s.length === 10 ? 'T00:00:00' : '')); return isNaN(d) ? s : d.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }); }

  function renderNews(list) {
    var box = $('newsList'); box.textContent = '';
    if (!list.length) { box.appendChild(el('p', 'muted', 'Keine Ankündigungen.')); return; }
    list.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).forEach(function (n) {
      var p = el('article', 'post ' + (n.type || 'news')), h = el('h3', '', n.title || '');
      if (n.type === 'event') h.appendChild(el('span', 'badge', 'Event')); else if (n.type === 'wartung') h.appendChild(el('span', 'badge', 'Wartung'));
      p.appendChild(h); p.appendChild(el('div', 'meta', fmtDate(n.date || ''))); p.appendChild(el('p', '', n.text || ''));
      box.appendChild(p);
    });
  }

  function renderWinners(hist) {
    var box = $('winnerList'); box.textContent = '';
    if (!hist.length) { box.appendChild(el('p', 'muted', 'Die ersten Wochensieger stehen am Ende dieser Woche hier.')); return; }
    hist.slice(0, 6).forEach(function (w) {
      var c = el('div', 'win'); c.appendChild(el('h3', '', 'Woche ab ' + fmtDate(w.weekStart)));
      var ul = el('ul');
      (data ? data.boards : []).forEach(function (b) {
        var first = (w.winners[b.id] || [])[0];
        var li = el('li'); li.appendChild(el('span', '', b.icon + ' ' + b.title));
        li.appendChild(el('strong', '', first ? first.name + ' (' + nf.format(first.value) + ')' : '–')); ul.appendChild(li);
      });
      c.appendChild(ul); box.appendChild(c);
    });
  }

  function load() {
    fetchJson('data/leaderboards.json').then(function (d) {
      data = d; renderStatus(d.server); renderBoards();
      var end = new Date(d.weekEnd);
      $('weekInfo').textContent = mode === 'week' ? 'Die Woche endet am ' + end.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' }) + ' um 00:00 Uhr. Danach beginnt eine neue Wertung.' : 'Gesamtstand seit Beginn der Welt.';
      $('updated').textContent = 'Zuletzt aktualisiert: ' + new Date(d.updated).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
    }).catch(function () { renderStatus(null); $('updated').textContent = 'Daten momentan nicht verfügbar.'; });
    fetchJson('data/history.json').then(renderWinners).catch(function () { renderWinners([]); });
  }

  document.querySelectorAll('.seg button[data-mode]').forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); }); });
  document.querySelectorAll('[data-bmode]').forEach(function (b) { b.addEventListener('click', function () { setMode(b.getAttribute('data-bmode')); }); });
  $('bdSearch').addEventListener('input', renderBoardDlg);
  document.querySelectorAll('dialog').forEach(function (d) {
    d.addEventListener('click', function (ev) { if (ev.target === d || ev.target.hasAttribute('data-close')) d.close(); });
  });

  // Whitelist-Bewerbung
  var msg = $('applyMsg');
  function say(t, ok) { msg.textContent = t; msg.className = 'msg ' + (ok ? 'ok' : 'err'); }
  document.querySelectorAll('[data-apply]').forEach(function (b) { b.addEventListener('click', function () { say('', true); $('applyDlg').showModal(); $('fMc').focus(); }); });
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
  $('copy').addEventListener('click', function () {
    var a = $('addr').textContent, small = this.querySelector('small');
    var done = function () { small.textContent = 'kopiert!'; setTimeout(function () { small.textContent = 'kopieren'; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(a).then(done, function () {}); else done();
  });

  function tick() {
    var box = $('cd'), left = new Date(box.getAttribute('data-target')) - Date.now();
    if (isNaN(left)) return;
    if (left <= 0) { box.parentNode.hidden = true; return; }
    var p = function (n) { return String(n).padStart(2, '0'); }, s = Math.floor(left / 1000);
    $('cd-d').textContent = Math.floor(s / 86400); $('cd-h').textContent = p(Math.floor(s % 86400 / 3600));
    $('cd-m').textContent = p(Math.floor(s % 3600 / 60)); $('cd-s').textContent = p(s % 60);
  }
  tick(); setInterval(tick, 1000);

  fetchJson('announcements.json').then(renderNews).catch(function () { renderNews([]); });
  load(); setInterval(load, 60000);
})();
