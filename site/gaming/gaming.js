// Gaming-Profil: Ueberblick ueber alle Spiele, Valorant (Rang, Statistik, letzte Spiele), Steam-Highlights,
// Minecraft (3D-Skin, Status des Cobblemon Servers) und Discord-Zahlen
(function () {
  'use strict';
  // Serverstart (deutsche Zeit); gleicher Wert wie in cobblemon/app.js
  var START = new Date('2026-10-30T15:00:00+01:00').getTime();
  // Live-Daten des Cobblemon Servers (Branch "data", wie auf der Server-Seite)
  var DATA_BASE = 'https://raw.githubusercontent.com/erschoenfeld2-tech/Skeison_Web/data/';
  var DISCORD_INVITE = 'tjVKFGMRw7';
  var $ = function (id) { return document.getElementById(id); };
  var FX = window.FX || { reduced: true };
  var nf = new Intl.NumberFormat('de-DE');
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function ext(a, href) { a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function safe(u) { return /^https:\/\//.test(u || '') ? u : ''; }
  function img(src, cls, alt) { var i = el('img', cls); i.src = src; i.alt = alt || ''; i.loading = 'lazy'; i.onerror = function () { i.hidden = true; }; return i; }
  function getJson(u, opt) { return fetch(u, opt).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function when(iso) { return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' Uhr'; }
  function num(v, digits) { return Number(v).toLocaleString('de-DE', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 }); }

  $('year').textContent = new Date().getFullYear();

  // Kacheln "Auf einen Blick": Wert (und kleiner Zusatz) setzen oder die Kachel ausblenden, wenn es nichts zu zeigen gibt
  function tile(id, value, sub, cls) {
    var t = $(id); if (!t) return;
    if (value == null || value === '') { t.hidden = true; return; }
    var dd = t.querySelector('dd'); dd.textContent = '';
    dd.appendChild(el('b', cls || '', value));
    if (sub) dd.appendChild(el('small', '', sub));
    t.hidden = false; t.classList.add('ready');
  }

  // Gesicht des Minecraft-Skins (Kopf + Hut-Ebene) als Pixelbild im Einstieg
  var face = $('face');
  if (face && face.getContext) {
    var fi = new Image();
    fi.onload = function () { var c = face.getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(fi, 8, 8, 8, 8, 0, 0, 8, 8); c.drawImage(fi, 40, 8, 8, 8, 0, 0, 8, 8); face.classList.add('ready'); };
    fi.src = '../skin/skeison.png';
  }

  // ---------- Valorant aus valorant.json (wird von tools/fetch-valorant.js beim Deploy erzeugt) ----------
  function valEmpty(title, text) {
    var card = $('valCard'); card.textContent = ''; card.removeAttribute('aria-busy');
    var box = el('div', 'empty-state'); box.appendChild(el('h3', '', title)); box.appendChild(el('p', '', text));
    card.appendChild(box);
    tile('gRank', null); tile('gKd', null);
  }
  function stat(label, value, sub) { var d = el('div'); d.appendChild(el('dt', '', label)); var dd = el('dd', '', value); if (sub) dd.appendChild(el('small', '', sub)); d.appendChild(dd); return d; }
  function renderValorant(v) {
    if (!v || v.setup || !v.riotId) return valEmpty('Valorant-Statistik folgt', 'Hier erscheinen bald mein Rang, K/D, Trefferquote und die letzten Spiele.');
    var card = $('valCard'); card.textContent = ''; card.removeAttribute('aria-busy');
    var link = $('valLink'); if (safe(v.url)) { link.href = v.url; link.hidden = false; }
    var r = v.rank, s = v.stats;

    // Kopf: Spielerkarte, Name, Rang
    var head = el('div', 'val-head');
    if (v.card && safe(v.card.wide)) { var bg = img(v.card.wide, 'val-banner'); head.appendChild(bg); }
    var who = el('div', 'val-who');
    if (v.card && safe(v.card.small)) who.appendChild(img(v.card.small, 'avatar'));
    var info = el('div', 'pinfo'); var h = el('h3', '', v.name || 'Valorant'); if (v.tag) h.appendChild(el('span', 'val-tag', '#' + v.tag)); info.appendChild(h);
    info.appendChild(el('p', 'muted', [v.level != null ? 'Level ' + v.level : '', v.updated && !isNaN(new Date(v.updated)) ? 'Stand: ' + when(v.updated) : ''].filter(Boolean).join(' · ')));
    who.appendChild(info); head.appendChild(who);
    if (r) {
      var rank = el('div', 'val-rank');
      if (safe(r.icon)) rank.appendChild(img(r.icon, 'rank-ico', ''));
      var rt = el('div'); rt.appendChild(el('b', '', r.name));
      var rr = el('span', 'muted', r.tier > 2 ? r.rr + ' RR' : 'noch nicht eingestuft');
      if (r.tier > 2 && r.lastChange) rr.appendChild(el('i', r.lastChange > 0 ? 'up' : 'down', (r.lastChange > 0 ? ' +' : ' ') + r.lastChange + ' im letzten Spiel'));
      rt.appendChild(rr);
      // Fortschritt zum naechsten Rang (100 RR je Stufe)
      if (r.tier > 2 && r.tier < 27) { var bar = el('div', 'rr-bar'); var fill = el('i'); fill.style.width = Math.max(0, Math.min(100, r.rr)) + '%'; bar.appendChild(fill); bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', r.rr + ' von 100 Rangpunkten'); rt.appendChild(bar); }
      if (r.peak && r.peak.name) rt.appendChild(el('small', 'muted', 'Bestleistung: ' + r.peak.name + (r.peak.season ? ' (' + r.peak.season + ')' : '')));
      rank.appendChild(rt); head.appendChild(rank);
    }
    card.appendChild(head);

    if (s) {
      var dl = el('dl', 'stats');
      dl.appendChild(stat('K/D', num(s.kd, 2), s.kda ? 'KDA ' + num(s.kda, 2) : ''));
      dl.appendChild(stat('Siegquote', s.winrate + ' %', s.wins + ' von ' + s.matches));
      if (s.hs != null) dl.appendChild(stat('Kopftreffer', s.hs + ' %'));
      if (s.adr != null) dl.appendChild(stat('Schaden / Runde', nf.format(s.adr)));
      card.appendChild(dl);
      card.appendChild(el('p', 'muted val-note', 'Aus den letzten ' + s.matches + ' gewerteten Spielen.'));
    }
    if (v.agents && v.agents.length) {
      card.appendChild(el('h4', '', 'Meine Agenten'));
      var ag = el('div', 'agents');
      v.agents.forEach(function (a) {
        var d = el('div', 'agent'); if (safe(a.icon)) d.appendChild(img(a.icon, '', ''));
        var t = el('div', 't'); t.appendChild(el('b', '', a.name)); t.appendChild(el('span', '', a.games + (a.games === 1 ? ' Spiel' : ' Spiele') + ' · ' + a.winrate + ' % Siege · K/D ' + num(a.kd, 2)));
        d.appendChild(t); ag.appendChild(d);
      });
      card.appendChild(ag);
    }
    if (v.recent && v.recent.length) {
      card.appendChild(el('h4', '', 'Letzte Spiele'));
      var ul = el('ul', 'matches');
      v.recent.forEach(function (m) {
        var li = el('li', m.draw ? 'draw' : m.won ? 'win' : 'loss');
        li.appendChild(el('span', 'res', m.draw ? 'Remis' : m.won ? 'Sieg' : 'Niederlage'));
        if (safe(m.icon)) li.appendChild(img(m.icon, '', ''));
        var t = el('span', 't'); t.appendChild(el('b', '', m.map || 'Unbekannte Karte')); t.appendChild(el('small', '', m.agent)); li.appendChild(t);
        li.appendChild(el('span', 'score', m.score));
        li.appendChild(el('span', 'kda', m.k + ' / ' + m.d + ' / ' + m.a));
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }
    if (!r && !s) card.appendChild(el('p', 'muted', 'Noch keine gewerteten Spiele in dieser Saison.'));
    tile('gRank', r ? r.name : null, r && r.tier > 2 ? r.rr + ' RR' : '');
    tile('gKd', s ? num(s.kd, 2) : null, s ? s.winrate + ' % Siege' : '');
  }
  getJson('../valorant.json', { cache: 'no-cache' }).then(renderValorant).catch(function () { valEmpty('Valorant-Daten sind gerade nicht verfügbar', 'Bitte später noch einmal vorbeischauen.'); });

  // ---------- 3D-Skin (Datei site/skin/skeison.png ersetzen, um den Skin zu wechseln); Animation per Knopf waehlbar ----------
  var canvas = $('skinCanvas');
  try {
    var v = new skinview3d.SkinViewer({ canvas: canvas, width: 300, height: 400 });
    v.fov = 40; v.zoom = 0.85; v.autoRotateSpeed = 0.6;
    v.controls.enablePan = false;
    var ANIMS = { idle: skinview3d.IdleAnimation, wave: skinview3d.WaveAnimation, walk: skinview3d.WalkingAnimation, run: skinview3d.RunningAnimation };
    // Ruhig bei "Bewegung reduzieren" oder "Animationen pausieren": keine Drehung, keine Bewegung,
    // bis jemand selbst eine Animation waehlt (dann laeuft sie, das ist gewollt)
    var chosen = false;
    var applyStill = function () {
      var still = FX.reduced || FX.still;
      v.autoRotate = !still;
      if (v.animation) v.animation.paused = still && !chosen;
    };
    var setAnim = function (name) {
      v.animation = new ANIMS[name]();
      applyStill();
      document.querySelectorAll('#skinAnims .chip').forEach(function (c) { var on = c.getAttribute('data-anim') === name; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
    };
    setAnim('idle');
    document.querySelectorAll('#skinAnims .chip').forEach(function (c) { c.addEventListener('click', function () { chosen = true; setAnim(c.getAttribute('data-anim')); }); });
    document.addEventListener('fx:still', function () { chosen = false; applyStill(); });
    Promise.resolve(v.loadSkin('../skin/skeison.png')).then(function () { canvas.classList.add('ready'); }, function () { canvas.classList.add('ready'); });
    // Rendern pausieren, wenn der Skin nicht im Bild ist (spart Akku)
    // ... und auch, wenn das Fenster im Hintergrund ist (fx:idle aus assets/fx.js)
    var onScreen = true, bg = !!FX.idle, sync = function () { v.renderPaused = !onScreen || bg; };
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; sync(); }).observe(canvas);
    document.addEventListener('fx:idle', function (e) { bg = e.detail; sync(); }); sync();
  } catch (e) {
    $('skinAnims').hidden = true;
    canvas.replaceWith(el('p', 'muted', '3D-Ansicht wird von diesem Browser nicht unterstützt.'));
  }

  // ---------- Steam-Highlights aus steam.json (wird von tools/fetch-steam.js beim Deploy erzeugt) ----------
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
    tile('gHours', null); tile('gGames', null); tile('gTop', null);
  }
  getJson('../steam.json', { cache: 'no-cache' }).then(function (s) {
    if (s.url) $('stLink').href = s.url;
    if (s.name) $('stName').textContent = s.name;
    // Stand der Daten (werden beim Deploy abgerufen, nicht live)
    if (s.updated && !isNaN(new Date(s.updated))) $('stState').textContent = 'Stand: ' + when(s.updated);
    if (s.avatar) { var av = $('stAvatar'); av.src = s.avatar; av.hidden = false; }
    var body = $('stBody'); body.textContent = ''; body.removeAttribute('aria-busy');
    var st = [];
    if (s.gameCount) st.push(['Spiele', s.gameCount, nf.format]);
    if (s.totalHours) st.push(['Spielzeit', Math.round(s.totalHours), function (n) { return nf.format(n) + ' Std'; }]);
    if (s.level != null) st.push(['Level', s.level, String]);
    if (st.length) {
      var dl = $('stStats'); dl.hidden = false;
      // Werte sofort zeigen (vorher zaehlten sie beim Laden von 0 hoch und verzoegerten echte Daten)
      st.forEach(function (p) { var d = el('div'), dd = el('dd', '', p[2](p[1])); d.appendChild(el('dt', '', p[0])); d.appendChild(dd); dl.appendChild(d); });
    }
    if (s.recent && s.recent.length) body.appendChild(gameList('Zuletzt gespielt', s.recent, 'recent'));
    if (s.top && s.top.length) body.appendChild(gameList('Meistgespielt', s.top, 'hours'));
    if (!body.children.length) steamEmpty('Hier erscheinen bald die meistgespielten Spiele. Die Daten werden täglich aktualisiert.');
    // Ueberblick: Gesamtspielzeit, Anzahl Spiele, meistgespieltes Spiel, "spiele gerade"
    tile('gHours', s.totalHours ? nf.format(Math.round(s.totalHours)) + ' Std' : null, s.totalHours ? 'rund ' + nf.format(Math.round(s.totalHours / 24)) + ' Tage' : '');
    tile('gGames', s.gameCount ? nf.format(s.gameCount) : null, s.level != null ? 'Steam-Level ' + s.level : '');
    var top = s.top && s.top[0];
    tile('gTop', top ? top.name : null, top ? fmtH(top.hours) : '', 'text');
    var now = s.recent && s.recent[0];
    if (now) { var p = $('nowPlaying'); p.textContent = ''; p.appendChild(el('span', 'ping')); p.appendChild(document.createTextNode('Spiele gerade viel: ')); p.appendChild(el('b', '', now.name)); p.appendChild(document.createTextNode(' (' + fmtH(now.recent) + ' in 2 Wochen)')); p.hidden = false; }
  }).catch(function () { steamEmpty('Steam-Daten sind gerade nicht verfügbar.'); });

  // ---------- Status des Cobblemon Servers (Karte und Kachel) ----------
  function srv(cls, text, short) {
    var s = $('srvStatus'); s.className = 'srv ' + cls; s.textContent = ''; s.appendChild(el('span', cls === 'up' ? 'ping pulse' : 'ping')); s.appendChild(document.createTextNode(text)); s.hidden = false;
    tile('gSrv', short || text, cls === 'up' ? 'Spieler online' : '', 'text ' + cls);
  }
  if (Date.now() < START) srv('soon', 'Start am ' + new Date(START).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' Uhr', 'Startet bald');
  else getJson(DATA_BASE + 'leaderboards.json?t=' + Date.now(), { cache: 'no-store' }).then(function (d) {
    var s = d.server || {}, stale = Date.now() - new Date(d.updated).getTime() > 45 * 60000;
    if (stale) srv('soon', 'Status unbekannt'); else if (s.up) srv('up', 'Aktiv · ' + s.online + '/' + s.max + ' Spieler online', s.online + ' / ' + s.max); else srv('down', 'Gerade offline', 'Offline');
  }).catch(function () { tile('gSrv', 'Zur Server-Seite', '', 'text'); });

  // ---------- Mitglieder- und Online-Zahl des Discord-Servers (oeffentliche Einladungs-Info, bei Fehler ausgeblendet) ----------
  getJson('https://discord.com/api/v10/invites/' + DISCORD_INVITE + '?with_counts=true').then(function (d) {
    if (!d.approximate_member_count) return;
    var box = $('dcStats'), on = el('span', 'on'), all = el('span', 'all'), onN = el('b'), allN = el('b');
    on.appendChild(el('i', 'ping pulse')); on.appendChild(onN); on.appendChild(document.createTextNode(' online'));
    all.appendChild(allN); all.appendChild(document.createTextNode(' Mitglieder'));
    box.appendChild(on); box.appendChild(all); box.hidden = false;
    onN.textContent = nf.format(d.approximate_presence_count || 0); allN.textContent = nf.format(d.approximate_member_count);
  }).catch(function () {});
})();
