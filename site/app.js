(function () {
  'use strict';
  var mode = 'week', data = null;
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
      }
      cards.appendChild(card);
    });
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

  document.querySelectorAll('.seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      mode = b.getAttribute('data-mode');
      document.querySelectorAll('.seg button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderBoards(); if (data) $('weekInfo').textContent = mode === 'week' ? 'Die Woche endet am ' + new Date(data.weekEnd).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' }) + ' um 00:00 Uhr. Danach beginnt eine neue Wertung.' : 'Gesamtstand seit Beginn der Welt.';
    });
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
