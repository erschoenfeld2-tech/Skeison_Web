// Gaming-Profil: eine "Buehne" mit Spielauswahl statt langem Scrollen. Pro Spiel eine Hauptfigur (Valorant: Lieblingsagent,
// Steam: Pionier, Minecraft: der eigene Skin in 3D) und die Zahlen in Unterseiten; dazu "Konten" und die Leiste rechts.
// Diese Datei zeichnet nur. Die Daten kommen ueber Gaming.render(view): angemeldet aus dem Gaming-Profil (profile.js),
// ohne Anmeldung als Beispiel aus den Deploy-Dateien (Gaming.demo(): valorant.json, valorant-skins.json, steam.json).
(function () {
  'use strict';
  // Serverstart (deutsche Zeit); gleicher Wert wie in cobblemon/app.js
  var START = new Date('2026-10-30T15:00:00+01:00').getTime();
  // Live-Daten des Cobblemon Servers (Branch "data", wie auf der Server-Seite)
  var DATA_BASE = 'https://raw.githubusercontent.com/erschoenfeld2-tech/Skeison_Web/data/';
  var DISCORD_INVITE = 'tjVKFGMRw7';
  // Valorant-Figur: Agent von valorant-api.com; ohne eigene Wahl KAY/O (vorher eigene Datei gaming/img/valorant-figur.png)
  var KAYO = '601dbbe7-43ce-be57-2a40-4abd24953621';
  // Steam: Pionier im Schutzanzug als 3D-Figur. Die Designs sind eigene Pixel-Skins (tools/pioneer-skins.py malt sie nach site/skin/);
  // [Datei, Name, Farbe des Auswahlpunkts].
  var PIONEERS = [['pionier-gruen', 'Grün', '#7c9a62'], ['pionier-schwarz', 'Schwarz', '#34343a'], ['pionier-blau', 'Blau', '#97a3e6'], ['pionier-weiss', 'Weiß', '#ececf0'], ['pionier-gelb', 'Gelb', '#e9db4d']];
  // Zusaetzliches Design als echtes 3D-Modell (site/gaming/3d/void-pionier.glb, pionier3d.js), letzter Farbpunkt
  var VOID = ['void', 'Void (3D-Modell)', '#5b85ff'];
  var GAMES = ['val', 'steam', 'mc', 'acc'];
  var WORDS = { val: 'VALORANT', steam: 'STEAM', mc: 'MINECRAFT', acc: 'KONTEN' };
  var HASH = { valorant: 'val', steam: 'steam', minecraft: 'mc', server: 'mc', konten: 'acc' };

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
  var view = { demo: true, mine: false };   // was gerade gezeigt wird (Gaming.render)

  // ---------- Einstieg: Gesicht des Minecraft-Skins (Kopf + Hut-Ebene), Name, Spruch ----------
  function drawFace(canvas, src) {
    if (!canvas || !canvas.getContext || !src) return;
    var fi = new Image();
    fi.onload = function () { var c = canvas.getContext('2d'); c.clearRect(0, 0, 8, 8); c.imageSmoothingEnabled = false; c.drawImage(fi, 8, 8, 8, 8, 0, 0, 8, 8); c.drawImage(fi, 40, 8, 8, 8, 0, 0, 8, 8); canvas.classList.add('ready'); };
    fi.src = src;
  }

  // ---------- Valorant-Figur: Agent laden; klappt kein Bild, bleibt das Symbol stehen ----------
  function setAgent(agent) {
    var image = $('figVal'), id = (agent && agent.id) || KAYO, list = (agent && agent.p ? [agent.p] : [])
      .concat(['https://media.valorant-api.com/agents/' + id + '/fullportrait.png', 'https://media.valorant-api.com/agents/' + id + '/fullportraitv2.png']);
    var i = 0;
    image.hidden = true; image.parentNode.classList.remove('has-img');
    image.onload = function () { image.hidden = false; image.parentNode.classList.add('has-img'); };
    image.onerror = function () { i++; if (i < list.length) image.src = list[i]; else image.hidden = true; };
    image.src = list[0];
    var name = (agent && agent.n) || 'KAY/O';
    image.alt = name + ', ' + (view.demo || view.mine ? 'mein' : 'Lieblings-') + 'Agent in Valorant';
    var fn = $('figValName'); fn.textContent = ''; fn.appendChild(el('b', '', name)); fn.appendChild(el('span', '', view.demo || view.mine ? 'Mein Agent' : 'Lieblingsagent'));
  }

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

  // ---------- "Wert des Kontos": ausklappbares Fenster mit einer groben Schaetzung (Valorant-Skins, Steam-Bibliothek) ----------
  function eur(n) { return nf.format(Math.round(n)) + ' €'; }
  // rows: [[Text, Wert, Farbe?]], note: Erklaerung unter der Aufstellung
  function valueBox(total, sub, rows, note) {
    var d = el('details', 'worth'), sm = el('summary');
    sm.appendChild(el('span', 'w-label', 'Wert des Kontos'));
    sm.appendChild(counter(total, 0, ' €'));
    if (sub) sm.appendChild(el('small', '', sub));
    d.appendChild(sm);
    var ul = el('ul', 'w-rows');
    rows.forEach(function (r) {
      var li = el('li'); if (r[2]) li.style.setProperty('--c', r[2]);
      li.appendChild(el('span', '', r[0])); li.appendChild(el('b', '', r[1])); ul.appendChild(li);
    });
    d.appendChild(ul);
    d.appendChild(el('p', 'w-note', note));
    return d;
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
  // link: [Text, URL] (oeffnet neu) oder [Text, Funktion] (Knopf, z. B. "Im Editor verknuepfen")
  function emptyPage(title, text, link) {
    var box = el('div', 'empty-state'); if (title) box.appendChild(el('h3', '', title)); box.appendChild(el('p', '', text));
    if (link && typeof link[1] === 'function') { var b = el('button', 'btn small', link[0]); b.type = 'button'; b.addEventListener('click', link[1]); box.appendChild(b); }
    else if (link && link[1]) box.appendChild(ext(el('a', 'btn ghost small', link[0]), link[1]));
    return box;
  }
  function editLink(text) { return view.mine && Gaming.onEdit ? [text, function () { Gaming.onEdit(); }] : null; }

  // ---------- Buehne: Spiel wechseln (Reiter, Tasten 1-4 und Pfeile, Wischen, #valorant/#steam/#minecraft/#konten) ----------
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
  // Tasten 1-4 und Pfeile wirken, solange die Buehne im Bild ist und nicht gerade in ein Feld getippt wird
  var stageSeen = true;
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { stageSeen = es[0].isIntersecting; }, { threshold: 0.25 }).observe(stage);
  document.addEventListener('keydown', function (e) {
    if (!stageSeen || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.key >= '1' && e.key <= '4') show(GAMES[+e.key - 1]);
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
  // Sprungmarken: #valorant, #steam, #minecraft, #konten waehlen das Spiel und holen die Buehne ins Bild
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
    history.replaceState(null, '', location.search + a.getAttribute('href'));
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

  // ---------- Valorant: Live-Daten (gp-sync bzw. valorant.json) und ausgewaehlte Skins ----------
  function valOverview(v) {
    var r = v.rank, s = v.stats, box = el('div', 'val-over');
    var head = el('div', 'val-who');
    if (v.card && safe(v.card.small)) head.appendChild(img(v.card.small, 'avatar'));
    var info = el('div', 'pinfo'), h = el('h3', '', v.name || 'Valorant'); if (v.tag) h.appendChild(el('span', 'val-tag', '#' + v.tag)); info.appendChild(h);
    info.appendChild(el('p', 'muted', [v.level != null ? 'Level ' + v.level : '', v.updated && !isNaN(new Date(v.updated)) ? 'Stand: ' + when(v.updated) : ''].filter(Boolean).join(' · ')));
    head.appendChild(info); box.appendChild(head);
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
  // Skins: Format { skins: [{ name, weapon, tier, color, image }], value } (valcat.js bzw. valorant-skins.json)
  function valSkins(sk) {
    var list = sk && Array.isArray(sk.skins) ? sk.skins.filter(function (x) { return x && x.name; }) : [];
    if (!list.length) return null;
    var wrap = el('div', 'skins-wrap'), weapons = [], curW = '';
    list.forEach(function (x) { if (x.weapon && weapons.indexOf(x.weapon) < 0) weapons.push(x.weapon); });
    var bar = el('div', 'skin-filter hscroll'), grid = el('div', 'skins');
    function paint() {
      grid.textContent = '';
      list.filter(function (x) { return !curW || x.weapon === curW; }).forEach(function (x, i) {
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
        b.addEventListener('click', function () { curW = w; Array.prototype.forEach.call(bar.children, function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); }); paint(); });
        bar.appendChild(b);
      });
      wrap.appendChild(bar);
    }
    paint(); wrap.appendChild(grid);
    return wrap;
  }
  function valWorth(sk) {
    var w = sk && sk.value; if (!w || !(w.vp > 0)) return null;
    var rows = (w.tiers || []).map(function (t) { return [t.count + ' × ' + t.tier, nf.format(t.vp) + ' VP', /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '']; });
    if (w.unpriced) rows.push([w.unpriced + ' ohne Preisstufe', 'nicht gezählt']);
    return valueBox(w.eur, nf.format(w.vp) + ' VP in ' + w.priced + ' Skins', rows,
      'Grobe Schätzung: übliche Shop-Preise je Seltenheitsstufe, umgerechnet mit rund ' + String(w.eurPer100Vp).replace('.', ',') + ' € je 100 VP. Einzelne Bundles kosten mehr oder weniger; Battlepass-Skins und Agenten zählen nicht mit. Das ist kein Verkaufswert.');
  }
  // state: ok | none (kein Konto) | setup (Schluessel fehlt) | error | loading
  function renderValorant(v, state, sk) {
    var ok = state === 'ok' && v, skins = sk === 'loading' ? emptyPage('', 'Skins werden geladen …') : valSkins(sk), n = sk && sk.skins ? sk.skins.length : 0, worth = sk && sk !== 'loading' ? valWorth(sk) : null;
    var link = $('valLink'); link.hidden = true; if (ok && safe(v.url)) { link.href = v.url; link.hidden = false; }
    var empty = {
      none: ['Kein Valorant-Konto verknüpft', view.mine ? 'Verknüpfe deine Riot-ID, dann erscheinen Rang, K/D und die letzten Spiele.' : 'Hier ist noch kein Valorant-Konto hinterlegt.', editLink('Riot-ID verknüpfen')],
      setup: ['Valorant-Statistik folgt', 'Die Live-Daten für Valorant sind noch nicht eingerichtet. Skins und Lieblingsagent funktionieren schon.'],
      error: ['Valorant-Daten sind gerade nicht verfügbar', v && v.message ? v.message : 'Bitte später noch einmal vorbeischauen.'],
      loading: ['', 'Valorant-Daten werden geladen …']
    }[ok ? 'x' : state] || ['', ''];
    var pages = ok ? [{ id: 'over', title: 'Überblick', node: valOverview(v) }, { id: 'agents', title: 'Agenten', node: valAgents(v) }, { id: 'matches', title: 'Letzte Spiele', node: valMatches(v) }]
      : [{ id: 'over', title: 'Überblick', node: emptyPage(empty[0], empty[1], empty[2]) }];
    if (worth) pages[0].node.appendChild(worth);
    if (!skins && view.mine && !view.demo) skins = emptyPage('Noch keine Skins ausgewählt', 'Wähle im Editor aus allen Skins und Bundles die aus, die du besitzt.', editLink('Skins auswählen'));
    pages.push({ id: 'skins', title: 'Skins', node: skins, count: n || null });
    setPages('valTabs', 'valPages', pages);
    var r = ok && v.rank;
    $('pkVal').textContent = r ? r.name + (r.tier > 2 ? ' · ' + r.rr + ' RR' : '') : 'Taktik-Shooter';
  }

  // ---------- 3D-Figuren (skinview3d): Minecraft-Skin und der Pionier fuer Steam ----------
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
        if (o.onAnim) o.onAnim(name, chosen);
        Array.prototype.forEach.call(chips.querySelectorAll('.chip'), function (c) { var on = c.getAttribute('data-anim') === name; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
      };
      setAnim('idle');
      Array.prototype.forEach.call(chips.querySelectorAll('.chip'), function (c) { c.addEventListener('click', function () { chosen = true; clearTimeout(enterT); setAnim(c.getAttribute('data-anim')); }); });
      document.addEventListener('fx:still', function () { chosen = false; applyStill(); });
      // model: 'slim' (Alex) oder 'default' (Steve); ohne Angabe erkennt skinview3d es selbst
      var load = function (url, model) {
        return Promise.resolve(v.loadSkin(url, { model: model === 'slim' ? 'slim' : model === 'classic' ? 'default' : 'auto-detect' }))
          .then(function () { canvas.classList.add('ready'); }, function () { canvas.classList.add('ready'); });
      };
      if (o.skin) load(o.skin);
      // o.paused: Figur ist gerade ausgeblendet (z. B. Pionier-Design "Void"); o.onSync bekommt, ob dieses Spiel sichtbar ist
      var onScreen = true, bg = !!FX.idle, sync = function () {
        var shown = onScreen && !bg && cur === o.game;
        v.renderPaused = !shown || !!(o.paused && o.paused());
        if (o.onSync) o.onSync(shown);
      };
      if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; sync(); }).observe(stage);
      document.addEventListener('fx:idle', function (e) { bg = e.detail; sync(); }); sync();
      syncers.push(sync);
      // Beim Wechsel zu diesem Spiel zeigt die Figur kurz ihre Begruessung (o.enter), danach steht sie wieder
      onShow[o.game] = function () {
        syncers.forEach(function (f) { f(); }); clearTimeout(enterT);
        if (calm() || chosen || !o.enter) return;
        setAnim(o.enter); enterT = setTimeout(function () { if (!chosen) setAnim('idle'); }, 2600);
      };
      return { load: load, sync: sync };
    } catch (e) {
      chips.hidden = true;
      canvas.replaceWith(el('p', 'muted', '3D-Ansicht wird von diesem Browser nicht unterstützt.'));
      return null;
    }
  }
  var syncers = [], SV = window.skinview3d || {};
  onShow.val = onShow.acc = function () { syncers.forEach(function (f) { f(); }); };
  var BASE_ANIMS = {
    idle: function () { return new SV.IdleAnimation(); }, wave: function () { return new SV.WaveAnimation(); },
    walk: function () { return new SV.WalkingAnimation(); }, run: function () { return new SV.RunningAnimation(); }
  };
  var mcFig = figure3d({ canvas: 'skinCanvas', chips: 'skinAnims', skin: null, game: 'mc', anims: BASE_ANIMS, enter: 'wave' });

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
  // Pionier mit Farbpunkten; Design "Void" ist ein eigenes 3D-Modell statt Pixel-Skin (pionier3d.js, three.js erst bei Wahl).
  // Die skinview3d-Figur pausiert solange; Animationsknoepfe und Sichtbarkeit werden an das Modell weitergegeben.
  // select(id) waehlt ein Design (aus dem Profil); pioneer.onPick meldet eine Wahl per Klick (profile.js speichert sie).
  var pioneer = (function () {
    var current = PIONEERS[0][0], voidOn = false, voidFig = null, voidCanvas = null, lastAnim = 'idle', lastChosen = false, shown = false;
    var syncVoid = function () { if (voidFig) voidFig.setActive(shown && voidOn); };
    var fig = figure3d({
      canvas: 'pioneerCanvas', chips: 'pioneerAnims', skin: '../skin/' + PIONEERS[0][0] + '.png', game: 'steam', anims: PIONEER_ANIMS, enter: 'wave',
      paused: function () { return voidOn; },
      onSync: function (s) { shown = s; syncVoid(); },
      onAnim: function (name, byUser) { lastAnim = name; lastChosen = byUser; if (voidFig) voidFig.setAnim(name, byUser); }
    });
    var box = $('pioneerSkins'), api = { select: function () {}, onPick: null };
    if (!fig) { box.hidden = true; return api; }
    function loadVoid() {
      if (voidCanvas) return;
      voidCanvas = el('canvas'); voidCanvas.width = 300; voidCanvas.height = 400;
      voidCanvas.setAttribute('aria-label', '3D-Modell: Void-Pionier im schwarz-blauen Raumanzug (eigenes Design)');
      $('pioneerCanvas').after(voidCanvas);
      import('./pionier3d.js')
        .then(function (m) { return m.mount(voidCanvas, { url: '3d/void-pionier.glb', calm: calm }); })
        .then(function (c) { voidFig = c; voidFig.setAnim(lastAnim, lastChosen); syncVoid(); })
        .catch(function () { voidCanvas.replaceWith(el('p', 'muted', '3D-Modell konnte nicht geladen werden.')); });
    }
    function showVoid(on) {
      voidOn = on;
      $('pioneerCanvas').hidden = on;
      if (on) loadVoid();
      if (voidCanvas) voidCanvas.hidden = !on;
      fig.sync();
    }
    function select(id) {
      if (id !== VOID[0] && !PIONEERS.some(function (x) { return x[0] === id; })) id = PIONEERS[0][0];
      if (id === VOID[0]) showVoid(true);
      else { showVoid(false); if (id !== current) fig.load('../skin/' + id + '.png'); }
      current = id;
      Array.prototype.forEach.call(box.children, function (c) { var on = c.getAttribute('data-id') === id; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
    }
    PIONEERS.concat([VOID]).forEach(function (x) {
      var b = el('button', 'swatch'); b.type = 'button'; b.title = x[1]; b.setAttribute('aria-label', 'Design ' + x[1]); b.setAttribute('aria-pressed', 'false'); b.setAttribute('data-id', x[0]);
      b.style.setProperty('--c', x[2]);
      if (x === VOID) b.classList.add('swatch-void');
      b.addEventListener('click', function () { select(x[0]); if (api.onPick) api.onPick(x[0]); });
      box.appendChild(b);
    });
    api.select = select;
    return api;
  })();

  // Minecraft: mehrere Skins mit Farbpunkten (kleines Gesicht je Skin); list: [{ id, name, src, model }]
  function setMcSkins(list, activeId) {
    var box = $('mcSkins'); box.textContent = '';
    list = (list || []).filter(function (s) { return s && s.src; });
    box.hidden = list.length < 2;
    var pick = list.filter(function (s) { return s.id === activeId; })[0] || list[0];
    if (mcFig && pick) mcFig.load(pick.src, pick.model);
    drawFace($('face'), pick ? pick.src : '');
    list.forEach(function (s) {
      var b = el('button', 'swatch swatch-face' + (s === pick ? ' on' : '')); b.type = 'button'; b.title = s.name; b.setAttribute('aria-label', 'Skin ' + s.name); b.setAttribute('aria-pressed', String(s === pick));
      var c = el('canvas'); c.width = 8; c.height = 8; b.appendChild(c); drawFace(c, s.src);
      b.addEventListener('click', function () {
        if (mcFig) mcFig.load(s.src, s.model);
        drawFace($('face'), s.src);
        Array.prototype.forEach.call(box.children, function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
        if (Gaming.onMcSkin) Gaming.onMcSkin(s.id);
      });
      box.appendChild(b);
    });
    var fn = $('figMcName'); fn.textContent = '';
    fn.appendChild(el('b', '', view.mcName || (view.demo ? 'Skeison' : view.owner ? view.owner.name : 'Minecraft')));
    fn.appendChild(el('span', '', pick && pick.name && pick.name !== view.mcName ? 'Skin: ' + pick.name : 'Minecraft-Name'));
  }

  // ---------- Steam: Live-Daten (gp-sync bzw. steam.json) und selbst gewaehlte Lieblingsspiele ----------
  function fmtH(h) { return (Math.round(h * 10) / 10).toLocaleString('de-DE') + ' Std'; }
  var header = function (id) { return 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + id + '/header.jpg'; };
  function gameList(list, key) {
    if (!list || !list.length) return null;
    var g = el('div', 'games'), max = Math.max.apply(null, list.map(function (x) { return x[key] || 0; })) || 1;
    list.forEach(function (x, n) {
      var a = ext(el('a', 'game'), x.url || 'https://store.steampowered.com/app/' + x.appid), im = el('div', 'im'); a.style.setProperty('--i', n);
      var i = el('img'); i.src = x.image || header(x.appid); i.alt = ''; i.loading = 'lazy'; i.onerror = function () { i.style.visibility = 'hidden'; }; im.appendChild(i); a.appendChild(im);
      var d = el('div', 't'); d.appendChild(el('b', '', x.name));
      if (key) {
        d.appendChild(el('span', '', fmtH(x[key] || 0) + (key === 'recent' ? ' in 2 Wochen' : ' gesamt')));
        var bar = el('div', 'rr-bar'), fill = el('i'); fill.style.setProperty('--w', Math.max(4, Math.round((x[key] || 0) / max * 100)) + '%'); bar.appendChild(fill); d.appendChild(bar);
      } else if (x.hours) d.appendChild(el('span', '', fmtH(x.hours) + ' gespielt'));
      else d.appendChild(el('span', '', 'Lieblingsspiel'));
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
    if (s.private) box.appendChild(el('p', 'muted val-note', 'Die Spieldetails sind auf Steam nicht öffentlich, deshalb fehlen Spielzeiten.'));
    var w = s.value;
    if (w && w.eur > 0) {
      var rows = (w.top || []).map(function (g) { return [g.name, eur(g.eur)]; });
      if (w.priced > rows.length) rows.push(['… und ' + (w.priced - rows.length) + ' weitere Spiele', '']);
      if (w.eurNow && w.eurNow !== w.eur) rows.push(['Zu den Preisen von heute (Angebote)', eur(w.eurNow)]);
      if (w.perHour != null) rows.push(['Pro gespielter Stunde', String(w.perHour.toFixed(2)).replace('.', ',') + ' €']);
      box.appendChild(valueBox(w.eur, w.priced + ' von ' + w.count + ' Spielen mit Preis', rows,
        'Summe der regulären Shop-Preise von heute (deutscher Steam-Shop). Kostenlose und nicht mehr verkaufte Spiele zählen nicht mit, DLCs und Gegenstände auch nicht. Bezahlt wurde im Angebot oft weniger; das ist kein Verkaufswert.'));
    }
    return box;
  }
  // favs: [{ appid, name }] (Reihenfolge wie gewaehlt); Spielzeit aus der Bibliothek, wenn bekannt
  function renderSteam(s, state, favs) {
    var link = $('stLink'); link.hidden = !(s && s.url); if (s && s.url) link.href = s.url;
    var hours = {}; ((s && s.library) || []).forEach(function (g) { hours[g.appid] = g.hours; });
    var favNode = favs && favs.length ? gameList(favs.map(function (f) { return { appid: f.appid, name: f.name, hours: hours[f.appid] }; }), '') : null;
    var recent = s ? gameList(s.recent, 'recent') : null, top = s ? gameList(s.top, 'hours') : null;
    var pages = [];
    if (s && (s.name || recent || top)) pages.push({ id: 'over', title: 'Überblick', node: steamOverview(s) });
    pages.push({ id: 'favs', title: 'Lieblingsspiele', node: favNode || (view.mine && !view.demo ? emptyPage('Noch keine Lieblingsspiele', 'Wähle deine Lieblingsspiele aus deiner Bibliothek oder aus dem Steam-Shop.', editLink('Lieblingsspiele wählen')) : null), count: favs && favs.length ? favs.length : null });
    pages.push({ id: 'recent', title: 'Zuletzt gespielt', node: recent }, { id: 'top', title: 'Meistgespielt', node: top });
    if (!pages.some(function (p) { return p.node; })) {
      var msg = { none: [view.mine ? 'Verknüpfe dein Steam-Profil, dann erscheinen Spielzeiten und deine meistgespielten Spiele.' : 'Hier ist noch kein Steam-Profil hinterlegt.', editLink('Steam verknüpfen')],
        error: ['Steam-Daten sind gerade nicht verfügbar.'], loading: ['Steam-Daten werden geladen …'], demo: ['Hier erscheinen die meistgespielten Spiele.'] }[state] || ['Noch keine Steam-Daten.'];
      pages = [{ id: 'over', title: 'Überblick', node: emptyPage('', msg[0], msg[1]) }];
    }
    setPages('stTabs', 'stPages', pages);
    $('pkSteam').textContent = s && s.totalHours ? nf.format(Math.round(s.totalHours)) + ' Std Spielzeit' : favs && favs[0] ? favs[0].name + (favs.length > 1 ? ' & mehr' : '') : 'Spiele';
    var now = s && s.recent && s.recent[0], p = $('nowPlaying');
    p.hidden = !now; p.textContent = '';
    if (now) { p.appendChild(el('span', 'ping')); p.appendChild(document.createTextNode((view.demo || view.mine ? 'Spiele' : 'Spielt') + ' gerade viel: ')); p.appendChild(el('b', '', now.name)); p.appendChild(document.createTextNode(' (' + fmtH(now.recent) + ' in 2 Wochen)')); }
  }

  // ---------- Minecraft: Server (Cobblemon im Beispiel, sonst der Lieblingsserver des Profils) ----------
  function srvLine(target, cls, text) {
    target.className = 'srv ' + cls; target.textContent = ''; target.appendChild(el('span', cls === 'up' ? 'ping pulse' : 'ping')); target.appendChild(document.createTextNode(text)); target.hidden = false;
  }
  // Status des Cobblemon Servers in beliebige Elemente schreiben (Buehne und Startkarte ohne Anmeldung)
  function cobblemon(line, stats, onShort) {
    if (Date.now() < START) { srvLine(line, 'soon', 'Start am ' + new Date(START).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' Uhr'); if (onShort) onShort('Startet bald'); return; }
    getJson(DATA_BASE + 'leaderboards.json?t=' + Date.now(), { cache: 'no-store' }).then(function (d) {
      var s = d.server || {}, stale = Date.now() - new Date(d.updated).getTime() > 45 * 60000;
      if (stale) { srvLine(line, 'soon', 'Status unbekannt'); if (onShort) onShort('Cobblemon Server'); }
      else if (s.up) { srvLine(line, 'up', 'Aktiv · ' + s.online + '/' + s.max + ' Spieler online'); if (onShort) onShort(s.online + ' / ' + s.max + ' online'); }
      else { srvLine(line, 'down', 'Gerade offline'); if (onShort) onShort('Server offline'); }
      if (!stats) return;
      var names = {}; (d.boards || []).forEach(function (b) { (b.total || []).forEach(function (e) { if (e && e.name) names[e.name.toLowerCase()] = 1; }); });
      var n = Object.keys(names).length; stats.textContent = '';
      stats.appendChild(stat('Läuft seit', Math.max(1, Math.floor((Date.now() - START) / 86400000)), '', 0, ' Tagen'));
      if (n) stats.appendChild(stat('Spieler', n, 'in den Ranglisten'));
      stats.hidden = false; countUp(stats);
    }).catch(function () { if (onShort) onShort('Cobblemon Server'); });
  }
  // srv: { kind: 'cobblemon' } oder { kind: 'fav', address, data, error }
  function renderServer(srv) {
    var box = $('server'); box.textContent = '';
    if (srv && srv.kind === 'cobblemon') {
      box.appendChild(el('span', 'tag', 'Mein Server')); box.appendChild(el('h3', '', 'Cobblemon Server'));
      box.appendChild(el('p', 'muted', 'Eigener Minecraft-Server mit Pokémon: Ranglisten, Wochensieger, Nether- und End-Freischaltung. Mitspielen geht über die Whitelist.'));
      var line = el('p', 'srv'), dl = el('dl', 'stats'); line.hidden = true; dl.hidden = true; box.appendChild(line); box.appendChild(dl);
      var row = el('div', 'cta-row'), a = el('a', 'btn'), b = el('a', 'btn ghost', 'Für die Whitelist bewerben');
      a.href = '../cobblemon/'; a.textContent = 'Zur Server-Seite '; a.appendChild(el('span', 'arr', '→')); b.href = '../cobblemon/#bewerben';
      row.appendChild(a); row.appendChild(b); box.appendChild(row);
      cobblemon(line, dl, function (t) { $('pkMc').textContent = t; });
      return;
    }
    if (!srv || !srv.address) {
      if (view.mine && !view.demo) box.appendChild(emptyPage('Lieblingsserver', 'Trag deinen Lieblingsserver ein; sobald er gefunden wird, erscheint hier eine Vorschau mit Status und Spielern.', editLink('Server eintragen')));
      $('pkMc').textContent = view.mcName || 'Minecraft';
      box.hidden = !box.children.length; return;
    }
    box.hidden = false;
    var d = srv.data, head = el('div', 'srv-head');
    if (d && d.icon && /^data:image\/png;base64,/.test(d.icon)) { var ic = el('img', 'srv-icon'); ic.src = d.icon; ic.alt = ''; ic.width = 48; ic.height = 48; head.appendChild(ic); }
    var t = el('div'); t.appendChild(el('span', 'tag', 'Lieblingsserver')); t.appendChild(el('h3', '', srv.address)); head.appendChild(t); box.appendChild(head);
    var ln = el('p', 'srv'); box.appendChild(ln);
    if (!d) { srvLine(ln, 'soon', srv.error === 'not_found' ? 'Server nicht gefunden' : 'Status wird geprüft …'); $('pkMc').textContent = srv.address; return; }
    if (d.online) srvLine(ln, 'up', 'Online · ' + d.players + '/' + d.max + ' Spieler'); else srvLine(ln, 'down', 'Gerade offline');
    if (d.motd) box.appendChild(el('p', 'srv-motd', d.motd));
    var info = [d.version ? 'Version ' + d.version : '', srv.fetched ? 'Stand: ' + when(srv.fetched) : ''].filter(Boolean).join(' · ');
    if (info) box.appendChild(el('p', 'muted', info));
    if (d.names && d.names.length) box.appendChild(el('p', 'muted', 'Gerade online: ' + d.names.join(', ')));
    $('pkMc').textContent = d.online ? d.players + ' / ' + d.max + ' online' : srv.address;
  }

  // ---------- Konten: Karten in der Buehne und die Leiste rechts ----------
  // accounts: [{ kind, handle, extra, in_sidebar, data }]
  function accBadge(k) { var b = el('span', 'acc-badge', k.short); b.style.setProperty('--c', k.color); b.setAttribute('aria-hidden', 'true'); return b; }
  function accActions(a, k, link) {
    var row = el('div', 'acc-act');
    if (link) { var l = ext(el('a', 'btn ghost small', 'Öffnen ↗'), link); l.setAttribute('aria-label', k.name + ' öffnen'); row.appendChild(l); }
    var c = el('button', 'btn ghost small', 'Kopieren'); c.type = 'button'; c.setAttribute('aria-label', k.name + ' kopieren');
    c.addEventListener('click', function () {
      (navigator.clipboard ? navigator.clipboard.writeText(a.handle) : Promise.reject()).then(function () { if (FX.toast) FX.toast(k.name + ' kopiert'); c.textContent = 'Kopiert ✓'; setTimeout(function () { c.textContent = 'Kopieren'; }, 1600); }, function () {});
    });
    row.appendChild(c);
    return row;
  }
  function renderAccounts(list) {
    var GA = window.GAccounts, grid = $('accGrid'), bar = $('accBar'), barList = $('accBarList');
    grid.textContent = ''; barList.textContent = '';
    list = (list || []).filter(function (a) { return GA && GA.BY[a.kind]; });
    $('pkAcc').textContent = list.length ? list.length + (list.length === 1 ? ' Konto' : ' Konten') : 'Verknüpfungen';
    if (!list.length) grid.appendChild(emptyPage('Noch keine Konten verknüpft', view.mine ? 'Verknüpfe Steam, Valorant, Minecraft, Discord, Konsolen und Kanäle. Sie erscheinen hier und in der Leiste.' : 'Hier sind noch keine Konten hinterlegt.', editLink('Konten verknüpfen')));
    list.forEach(function (a, i) {
      var k = GA.BY[a.kind], link = GA.link(a, a.data), sum = GA.summary(a, a.data);
      var card = el('div', 'acc-card'); card.style.setProperty('--c', k.color); card.style.setProperty('--i', Math.min(i, 14));
      var top = el('div', 'acc-top'); top.appendChild(accBadge(k));
      var t = el('div', 'acc-t'); t.appendChild(el('b', '', k.name)); t.appendChild(el('span', '', a.handle)); top.appendChild(t); card.appendChild(top);
      if (sum && sum !== a.handle) card.appendChild(el('p', 'acc-sum', sum));
      if (a.kind === 'discord' && a.data && a.data.name) card.appendChild(el('p', 'muted', a.data.name));
      card.appendChild(accActions(a, k, link));
      grid.appendChild(card);
      if (a.in_sidebar === false) return;
      var li = el('li'), row = link ? ext(el('a', 'acc-row'), link) : el('div', 'acc-row');
      row.style.setProperty('--c', k.color); row.appendChild(accBadge(k));
      var rt = el('span', 'acc-t'); rt.appendChild(el('b', '', k.name)); rt.appendChild(el('span', '', sum || a.handle)); row.appendChild(rt);
      if (link) row.appendChild(el('span', 'arr', '↗'));
      li.appendChild(row); barList.appendChild(li);
    });
    bar.hidden = !barList.children.length && !view.mine;
    $('accBarEmpty').hidden = !!barList.children.length;
  }

  // ---------- Discord-Abschnitt unter der Buehne (Server-Einladung des Profils, im Beispiel der eigene Server) ----------
  function renderDiscord(d, demo) {
    var sec = $('discord'), box = $('dcStats'), link = $('discordLink');
    box.textContent = ''; box.hidden = true;
    if (!demo && !(d && d.code)) { sec.hidden = true; return; }
    sec.hidden = false;
    $('dcText').textContent = demo
      ? 'Mit mir zocken, Fragen stellen, Neuigkeiten zum Server: alles läuft über meinen Discord. Hilfe zur Wunschliste gibt es dort ebenfalls.'
      : (view.mine ? 'Dein Discord-Server' : 'Discord-Server von ' + (view.owner ? view.owner.name : '')) + (d.name ? ': ' + d.name + '.' : '.');
    link.href = demo ? 'https://discord.gg/' + DISCORD_INVITE : 'https://discord.gg/' + d.code;
    var fill = function (x) {
      if (!x || !x.members) return;
      var on = el('span', 'on'), all = el('span', 'all'), onN = el('b'), allN = el('b');
      on.appendChild(el('i', 'ping pulse')); on.appendChild(onN); on.appendChild(document.createTextNode(' online'));
      all.appendChild(allN); all.appendChild(document.createTextNode(' Mitglieder'));
      box.appendChild(on); box.appendChild(all); box.hidden = false;
      onN.textContent = nf.format(x.online || 0); allN.textContent = nf.format(x.members);
    };
    if (demo) getJson('https://discord.com/api/v10/invites/' + DISCORD_INVITE + '?with_counts=true').then(function (x) { fill({ members: x.approximate_member_count, online: x.approximate_presence_count }); }).catch(function () {});
    else fill(d);
  }

  // ---------- Alles zeichnen ----------
  // v: { demo, mine, owner{name,avatar,color}, tagline, agent{ id, n, p }, val, valState, valSkins, steam, steamState, favs,
  //      pioneer, mcSkins[{id,name,src,model}], mcActive, mcName, server, accounts, discord }
  function render(v) {
    view = v;
    document.body.classList.toggle('is-demo', !!v.demo);
    $('meTag').textContent = v.demo ? 'Beispiel' : v.owner ? v.owner.name : 'Gaming';
    $('meLead').textContent = v.tagline || (v.demo ? 'So sieht ein Gaming-Profil aus: Taktik-Shooter, Fabrikbau und ein eigener Minecraft-Server.' : v.mine ? 'Dein Gaming-Profil. Wähl ein Spiel und schau, wie es gerade läuft.' : 'Wähl ein Spiel und schau, wie es gerade läuft.');
    setAgent(v.agent);
    renderValorant(v.val, v.valState, v.valSkins);
    renderSteam(v.steam, v.steamState, v.favs);
    pioneer.select(v.pioneer || PIONEERS[0][0]);
    setMcSkins(v.mcSkins, v.mcActive);
    renderServer(v.server);
    renderAccounts(v.accounts);
    renderDiscord(v.discord, v.demo);
    var p = panel(cur); if (p) countUp(p);
  }

  // Beispiel ohne Anmeldung: Erics Daten aus dem Deploy (bisherige Ansicht), abgedunkelt mit "Beispiel"
  function demo() {
    var base = { demo: true, mine: false, owner: { name: 'Skeison' }, valState: 'loading', valSkins: 'loading', steamState: 'loading', favs: [], pioneer: 'pionier-gruen',
      mcSkins: [{ id: 'skeison', name: 'Skeison', src: '../skin/skeison.png' }], mcName: 'Skeison', server: { kind: 'cobblemon' },
      accounts: [{ kind: 'steam', handle: 'Skeison', extra: {}, data: null }, { kind: 'minecraft', handle: 'Skeison', extra: {} }, { kind: 'discord', handle: 'discord.gg/' + DISCORD_INVITE, extra: {} }] };
    render(base);
    Promise.all([
      getJson('../valorant.json', { cache: 'no-cache' }).catch(function () { return { error: true }; }),
      getJson('../valorant-skins.json', { cache: 'no-cache' }).catch(function () { return null; }),
      getJson('../steam.json', { cache: 'no-cache' }).catch(function () { return null; })
    ]).then(function (r) {
      var val = r[0], ok = val && !val.setup && val.riotId;
      base.val = ok ? val : null; base.valState = ok ? 'ok' : val && val.error ? 'error' : 'setup'; base.valSkins = r[1];
      base.steam = r[2]; base.steamState = r[2] ? 'ok' : 'demo';
      if (r[2] && r[2].url) base.accounts[0] = { kind: 'steam', handle: r[2].steamId || 'Skeison', extra: {}, data: r[2] };
      if (ok) base.accounts.unshift({ kind: 'valorant', handle: val.riotId, extra: {}, data: val });
      if (view.demo) render(base);
    });
  }

  var Gaming = window.Gaming = { render: render, demo: demo, cobblemon: cobblemon, show: show, onEdit: null, onMcSkin: null,
    pioneer: pioneer, get current() { return cur; } };
  fromHash(false);
})();
