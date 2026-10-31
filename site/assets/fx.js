// Gemeinsame Effekte: Pixel-Partikel im Hintergrund, Navigation, Scroll-Animationen, Countdown-Rolle, Toast.
// Respektiert "Bewegung reduzieren" im System; ohne JavaScript bleibt alles sichtbar.
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
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 }) : null;
  FX.reveal = function (el) { if (io) io.observe(el); else el.classList.add('in'); };
  function indexChildren(c) { Array.prototype.forEach.call(c.children, function (ch, i) { ch.style.setProperty('--i', Math.min(i, 8)); }); }

  // Einmal ausfuehren, sobald ein Element sichtbar wird
  FX.whenVisible = function (el, fn) {
    if (!('IntersectionObserver' in window)) return fn();
    var o = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { o.disconnect(); fn(); } }, { threshold: 0.3 });
    o.observe(el);
  };

  // Zahl hochzaehlen
  FX.count = function (el, to, fmt) {
    fmt = fmt || String;
    if (reduced) { el.textContent = fmt(to); return; }
    el.textContent = fmt(0);
    FX.whenVisible(el, function () {
      var t0 = null;
      (function step(t) {
        if (t0 === null) t0 = t;
        var p = Math.min((t - t0) / 1600, 1);
        el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - p, 4))));
        if (p < 1) requestAnimationFrame(step);
      })(performance.now());
    });
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
    function run() { if (timer || raf || FX.idle) return; last = performance.now(); readColor(); schedule(); }
    readColor(); size(); run();
    window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(size, 150); });
    document.addEventListener('fx:idle', function (e) { if (e.detail) stop(); else run(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
