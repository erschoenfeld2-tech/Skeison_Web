// Gaming-Profil: Cobblemon-Countdown, 3D-Skin, Steam-Highlights, Server-Status und Discord-Zahlen
(function () {
  'use strict';
  // Serverstart (deutsche Zeit); gleicher Wert wie in cobblemon/app.js
  var START = new Date('2026-10-30T15:00:00+01:00').getTime();
  // Live-Daten des Cobblemon Servers (Branch "data", wie auf der Server-Seite)
  var DATA_BASE = 'https://raw.githubusercontent.com/erschoenfeld2-tech/Skeison_Web/data/';
  var DISCORD_INVITE = 'tjVKFGMRw7';
  var $ = function (id) { return document.getElementById(id); };
  var FX = window.FX || { roll: function (e, v) { e.textContent = v; }, count: function (e, v, f) { e.textContent = (f || String)(v); }, reduced: true };
  var nf = new Intl.NumberFormat('de-DE');
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function ext(a, href) { a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; }

  $('year').textContent = new Date().getFullYear();

  function tick() {
    var left = START - Date.now(), p = function (n) { return String(n).padStart(2, '0'); };
    $('cd').hidden = left <= 0; $('live').hidden = left > 0;
    if (left <= 0) return;
    var s = Math.floor(left / 1000);
    FX.roll($('cd-d'), Math.floor(s / 86400)); FX.roll($('cd-h'), p(Math.floor(s % 86400 / 3600)));
    FX.roll($('cd-m'), p(Math.floor(s % 3600 / 60))); FX.roll($('cd-s'), p(s % 60));
  }
  tick(); setInterval(tick, 1000);

  // 3D-Skin (Datei site/skin/skeison.png ersetzen, um den Skin zu wechseln); Animation per Knopf waehlbar
  var canvas = $('skinCanvas');
  try {
    var v = new skinview3d.SkinViewer({ canvas: canvas, width: 300, height: 400 });
    v.fov = 40; v.zoom = 0.85; v.autoRotate = !FX.reduced; v.autoRotateSpeed = 0.6;
    v.controls.enablePan = false;
    var ANIMS = { idle: skinview3d.IdleAnimation, wave: skinview3d.WaveAnimation, walk: skinview3d.WalkingAnimation, run: skinview3d.RunningAnimation };
    var setAnim = function (name) {
      v.animation = new ANIMS[name]();
      document.querySelectorAll('#skinAnims .chip').forEach(function (c) { var on = c.getAttribute('data-anim') === name; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
    };
    setAnim('idle');
    document.querySelectorAll('#skinAnims .chip').forEach(function (c) { c.addEventListener('click', function () { setAnim(c.getAttribute('data-anim')); }); });
    Promise.resolve(v.loadSkin('../skin/skeison.png')).then(function () { canvas.classList.add('ready'); }, function () { canvas.classList.add('ready'); });
    // Rendern pausieren, wenn der Skin nicht im Bild ist (spart Akku)
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { v.renderPaused = !es[0].isIntersecting; }).observe(canvas);
  } catch (e) {
    $('skinAnims').hidden = true;
    canvas.replaceWith(el('p', 'muted', '3D-Ansicht wird von diesem Browser nicht unterstützt.'));
  }

  // Steam-Highlights aus steam.json (wird von tools/fetch-steam.js beim Deploy erzeugt)
  function fmtH(h) { return (Math.round(h * 10) / 10).toLocaleString('de-DE') + ' Std'; }
  function gameList(title, list, key) {
    var f = document.createDocumentFragment(); f.appendChild(el('h4', '', title));
    var g = el('div', 'games');
    list.forEach(function (x) {
      var a = ext(el('a', 'game'), x.url), im = el('div', 'im');
      var i = el('img'); i.src = x.image; i.alt = ''; i.loading = 'lazy'; i.onerror = function () { i.style.visibility = 'hidden'; }; im.appendChild(i); a.appendChild(im);
      var d = el('div', 't'); d.appendChild(el('b', '', x.name)); d.appendChild(el('span', '', fmtH(x[key]) + (key === 'recent' ? ' in 2 Wochen' : ' gesamt'))); a.appendChild(d); g.appendChild(a);
    });
    f.appendChild(g); return f;
  }
  function steamEmpty(text) {
    var body = $('stBody'); body.textContent = ''; body.removeAttribute('aria-busy');
    var box = el('div', 'empty-state'); box.appendChild(el('p', '', text));
    box.appendChild(ext(el('a', 'btn ghost small', 'Auf Steam ansehen ↗'), $('stLink').href));
    body.appendChild(box);
  }
  fetch('../steam.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (s) {
    if (s.url) $('stLink').href = s.url;
    if (s.name) $('stName').textContent = s.name;
    // Stand der Daten (werden beim Deploy abgerufen, nicht live)
    if (s.updated && !isNaN(new Date(s.updated))) $('stState').textContent = 'Stand: ' + new Date(s.updated).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' Uhr';
    if (s.avatar) { var av = $('stAvatar'); av.src = s.avatar; av.hidden = false; }
    var body = $('stBody'); body.textContent = ''; body.removeAttribute('aria-busy');
    var st = [];
    if (s.gameCount) st.push(['Spiele', s.gameCount, nf.format]);
    if (s.totalHours) st.push(['Spielzeit', Math.round(s.totalHours), function (n) { return nf.format(n) + ' Std'; }]);
    if (s.level != null) st.push(['Level', s.level, String]);
    if (st.length) {
      var dl = $('stStats'); dl.hidden = false;
      st.forEach(function (p) { var d = el('div'), dd = el('dd'); d.appendChild(el('dt', '', p[0])); d.appendChild(dd); dl.appendChild(d); FX.count(dd, p[1], p[2]); });
    }
    if (s.recent && s.recent.length) body.appendChild(gameList('Zuletzt gespielt', s.recent, 'recent'));
    if (s.top && s.top.length) body.appendChild(gameList('Meistgespielt', s.top, 'hours'));
    if (!body.children.length) steamEmpty('Hier erscheinen bald die meistgespielten Spiele. Die Daten werden täglich aktualisiert.');
  }).catch(function () { steamEmpty('Steam-Daten sind gerade nicht verfügbar.'); });

  // Status des Cobblemon Servers auf der Karte
  function srv(cls, text) { var s = $('srvStatus'); s.className = 'srv ' + cls; s.textContent = ''; s.appendChild(el('span', cls === 'up' ? 'ping pulse' : 'ping')); s.appendChild(document.createTextNode(text)); s.hidden = false; }
  if (Date.now() < START) srv('soon', 'Start am ' + new Date(START).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' Uhr');
  else fetch(DATA_BASE + 'leaderboards.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
    var s = d.server || {};
    if (s.up) srv('up', 'Online · ' + s.online + '/' + s.max + ' Spieler'); else srv('down', 'Gerade offline');
  }).catch(function () {});

  // Mitglieder- und Online-Zahl des Discord-Servers (oeffentliche Einladungs-Info, bei Fehler ausgeblendet)
  fetch('https://discord.com/api/v10/invites/' + DISCORD_INVITE + '?with_counts=true').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
    if (!d.approximate_member_count) return;
    var box = $('dcStats'), on = el('span', 'on'), all = el('span', 'all'), onN = el('b'), allN = el('b');
    on.appendChild(el('i', 'ping pulse')); on.appendChild(onN); on.appendChild(document.createTextNode(' online'));
    all.appendChild(allN); all.appendChild(document.createTextNode(' Mitglieder'));
    box.appendChild(on); box.appendChild(all); box.hidden = false;
    FX.count(onN, d.approximate_presence_count || 0, nf.format); FX.count(allN, d.approximate_member_count, nf.format);
  }).catch(function () {});
})();
