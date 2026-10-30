(function () {
  'use strict';
  var GH_USER = 'erschoenfeld2-tech';

  // Hausmesse (deutsche Zeit). Nur ein Datum ('2026-11-24') gilt fuer den ganzen Tag; mit Uhrzeit z. B.
  // start: '2026-11-24T09:00:00+01:00', end: '2026-11-24T15:00:00+01:00'. Ohne Termin steht dort "Termin folgt".
  var HAUSMESSE = { start: '2026-11-24T09:00:00+01:00', end: '2026-11-24T15:00:00+01:00', stand: '23' };

  // Projekte mit eigener Beschreibung (Repo-Name wie auf GitHub, Gross-/Kleinschreibung egal).
  // Alle weiteren oeffentlichen Repos erscheinen automatisch danach.
  var PROJECTS = [
    { repo: 'investment-helper', title: 'Kurslot', sub: 'Investment-Helper', chart: 'AAPL',
      text: 'Aktie, ETF oder Kryptowährung eingeben und eine faktenbasierte Einordnung bekommen: echter Kursverlauf, Erwartung gegen Ist-Zahlen, Schwankungstreiber und wie lange frühere Erholungen gedauert haben. Keine Anlageberatung.',
      tags: ['Kursverlauf', 'Schock & Erholung', 'Bewertung', 'Supabase Edge Function'] },
    { repo: 'raumbuchungssytem', title: 'Raumbuchungssystem', sub: 'Schulprojekt · Hausmesse Stand 23', more: '#hausmesse',
      text: 'Räume über einen interaktiven Grundriss buchen und per NFC-Karte am Kartenleser einchecken. Statische Web-App mit Supabase und Row-Level-Security.',
      tags: ['NFC-Check-in', 'Grundriss', 'Supabase', 'Python'] },
    { repo: 'skeison_web', title: 'Skeison Web', sub: 'Diese Seite', live: false,
      text: 'Projektübersicht, Wunschliste, Gaming-Profil und Cobblemon Server mit Ranglisten, Whitelist-Bewerbung und Live-Status.',
      tags: ['Vanilla JS', 'GitHub Pages', 'Supabase'] }
  ];

  // Kurslot-Schnittstelle (oeffentlicher Schluessel, wie im Kurslot-Frontend); Antworten werden dort zwischengespeichert
  var KURSLOT_API = 'https://lkxfxsadfxrxpsxnsqnb.supabase.co/functions/v1/market', KURSLOT_KEY = 'sb_publishable_jy_QnFrhB3RNZIItB4_8SQ_4SE9ahtz';
  // Cobblemon-Serverstart (deutsche Zeit); gleicher Wert wie in cobblemon/app.js
  var COBBLEMON_START = new Date('2026-10-30T15:00:00+01:00').getTime();
  var DATA_BASE = 'https://raw.githubusercontent.com/erschoenfeld2-tech/Skeison_Web/data/';

  var $ = function (id) { return document.getElementById(id); };
  var FX = window.FX || { roll: function (e, v) { e.textContent = v; }, whenVisible: function (e, f) { f(); }, reduced: true };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function ext(a, href) { a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; }
  function store(key, val) { try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: val })); } catch (e) {} }
  function stored(key, maxAge) { try { var s = JSON.parse(sessionStorage.getItem(key) || 'null'); return s && Date.now() - s.t < maxAge ? s.v : null; } catch (e) { return null; } }
  function getJson(url, opts) { return fetch(url, opts).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }

  // Alte Links auf das Profil (fruehere Startseite) fuehren jetzt zum Gaming-Profil
  if (/^#(profil|discord|server)$/.test(location.hash)) { location.replace('gaming/' + location.hash); return; }
  $('year').textContent = new Date().getFullYear();

  // Hausmesse: Termin, Countdown und "laeuft gerade"
  // Mitternacht in deutscher Zeit (Winter- oder Sommerzeit) fuer ein reines Datum
  function berlinMidnight(d) {
    var t = new Date(d + 'T00:00:00+01:00').getTime();
    return new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }) === '01' ? t - 3600000 : t;
  }
  var allDay = /^\d{4}-\d{2}-\d{2}$/.test(HAUSMESSE.start);
  var fairStart = !HAUSMESSE.start ? NaN : allDay ? berlinMidnight(HAUSMESSE.start) : new Date(HAUSMESSE.start).getTime();
  var fairEnd = HAUSMESSE.end ? new Date(HAUSMESSE.end).getTime() : fairStart + (allDay ? 24 : 8) * 3600000;
  if (!isNaN(fairStart)) {
    var day = new Date(fairStart).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    var hm = function (ms) { return new Date(ms).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }); };
    $('fairWhen').textContent = allDay ? day : day + ', ' + hm(fairStart) + (HAUSMESSE.end ? '–' + hm(fairEnd) : '') + ' Uhr';
    var fairTick = function () {
      var now = Date.now(), p = function (n) { return String(n).padStart(2, '0'); };
      var before = now < fairStart, during = !before && now < fairEnd;
      $('fairCd').hidden = !before; $('fairLive').hidden = before;
      $('fairLive').classList.toggle('over', !before && !during);
      $('fairLiveText').textContent = during ? 'Die Hausmesse läuft – besuch uns an Stand ' + HAUSMESSE.stand + '!' : 'Danke für euren Besuch an Stand ' + HAUSMESSE.stand + '!';
      if (!before) return;
      var s = Math.floor((fairStart - now) / 1000);
      FX.roll($('fd-d'), Math.floor(s / 86400)); FX.roll($('fd-h'), p(Math.floor(s % 86400 / 3600)));
      FX.roll($('fd-m'), p(Math.floor(s % 3600 / 60))); FX.roll($('fd-s'), p(s % 60));
    };
    fairTick(); setInterval(fairTick, 1000);
  }

  // Projekte: eigene Beschreibung + Live-Daten von GitHub (Sprache, letzte Aenderung, Live-Seite)
  var LANG = { JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', HTML: '#e34c26', CSS: '#663399', Java: '#b07219', 'C#': '#178600', 'C++': '#f34b7d', C: '#555555', Go: '#00ADD8', Rust: '#dea584', Shell: '#89e051', Batchfile: '#C1F12E', Lua: '#000080', Kotlin: '#A97BFF', PHP: '#4F5D95' };
  var rtf = window.Intl && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat('de', { numeric: 'auto' }) : null;
  function ago(iso) {
    var d = new Date(iso), days = Math.round((d - Date.now()) / 86400000);
    if (!rtf || isNaN(d)) return d.toLocaleDateString('de-DE');
    if (days > -1) return rtf.format(Math.round((d - Date.now()) / 3600000), 'hour');
    if (days > -30) return rtf.format(days, 'day');
    if (days > -365) return rtf.format(Math.round(days / 30), 'month');
    return rtf.format(Math.round(days / 365), 'year');
  }
  function liveUrl(r) {
    if (r.homepage && /^https?:\/\//i.test(r.homepage)) return r.homepage;
    if (r.has_pages) return 'https://' + GH_USER + '.github.io/' + (r.name.toLowerCase() === GH_USER + '.github.io' ? '' : r.name + '/');
    return '';
  }
  function projectCard(p, r) {
    var card = el('article', 'project' + (p.chart ? ' wide' : '')), body = el('div', 'p-body');
    var code = r ? r.html_url : 'https://github.com/' + GH_USER + '/' + p.repo;
    var head = el('div', 'p-head'), h = el('h3');
    h.appendChild(ext(el('a', '', p.title || (r && r.name)), code)); head.appendChild(h);
    if (p.sub) head.appendChild(el('span', 'p-sub', p.sub));
    body.appendChild(head);
    body.appendChild(el('p', 'p-text', p.text || (r && r.description) || 'Keine Beschreibung.'));
    if (p.tags) { var tg = el('ul', 'p-tags'); p.tags.forEach(function (x) { tg.appendChild(el('li', '', x)); }); body.appendChild(tg); }
    if (r) {
      var m = el('div', 'meta');
      if (r.language) { var lg = el('span'), dot = el('i', 'lang-dot'); dot.style.setProperty('--c', LANG[r.language] || '#8b95b8'); lg.appendChild(dot); lg.appendChild(document.createTextNode(r.language)); m.appendChild(lg); }
      var upd = el('span', '', 'Aktualisiert ' + ago(r.pushed_at)); upd.title = new Date(r.pushed_at).toLocaleString('de-DE'); m.appendChild(upd);
      if (r.stargazers_count) m.appendChild(el('span', '', '★ ' + r.stargazers_count));
      body.appendChild(m);
    }
    var links = el('div', 'rlinks'), live = r ? liveUrl(r) : '';
    if (live && p.live !== false) { var l = ext(el('a', 'btn small', 'Live ansehen '), live); l.appendChild(el('span', 'arr', '↗')); links.appendChild(l); }
    if (p.more) { var mo = el('a', 'btn ghost small', 'Zur Hausmesse '); mo.href = p.more; mo.appendChild(el('span', 'arr', '→')); links.appendChild(mo); }
    links.appendChild(ext(el('a', 'btn ghost small', 'Code'), code));
    body.appendChild(links); card.appendChild(body);
    if (p.chart) card.appendChild(chartBox(p.chart));
    return card;
  }
  function renderProjects(repos) {
    var box = $('projects'), rest = {};
    box.textContent = ''; box.removeAttribute('aria-busy');
    (repos || []).forEach(function (r) { rest[r.name.toLowerCase()] = r; });
    PROJECTS.forEach(function (p) { box.appendChild(projectCard(p, rest[p.repo])); delete rest[p.repo]; });
    (repos || []).forEach(function (r) { if (rest[r.name.toLowerCase()]) box.appendChild(projectCard({ repo: r.name }, r)); });
    // Live-Demo des Raumbuchungssystems auch in der Hausmesse-Karte verlinken
    var rb = (repos || []).filter(function (r) { return r.name.toLowerCase() === 'raumbuchungssytem'; })[0];
    if (rb && liveUrl(rb)) { var a = $('rbLink'); a.href = liveUrl(rb); a.firstChild.textContent = 'Live-Demo '; }
  }
  var cachedRepos = stored('repos3', 3600000);
  if (cachedRepos) renderProjects(cachedRepos);
  else getJson('https://api.github.com/users/' + GH_USER + '/repos?sort=pushed&per_page=30').then(function (all) {
    var list = all.filter(function (r) { return !r.fork && !r.archived; });
    store('repos3', list); renderProjects(list);
  }).catch(function () { renderProjects(null); });

  // Kurslot-Vorschau: Wochenschlusskurse der letzten 12 Monate als kleiner Chart, zeichnet sich beim Sichtbarwerden
  function chartBox(symbol) {
    var box = el('figure', 'chart'), cap = el('figcaption'), val = el('span', 'c-val');
    cap.appendChild(el('span', 'c-title', symbol + ' · 12 Monate')); cap.appendChild(val); box.appendChild(cap);
    var plot = el('div', 'c-plot'); plot.appendChild(el('div', 'sk sk-chart')); box.appendChild(plot);
    var note = el('p', 'c-note', 'Wochenschlusskurse aus Kurslot'); box.appendChild(note);
    function draw(pts) {
      pts = pts.slice(-53);
      if (pts.length < 8) throw new Error('zu wenig Daten');
      var W = 600, H = 180, pad = 8, min = Infinity, max = -Infinity;
      pts.forEach(function (q) { min = Math.min(min, q.c); max = Math.max(max, q.c); });
      var x = function (i) { return (pad + i * (W - 2 * pad) / (pts.length - 1)).toFixed(1); };
      var y = function (c) { return (pad + (max - c) * (H - 2 * pad) / (max - min || 1)).toFixed(1); };
      var d = pts.map(function (q, i) { return (i ? 'L' : 'M') + x(i) + ' ' + y(q.c); }).join('');
      var last = pts[pts.length - 1].c, ch = (last / pts[0].c - 1) * 100, up = ch >= 0;
      plot.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">'
        + '<stop offset="0" stop-color="currentColor" stop-opacity=".25"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>'
        + '<path class="c-area" d="' + d + 'L' + x(pts.length - 1) + ' ' + H + 'L' + pad + ' ' + H + 'Z" fill="url(#cg)"/>'
        + '<path class="c-line" d="' + d + '" pathLength="1"/><circle class="c-dot" cx="' + x(pts.length - 1) + '" cy="' + y(last) + '" r="4"/></svg>';
      var pct = Math.abs(ch).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      plot.firstChild.setAttribute('aria-label', 'Kursverlauf ' + symbol + ' über 12 Monate: ' + (up ? 'plus ' : 'minus ') + pct + ' Prozent');
      box.classList.add(up ? 'up' : 'down');
      val.textContent = '';
      val.appendChild(el('b', '', last.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
      val.appendChild(el('span', 'c-ch', (up ? '+' : '−') + pct + ' %'));
      note.textContent = 'Wochenschlusskurse aus Kurslot · Stand ' + new Date(pts[pts.length - 1].t).toLocaleDateString('de-DE');
      FX.whenVisible(box, function () { box.classList.add('drawn'); });
    }
    function fail() { plot.textContent = ''; plot.appendChild(el('p', 'c-empty', 'Vorschau gerade nicht verfügbar.')); note.hidden = true; }
    var cached = stored('kurslot-' + symbol, 6 * 3600000);
    if (cached) { try { draw(cached); } catch (e) { fail(); } }
    else getJson(KURSLOT_API + '?op=series&symbol=' + encodeURIComponent(symbol), { headers: { apikey: KURSLOT_KEY, Authorization: 'Bearer ' + KURSLOT_KEY } })
      .then(function (res) { var pts = (res.data || []).slice(-53); draw(pts); store('kurslot-' + symbol, pts); })
      .catch(fail);
    return box;
  }

  // Gesicht des Minecraft-Skins (Kopf + Hut-Ebene) als Pixelbild im Gaming-Teaser
  var face = $('face');
  if (face && face.getContext) {
    var img = new Image();
    img.onload = function () { var c = face.getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8); c.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8); face.classList.add('ready'); };
    img.src = 'skin/skeison.png';
  }

  // Cobblemon Server als Zusatz: Starttermin bzw. Online-Status
  function srv(cls, text) { var s = $('srvStatus'); s.className = 'srv ' + cls; s.textContent = ''; s.appendChild(el('span', cls === 'up' ? 'ping pulse' : 'ping')); s.appendChild(document.createTextNode(text)); s.hidden = false; }
  if (Date.now() < COBBLEMON_START) srv('soon', 'Start ' + new Date(COBBLEMON_START).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' Uhr');
  else getJson(DATA_BASE + 'leaderboards.json?t=' + Date.now(), { cache: 'no-store' }).then(function (d) {
    var s = d.server || {}, stale = Date.now() - new Date(d.updated).getTime() > 45 * 60000;
    if (stale) srv('soon', 'Status unbekannt'); else if (s.up) srv('up', 'Aktiv · ' + s.online + '/' + s.max + ' online'); else srv('down', 'Offline');
  }).catch(function () {});
})();
