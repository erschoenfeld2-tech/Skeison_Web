// Hell oder dunkel fuer alle Seiten: setzt data-mode="light|dark" auf <html>, bevor die Seite gezeichnet wird (kein Aufblitzen).
// Standard ist "auto": die Seite folgt dem Geraet (prefers-color-scheme). Wer ueber den Knopf in der Navigation (assets/fx.js)
// oder im Wunschliste-Profil etwas anderes waehlt, behaelt das auf diesem Geraet fuer alle Seiten (localStorage "wl-mode").
// Die Stylesheets haengen ihre hellen Farben an html[data-mode="light"]; ohne JavaScript bleibt die Seite dunkel.
(function () {
  'use strict';
  var KEY = 'wl-mode', root = document.documentElement;
  var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function pref() { try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch (e) { return 'auto'; } }
  function device() { return mq && !mq.matches ? 'light' : 'dark'; }
  function current() { var p = pref(); return p === 'auto' ? device() : p; }
  function apply() {
    var mode = current();
    if (root.getAttribute('data-mode') === mode) return;
    root.setAttribute('data-mode', mode);
    try { document.dispatchEvent(new CustomEvent('wl:mode', { detail: mode })); } catch (e) {}
  }
  function set(v) {
    try { if (v === 'light' || v === 'dark') localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) {}
    apply();
    try { document.dispatchEvent(new CustomEvent('wl:modepref', { detail: pref() })); } catch (e) {}
  }
  apply();
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply); }
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(); });
  window.WLMode = {
    get: pref,                 // 'auto' | 'light' | 'dark' (die Wahl)
    current: current,          // 'light' | 'dark' (was gerade gilt)
    set: set,
    // Knopf in der Navigation: wechselt zur jeweils anderen Darstellung. Entspricht die neue Wahl dem Geraet,
    // gilt wieder "auto" (die Seite folgt dann weiter dem Geraet, statt auf einer Wahl haengen zu bleiben).
    toggle: function () { var next = current() === 'dark' ? 'light' : 'dark'; set(next === device() ? 'auto' : next); return next; }
  };
})();
