// Gaming-Profil, Ergaenzungen zur Buehne (gaming.js): Reiter "Statistik" (uebergreifend ueber alle getrackten Spiele),
// eigene Reiter (Spiele aus Launchern oder einzelne Steam-Spiele, mit eigenen Zahlen und Errungenschaften) und die
// Ausstellung der oeffentlichen Profile. Gaming.render ruft Gaming.extra(view) vor dem Setzen der Reiter auf.
(function () {
  'use strict';
  var G = window.Gaming, U = G.u, el = U.el, nf = U.nf, $ = function (id) { return document.getElementById(id); };
  var STEAM_CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps/';

  // ---------------------------------------------------------------- Statistik
  // Kacheln zur Auswahl (Editor: "Reiter & Statistik"); ohne Auswahl erscheinen alle, die Daten haben
  var STAT_KEYS = [
    ['hours', 'Gesamtspielzeit'], ['games', 'Spiele'], ['ach', 'Errungenschaften'], ['accounts', 'Verknüpfte Konten'],
    ['steam_hours', 'Steam-Spielzeit'], ['steam_games', 'Steam-Bibliothek'], ['steam_level', 'Steam-Level'],
    ['mc_hours', 'Minecraft (Cobblemon Server)'], ['custom_hours', 'Spiele aus Launchern'],
    ['val_hours', 'Valorant-Spielzeit'], ['val_rank', 'Bester Valorant-Rang'], ['val_kd', 'Valorant K/D'], ['val_win', 'Valorant-Siegquote'],
    ['value', 'Wert aller Konten'], ['top', 'Meistgespielt über alle Spiele'], ['platforms', 'Spielzeit nach Quelle']
  ];
  var ACC_GAMES = ['valorant', 'lol', 'minecraft', 'hoyoverse', 'roblox'];

  // Minecraft-Spielzeit vom Cobblemon Server (stats.json im Branch "data"; play_time in Ticks, 72.000 je Stunde)
  var mcStats = null;
  function mcHours(names) {
    if (!names.length) return Promise.resolve(null);
    if (!mcStats) mcStats = U.getJson(U.DATA_BASE + 'stats.json', { cache: 'no-cache' }).catch(function () { mcStats = null; return null; });
    return mcStats.then(function (d) {
      if (!d || !Array.isArray(d.players)) return null;
      var pt = ((d.stats || {})['minecraft:custom'] || {})['minecraft:play_time'] || [], sum = 0, found = false;
      names.forEach(function (n) {
        var i = d.players.map(function (p) { return String(p).toLowerCase(); }).indexOf(String(n).toLowerCase());
        if (i < 0) return;
        pt.forEach(function (row) { if (row[0] === i) { sum += row[1] / 72000; found = true; } });
      });
      return found ? Math.round(sum * 10) / 10 : null;
    });
  }

  function collect(v) {
    var steams = (v.steamList && v.steamList.length ? v.steamList.map(function (s) { return s.steam; }) : [v.steam]).filter(Boolean);
    var vals = (v.valList && v.valList.length ? v.valList.map(function (s) { return s.val; }) : [v.val]).filter(Boolean);
    var lib = {};   // appid -> Stunden (hoechster Wert ueber alle Steam-Konten)
    steams.forEach(function (s) { (s.library || []).forEach(function (g) { if (g && g.appid) lib[g.appid] = Math.max(lib[g.appid] || 0, g.hours || 0); }); });
    var custom = v.custom || [], ach = v.ach || {};
    var r = { steams: steams, vals: vals, lib: lib, custom: custom };
    r.steamHours = steams.reduce(function (a, s) { return a + (s.totalHours || 0); }, 0);
    r.steamGames = steams.reduce(function (a, s) { return a + (s.gameCount || 0); }, 0);
    r.steamLevel = steams.reduce(function (a, s) { return Math.max(a, s.level || 0); }, 0) || null;
    // Launcher-Spiele zaehlen mit eigener Spielzeit; Steam-Spiele stecken schon in der Steam-Spielzeit
    r.customHours = custom.filter(function (g) { return !g.appid; }).reduce(function (a, g) { return a + (+g.hours || 0); }, 0);
    var kinds = {}; (v.accounts || []).forEach(function (a) { var b = String(a.kind).replace(/-[2-5]$/, ''); if (a.in_sidebar !== false) kinds[b] = 1; });
    // Spielzeit aus Konten (Valorant, LoL, HoYoverse, Roblox): eigene Angabe oder bei Valorant die Schaetzung aus gp-sync
    var GA = window.GAccounts, acc = {};
    (v.accounts || []).forEach(function (a) {
      var b = String(a.kind).replace(/-[2-5]$/, ''), k = GA && GA.BY[b], h = GA && k && k.hours && a.in_sidebar !== false ? GA.hours(a, a.data) : null;
      if (!h) return;
      var e = acc[b] = acc[b] || { name: k.name, hours: 0, own: true, some: false, kind: b };
      e.hours += h.hours; if (!h.own) e.own = false; else e.some = true;
    });
    // Hinweis je Spiel: eigene Angabe, geschaetzt oder (bei mehreren Konten gemischt) teils geschaetzt
    Object.keys(acc).forEach(function (b) { var e = acc[b]; e.how = e.own ? 'eigene Angabe' : e.some ? 'teils geschätzt' : 'geschätzt, mind.'; });
    r.accGames = Object.keys(acc).map(function (b) { return acc[b]; });
    r.accHours = r.accGames.reduce(function (s, e) { return s + e.hours; }, 0);
    r.valHours = acc.valorant || null;
    r.accounts = (v.accounts || []).filter(function (a) { return a.in_sidebar !== false; }).length;
    // Launcher-Reiter zaehlen mit ihren Spielen (ohne die, die schon in der Steam-Bibliothek stehen)
    r.games = r.steamGames + custom.reduce(function (n, g) {
      if (g.launcher) return n + launcherGames(g).filter(function (x) { return !x.a || !lib[x.a]; }).length;
      return n + (!g.appid || !lib[g.appid] ? 1 : 0);
    }, 0) + ACC_GAMES.filter(function (k) { return kinds[k]; }).length;
    // Errungenschaften: Steam (live) fuer eigene Reiter mit appid, sonst die selbst eingetragenen
    r.achDone = 0; r.achAll = 0;
    custom.forEach(function (g) {
      var live = g.appid && ach[g.appid];
      if (live) { r.achDone += live.done || 0; r.achAll += live.total || 0; }
      else (g.achievements || []).forEach(function (a) { r.achAll++; if (a.done) r.achDone++; });
    });
    var best = null; vals.forEach(function (x) { if (x.rank && x.rank.tier > 2 && (!best || x.rank.tier > best.tier)) best = x.rank; });
    r.valBest = best; r.valMain = vals[0] || null;
    // Wert: Valorant-Skins (Katalog) und Steam-Bibliotheken, nur wenn freigegeben
    if (v.showValue !== false) {
      var w = 0, has = false;
      if (v.valSkins && v.valSkins.value && v.valSkins.value.eur > 0) { w += v.valSkins.value.eur; has = true; }
      steams.forEach(function (s) { if (s.value && s.value.eur > 0) { w += s.value.eur; has = true; } });
      r.value = has ? w : null;
    }
    // Meistgespielt ueber alle Quellen
    var top = [];
    Object.keys(lib).forEach(function (id) { var n = ''; steams.forEach(function (s) { (s.library || []).forEach(function (g) { if (String(g.appid) === id) n = g.name; }); }); if (lib[id] > 0) top.push({ name: n, hours: lib[id], appid: +id, src: 'Steam' }); });
    custom.forEach(function (g) {
      if (g.launcher) launcherGames(g).forEach(function (x) { if (+x.h > 0) top.push({ name: x.n, hours: +x.h, src: g.platform || 'Launcher', appid: x.a || undefined, image: x.i }); });
      else if (!g.appid && +g.hours > 0) top.push({ name: g.name, hours: +g.hours, src: g.platform || 'Launcher', image: g.image });
    });
    r.accGames.forEach(function (e) { top.push({ name: e.name, hours: e.hours, src: e.how, kind: e.kind }); });
    r.top = top.sort(function (a, b) { return b.hours - a.hours; });
    return r;
  }

  function bars(rows, unit) {
    var max = Math.max.apply(null, rows.map(function (x) { return x.hours; }).concat([1])), ul = el('ul', 'xbars');
    rows.forEach(function (x, i) {
      var li = el('li'); li.style.setProperty('--i', i);
      if (x.appid) li.appendChild(U.img(STEAM_CDN + x.appid + '/capsule_184x69.jpg', 'xb-im', ''));
      else if (x.image && U.safe(x.image)) li.appendChild(U.img(x.image, 'xb-im', ''));
      else li.appendChild(el('span', 'xb-im xb-ph', (x.name || '?').slice(0, 2).toUpperCase()));
      var t = el('span', 'xb-t'); t.appendChild(el('b', '', x.name || 'Unbekannt')); t.appendChild(el('small', '', U.fmtH(x.hours) + (x.src ? ' · ' + x.src : '') + (unit || '')));
      var bar = el('i', 'xb-bar'); bar.style.setProperty('--w', Math.max(3, Math.round(x.hours / max * 100)) + '%'); t.appendChild(bar);
      li.appendChild(t); ul.appendChild(li);
    });
    return ul;
  }

  function renderStats(v) {
    var box = $('xstats'), pk = $('pkStats'), note = $('statsNote'); if (!box) return;
    box.textContent = '';
    var r = collect(v), pick = v.statsPick && v.statsPick.length ? v.statsPick : null, want = function (k) { return !pick || pick.indexOf(k) >= 0; };
    var dl = el('dl', 'stats xstat-tiles');
    var tile = function (k, label, value, sub, dec, suf) { if (want(k) && value != null && value !== '' && !(typeof value === 'number' && !isFinite(value))) { var d = U.stat(label, value, sub, dec, suf); d.setAttribute('data-k', k); dl.appendChild(d); return d; } return null; };
    var mcNames = (v.mcNames || []).filter(Boolean);
    var baseH = r.steamHours + r.customHours + r.accHours, srcOf = function (mc) { return [r.steamHours ? 'Steam' : '', r.accHours ? r.accGames.map(function (e) { return e.name; }).join(', ') : '', r.customHours ? 'Launcher' : '', mc ? 'Minecraft' : ''].filter(Boolean).join(', '); };
    var hoursTile = tile('hours', 'Gesamtspielzeit', Math.round(baseH) || (mcNames.length ? 0 : null), srcOf(false) + (mcNames.length ? ' · Minecraft folgt …' : ''), 0, ' Std');
    tile('games', 'Spiele', r.games || null, 'über alle Plattformen');
    if (r.achAll) tile('ach', 'Errungenschaften', r.achDone, 'von ' + nf.format(r.achAll) + ' (' + Math.round(r.achDone / r.achAll * 100) + ' %)');
    tile('accounts', 'Verknüpfte Konten', r.accounts || null);
    if (r.steams.length) {
      tile('steam_hours', 'Steam-Spielzeit', Math.round(r.steamHours) || null, r.steams.length > 1 ? r.steams.length + ' Konten' : '', 0, ' Std');
      tile('steam_games', 'Steam-Bibliothek', r.steamGames || null, 'Spiele');
      tile('steam_level', 'Steam-Level', r.steamLevel);
    }
    var mcTile = mcNames.length && want('mc_hours') ? tile('mc_hours', 'Minecraft', '…', 'Cobblemon Server') : null;
    if (r.customHours) tile('custom_hours', 'Spiele aus Launchern', Math.round(r.customHours), r.custom.reduce(function (n, g) { return n + (g.launcher ? launcherGames(g).length : g.appid ? 0 : 1); }, 0) + ' Spiele', 0, ' Std');
    if (r.valBest) tile('val_rank', 'Bester Valorant-Rang', r.valBest.name, r.vals.length > 1 ? 'über ' + r.vals.length + ' Konten' : (r.valBest.rr + ' RR'));
    if (r.valHours) tile('val_hours', 'Valorant-Spielzeit', Math.round(r.valHours.hours), r.valHours.own ? 'eigene Angabe' : '≈ ' + r.valHours.how, 0, ' Std');
    if (r.valMain && r.valMain.stats) { tile('val_kd', 'Valorant K/D', r.valMain.stats.kd, r.valMain.stats.matches + ' Spiele', 2); tile('val_win', 'Valorant-Siegquote', r.valMain.stats.winrate, '', 0, ' %'); }
    if (r.value != null) tile('value', 'Wert aller Konten', Math.round(r.value), 'grobe Schätzung', 0, ' €');
    if (dl.children.length) box.appendChild(dl);

    // Spielzeit nach Quelle und Meistgespielt ueber alle
    var srcRows = [];
    if (r.steamHours) srcRows.push({ name: 'Steam', hours: r.steamHours });
    if (r.customHours) srcRows.push({ name: 'Launcher und andere', hours: r.customHours });
    r.accGames.forEach(function (e) { srcRows.push({ name: e.name + (e.own ? '' : ' (' + e.how + ')'), hours: e.hours }); });
    var plat = null;
    if (want('platforms') && srcRows.length) { plat = el('section', 'xsec'); plat.appendChild(el('h3', '', 'Spielzeit nach Quelle')); plat.appendChild(bars(srcRows)); box.appendChild(plat); }
    if (want('top') && r.top.length) { var t = el('section', 'xsec'); t.appendChild(el('h3', '', 'Meistgespielt über alle Spiele')); t.appendChild(bars(r.top.slice(0, 10))); box.appendChild(t); }
    if (!box.children.length) box.appendChild(U.emptyPage('Noch keine Statistik', v.mine ? 'Verknüpfe Steam oder leg eigene Reiter für Spiele aus Launchern an, dann erscheinen hier Spielzeit, Spiele und Errungenschaften über alles.' : 'Hier gibt es noch keine Zahlen.', U.editLink('Reiter anlegen')));
    var total = baseH;
    pk.textContent = total ? nf.format(Math.round(total)) + ' Std gesamt' : 'Alle Spiele';
    note.textContent = r.valMain && !r.valHours && v.mine ? 'Valorant liefert keine Gesamtspielzeit; trag sie im Editor beim Konto ein (z. B. von tracker.gg).' : '';
    U.countUp(box);
    // Minecraft-Spielzeit kommt nach (Server-Statistik)
    if (mcNames.length) mcHours(mcNames).then(function (h) {
      if (U.view() !== v) return;
      if (mcTile) { mcTile.querySelector('dd b').textContent = h != null ? nf.format(Math.round(h)) + ' Std' : '–'; if (h == null) mcTile.querySelector('dd').appendChild(el('small', '', 'nicht auf dem Server gefunden')); }
      if (hoursTile) {
        var sum = Math.round(baseH + (h || 0)), b = hoursTile.querySelector('dd b'), s = hoursTile.querySelector('dd small');
        b.textContent = nf.format(sum) + ' Std'; b.setAttribute('data-count', sum);
        if (s) s.textContent = srcOf(!!h);
        // die Reiterleiste wird beim Zeichnen neu gebaut: Zeile frisch holen
        if ($('pkStats')) $('pkStats').textContent = sum ? nf.format(sum) + ' Std gesamt' : 'Alle Spiele';
      }
      if (h && plat) { srcRows.push({ name: 'Minecraft (Cobblemon Server)', hours: h }); plat.replaceChild(bars(srcRows), plat.querySelector('ul')); }
    });
  }

  // ---------------------------------------------------------------- Eigene Reiter
  function hue(s) { var h = 0; String(s).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return h; }
  function colorOf(g) { return 'hsl(' + hue(g.name + (g.platform || '')) + ' 72% 60%)'; }
  function achPage(list, live) {
    if (!list.length) return null;
    var done = list.filter(function (a) { return a.done; }).length, wrap = el('div', 'ach-wrap');
    var head = el('div', 'ach-head'); head.appendChild(el('b', '', done + ' von ' + list.length + ' geschafft'));
    var bar = el('div', 'rr-bar'), fill = el('i'); fill.style.setProperty('--w', Math.round(done / list.length * 100) + '%'); bar.appendChild(fill); head.appendChild(bar);
    if (live) head.appendChild(el('small', 'muted', 'Live von Steam'));
    wrap.appendChild(head);
    var mode = 'all', seg = el('div', 'skin-filter'), ul = el('ul', 'ach-list');
    [['all', 'Alle'], ['done', 'Geschafft'], ['open', 'Offen']].forEach(function (m) {
      var b = el('button', 'chip' + (m[0] === mode ? ' on' : ''), m[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(m[0] === mode));
      b.addEventListener('click', function () { mode = m[0]; Array.prototype.forEach.call(seg.children, function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); paint(); });
      seg.appendChild(b);
    });
    function paint() {
      ul.textContent = '';
      list.filter(function (a) { return mode === 'all' || (mode === 'done') === !!a.done; }).slice(0, 200).forEach(function (a) {
        var li = el('li', a.done ? 'done' : 'open');
        if (a.i && U.safe(a.i)) li.appendChild(U.img(a.i, 'ach-ic', '')); else li.appendChild(el('span', 'ach-ic ach-ph', a.done ? '🏆' : '🔒'));
        var t = el('span', 'ach-t'); t.appendChild(el('b', '', a.n)); if (a.d) t.appendChild(el('small', '', a.d)); li.appendChild(t);
        li.appendChild(el('span', 'ach-at', a.done ? (a.at ? new Date(a.at).toLocaleDateString('de-DE') : '✓') : ''));
        ul.appendChild(li);
      });
      if (!ul.children.length) ul.appendChild(el('li', 'muted', 'Keine Einträge.'));
    }
    wrap.appendChild(seg); paint(); wrap.appendChild(ul);
    return wrap;
  }
  // Launcher-Reiter (gp_custom_games.launcher): Bibliothek des Launchers wie bei Steam, Cover ueber die Steam-appid
  function launcherGames(g) { return (g.games || []).filter(function (x) { return x && x.n; }); }
  function launcherPanel(g, v, p) {
    var GA = window.GAccounts, L = GA ? GA.launcher(g.platform) : { name: g.platform, short: 'LA', color: '#8395a7', kind: '' };
    var list = launcherGames(g), hours = list.reduce(function (s, x) { return s + (+x.h || 0); }, 0), withH = list.filter(function (x) { return +x.h > 0; });
    p.style.setProperty('--lc', L.color);
    // Figur: drei Cover gefaechert, sonst das Zeichen des Launchers
    var fig = el('div', 'fig'); fig.setAttribute('data-fig', 'launcher');
    var covers = list.filter(function (x) { return x.a || U.safe(x.i); }).slice(0, 3);
    if (covers.length) {
      var fan = el('div', 'l-fan n' + covers.length);
      covers.forEach(function (x, i) {
        var card = el('figure', 'hero-card in'), im = el('img'); im.alt = x.n; im.src = U.safe(x.i) ? x.i : STEAM_CDN + x.a + '/library_600x900.jpg';
        im.onerror = function () { if (x.a && !card.classList.contains('wide')) { card.classList.add('wide'); im.src = STEAM_CDN + x.a + '/header.jpg'; } else card.remove(); };
        card.style.setProperty('--k', i); card.appendChild(im); fan.appendChild(card);
      });
      fig.appendChild(fan);
    } else { var mark = el('div', 'custom-ph l-mark', L.short); mark.setAttribute('aria-hidden', 'true'); fig.appendChild(mark); }
    var fn = el('p', 'fig-name'); fn.appendChild(el('b', '', g.name)); fn.appendChild(el('span', '', 'Launcher · ' + list.length + (list.length === 1 ? ' Spiel' : ' Spiele'))); fig.appendChild(fn);
    p.appendChild(fig);
    var info = el('div', 'info'), head = el('div', 'info-head'), h2 = el('h2');
    var badge = U.accBadge({ short: L.short, color: L.color, name: L.name }); h2.appendChild(badge); h2.appendChild(document.createTextNode(' ' + g.name)); head.appendChild(h2);
    // Profil-Link, wenn ein passendes Konto verknuepft ist
    var acc = L.kind && (v.accounts || []).filter(function (a) { return GA.base(a.kind) === L.kind; })[0], url = acc ? GA.link(acc, acc.data) : '';
    if (url) { var a = U.ext(el('a', 'more-link', 'Profil '), url); a.appendChild(el('span', 'arr', '↗')); head.appendChild(a); }
    info.appendChild(head);
    var tabs = el('div', 'subtabs'); tabs.id = 'ct-' + g.id; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', g.name + ': Ansicht'); tabs.hidden = true;
    var pages = el('div', 'pages'); pages.id = 'cp-' + g.id;
    info.appendChild(tabs); info.appendChild(pages); p.appendChild(info);
    // Bibliothek: meistgespielte zuerst, wie die Steam-Listen
    var lib = null;
    if (list.length) {
      lib = el('div', 'games'); var max = Math.max.apply(null, list.map(function (x) { return +x.h || 0; })) || 1;
      list.slice().sort(function (a, b) { return (+b.h || 0) - (+a.h || 0) || String(a.n).localeCompare(String(b.n), 'de'); }).forEach(function (x, n) {
        var card = x.a ? U.ext(el('a', 'game'), 'https://store.steampowered.com/app/' + x.a) : el('div', 'game'), im = el('div', 'im'); card.style.setProperty('--i', n);
        if (x.a || U.safe(x.i)) { var i = el('img'); i.src = U.safe(x.i) ? x.i : U.header(x.a); i.alt = ''; i.loading = 'lazy'; i.onerror = function () { i.replaceWith(el('span', 'game-ph', String(x.n).slice(0, 2).toUpperCase())); }; im.appendChild(i); }
        else im.appendChild(el('span', 'game-ph', String(x.n).slice(0, 2).toUpperCase()));
        card.appendChild(im);
        var d = el('div', 't'); d.appendChild(el('b', '', x.n));
        if (+x.h > 0) { d.appendChild(el('span', '', U.fmtH(+x.h) + ' gespielt')); var bar = el('div', 'rr-bar'), fill = el('i'); fill.style.setProperty('--w', Math.max(4, Math.round(+x.h / max * 100)) + '%'); bar.appendChild(fill); d.appendChild(bar); }
        else d.appendChild(el('span', '', 'auf ' + L.name));
        card.appendChild(d); lib.appendChild(card);
      });
    }
    var over = el('div'), dl = el('dl', 'stats');
    if (list.length) dl.appendChild(U.stat('Spiele', list.length));
    if (hours > 0) dl.appendChild(U.stat('Spielzeit', Math.round(hours), withH.length < list.length ? 'bei ' + withH.length + ' Spielen eingetragen' : 'alle Spiele', 0, ' Std'));
    var top = withH.slice().sort(function (a, b) { return b.h - a.h; })[0];
    if (top) dl.appendChild(U.stat('Meistgespielt', top.n, U.fmtH(+top.h)));
    (g.stats || []).forEach(function (s) { if (s && s.l) dl.appendChild(U.stat(s.l, String(s.v || '–'))); });
    if (dl.children.length) over.appendChild(dl);
    else over.appendChild(U.emptyPage('', v.mine ? 'Trag im Editor die Spiele ein, die du auf ' + L.name + ' hast, gern mit Spielzeit.' : 'Hier stehen noch keine Spiele.', U.editLink('Spiele eintragen')));
    var achList = g.achievements || [];
    U.setPages(tabs.id, pages.id, [{ id: 'lib', title: 'Bibliothek', node: lib, count: list.length || null }, { id: 'over', title: 'Überblick', node: over },
      { id: 'ach', title: 'Errungenschaften', node: achList.length ? achPage(achList, false) : null, count: achList.length || null }]);
    return { key: 'c-' + g.id, title: g.name, sub: hours ? U.fmtH(hours) : list.length + (list.length === 1 ? ' Spiel' : ' Spiele'), color: L.color, word: g.name.toUpperCase(), short: L.short };
  }
  function customPanel(g, v) {
    var key = 'c-' + g.id, p = $('p-' + key), live = g.appid && v.ach ? v.ach[g.appid] : null;
    if (!p) {
      p = el('article', 'panel panel-custom'); p.id = 'p-' + key; p.setAttribute('data-game', key); p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', 'tab-' + key); p.hidden = true;
      $('p-team').before(p);
    }
    p.textContent = ''; p.classList.toggle('panel-launcher', !!g.launcher); p.style.removeProperty('--lc');
    if (g.launcher) return launcherPanel(g, v, p);
    var fig = el('div', 'fig'); fig.setAttribute('data-fig', 'custom');
    var src = U.safe(g.image) ? g.image : g.appid ? STEAM_CDN + g.appid + '/library_600x900.jpg' : '';
    if (src) {
      var card = el('figure', 'hero-card in'), im = el('img'); im.alt = g.name; im.src = src;
      im.onerror = function () { if (g.appid && !card.classList.contains('wide')) { card.classList.add('wide'); im.src = STEAM_CDN + g.appid + '/header.jpg'; } else { card.replaceWith(ph()); } };
      card.appendChild(im); card.appendChild(el('i', 'hero-shine')); fig.appendChild(card);
    } else fig.appendChild(ph());
    function ph() { var d = el('div', 'custom-ph', g.name.slice(0, 2).toUpperCase()); d.setAttribute('aria-hidden', 'true'); return d; }
    var fn = el('p', 'fig-name'); fn.appendChild(el('b', '', g.name)); fn.appendChild(el('span', '', g.platform || (g.appid ? 'Steam' : 'Eigenes Spiel'))); fig.appendChild(fn);
    p.appendChild(fig);
    var info = el('div', 'info'), head = el('div', 'info-head'); head.appendChild(el('h2', '', g.name));
    if (g.appid) { var a = U.ext(el('a', 'more-link', 'Im Steam-Shop '), 'https://store.steampowered.com/app/' + g.appid); a.appendChild(el('span', 'arr', '↗')); head.appendChild(a); }
    info.appendChild(head);
    var tabs = el('div', 'subtabs'); tabs.id = 'ct-' + g.id; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', g.name + ': Ansicht'); tabs.hidden = true;
    var pages = el('div', 'pages'); pages.id = 'cp-' + g.id;
    info.appendChild(tabs); info.appendChild(pages); p.appendChild(info);
    // Ueberblick: Spielzeit (bei Steam-Spielen aus der Bibliothek), Plattform, eigene Zahlen
    var hours = g.appid && v.libHours && v.libHours[g.appid] != null ? v.libHours[g.appid] : g.hours != null ? +g.hours : null;
    var achList = live && live.list ? live.list : (g.achievements || []);
    var over = el('div'), dl = el('dl', 'stats');
    if (hours != null) dl.appendChild(U.stat('Spielzeit', Math.round(hours * 10) / 10, g.appid && v.libHours && v.libHours[g.appid] != null ? 'laut Steam' : '', hours % 1 ? 1 : 0, ' Std'));
    if (achList.length) { var dn = live ? live.done : achList.filter(function (x) { return x.done; }).length, all = live ? live.total : achList.length; dl.appendChild(U.stat('Errungenschaften', dn, 'von ' + all)); }
    (g.stats || []).forEach(function (s) { if (s && s.l) { var n = Number(String(s.v).replace(',', '.')); dl.appendChild(U.stat(s.l, isFinite(n) && String(s.v).trim() !== '' && /^-?[\d.,]+$/.test(String(s.v).trim()) ? n : String(s.v || '–'), '', (String(s.v).split(/[.,]/)[1] || '').length)); } });
    if (dl.children.length) over.appendChild(dl);
    else over.appendChild(U.emptyPage('', v.mine ? 'Trag im Editor Spielzeit, eigene Zahlen (z. B. Rang, Level, Siege) und Errungenschaften ein.' : 'Hier stehen noch keine Zahlen.', U.editLink('Reiter bearbeiten')));
    U.setPages(tabs.id, pages.id, [{ id: 'over', title: 'Überblick', node: over }, { id: 'ach', title: 'Errungenschaften', node: achPage(achList, !!live), count: achList.length || null }]);
    return { key: key, title: g.name, sub: hours ? U.fmtH(hours) : g.platform || 'Eigenes Spiel', color: colorOf(g), word: g.name.toUpperCase(),
      short: g.name.split(/[\s:-]+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || g.name.slice(0, 2).toUpperCase() };
  }
  function renderCustom(v) {
    var want = {}, out = [];
    (v.custom || []).forEach(function (g) { if (g && g.id) { want['p-c-' + g.id] = 1; out.push(customPanel(g, v)); } });
    Array.prototype.forEach.call(document.querySelectorAll('.panel-custom'), function (p) { if (!want[p.id]) p.remove(); });
    G.customTabs = out;
  }

  G.extra = function (v) { renderCustom(v); renderStats(v); };
  G.STAT_KEYS = STAT_KEYS;
  G.colorOf = colorOf;

  // ---------------------------------------------------------------- Ausstellung (oeffentliche Profile)
  // list: Ergebnis von gp_showcase; onOpen(id) oeffnet ein Profil
  G.showcase = function (box, list, onOpen) {
    box.textContent = '';
    var head = el('div', 'sc-head'); head.appendChild(el('h2', '', 'Ausstellung'));
    head.appendChild(el('p', 'muted', 'Öffentliche Gaming-Profile aller, die eins haben. Spielernamen sind dort gekürzt, Konten-Werte bleiben verborgen.'));
    box.appendChild(head);
    var grid = el('div', 'sc-grid'), GA = window.GAccounts;
    list.forEach(function (p, i) {
      var c = el('button', 'sc-card' + (p.me ? ' me' : '')); c.type = 'button'; c.style.setProperty('--c', p.color); c.style.setProperty('--i', Math.min(i, 12));
      var cov = el('div', 'sc-cov');
      (p.games || []).slice(0, 3).forEach(function (g) { cov.appendChild(U.img(STEAM_CDN + g.appid + '/library_600x900.jpg', '', '')); });
      if (!cov.children.length) cov.classList.add('empty');
      c.appendChild(cov);
      var who = el('div', 'sc-who'), av = el('span', 'av big', p.avatar); av.style.setProperty('--c', p.color); who.appendChild(av);
      var t = el('div'); t.appendChild(el('b', '', p.me ? p.name + ' (du)' : p.name)); if (p.tagline) t.appendChild(el('span', 'muted', p.tagline)); who.appendChild(t); c.appendChild(who);
      var kinds = el('div', 'gs-kinds'); (p.kinds || []).forEach(function (k) { var d = GA && GA.BY[k]; if (d) kinds.appendChild(U.accBadge(d)); }); if (kinds.children.length) c.appendChild(kinds);
      var facts = [p.hours ? nf.format(Math.round(p.hours)) + ' Std' : '', (p.custom || []).length ? (p.custom || []).join(', ') : '',
        p.tier === 'friend' ? 'Freund' : p.tier === 'known' ? 'Bekannt' : ''].filter(Boolean);
      if (facts.length) c.appendChild(el('small', 'sc-facts muted', facts.join(' · ')));
      c.addEventListener('click', function () { onOpen(p.id); });
      grid.appendChild(c);
    });
    box.appendChild(grid);
    if (list.length < 2) box.appendChild(el('p', 'muted', 'Noch ist hier wenig los. Sobald andere ihr öffentliches Profil einschalten, erscheinen sie hier.'));
  };
})();
