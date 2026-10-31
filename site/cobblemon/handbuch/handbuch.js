(function () {
  'use strict';
  // Mod-Liste aus mods.json (mit tools/update-handbuch.js aus dem Modpack abgeglichen, Beschreibungen sind von Hand gepflegt)
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function ext(a, href) { a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; }
  var SIDE = { both: ['both', 'Server & Client'], client: ['client', 'Nur Client'], 'optional-client': ['opt', 'Client optional'] };
  var doc = null, cat = 'all';

  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  function card(m) {
    var c = el('article', 'mod'), head = el('header'), side = SIDE[m.side] || SIDE.both;
    c.id = 'mod-' + m.id.replace(/[^A-Za-z0-9_-]/g, '_');
    head.appendChild(el('h3', '', m.name)); head.appendChild(el('span', 'badge ' + side[0], side[1])); c.appendChild(head);
    c.appendChild(el('p', m.text ? 'mt' : 'mt none', m.text || 'Beschreibung folgt. Details stehen auf der Seite der Mod.'));
    var links = el('div', 'mlinks');
    if (/^file:/.test(m.id)) links.appendChild(el('span', 'muted small', 'Liegt direkt im Modpack, keine eigene Seite verlinkt.'));
    else { var a = ext(el('a', 'btn small', 'Modrinth '), 'https://modrinth.com/project/' + encodeURIComponent(m.id)); a.appendChild(el('span', 'arr', '↗')); links.appendChild(a); }
    (m.links || []).forEach(function (l) { var b = ext(el('a', 'btn small ghost', l.label + ' '), l.url); b.appendChild(el('span', 'arr', '↗')); links.appendChild(b); });
    c.appendChild(links);
    if (m.file) c.appendChild(el('p', 'mfile', m.file));
    return c;
  }

  function render() {
    var q = norm($('modSearch').value).trim(), words = q ? q.split(/\s+/) : [], box = $('modList'), shown = 0;
    box.textContent = '';
    doc.categories.forEach(function (c) {
      if (cat !== 'all' && cat !== c.id) return;
      var list = doc.mods.filter(function (m) {
        if (m.cat !== c.id) return false;
        var hay = norm(m.name + ' ' + m.text + ' ' + m.file + ' ' + c.name);
        return words.every(function (w) { return hay.indexOf(w) >= 0; });
      });
      if (!list.length) return;
      shown += list.length;
      var sec = el('section', 'hb-cat'), h = el('h3', '', c.name); h.appendChild(el('span', 'n', String(list.length))); sec.appendChild(h);
      if (c.text) sec.appendChild(el('p', 'muted ct', c.text));
      var grid = el('div', 'mods'); list.forEach(function (m) { grid.appendChild(card(m)); }); sec.appendChild(grid); box.appendChild(sec);
    });
    if (!shown) box.appendChild(el('p', 'muted', 'Keine passende Mod gefunden.'));
    $('modCount').textContent = shown === doc.mods.length ? doc.mods.length + ' Mods' : shown + ' von ' + doc.mods.length + ' Mods';
  }

  function chips() {
    var box = $('modCats'); box.textContent = '';
    [{ id: 'all', name: 'Alle' }].concat(doc.categories.filter(function (c) { return doc.mods.some(function (m) { return m.cat === c.id; }); })).forEach(function (c) {
      var n = c.id === 'all' ? doc.mods.length : doc.mods.filter(function (m) { return m.cat === c.id; }).length;
      var b = el('button', 'chip' + (c.id === cat ? ' on' : ''), c.name + ' '); b.type = 'button'; b.setAttribute('aria-pressed', String(c.id === cat));
      b.appendChild(el('small', '', String(n)));
      b.addEventListener('click', function () { cat = c.id; chips(); render(); });
      box.appendChild(b);
    });
  }

  fetch('mods.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
    doc = d;
    var p = d.pack || {}, f = $('packFacts');
    [['Modpack', p.version], ['Minecraft', p.minecraft], ['NeoForge', p.neoforge], ['Mods', String(d.mods.length)]].forEach(function (x) {
      if (!x[1]) return; var li = el('li'); li.appendChild(el('span', '', x[0])); li.appendChild(el('b', '', x[1])); f.appendChild(li);
    });
    $('packInfo').textContent = (p.name || 'Modpack') + ' ' + (p.version || '') + ' · Minecraft ' + (p.minecraft || '?') + ' · NeoForge ' + (p.neoforge || '?');
    chips(); render();
    $('modSearch').addEventListener('input', render);
    if (location.hash.indexOf('#mod-') === 0) { var t = document.getElementById(location.hash.slice(1)); if (t) { t.scrollIntoView(); t.classList.add('hit'); } }
  }).catch(function () { $('modList').textContent = ''; $('modList').appendChild(el('p', 'muted', 'Die Mod-Liste konnte nicht geladen werden.')); });
})();
