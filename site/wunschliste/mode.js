// Hell oder dunkel: setzt data-mode="light|dark" auf <html>, bevor die Seite gezeichnet wird (kein Aufblitzen).
// "auto" folgt dem Geraet (prefers-color-scheme); die Wahl im Profil (WLMode.set) wird auf dem Geraet gespeichert.
// Alle Designs der Wunschliste haben eine helle und eine dunkle Fassung (style.css, [data-mode="dark"]).
(function () {
  'use strict';
  var KEY = 'wl-mode', root = document.documentElement;
  var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function pref() { try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch (e) { return 'auto'; } }
  function apply() {
    var p = pref(), mode = p === 'auto' ? (mq && !mq.matches ? 'light' : 'dark') : p;
    if (root.getAttribute('data-mode') === mode) return;
    root.setAttribute('data-mode', mode);
    try { document.dispatchEvent(new CustomEvent('wl:mode', { detail: mode })); } catch (e) {}
  }
  apply();
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply); }
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(); });
  window.WLMode = {
    get: pref,
    set: function (v) { try { if (v === 'light' || v === 'dark') localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) {} apply(); }
  };
})();
