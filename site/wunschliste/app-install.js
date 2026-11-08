// Seite "Wunschliste als App": passende Anleitung hervorheben und die Installation im Browser anbieten
(function () {
  'use strict';
  var ua = navigator.userAgent;
  var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var os = ios ? 'ios' : /Android/.test(ua) ? 'android' : 'web';
  var mine = document.querySelector('.ap-card[data-os="' + os + '"]');
  if (mine) {
    mine.classList.add('mine');
    mine.querySelector('.ap-you').hidden = false;
    mine.parentNode.insertBefore(mine, mine.parentNode.firstChild);
  }

  // Chrome/Edge: eigener Knopf fuer "App installieren"
  var prompt = null, btn = document.getElementById('installBtn'), hint = document.getElementById('installHint');
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    prompt = e;
    btn.hidden = false;
    hint.hidden = true;
  });
  btn.addEventListener('click', function () {
    if (!prompt) return;
    prompt.prompt();
    prompt.userChoice.finally(function () { prompt = null; btn.hidden = true; hint.hidden = false; });
  });
  window.addEventListener('appinstalled', function () { btn.hidden = true; hint.textContent = 'Installiert. Du findest die Wunschliste jetzt bei deinen Apps.'; hint.hidden = false; });
})();
