// Gemeinsame Effekte: Pixel-Partikel im Hintergrund, Navigation, Scroll-Animationen, Countdown-Rolle, Toast,
// Knopf "Animationen pausieren". Respektiert "Bewegung reduzieren" im System; ohne JavaScript bleibt alles sichtbar.
(function () {
  'use strict';
  var root = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var each = function (sel, fn, scope) { Array.prototype.forEach.call((scope || document).querySelectorAll(sel), fn); };
  var FX = window.FX = { reduced: reduced };
  root.classList.add('fx');

  // Ruhezustand: Ist der Tab verdeckt oder das Fenster nicht im Vordergrund, stehen alle Dauer-Animationen still
  // (CSS-Klasse "fx-idle", Ereignis "fx:idle") und alles laeuft beim Zurueckkehren weiter. Spart im Hintergrund fast die gesamte CPU.
  FX.idle = false;
  function setIdle() {
    var now = document.hidden || !document.hasFocus();
    if (now === FX.idle) return;
    FX.idle = now; root.classList.toggle('fx-idle', now);
    document.dispatchEvent(new CustomEvent('fx:idle', { detail: now }));
  }
  window.addEventListener('blur', setIdle); window.addEventListener('focus', setIdle); document.addEventListener('visibilitychange', setIdle);
  setIdle();

  // "Animationen pausieren" (Knopf in der Navigation, siehe initNav): haelt alle Dauer-Animationen an, auch Partikel
  // und 3D-Skin (CSS-Klasse "fx-still", Ereignis "fx:still"). Die Wahl gilt fuer alle Seiten und wird gespeichert.
  var STILL_KEY = 'fx-still';
  FX.still = false;
  try { FX.still = localStorage.getItem(STILL_KEY) === '1'; } catch (e) { /* ohne Speicher: Standard "laeuft" */ }
  root.classList.toggle('fx-still', FX.still);
  function setStill(on) {
    FX.still = on; root.classList.toggle('fx-still', on);
    try { localStorage.setItem(STILL_KEY, on ? '1' : '0'); } catch (e) { /* Wahl gilt dann nur fuer diese Seite */ }
    each('.motion-btn', function (b) { b.setAttribute('aria-pressed', String(on)); });
    document.dispatchEvent(new CustomEvent('fx:still', { detail: on }));
  }

  // Sprungmarken (#abschnitt): Mausklick scrollt sanft, Tastatur springt sofort.
  // CSS "scroll-behavior: smooth" haette auch den Tastatur-Fokus verzoegert (er landete erst nach ~0,4 s im Bild).
  // e.detail === 0: per Tastatur ausgeloest. Ziele ohne Element (z. B. #bewerben) laufen normal ueber hashchange.
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button || e.detail === 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || reduced) return;
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.classList.contains('skip')) return;
    var id = decodeURIComponent(a.getAttribute('href').slice(1)), t = id && document.getElementById(id);
    if (!t) return;
    e.preventDefault();
    t.scrollIntoView({ behavior: 'smooth' });
    if (location.hash !== '#' + id) history.pushState(null, '', '#' + id);
  });

  // Countdown-Ziffer: alte Zahl rollt nach oben weg, neue rollt von unten herein
  FX.roll = function (el, val) {
    val = String(val);
    var old = el.getAttribute('data-v');
    if (old === val) return;
    el.setAttribute('data-v', val);
    if (old === null || reduced || document.hidden) { el.textContent = val; return; }
    el.textContent = '';
    var n = document.createElement('span'); n.className = 'r-in'; n.textContent = val;
    var o = document.createElement('span'); o.className = 'r-out'; o.textContent = old; o.setAttribute('aria-hidden', 'true');
    el.appendChild(n); el.appendChild(o);
  };

  // Einblenden beim Scrollen
  var pending = [];
  function show(el) { el.classList.add('in'); if (io) io.unobserve(el); }
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) show(e.target); });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 }) : null;
  // Bei "Bewegung reduzieren" oder ohne Observer sofort zeigen
  FX.reveal = function (el) { if (io && !reduced) { io.observe(el); pending.push(el); } else el.classList.add('in'); };
  // Sicherheitsnetz: Meldet der Observer nichts (Fehler, Drucken, alte Browser), zeigt ein Nachzuegler-Check
  // nach dem Laden und nach jedem Scrollen alles, was im Bild ist. Inhalt bleibt so nie dauerhaft unsichtbar.
  var sweepT = 0;
  function sweep() {
    var h = window.innerHeight;
    pending = pending.filter(function (el) {
      if (el.classList.contains('in')) return false;
      var r = el.getBoundingClientRect();
      if (r.top < h && r.bottom > 0) { show(el); return false; }
      return true;
    });
  }
  function sweepSoon(ms) { clearTimeout(sweepT); sweepT = setTimeout(sweep, ms); }
  window.addEventListener('scroll', function () { sweepSoon(400); }, { passive: true });
  window.addEventListener('load', function () { sweepSoon(1200); });
  window.addEventListener('beforeprint', function () { pending.forEach(show); pending = []; });
  // Tastatur: Springt der Fokus in einen noch unsichtbaren Abschnitt, sofort zeigen
  document.addEventListener('focusin', function (e) {
    var sel = '[data-reveal], [data-stagger]', n = e.target.closest ? e.target.closest(sel) : null;
    // "now": Einblend-Animation ueberspringen (auch eine gerade laufende), damit der Fokusrahmen sofort sichtbar ist
    while (n) { n.classList.add('now'); if (!n.classList.contains('in')) show(n); n = n.parentElement && n.parentElement.closest(sel); }
  });

  // Pause-Knopf fuer Demo-Grafiken mit Dauer-Animation ([data-loops]): haelt alle Animationen darin an
  function loopPause(box) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'loop-pause'; b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', 'Animation anhalten'); b.title = 'Animation anhalten';
    b.innerHTML = '<svg class="i-pause" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" rx="1"/><rect x="8.5" y="1" width="3.5" height="12" rx="1"/></svg>'
      + '<svg class="i-play" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9.5-5.5z"/></svg>';
    b.addEventListener('click', function () {
      var on = box.classList.toggle('paused');
      b.setAttribute('aria-pressed', String(on));
      var t = on ? 'Animation fortsetzen' : 'Animation anhalten';
      b.setAttribute('aria-label', t); b.title = t;
    });
    box.appendChild(b);
  }
  function indexChildren(c) { Array.prototype.forEach.call(c.children, function (ch, i) { ch.style.setProperty('--i', Math.min(i, 8)); }); }

  // Einmal ausfuehren, sobald ein Element sichtbar wird
  FX.whenVisible = function (el, fn) {
    if (!('IntersectionObserver' in window)) return fn();
    var o = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { o.disconnect(); fn(); } }, { threshold: 0.3 });
    o.observe(el);
  };

  // Kurze Meldung unten
  var toastEl, toastT;
  FX.toast = function (text) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = text; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  };

  // Gleitende Markierung in Umschaltern (.seg); folgt der Klasse "on" der Buttons
  function segIndicator(seg) {
    var ind = document.createElement('span'); ind.className = 'seg-ind'; ind.setAttribute('aria-hidden', 'true');
    seg.insertBefore(ind, seg.firstChild); seg.classList.add('has-ind');
    function upd() {
      var on = seg.querySelector('button.on');
      if (!on || !on.offsetWidth) return;
      ind.style.width = on.offsetWidth + 'px'; ind.style.transform = 'translateX(' + on.offsetLeft + 'px)';
      if (!ind.classList.contains('ready')) requestAnimationFrame(function () { ind.classList.add('ready'); });
    }
    if (window.MutationObserver) new MutationObserver(upd).observe(seg, { attributes: true, subtree: true, attributeFilter: ['class'] });
    if (window.ResizeObserver) new ResizeObserver(upd).observe(seg);
    upd();
  }

  function init() {
    each('[data-reveal]', FX.reveal);
    each('[data-stagger]', function (c) {
      indexChildren(c); FX.reveal(c);
      if (window.MutationObserver) new MutationObserver(function () { indexChildren(c); }).observe(c, { childList: true });
    });
    each('.seg', segIndicator);
    each('[data-loops]', loopPause);
    initNav();
    initParticles();
  }

  // Navigation: Glas-Effekt beim Scrollen, aktiver Abschnitt, Lesefortschritt, Handy-Menue, Nach-oben-Knopf
  function initNav() {
    var bar = document.querySelector('.nav-bar');
    var links = bar && bar.querySelector('.links'), ind = bar && bar.querySelector('.nav-ind');
    var prog = bar && bar.querySelector('.nav-progress'), menu = bar && bar.querySelector('.menu-btn');
    var anchors = links ? Array.prototype.filter.call(links.querySelectorAll('a'), function (a) { return a.getAttribute('href').charAt(0) === '#'; }) : [];
    var secs = anchors.map(function (a) { return document.querySelector(a.getAttribute('href')); });
    var active = null, hover = null;
    if (links) Array.prototype.forEach.call(links.children, function (c, i) { c.style.setProperty('--i', i); });

    // Knopf "Animationen pausieren" (WCAG 2.2.2: Dauerbewegung braucht eine Pause); bei "Bewegung reduzieren" per CSS ausgeblendet
    if (links) {
      var mb = document.createElement('button');
      mb.type = 'button'; mb.className = 'motion-btn'; mb.setAttribute('aria-pressed', String(FX.still));
      mb.setAttribute('aria-label', 'Animationen pausieren'); mb.title = 'Animationen pausieren';
      mb.innerHTML = '<svg class="i-pause" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" rx="1"/><rect x="8.5" y="1" width="3.5" height="12" rx="1"/></svg>'
        + '<svg class="i-play" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9.5-5.5z"/></svg><span class="mb-t" aria-hidden="true">Animationen pausieren</span>';
      mb.addEventListener('click', function () { setStill(!FX.still); });
      links.insertBefore(mb, links.querySelector('.nav-cta'));
    }

    function place(a) {
      if (!ind) return;
      if (!a || !a.offsetWidth) { ind.style.opacity = 0; return; }
      ind.style.opacity = 1; ind.style.width = a.offsetWidth + 'px'; ind.style.transform = 'translateX(' + a.offsetLeft + 'px)';
      if (!ind.classList.contains('ready')) requestAnimationFrame(function () { ind.classList.add('ready'); });
    }
    function setActive(a) {
      if (a === active) return;
      active = a; anchors.forEach(function (x) { x.classList.toggle('active', x === a); if (x === a) x.setAttribute('aria-current', 'true'); else x.removeAttribute('aria-current'); });
      if (!hover) place(a);
    }
    anchors.forEach(function (a) {
      a.addEventListener('mouseenter', function () { hover = a; place(a); });
      a.addEventListener('mouseleave', function () { hover = null; place(active); });
    });

    var totop = document.createElement('button');
    totop.type = 'button'; totop.className = 'totop'; totop.setAttribute('aria-label', 'Nach oben');
    totop.innerHTML = '<svg viewBox="0 0 52 52" aria-hidden="true"><circle class="trk" cx="26" cy="26" r="24.5" pathLength="100"/><circle class="bar" cx="26" cy="26" r="24.5" pathLength="100"/></svg><b aria-hidden="true">↑</b>';
    totop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); });
    document.body.appendChild(totop);
    var ring = totop.querySelector('.bar');

    var ticking = false;
    function onScroll() {
      ticking = false;
      var y = window.scrollY, max = root.scrollHeight - window.innerHeight, p = max > 0 ? Math.min(y / max, 1) : 0;
      if (bar) bar.classList.toggle('scrolled', y > 8);
      if (prog) prog.style.transform = 'scaleX(' + p + ')';
      ring.style.strokeDashoffset = String(100 - p * 100);
      totop.classList.toggle('show', y > 600);
      var cur = null, line = window.innerHeight * 0.35;
      secs.forEach(function (s, i) { if (s && s.getBoundingClientRect().top <= line) cur = anchors[i]; });
      if (max > 0 && y >= max - 4 && secs[secs.length - 1]) cur = anchors[anchors.length - 1];
      setActive(cur);
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
    window.addEventListener('resize', function () { place(hover || active); onScroll(); });
    onScroll();

    if (!menu) return;
    function setOpen(open) { bar.classList.toggle('open', open); menu.setAttribute('aria-expanded', String(open)); }
    menu.addEventListener('click', function () { setOpen(!bar.classList.contains('open')); });
    links.addEventListener('click', function (e) { if (e.target.closest('a, button')) setOpen(false); });
    document.addEventListener('click', function (e) { if (!bar.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && bar.classList.contains('open')) { setOpen(false); menu.focus(); } });
  }

  // Aufsteigende eckige Pixel-Partikel (wie Minecraft-Partikel); Farbe folgt der Akzentfarbe (color von .fx-bg).
  // Sparsam gebaut: halbe Aufloesung (ein Partikel-Pixel = 2x2 Bildschirmpixel, per CSS hochskaliert), 12 Bilder pro Sekunde,
  // Stillstand im Hintergrund. Vorher: Vollbild-Flaeche mit 60 Bildern pro Sekunde, dauerhaft.
  function initParticles() {
    var cv = document.querySelector('.fx-bg canvas');
    if (!cv || reduced || !cv.getContext) return;
    var ctx = cv.getContext('2d'), S = 2, FPS = 12;
    var W = 0, H = 0, P = [], rgb = '255,203,5', timer = 0, raf = 0, last = 0, lastColor = 0, resizeT = 0;
    function readColor() { var m = getComputedStyle(cv.parentNode).color.match(/[\d.]+/g); if (m) rgb = m.slice(0, 3).join(','); }
    function spawn(anywhere) {
      var life = 10 + Math.random() * 15; // Sekunden
      return { x: Math.random() * W, y: anywhere ? Math.random() * H : H * (0.4 + Math.random() * 0.6), s: 1 + Math.floor(Math.random() * 2),
        v: 3.5 + Math.random() * 8, w: Math.random() * 6.28, life: life, age: anywhere ? Math.random() * life : 0, a: 0.15 + Math.random() * 0.3 };
    }
    function size() {
      var cw = cv.clientWidth, ch = cv.clientHeight;
      W = Math.ceil(cw / S); H = Math.ceil(ch / S); cv.width = W; cv.height = H;
      var n = Math.min(45, Math.round(cw * ch / 26000));
      while (P.length < n) P.push(spawn(true));
      P.length = n;
    }
    function frame(t) {
      raf = 0;
      var dt = Math.min((t - last) / 1000, 0.25); last = t;
      if (t - lastColor > 5000) { lastColor = t; readColor(); }
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < P.length; i++) {
        var q = P[i];
        q.age += dt; q.y -= q.v * dt; q.w += 0.6 * dt;
        if (q.age > q.life || q.y < -5) { P[i] = spawn(false); continue; }
        var k = q.age / q.life, fade = k < 0.15 ? k / 0.15 : k > 0.75 ? (1 - k) / 0.25 : 1;
        ctx.fillStyle = 'rgba(' + rgb + ',' + (q.a * fade).toFixed(3) + ')';
        ctx.fillRect(Math.round(q.x + Math.sin(q.w) * 4), Math.round(q.y), q.s, q.s);
      }
      schedule();
    }
    // Zwischen den Bildern schlaeft der Tab (setTimeout), gezeichnet wird synchron zum Bildschirm
    function schedule() { timer = setTimeout(function () { timer = 0; raf = requestAnimationFrame(frame); }, 1000 / FPS); }
    function stop() { clearTimeout(timer); cancelAnimationFrame(raf); timer = raf = 0; }
    function run() { if (timer || raf || FX.idle || FX.still) return; last = performance.now(); readColor(); schedule(); }
    // Pausiert ("Animationen pausieren"): ein ruhendes Bild statt einer leeren Flaeche
    function drawStill() { last = performance.now(); frame(last); stop(); }
    readColor(); size(); if (FX.still) drawStill(); else run();
    window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(function () { size(); if (FX.still) drawStill(); }, 150); });
    document.addEventListener('fx:idle', function (e) { if (e.detail) stop(); else run(); });
    document.addEventListener('fx:still', function (e) { if (e.detail) stop(); else run(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
