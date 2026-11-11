// Gaming-Profil: eine "Buehne" mit Spielauswahl statt langem Scrollen. Pro Spiel eine Hauptfigur (Valorant: KAY/O,
// Steam: Pionier aus Satisfactory, Minecraft: der eigene Skin in 3D) und die Zahlen in Unterseiten:
// Valorant (Rang, Statistik, Agenten, letzte Spiele, Skins), Steam-Highlights, Status des Cobblemon Servers, Discord-Zahlen.
(function () {
  'use strict';
  // Serverstart (deutsche Zeit); gleicher Wert wie in cobblemon/app.js
  var START = new Date('2026-10-30T15:00:00+01:00').getTime();
  // Live-Daten des Cobblemon Servers (Branch "data", wie auf der Server-Seite)
  var DATA_BASE = 'https://raw.githubusercontent.com/erschoenfeld2-tech/Skeison_Web/data/';
  var DISCORD_INVITE = 'tjVKFGMRw7';
  // Hauptfiguren: Zuerst wird eine eigene Datei versucht (gaming/img/…, z. B. ein freigestelltes PNG), dann die Quelle im Netz.
  // KAY/O kommt von valorant-api.com (wie Rang- und Agentenbilder), der Pionier ist das Steam-Titelbild von Satisfactory.
  var KAYO = '601dbbe7-43ce-be57-2a40-4abd24953621';
  var FIGURES = {
    val: ['img/valorant-figur.png', 'https://media.valorant-api.com/agents/' + KAYO + '/fullportrait.png', 'https://media.valorant-api.com/agents/' + KAYO + '/fullportraitv2.png']
  };
  // Steam: Pionier im Schutzanzug als 3D-Figur. Die Designs sind eigene Pixel-Skins (tools/pioneer-skins.py malt sie nach site/skin/);
  // [Datei, Name, Farbe des Auswahlpunkts]. Das zuletzt gewaehlte Design merkt sich das Geraet.
  var PIONEERS = [['pionier-orange', 'FICSIT-Orange', '#fa9549'], ['pionier-blau', 'Stahlblau', '#4d8fe0'], ['pionier-gold', 'Caterium-Gold', '#e8c14a']];
  var GAMES = ['val', 'steam', 'mc'];
  var WORDS = { val: 'VALORANT', steam: 'STEAM', mc: 'MINECRAFT' };
  var HASH = { valorant: 'val', steam: 'steam', minecraft: 'mc', server: 'mc' };

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
  function calm() { return FX.reduced || FX.still; }

  $('year').textContent = new Date().getFullYear();

  // Gesicht des Minecraft-Skins (Kopf + Hut-Ebene) als Pixelbild im Einstieg
  var face = $('face');
  if (face && face.getContext) {
    var fi = new Image();
    fi.onload = function () { var c = face.getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(fi, 8, 8, 8, 8, 0, 0, 8, 8); c.drawImage(fi, 40, 8, 8, 8, 0, 0, 8, 8); face.classList.add('ready'); };
    fi.src = '../skin/skeison.png';
  }

  // ---------- Hauptfiguren laden: Quellen der Reihe nach versuchen; klappt keine, bleibt das Symbol stehen ----------
  function loadFigure(image, list) {
    var i = 0;
    image.onload = function () { image.hidden = false; image.parentNode.classList.add('has-img'); };
    image.onerror = function () { i++; if (i < list.length) image.src = list[i]; else image.hidden = true; };
    image.src = list[0];
  }
  loadFigure($('figVal'), FIGURES.val);

  // ---------- Zahlen hochzaehlen (nur beim Einblenden einer Ansicht; bei "Bewegung reduzieren"/Pause sofort) ----------
  function countUp(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll('[data-count]'), function (n) {
      var to = parseFloat(n.getAttribute('data-count')), dec = +(n.getAttribute('data-dec') || 0), suf = n.getAttribute('data-suf') || '';
      if (!isFinite(to)) return;
      if (calm() || document.hidden) { n.textContent = num(to, dec) + suf; return; }
      var t0 = performance.now(), dur = 900;
      (function step(t) {
        var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        n.textContent = num(to * e, dec) + suf;
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    });
  }
  function counter(value, dec, suf) { var b = el('b', '', num(value, dec) + (suf || '')); b.setAttribute('data-count', value); if (dec) b.setAttribute('data-dec', dec); if (suf) b.setAttribute('data-suf', suf); return b; }
  function stat(label, value, sub, dec, suf) {
    var d = el('div'); d.appendChild(el('dt', '', label));
    var dd = el('dd'); dd.appendChild(typeof value === 'number' ? counter(value, dec, suf) : el('b', '', value));
    if (sub) dd.appendChild(el('small', '', sub)); d.appendChild(dd); return d;
  }

  // ---------- Unterseiten einer Ansicht: kleine Reiter statt Scrollen ----------
  // pages: [{ id, title, node }]; baut die Reiter und zeigt die erste Seite
  function setPages(tabsId, pagesId, pages) {
    var tabs = $(tabsId), box = $(pagesId);
    tabs.textContent = ''; box.textContent = ''; box.removeAttribute('aria-busy');
    pages = pages.filter(function (p) { return p && p.node; });
    pages.forEach(function (p, i) {
      var b = el('button', i ? '' : 'on', p.title); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(!i)); b.setAttribute('data-page', p.id);
      if (p.count != null) b.appendChild(el('small', '', String(p.count)));
      tabs.appendChild(b);
      var pg = el('div', 'page' + (i ? '' : ' on')); pg.setAttribute('data-page', p.id); pg.setAttribute('role', 'tabpanel'); pg.hidden = !!i; pg.appendChild(p.node); box.appendChild(pg);
    });
    tabs.hidden = pages.length < 2;
    tabs.onclick = function (e) {
      var b = e.target.closest('button'); if (!b || b.classList.contains('on')) return;
      Array.prototype.forEach.call(tabs.children, function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); });
      Array.prototype.forEach.call(box.children, function (pg) { var on = pg.getAttribute('data-page') === b.getAttribute('data-page'); pg.hidden = !on; pg.classList.toggle('on', on); if (on) countUp(pg); });
    };
    if (box.closest('.panel').classList.contains('on')) countUp(box);
  }
  function emptyPage(title, text, link) {
    var box = el('div', 'empty-state'); if (title) box.appendChild(el('h3', '', title)); box.appendChild(el('p', '', text));
    if (link) box.appendChild(ext(el('a', 'btn ghost small', link[0]), link[1]));
    return box;
  }

  // ---------- Buehne: Spiel wechseln (Reiter, Tasten 1-3 und Pfeile, Wischen, #valorant/#steam/#minecraft) ----------
  var stage = $('stage'), cur = 'val', busy = 0, onShow = {};
  var word = stage.querySelector('.stage-word');
  function setWord(g) { Array.prototype.forEach.call(word.children, function (s) { s.textContent = (WORDS[g] + ' · ').repeat(6); }); }
  setWord(cur);
  function panel(g) { return $('p-' + g); }
  function show(g, quiet) {
    if (g === cur || GAMES.indexOf(g) < 0) return;
    var dir = GAMES.indexOf(g) > GAMES.indexOf(cur) ? 1 : -1, from = cur; cur = g;
    Array.prototype.forEach.call(stage.querySelectorAll('.picker button'), function (b) {
      var on = b.getAttribute('data-game') === g; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    });
    var swap = function () {
      panel(from).hidden = true; panel(from).classList.remove('on');
      stage.setAttribute('data-game', g); setWord(g);
      var p = panel(g); p.hidden = false; void p.offsetWidth; p.classList.add('on');
      countUp(p); if (onShow[g]) onShow[g]();
    };
    clearTimeout(busy);
    if (quiet || calm()) { stage.classList.remove('switching'); swap(); return; }
    // Wischer in der Farbe des neuen Spiels faehrt ueber die Buehne; in der Mitte wird der Inhalt getauscht
    stage.style.setProperty('--dir', dir); stage.setAttribute('data-next', g);
    stage.classList.remove('switching'); void stage.offsetWidth; stage.classList.add('switching');
    busy = setTimeout(function () { swap(); busy = setTimeout(function () { stage.classList.remove('switching'); }, 520); }, 260);
  }
  function step(d) { show(GAMES[(GAMES.indexOf(cur) + d + GAMES.length) % GAMES.length]); }
  stage.querySelector('.picker').addEventListener('click', function (e) { var b = e.target.closest('button[data-game]'); if (b) show(b.getAttribute('data-game')); });
  stage.querySelector('.picker').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); e.stopPropagation(); step(e.key === 'ArrowRight' ? 1 : -1);
    stage.querySelector('.picker button[aria-selected="true"]').focus();
  });
  // Tasten 1-3 und Pfeile wirken, solange die Buehne im Bild ist und nicht gerade in ein Feld getippt wird
  var stageSeen = true;
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { stageSeen = es[0].isIntersecting; }, { threshold: 0.25 }).observe(stage);
  document.addEventListener('keydown', function (e) {
    if (!stageSeen || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.key >= '1' && e.key <= '3') show(GAMES[+e.key - 1]);
    else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1);
  });
  // Wischen (Handy): waagerecht ueber die Buehne, nicht auf der 3D-Figur (die dreht sich dort) und nicht in Scroll-Leisten
  (function () {
    var x0 = null, y0 = 0;
    stage.addEventListener('touchstart', function (e) { x0 = e.target.closest('canvas, .hscroll, .subtabs') || e.touches.length > 1 ? null : e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) step(dx < 0 ? 1 : -1);
    }, { passive: true });
  })();
  // Sprungmarken: #valorant, #steam, #minecraft waehlen das Spiel und holen die Buehne ins Bild
  function fromHash(scroll) {
    var g = HASH[location.hash.slice(1)]; if (!g) return false;
    show(g, true);
    if (scroll) stage.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
    return true;
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]'); if (!a) return;
    var g = HASH[a.getAttribute('href').slice(1)]; if (!g) return;
    e.preventDefault(); e.stopPropagation();
    show(g); stage.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', a.getAttribute('href'));
  }, true);
  window.addEventListener('hashchange', function () { fromHash(true); });
  // Die Figur folgt dem Mauszeiger ein kleines Stueck (nur mit echter Maus, nicht bei Pause/"Bewegung reduzieren")
  if (window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var raf = 0;
    stage.addEventListener('pointermove', function (e) {
      if (calm() || raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0; var r = stage.getBoundingClientRect();
        stage.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
        stage.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
      });
    });
    stage.addEventListener('pointerleave', function () { stage.style.setProperty('--mx', 0); stage.style.setProperty('--my', 0); });
  }

  // ---------- Valorant aus valorant.json und valorant-skins.json (tools/fetch-valorant*.js erzeugen beide beim Deploy) ----------
  function valOverview(v) {
    var r = v.rank, s = v.stats, box = el('div', 'val-over');
    var who = el('div', 'val-who');
    if (v.card && safe(v.card.small)) who.appendChild(img(v.card.small, 'avatar'));
    var info = el('div', 'pinfo'), h = el('h3', '', v.name || 'Valorant'); if (v.tag) h.appendChild(el('span', 'val-tag', '#' + v.tag)); info.appendChild(h);
    info.appendChild(el('p', 'muted', [v.level != null ? 'Level ' + v.level : '', v.updated && !isNaN(new Date(v.updated)) ? 'Stand: ' + when(v.updated) : ''].filter(Boolean).join(' · ')));
    who.appendChild(info); box.appendChild(who);
    if (r) {
      var rank = el('div', 'val-rank');
      if (safe(r.icon)) rank.appendChild(img(r.icon, 'rank-ico', ''));
      var rt = el('div'); rt.appendChild(el('b', '', r.name));
      var rr = el('span', 'muted', r.tier > 2 ? r.rr + ' RR' : 'noch nicht eingestuft');
      if (r.tier > 2 && r.lastChange) rr.appendChild(el('i', r.lastChange > 0 ? 'up' : 'down', (r.lastChange > 0 ? ' +' : ' ') + r.lastChange + ' im letzten Spiel'));
      rt.appendChild(rr);
      // Fortschritt zum naechsten Rang (100 RR je Stufe)
      if (r.tier > 2 && r.tier < 27) { var bar = el('div', 'rr-bar'); var fill = el('i'); fill.style.setProperty('--w', Math.max(0, Math.min(100, r.rr)) + '%'); bar.appendChild(fill); bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', r.rr + ' von 100 Rangpunkten'); rt.appendChild(bar); }
      if (r.peak && r.peak.name) rt.appendChild(el('small', 'muted', 'Bestleistung: ' + r.peak.name + (r.peak.season ? ' (' + r.peak.season + ')' : '')));
      rank.appendChild(rt); box.appendChild(rank);
    }
    if (s) {
      var dl = el('dl', 'stats');
      dl.appendChild(stat('K/D', s.kd, s.kda ? 'KDA ' + num(s.kda, 2) : '', 2));
      dl.appendChild(stat('Siegquote', s.winrate, s.wins + ' von ' + s.matches, 0, ' %'));
      if (s.hs != null) dl.appendChild(stat('Kopftreffer', s.hs, '', 0, ' %'));
      if (s.adr != null) dl.appendChild(stat('Schaden / Runde', s.adr));
      box.appendChild(dl);
      box.appendChild(el('p', 'muted val-note', 'Aus den letzten ' + s.matches + ' gewerteten Spielen.'));
    }
    if (!r && !s) box.appendChild(el('p', 'muted', 'Noch keine gewerteten Spiele in dieser Saison.'));
    return box;
  }
  function valAgents(v) {
    if (!v.agents || !v.agents.length) return null;
    var ag = el('div', 'agents');
    v.agents.forEach(function (a) {
      var d = el('div', 'agent'); if (safe(a.icon)) d.appendChild(img(a.icon, '', ''));
      var t = el('div', 't'); t.appendChild(el('b', '', a.name)); t.appendChild(el('span', '', a.games + (a.games === 1 ? ' Spiel' : ' Spiele') + ' · ' + a.winrate + ' % Siege · K/D ' + num(a.kd, 2)));
      var bar = el('div', 'rr-bar'), fill = el('i'); fill.style.setProperty('--w', Math.max(4, Math.min(100, a.winrate)) + '%'); bar.appendChild(fill); t.appendChild(bar);
      d.appendChild(t); ag.appendChild(d);
    });
    return ag;
  }
  function valMatches(v) {
    if (!v.recent || !v.recent.length) return null;
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
    return ul;
  }
  // Skins: Liste aus gaming/meine-skins.json, Bilder und Seltenheit von tools/fetch-valorant-skins.js ergaenzt
  function valSkins(sk) {
    var list = sk && Array.isArray(sk.skins) ? sk.skins.filter(function (x) { return x && x.name; }) : [];
    if (!list.length) return null;
    var wrap = el('div', 'skins-wrap'), weapons = [], cur = '';
    list.forEach(function (x) { if (x.weapon && weapons.indexOf(x.weapon) < 0) weapons.push(x.weapon); });
    var bar = el('div', 'skin-filter hscroll'), grid = el('div', 'skins');
    function paint() {
      grid.textContent = '';
      list.filter(function (x) { return !cur || x.weapon === cur; }).forEach(function (x, i) {
        var c = el('figure', 'skin-card'); c.style.setProperty('--i', Math.min(i, 14));
        if (/^#[0-9a-f]{6}$/i.test(x.color || '')) c.style.setProperty('--tier', x.color);
        var im = el('div', 'im'); if (safe(x.image)) im.appendChild(img(x.image, '', '')); else im.appendChild(el('span', 'noimg', '🔫')); c.appendChild(im);
        var cap = el('figcaption'); cap.appendChild(el('b', '', x.name)); cap.appendChild(el('span', '', [x.weapon, x.tier].filter(Boolean).join(' · '))); c.appendChild(cap);
        grid.appendChild(c);
      });
    }
    if (weapons.length > 1) {
      [''].concat(weapons).forEach(function (w) {
        var b = el('button', 'chip' + (w ? '' : ' on'), w || 'Alle'); b.type = 'button'; b.setAttribute('aria-pressed', String(!w));
        b.addEventListener('click', function () { cur = w; Array.prototype.forEach.call(bar.children, function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); }); paint(); });
        bar.appendChild(b);
      });
      wrap.appendChild(bar);
    }
    paint(); wrap.appendChild(grid);
    return wrap;
  }
  function renderValorant(v, sk) {
    var ok = v && !v.setup && v.riotId, skins = valSkins(sk), n = sk && sk.skins ? sk.skins.length : 0;
    var link = $('valLink'); if (ok && safe(v.url)) { link.href = v.url; link.hidden = false; }
    var pages = ok ? [{ id: 'over', title: 'Überblick', node: valOverview(v) }, { id: 'agents', title: 'Agenten', node: valAgents(v) }, { id: 'matches', title: 'Letzte Spiele', node: valMatches(v) }]
      : [{ id: 'over', title: 'Überblick', node: emptyPage(v && v.error ? 'Valorant-Daten sind gerade nicht verfügbar' : 'Valorant-Statistik folgt', v && v.error ? 'Bitte später noch einmal vorbeischauen.' : 'Hier erscheinen bald mein Rang, K/D, Trefferquote und die letzten Spiele.') }];
    pages.push({ id: 'skins', title: 'Skins', node: skins, count: n });
    setPages('valTabs', 'valPages', pages);
    var r = ok && v.rank;
    $('pkVal').textContent = r ? r.name + (r.tier > 2 ? ' · ' + r.rr + ' RR' : '') : 'Taktik-Shooter';
  }
  Promise.all([
    getJson('../valorant.json', { cache: 'no-cache' }).catch(function () { return { error: true }; }),
    getJson('../valorant-skins.json', { cache: 'no-cache' }).catch(function () { return null; })
  ]).then(function (r) { renderValorant(r[0], r[1]); });

  // ---------- 3D-Figuren (skinview3d): der eigene Minecraft-Skin und der Pionier fuer Steam ----------
  // Beide Figuren sind Skins im Minecraft-Format und teilen sich diese Funktion: Animation per Knopf, Stillstand bei
  // "Bewegung reduzieren"/"Animationen pausieren", gerendert wird nur die Figur des gewaehlten Spiels.
  function figure3d(o) {
    var canvas = $(o.canvas), chips = $(o.chips);
    try {
      var v = new skinview3d.SkinViewer({ canvas: canvas, width: 300, height: 400 });
      v.fov = 40; v.zoom = 0.85; v.autoRotateSpeed = 0.6;
      v.controls.enablePan = false;
      // Ruhig bei "Bewegung reduzieren" oder "Animationen pausieren": keine Drehung, keine Bewegung,
      // bis jemand selbst eine Animation waehlt (dann laeuft sie, das ist gewollt)
      var chosen = false, enterT = 0;
      var applyStill = function () {
        var still = FX.reduced || FX.still;
        v.autoRotate = !still;
        if (v.animation) v.animation.paused = still && !chosen;
      };
      var setAnim = function (name) {
        v.animation = o.anims[name]();
        applyStill();
        Array.prototype.forEach.call(chips.querySelectorAll('.chip'), function (c) { var on = c.getAttribute('data-anim') === name; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
      };
      setAnim('idle');
      Array.prototype.forEach.call(chips.querySelectorAll('.chip'), function (c) { c.addEventListener('click', function () { chosen = true; clearTimeout(enterT); setAnim(c.getAttribute('data-anim')); }); });
      document.addEventListener('fx:still', function () { chosen = false; applyStill(); });
      var load = function (url) { return Promise.resolve(v.loadSkin(url)).then(function () { canvas.classList.add('ready'); }, function () { canvas.classList.add('ready'); }); };
      load(o.skin);
      // Rendern nur, wenn dieses Spiel gewaehlt und die Buehne im Bild ist (spart Akku), und nicht im Hintergrund (fx:idle aus assets/fx.js)
      var onScreen = true, bg = !!FX.idle, sync = function () { v.renderPaused = !onScreen || bg || cur !== o.game; };
      if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; sync(); }).observe(stage);
      document.addEventListener('fx:idle', function (e) { bg = e.detail; sync(); }); sync();
      syncers.push(sync);
      // Beim Wechsel zu diesem Spiel zeigt die Figur kurz ihre Begruessung (o.enter), danach steht sie wieder
      onShow[o.game] = function () {
        syncers.forEach(function (f) { f(); }); clearTimeout(enterT);
        if (calm() || chosen || !o.enter) return;
        setAnim(o.enter); enterT = setTimeout(function () { if (!chosen) setAnim('idle'); }, 2600);
      };
      return { load: load };
    } catch (e) {
      chips.hidden = true;
      canvas.replaceWith(el('p', 'muted', '3D-Ansicht wird von diesem Browser nicht unterstützt.'));
      return null;
    }
  }
  var syncers = [], SV = window.skinview3d || {};
  onShow.val = function () { syncers.forEach(function (f) { f(); }); };
  var BASE_ANIMS = {
    idle: function () { return new SV.IdleAnimation(); }, wave: function () { return new SV.WaveAnimation(); },
    walk: function () { return new SV.WalkingAnimation(); }, run: function () { return new SV.RunningAnimation(); }
  };
  // Minecraft: Datei site/skin/skeison.png ersetzen, um den Skin zu wechseln
  figure3d({ canvas: 'skinCanvas', chips: 'skinAnims', skin: '../skin/skeison.png', game: 'mc', anims: BASE_ANIMS, enter: 'wave' });

  // Pionier: zusaetzlich zwei Bewegungen aus dem Spiel, selbst gebaut (FunctionAnimation: t = Sekunden seit Beginn).
  // "Bauen": rechter Arm haelt das Bauwerkzeug nach vorn, der Blick folgt, kurzer Rueckstoss bei jedem "Klick".
  // "Jetpack": die Figur schwebt auf und ab, Beine haengen leicht nach hinten, Arme halten das Gleichgewicht.
  var PIONEER_ANIMS = {
    idle: BASE_ANIMS.idle, wave: BASE_ANIMS.wave, walk: BASE_ANIMS.walk, run: BASE_ANIMS.run,
    build: function () {
      return new SV.FunctionAnimation(function (p, t) {
        var k = p.skin, beat = Math.pow(Math.max(0, Math.sin(t * 5)), 12);
        k.rightArm.rotation.x = -1.5 + beat * 0.16; k.rightArm.rotation.z = -0.08;
        k.leftArm.rotation.x = -1.05; k.leftArm.rotation.z = 0.55;
        k.head.rotation.x = 0.08; k.head.rotation.y = Math.sin(t * 0.9) * 0.35;
        k.body.rotation.y = Math.sin(t * 0.9) * 0.06;
        k.leftLeg.rotation.x = 0.12; k.rightLeg.rotation.x = -0.12;
      });
    },
    jetpack: function () {
      return new SV.FunctionAnimation(function (p, t) {
        var k = p.skin, bob = Math.sin(t * 2.6);
        p.position.y = 3 + bob * 1.6; p.rotation.x = 0.14 + bob * 0.03;
        k.leftLeg.rotation.x = 0.3 + Math.sin(t * 2.6 + 1) * 0.1; k.rightLeg.rotation.x = 0.22 + Math.sin(t * 2.6 + 2) * 0.1;
        k.leftArm.rotation.z = 0.42 + bob * 0.08; k.rightArm.rotation.z = -0.42 - bob * 0.08;
        k.leftArm.rotation.x = 0.15; k.rightArm.rotation.x = 0.15;
        k.head.rotation.x = -0.12;
      });
    }
  };
  (function () {
    var KEY = 'gaming-pionier', pick = PIONEERS[0][0];
    try { var saved = localStorage.getItem(KEY); if (PIONEERS.some(function (x) { return x[0] === saved; })) pick = saved; } catch (e) { /* Standard */ }
    var fig = figure3d({ canvas: 'pioneerCanvas', chips: 'pioneerAnims', skin: '../skin/' + pick + '.png', game: 'steam', anims: PIONEER_ANIMS, enter: 'wave' });
    var box = $('pioneerSkins');
    if (!fig) { box.hidden = true; return; }
    PIONEERS.forEach(function (x) {
      var b = el('button', 'swatch' + (x[0] === pick ? ' on' : '')); b.type = 'button'; b.title = x[1]; b.setAttribute('aria-label', 'Design ' + x[1]); b.setAttribute('aria-pressed', String(x[0] === pick));
      b.style.setProperty('--c', x[2]);
      b.addEventListener('click', function () {
        fig.load('../skin/' + x[0] + '.png');
        try { localStorage.setItem(KEY, x[0]); } catch (e) { /* gilt dann nur fuer diesen Besuch */ }
        Array.prototype.forEach.call(box.children, function (c) { var on = c === b; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
      });
      box.appendChild(b);
    });
  })();

  // ---------- Steam-Highlights aus steam.json (wird von tools/fetch-steam.js beim Deploy erzeugt) ----------
  function fmtH(h) { return (Math.round(h * 10) / 10).toLocaleString('de-DE') + ' Std'; }
  function gameList(list, key) {
    if (!list || !list.length) return null;
    var g = el('div', 'games'), max = Math.max.apply(null, list.map(function (x) { return x[key] || 0; })) || 1;
    list.forEach(function (x, n) {
      var a = ext(el('a', 'game'), x.url), im = el('div', 'im'); a.style.setProperty('--i', n);
      var i = el('img'); i.src = x.image; i.alt = ''; i.loading = 'lazy'; i.onerror = function () { i.style.visibility = 'hidden'; }; im.appendChild(i); a.appendChild(im);
      var d = el('div', 't'); d.appendChild(el('b', '', x.name)); d.appendChild(el('span', '', fmtH(x[key]) + (key === 'recent' ? ' in 2 Wochen' : ' gesamt')));
      var bar = el('div', 'rr-bar'), fill = el('i'); fill.style.setProperty('--w', Math.max(4, Math.round((x[key] || 0) / max * 100)) + '%'); bar.appendChild(fill); d.appendChild(bar);
      a.appendChild(d); g.appendChild(a);
    });
    return g;
  }
  function steamOverview(s) {
    var box = el('div', 'steam-over'), head = el('div', 'val-who');
    if (s.avatar) { var av = el('img', 'avatar'); av.src = s.avatar; av.alt = ''; av.width = 64; av.height = 64; av.onerror = function () { av.hidden = true; }; head.appendChild(av); }
    var info = el('div', 'pinfo'); info.appendChild(el('h3', '', s.name || 'Steam'));
    info.appendChild(el('p', 'muted', s.updated && !isNaN(new Date(s.updated)) ? 'Stand: ' + when(s.updated) : 'Steam-Profil'));
    head.appendChild(info); box.appendChild(head);
    var dl = el('dl', 'stats');
    if (s.totalHours) dl.appendChild(stat('Spielzeit', Math.round(s.totalHours), 'rund ' + nf.format(Math.round(s.totalHours / 24)) + ' Tage', 0, ' Std'));
    if (s.gameCount) dl.appendChild(stat('Spiele', s.gameCount));
    if (s.level != null) dl.appendChild(stat('Level', s.level));
    var top = s.top && s.top[0];
    if (top) dl.appendChild(stat('Meistgespielt', top.name, fmtH(top.hours)));
    if (dl.children.length) box.appendChild(dl);
    return box;
  }
  function steamEmpty(text) {
    setPages('stTabs', 'stPages', [{ id: 'over', title: 'Überblick', node: emptyPage('', text, ['Auf Steam ansehen ↗', $('stLink').href]) }]);
  }
  getJson('../steam.json', { cache: 'no-cache' }).then(function (s) {
    if (s.url) $('stLink').href = s.url;
    var recent = gameList(s.recent, 'recent'), top = gameList(s.top, 'hours');
    if (!s.name && !recent && !top) return steamEmpty('Hier erscheinen bald die meistgespielten Spiele. Die Daten werden täglich aktualisiert.');
    setPages('stTabs', 'stPages', [{ id: 'over', title: 'Überblick', node: steamOverview(s) }, { id: 'recent', title: 'Zuletzt gespielt', node: recent }, { id: 'top', title: 'Meistgespielt', node: top }]);
    if (s.totalHours) $('pkSteam').textContent = nf.format(Math.round(s.totalHours)) + ' Std Spielzeit';
    var now = s.recent && s.recent[0];
    if (now) { var p = $('nowPlaying'); p.textContent = ''; p.appendChild(el('span', 'ping')); p.appendChild(document.createTextNode('Spiele gerade viel: ')); p.appendChild(el('b', '', now.name)); p.appendChild(document.createTextNode(' (' + fmtH(now.recent) + ' in 2 Wochen)')); p.hidden = false; }
  }).catch(function () { steamEmpty('Steam-Daten sind gerade nicht verfügbar.'); });

  // ---------- Status des Cobblemon Servers ----------
  function srv(cls, text, short) {
    var s = $('srvStatus'); s.className = 'srv ' + cls; s.textContent = ''; s.appendChild(el('span', cls === 'up' ? 'ping pulse' : 'ping')); s.appendChild(document.createTextNode(text)); s.hidden = false;
    $('pkMc').textContent = short || text;
  }
  if (Date.now() < START) srv('soon', 'Start am ' + new Date(START).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' Uhr', 'Startet bald');
  else getJson(DATA_BASE + 'leaderboards.json?t=' + Date.now(), { cache: 'no-store' }).then(function (d) {
    var s = d.server || {}, stale = Date.now() - new Date(d.updated).getTime() > 45 * 60000;
    if (stale) srv('soon', 'Status unbekannt', 'Cobblemon Server'); else if (s.up) srv('up', 'Aktiv · ' + s.online + '/' + s.max + ' Spieler online', s.online + ' / ' + s.max + ' online'); else srv('down', 'Gerade offline', 'Server offline');
    // Ein paar Zahlen vom Server: Tage seit dem Start und Spieler in den Ranglisten
    var names = {}; (d.boards || []).forEach(function (b) { (b.total || []).forEach(function (e) { if (e && e.name) names[e.name.toLowerCase()] = 1; }); });
    var dl = $('mcStats'), n = Object.keys(names).length;
    dl.appendChild(stat('Läuft seit', Math.max(1, Math.floor((Date.now() - START) / 86400000)), '', 0, ' Tagen'));
    if (n) dl.appendChild(stat('Spieler', n, 'in den Ranglisten'));
    dl.hidden = false; if (cur === 'mc') countUp(dl);
  }).catch(function () { $('pkMc').textContent = 'Cobblemon Server'; });

  // ---------- Mitglieder- und Online-Zahl des Discord-Servers (oeffentliche Einladungs-Info, bei Fehler ausgeblendet) ----------
  getJson('https://discord.com/api/v10/invites/' + DISCORD_INVITE + '?with_counts=true').then(function (d) {
    if (!d.approximate_member_count) return;
    var box = $('dcStats'), on = el('span', 'on'), all = el('span', 'all'), onN = el('b'), allN = el('b');
    on.appendChild(el('i', 'ping pulse')); on.appendChild(onN); on.appendChild(document.createTextNode(' online'));
    all.appendChild(allN); all.appendChild(document.createTextNode(' Mitglieder'));
    box.appendChild(on); box.appendChild(all); box.hidden = false;
    onN.textContent = nf.format(d.approximate_presence_count || 0); allN.textContent = nf.format(d.approximate_member_count);
  }).catch(function () {});

  fromHash(false);
})();
