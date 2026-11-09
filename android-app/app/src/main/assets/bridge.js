// Bruecke zwischen der Wunschliste-Webseite und der Android-App.
// Die App laedt die echte Webseite; dieses Skript ergaenzt nur, was ein Browser selbst kann, eine WebView aber nicht:
// Teilen-Menue, Kopieren, Dateien speichern (QR-Code), Zurueck-Taste, Farben der Statusleiste.
// Es veraendert die Webseite nicht, damit jede Aenderung an der Seite sofort auch in der App gilt.
(function () {
  'use strict';
  if (window.__wlApp) return;
  var N = window.WunschlisteNative;
  if (!N) return;
  function post(o) { try { N.postMessage(JSON.stringify(o)); } catch (e) {} }
  function toast(text) { if (window.FX && FX.toast) FX.toast(text); else post({ t: 'toast', text: text }); }

  // ---------- Teilen (navigator.share) ----------
  function share(d) {
    d = d || {};
    post({ t: 'share', title: String(d.title || ''), text: String(d.text || ''), url: String(d.url || '') });
    return Promise.resolve();
  }
  try { Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true }); } catch (e) {}
  try { Object.defineProperty(navigator, 'canShare', { value: function (d) { return !!d && !d.files; }, configurable: true, writable: true }); } catch (e) {}

  // ---------- Kopieren (navigator.clipboard.writeText) ----------
  function copyText(t) { post({ t: 'copy', text: String(t) }); return Promise.resolve(); }
  try {
    if (navigator.clipboard) Object.defineProperty(navigator.clipboard, 'writeText', { value: copyText, configurable: true, writable: true });
    else Object.defineProperty(navigator, 'clipboard', { value: { writeText: copyText }, configurable: true });
  } catch (e) {}

  // ---------- Dateien speichern (<a download> mit blob:/data:) ----------
  // Die Seite erzeugt Downloads per URL.createObjectURL. Die Blobs merken wir uns, weil die Inhalts-Richtlinie
  // der Seite (CSP) ein fetch() auf blob:-Adressen verbietet.
  var blobs = new Map();
  var origCreate = URL.createObjectURL, origRevoke = URL.revokeObjectURL;
  URL.createObjectURL = function (o) {
    var u = origCreate.call(URL, o);
    if (o instanceof Blob) blobs.set(u, o);
    return u;
  };
  URL.revokeObjectURL = function (u) {
    setTimeout(function () { blobs.delete(u); }, 15000);
    return origRevoke.call(URL, u);
  };
  function readAs(blob, how) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r[how](blob); });
  }
  // SVG (QR-Code) als PNG speichern, damit es in der Galerie erscheint und sich ueberall weitergeben laesst
  function svgToPng(svgText) {
    var doc = new DOMParser().parseFromString(svgText, 'image/svg+xml'), svg = doc.documentElement, size = 1024;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') return Promise.reject(new Error('no svg'));
    svg.setAttribute('width', size); svg.setAttribute('height', size);
    if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    var src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas'); c.width = c.height = size;
          var g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, size, size); g.drawImage(img, 0, 0, size, size);
          res(c.toDataURL('image/png'));
        } catch (e) { rej(e); }
      };
      img.onerror = rej;
      img.src = src;
    });
  }
  function saveBlob(blob, name) {
    var mime = blob.type || 'application/octet-stream';
    var job = /svg/.test(mime)
      ? readAs(blob, 'readAsText').then(svgToPng).then(function (png) { mime = 'image/png'; name = name.replace(/\.svg$/i, '') + '.png'; return png; },
          function () { return readAs(blob, 'readAsDataURL'); })
      : readAs(blob, 'readAsDataURL');
    job.then(function (dataUrl) {
      post({ t: 'save', name: name, mime: mime, data: String(dataUrl).split(',')[1] || '' });
    }, function () { toast('Speichern hat nicht geklappt'); });
  }
  function saveDataUrl(href, name) {
    var m = /^data:([^;,]*)((?:;[^,]*)*),(.*)$/.exec(href);
    if (!m) return;
    var data = /;base64/i.test(m[2]) ? m[3] : btoa(unescape(encodeURIComponent(decodeURIComponent(m[3]))));
    post({ t: 'save', name: name, mime: m[1] || 'application/octet-stream', data: data });
  }
  function handleDownload(a) {
    var href = a.href || '';
    if (!a.hasAttribute('download') || !/^(blob|data):/.test(href)) return false;
    var name = a.getAttribute('download') || 'download';
    if (href.indexOf('blob:') === 0) {
      var b = blobs.get(href);
      if (!b) return false;
      saveBlob(b, name);
    } else saveDataUrl(href, name);
    return true;
  }
  // a.click() auf einem nicht eingehaengten Link erreicht keinen Listener, daher die Methode selbst ersetzen
  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (handleDownload(this)) return;
    return origClick.call(this);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[download]');
    if (a && handleDownload(a)) e.preventDefault();
  }, true);

  // ---------- Zustand an die App melden (Dialog offen? Hintergrundfarbe fuer die Statusleiste) ----------
  var last = '', timer = 0, frame = 0;
  function rgb(s) {
    var m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    if (p.length > 3 && p[3] === 0) return null;
    return p.slice(0, 3).map(Math.round);
  }
  function report() {
    frame = 0;
    if (!document.body) return;
    var open = !!document.querySelector('dialog[open]');
    var c = rgb(getComputedStyle(document.body).backgroundColor) || rgb(getComputedStyle(document.documentElement).backgroundColor) || [11, 15, 28];
    var light = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 150;
    var key = open + '|' + c.join(',');
    if (key === last) return;
    last = key;
    post({ t: 'state', dialog: open, bg: c, light: light });
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(report);
    // Der Seitenhintergrund blendet weich ueber (transition); danach noch einmal messen
    clearTimeout(timer); timer = setTimeout(report, 700);
  }
  function watch() {
    document.documentElement.classList.add('in-app');
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['open', 'data-theme', 'class'] });
    document.addEventListener('close', schedule, true);
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule); } catch (e) {}
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();

  // ---------- Von der App aufgerufen ----------
  window.__wlApp = {
    // Zurueck-Taste: zuerst offene Dialoge und das Menue schliessen
    back: function () {
      var d = document.querySelector('dialog[open]');
      if (d) { d.close(); return true; }
      var m = document.querySelector('.menu-btn[aria-expanded="true"]');
      if (m) { m.click(); return true; }
      return false;
    },
    // Rueckkehr in die App: Daten neu laden (sanft) oder nach langer Pause die ganze Seite (neue Webseiten-Version)
    resume: function (full) {
      if (document.querySelector('dialog[open]')) return;
      var a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      if (full) location.reload();
      else window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    },
    // Erinnerungen: die Webseite uebergibt Anlaesse und offene Geschenke (null = abgemeldet)
    notify: function (data) { post({ t: 'notify-data', data: data || null }); },
    version: 2
  };
  // Die Seite kann schon geladen sein, bevor die Bruecke da ist: Bescheid geben
  try { window.dispatchEvent(new Event('wlapp-ready')); } catch (e) {}
})();
