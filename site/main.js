(function () {
  'use strict';
  var GH_USER = 'erschoenfeld2-tech', MAX_REPOS = 6;
  // Serverstart (deutsche Zeit); gleicher Wert wie in cobblemon/app.js
  var START = new Date('2026-10-30T15:00:00+01:00').getTime();
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  function tick() {
    var left = START - Date.now(), p = function (n) { return String(n).padStart(2, '0'); };
    $('cd').hidden = left <= 0; $('live').hidden = left > 0;
    if (left <= 0) return;
    var s = Math.floor(left / 1000);
    $('cd-d').textContent = Math.floor(s / 86400); $('cd-h').textContent = p(Math.floor(s % 86400 / 3600));
    $('cd-m').textContent = p(Math.floor(s % 3600 / 60)); $('cd-s').textContent = p(s % 60);
  }
  tick(); setInterval(tick, 1000);

  // 3D-Skin (Datei skin/skeison.png ersetzen, um den Skin zu wechseln)
  var canvas = $('skinCanvas');
  try {
    var v = new skinview3d.SkinViewer({ canvas: canvas, width: 300, height: 400, skin: 'skin/skeison.png' });
    v.fov = 40; v.zoom = 0.85; v.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches; v.autoRotateSpeed = 0.6;
    v.animation = new skinview3d.IdleAnimation();
    v.controls.enablePan = false;
  } catch (e) { canvas.replaceWith(el('p', 'muted', '3D-Ansicht wird von diesem Browser nicht unterstützt.')); }

  // GitHub-Projekte (oeffentliche Repos, zuletzt gepusht zuerst); Zwischenspeicher gegen das API-Limit
  function renderRepos(list) {
    var box = $('repos'); box.textContent = '';
    if (!list.length) { box.appendChild(el('p', 'muted', 'Keine öffentlichen Projekte gefunden.')); return; }
    list.forEach(function (r) {
      var a = el('a', 'repo'); a.href = r.html_url; a.target = '_blank'; a.rel = 'noopener';
      a.appendChild(el('h3', '', r.name)); a.appendChild(el('p', '', r.description || 'Keine Beschreibung.'));
      var m = el('div', 'meta');
      if (r.language) m.appendChild(el('span', '', r.language));
      m.appendChild(el('span', '', '★ ' + r.stargazers_count));
      m.appendChild(el('span', '', 'Aktualisiert ' + new Date(r.pushed_at).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })));
      a.appendChild(m); box.appendChild(a);
    });
  }
  var cached = null; try { cached = JSON.parse(sessionStorage.getItem('repos') || 'null'); } catch (e) {}
  if (cached) renderRepos(cached);
  else fetch('https://api.github.com/users/' + GH_USER + '/repos?sort=pushed&per_page=30').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (all) {
    var list = all.filter(function (r) { return !r.fork && !r.archived; }).slice(0, MAX_REPOS);
    try { sessionStorage.setItem('repos', JSON.stringify(list)); } catch (e) {}
    renderRepos(list);
  }).catch(function () {
    var b = $('repos'); b.textContent = ''; var p = el('p', 'muted', 'Projekte konnten nicht geladen werden. '); var a = el('a', '', 'Direkt auf GitHub ansehen'); a.href = 'https://github.com/' + GH_USER; p.appendChild(a); b.appendChild(p);
  });
})();
