// Weitere Bereiche des Gaming-Editors (editor.js ruft sie ueber window.EditorExtra auf):
//   oeffentlich  Oeffentliches Profil (eigener Spruch, Empfehlungen), wer welchen Bereich sieht, Bekannte (Anfragen) und Kreise
//   reiter       Reihenfolge und Sichtbarkeit der Reiter, Statistik-Kacheln, eigene Reiter (Spiele aus Launchern, Steam-Spiele)
//                mit eigenen Zahlen und Errungenschaften
//   account      Skeison Account: Name, Avatar, Farbe, Passwort (gilt auch fuer die Wunschliste)
(function () {
  'use strict';
  var E = window.Editor._, $ = E.$, $$ = E.$$, esc = E.esc, toast = E.toast, busy = E.busy, errText = E.errText;
  function say(m, cls, t) { m.className = 'msg ' + cls; m.textContent = t; m.hidden = false; }
  function st() { return E.st; }

  // ---------------------------------------------------------------- Oeffentlich & Bekannte
  var SECTIONS = [['val', 'Valorant', 'Rang, Statistik, Skins und Lieblingsagent'], ['steam', 'Steam', 'Spielzeiten, Bibliothek und Lieblingsspiele'],
    ['mc', 'Minecraft', 'Skins und Lieblingsserver'], ['stats', 'Statistik', 'Gesamtspielzeit und Zahlen über alle Spiele'],
    ['value', 'Wert der Konten', 'geschätzter Wert von Skins und Spielen in Euro']];
  async function friendsAndKnown() {
    var r = await Promise.all([
      Api.get('wl_friendships', 'status=eq.accepted&select=requester,addressee'),
      Api.get('wl_profiles', 'select=id,name,avatar,color,avatar_url&id=neq.' + st().me),
      Api.rpc('gp_known_list')
    ]);
    var ids = {}; r[0].forEach(function (f) { ids[f.requester === st().me ? f.addressee : f.requester] = 'friend'; });
    var people = r[1].filter(function (p) { return ids[p.id]; }).map(function (p) { return Object.assign({ rel: 'Freund' }, p); });
    (r[2] || []).forEach(function (k) { if (k.state === 'known' && !ids[k.id]) people.push({ id: k.id, name: k.name, avatar: k.avatar, avatar_url: k.avatar_url, color: k.color, rel: 'Bekannt' }); });
    people.sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    return { people: people, known: r[2] || [] };
  }
  function av(p) { var G = window.Gaming && window.Gaming.u; return G ? G.avatar(p).outerHTML : '<i class="av" style="--c:' + esc(p.color) + '">' + esc(p.avatar) + '</i>'; }

  function oeffentlich(body) {
    var S = st(), pub = S.p.public || { enabled: false, tagline: '' }, aud = (S.p.profile && S.p.profile.audience) || {};
    body.innerHTML =
      '<form class="gform ecard" id="fPub" novalidate><h3>Öffentliches Profil</h3>' +
      '<p class="muted">Ein eigenes, abgespecktes Profil für alle mit Skeison Account, die selbst ein öffentliches Profil haben. Nur sie sehen dich in der <b>Ausstellung</b>, und du siehst nur dann die Ausstellung. Dein Freundes-Profil bleibt davon unberührt.</p>' +
      '<label class="pick"><input type="checkbox" name="enabled"' + (pub.enabled ? ' checked' : '') + '><span>Öffentliches Profil zeigen</span></label>' +
      '<label>Spruch im öffentlichen Profil<input name="tagline" maxlength="120" value="' + esc(pub.tagline) + '" placeholder="z. B. Suche Leute für Ranked am Abend"></label>' +
      '<ul class="recs"><li>✓ Spielernamen erscheinen gekürzt (Sk•••#•••). Ungekürzt nur, wenn du es je Konto einschaltest.</li><li>✓ Kein Gesamtwert von Skins und Spielen in Euro.</li><li>✓ Links zu Profilen und IDs fallen weg.</li></ul>' +
      '<p class="msg" hidden></p><div class="dlg-actions start"><button class="btn" type="submit">Speichern</button></div></form>' +
      '<form class="gform ecard" id="fAud" novalidate><h3>Wer sieht welchen Bereich?</h3>' +
      '<p class="muted small">Öffentlich: alle mit öffentlichem Profil, dazu Bekannte und Freunde. Bekannte: Gaming-Bekannte (keine Freunde in der Wunschliste) und Freunde. Kreise legst du unten an. Konten stellst du einzeln unter „Konten“ ein, eigene Reiter unter „Reiter & Statistik“.</p>' +
      '<div class="aud-list">' + SECTIONS.map(function (s) {
        return '<label class="aud-row"><span><b>' + esc(s[1]) + '</b><small class="muted">' + esc(s[2]) + '</small></span>' + E.audSel('a_' + s[0], aud[s[0]] || 'friends', 'Wer sieht ' + s[1] + '?') + '</label>'; }).join('') + '</div>' +
      '<p class="msg warn" data-warn hidden>Empfehlung: Den Wert deiner Konten nicht öffentlich zeigen, sondern höchstens Bekannten oder einem Kreis.</p>' +
      '<p class="msg" data-m hidden></p><div class="dlg-actions start"><button class="btn" type="submit">Speichern</button></div></form>' +
      '<section class="ecard"><h3>Bekannte</h3><p class="muted">Bekannte sind keine Freunde in der Wunschliste. Sie sehen, was du für Bekannte freigibst (z. B. den Wert deiner Konten oder mehr Statistiken). Anfragen schickst du auf einem öffentlichen Profil in der Ausstellung („Als Bekannte anfragen“).</p><div class="known-list"><p class="muted">Lädt …</p></div></section>' +
      '<section class="ecard"><h3>Kreise</h3><p class="muted">Eigene Gruppen nur fürs Gaming-Profil, aus Freunden und Bekannten. Damit teilst du einzelne Konten, Bereiche oder Reiter nur mit dieser Gruppe.</p><div class="circle-list"><p class="muted">Lädt …</p></div>' +
      '<div class="dlg-actions start"><button type="button" class="btn ghost small" data-new-circle>+ Neuer Kreis</button></div><div class="circle-form"></div></section>';

    // Oeffentliches Profil
    var fp = $('#fPub', body), dp = E.keepDraft(fp, 'pub', function () { E.show('oeffentlich'); });
    fp.addEventListener('submit', async function (e) {
      e.preventDefault(); var m = $('.msg', fp);
      try {
        await busy($('button[type="submit"]', fp), function () { return Api.rpc('gp_set_public', { p_enabled: fp.enabled.checked, p_tagline: fp.tagline.value.trim().slice(0, 120) }); });
        S.p.public = { enabled: fp.enabled.checked, tagline: fp.tagline.value.trim() }; S.changed = true; dp.saved();
        say(m, 'ok', fp.enabled.checked ? 'Gespeichert. Du erscheinst jetzt in der Ausstellung und kannst sie sehen.' : 'Gespeichert. Dein öffentliches Profil ist aus.');
      } catch (err) { say(m, 'err', errText(err)); }
    });
    // Publikum der Bereiche
    var fa = $('#fAud', body), da = E.keepDraft(fa, 'aud', function () { E.show('oeffentlich'); });
    var warn = function () { $('[data-warn]', fa).hidden = fa.a_value.value !== 'public'; };
    fa.addEventListener('change', warn); warn();
    fa.addEventListener('submit', async function (e) {
      e.preventDefault(); var m = $('[data-m]', fa), a = {};
      SECTIONS.forEach(function (s) { a[s[0]] = fa['a_' + s[0]].value; });
      try { await busy($('button[type="submit"]', fa), function () { return E.saveProfile({ audience: a }); }); da.saved(); say(m, 'ok', 'Gespeichert. Oben bei „Ansehen als“ prüfst du, wie es für andere aussieht.'); }
      catch (err) { say(m, 'err', errText(err)); }
    });
    E.circles().then(function (cs) {
      if (!cs.length || !st() || st().tab !== 'oeffentlich') return;
      $$('select.aud', fa).forEach(function (s) { var n = document.createElement('div'); n.innerHTML = E.audSel(s.name, s.value, s.getAttribute('aria-label')); s.replaceWith(n.firstChild); });
    });

    // Bekannte und Kreise
    var kl = $('.known-list', body), cl = $('.circle-list', body), cf = $('.circle-form', body), data = null;
    function paintKnown() {
      var k = data.known, rows = k.map(function (x) {
        var act = x.state === 'received' ? '<button type="button" class="btn small" data-acc="' + x.id + '">Annehmen</button><button type="button" class="link-btn" data-dec="' + x.id + '">Ablehnen</button>'
          : x.state === 'sent' ? '<span class="muted small">Anfrage gesendet</span><button type="button" class="link-btn" data-rm="' + x.id + '">Zurückziehen</button>'
          : '<span class="muted small">Bekannt' + (x.friend ? ' · auch Freund' : '') + '</span><button type="button" class="link-btn danger-text" data-rm="' + x.id + '">Entfernen</button>';
        return '<li>' + av(x) + '<b>' + esc(x.name) + '</b><span class="k-act">' + act + '</span></li>';
      });
      kl.innerHTML = rows.length ? '<ul class="people-list">' + rows.join('') + '</ul>' : '<p class="muted">Noch keine Bekannten und keine offenen Anfragen.</p>';
    }
    kl.addEventListener('click', async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.acc) await busy(b, function () { return Api.rpc('gp_known_answer', { p_user: b.dataset.acc, p_accept: true }); });
        else if (b.dataset.dec) await busy(b, function () { return Api.rpc('gp_known_answer', { p_user: b.dataset.dec, p_accept: false }); });
        else if (b.dataset.rm) await busy(b, function () { return Api.rpc('gp_known_remove', { p_user: b.dataset.rm }); });
        st().changed = true; load();
      } catch (err) { toast(errText(err)); }
    });
    function paintCircles(cs) {
      cl.innerHTML = cs.length ? '<ul class="people-list">' + cs.map(function (c) {
        return '<li><span class="c-emo">' + esc(c.emoji) + '</span><b>' + esc(c.name) + '</b><small class="muted">' + c.members.length + (c.members.length === 1 ? ' Mitglied' : ' Mitglieder') + '</small>' +
          '<span class="k-act"><button type="button" class="link-btn" data-edit="' + c.id + '">Bearbeiten</button><button type="button" class="link-btn danger-text" data-del="' + c.id + '">Löschen</button></span></li>'; }).join('') + '</ul>'
        : '<p class="muted">Noch keine Kreise.</p>';
    }
    function circleForm(c) {
      var sel = c ? c.members : [];
      cf.innerHTML = '<form class="gform circle-edit" novalidate><div class="row2"><label>Emoji<input name="emoji" maxlength="8" value="' + esc(c ? c.emoji : '👥') + '"></label><label>Name<input name="name" maxlength="30" required value="' + esc(c ? c.name : '') + '" placeholder="z. B. Ranked-Team"></label></div>' +
        '<p class="small"><b>Mitglieder</b> <span class="muted">(Freunde und Bekannte)</span></p>' +
        (data.people.length ? '<div class="pick-list">' + data.people.map(function (p) {
          return '<label class="pick"><input type="checkbox" name="m" value="' + p.id + '"' + (sel.indexOf(p.id) >= 0 ? ' checked' : '') + '><span>' + av(p) + ' ' + esc(p.name) + ' <small class="muted">' + p.rel + '</small></span></label>'; }).join('') + '</div>'
          : '<p class="muted">Noch keine Freunde oder Bekannten.</p>') +
        '<p class="msg" hidden></p><div class="dlg-actions start"><button class="btn small" type="submit">' + (c ? 'Speichern' : 'Kreis anlegen') + '</button><button type="button" class="link-btn" data-cancel>Abbrechen</button></div></form>';
      var f = $('form', cf);
      $('[data-cancel]', f).addEventListener('click', function () { cf.textContent = ''; });
      f.addEventListener('submit', async function (e) {
        e.preventDefault(); var m = $('.msg', f);
        if (!f.name.value.trim()) return say(m, 'err', 'Bitte einen Namen eintragen.');
        try {
          await busy($('button[type="submit"]', f), function () {
            return Api.rpc('gp_set_circle', { p_id: c ? c.id : null, p_name: f.name.value.trim().slice(0, 30), p_emoji: f.emoji.value.trim() || '👥', p_members: $$('input[name="m"]:checked', f).map(function (x) { return x.value; }) });
          });
          cf.textContent = ''; st().circlesP = null; st().changed = true; toast(c ? 'Kreis gespeichert' : 'Kreis angelegt'); load();
        } catch (err) { say(m, 'err', errText(err)); }
      });
      f.name.focus();
    }
    var circleData = [];
    cl.addEventListener('click', async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.edit) circleForm(circleData.filter(function (c) { return c.id === b.dataset.edit; })[0]);
      else if (b.dataset.del) {
        if (!confirm('Kreis löschen? Was nur für diesen Kreis freigegeben war, sieht dann niemand mehr außer dir.')) return;
        try { await busy(b, function () { return Api.remove('gp_circles', 'id=eq.' + b.dataset.del); }); st().circlesP = null; st().changed = true; load(); }
        catch (err) { toast(errText(err)); }
      }
    });
    $('[data-new-circle]', body).addEventListener('click', function () { if (data) circleForm(null); });
    async function load() {
      try {
        var r = await Promise.all([friendsAndKnown(), Api.get('gp_circles', 'select=id,name,emoji&order=created_at'), Api.get('gp_circle_members', 'select=circle,member')]);
        if (!st() || st().tab !== 'oeffentlich') return;
        data = r[0];
        circleData = (r[1] || []).map(function (c) { return Object.assign({}, c, { members: (r[2] || []).filter(function (m) { return m.circle === c.id; }).map(function (m) { return m.member; }) }); });
        paintKnown(); paintCircles(circleData);
      } catch (err) { kl.innerHTML = '<p class="msg err">' + esc(errText(err)) + '</p>'; cl.textContent = ''; }
    }
    load();
  }

  // ---------------------------------------------------------------- Reiter & Statistik
  var BUILTIN = { val: 'Valorant', steam: 'Steam', mc: 'Minecraft', stats: 'Statistik', team: 'Zusammen spielen' };
  var PLATFORMS = ['Epic Games', 'Battle.net', 'EA App', 'Ubisoft Connect', 'Riot Client', 'HoYoPlay', 'GOG Galaxy', 'Rockstar Launcher', 'Xbox', 'PlayStation', 'Nintendo Switch', 'Mobil', 'Steam', 'Sonstiges'];
  function layoutOf(S) { var l = (S.p.profile && S.p.profile.layout) || {}; return { tabs: (l.tabs || []).slice(), hidden: (l.hidden || []).slice(), stats: l.stats ? l.stats.slice() : null }; }
  function orderOf(S, lay) {
    var all = ['val', 'steam', 'mc', 'stats'].concat((S.p.custom || []).map(function (g) { return 'c-' + g.id; })).concat(['team']);
    var order = lay.tabs.filter(function (k) { return all.indexOf(k) >= 0; });
    all.forEach(function (k) { if (order.indexOf(k) >= 0) return; var t = order.indexOf('team'); if (k !== 'team' && t >= 0) order.splice(t, 0, k); else order.push(k); });
    return order;
  }
  function reiter(body) {
    var S = st(), lay = layoutOf(S), restored = E.drafts().layout;
    if (restored && restored.tabs) lay = restored;
    var saver = E.autosaver('layout', function (d) { return E.ensureProfileOf(S).then(function () { return Api.upsert('gp_profiles', [{ id: S.me, layout: d, updated_at: new Date().toISOString() }]); }); },
      function (d) { if (S.p.profile) S.p.profile.layout = d; S.changed = true; });
    if (restored) saver.set(JSON.parse(JSON.stringify(lay)));
    var nameOf = function (k) { if (BUILTIN[k]) return BUILTIN[k]; var g = (S.p.custom || []).filter(function (x) { return 'c-' + x.id === k; })[0]; return g ? g.name : k; };
    body.innerHTML = '<section class="ecard"><h3>Reiter der Bühne</h3><p class="muted">Reihenfolge ändern und Reiter aus- oder einblenden. Was andere sehen dürfen, regelt zusätzlich „Wer sieht das?“. Speichert sich selbst.</p><ol class="tab-order"></ol></section>' +
      '<section class="ecard"><h3>Statistik-Kacheln</h3><p class="muted">Welche Zahlen der Reiter „Statistik“ zeigt (nur Kacheln mit Daten erscheinen).</p><div class="pick-list stat-pick"></div></section>' +
      '<section class="ecard"><h3>Deine Spiele als Reiter</h3><p class="muted">Ein Klick macht ein Spiel zum Reiter auf der Bühne (oder nimmt ihn wieder weg). Aus deiner Steam-Bibliothek und deinen Spiel-Konten; Spielzeit und Errungenschaften kommen bei Steam-Spielen live.</p>' +
      '<input type="search" class="game-q" placeholder="Spiel suchen" aria-label="Eigene Spiele durchsuchen"><div class="game-pick"></div></section>' +
      '<section class="ecard"><h3>Eigene Reiter</h3><p class="muted">Für Spiele, die es nur in Launchern gibt (Epic, Battle.net, HoYoPlay, Konsole …), oder für ein einzelnes Steam-Spiel mit Errungenschaften. Spielzeit, eigene Zahlen und Errungenschaften trägst du selbst ein; bei Steam-Spielen kommen Spielzeit und Errungenschaften live von Steam.</p>' +
      '<ul class="people-list custom-list"></ul><div class="dlg-actions start"><button type="button" class="btn ghost small" data-new>+ Spiel als Reiter</button><button type="button" class="btn ghost small" data-newl>+ Launcher mit Spielen</button></div><div class="custom-form"></div></section>';
    var ol = $('.tab-order', body), sp = $('.stat-pick', body);
    function changed() { saver.set(JSON.parse(JSON.stringify(lay))); }
    function paintOrder() {
      var order = orderOf(S, lay);
      ol.innerHTML = order.map(function (k, i) {
        var on = lay.hidden.indexOf(k) < 0;
        return '<li data-k="' + esc(k) + '"><label class="pick small"><input type="checkbox"' + (on ? ' checked' : '') + ' data-vis><span>' + esc(nameOf(k)) + '</span></label>' +
          '<span class="fav-act"><button type="button" class="link-btn" data-up aria-label="Nach oben"' + (i ? '' : ' disabled') + '>↑</button><button type="button" class="link-btn" data-down aria-label="Nach unten"' + (i < order.length - 1 ? '' : ' disabled') + '>↓</button></span></li>'; }).join('');
    }
    ol.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var order = orderOf(S, lay), k = b.closest('li').dataset.k, i = order.indexOf(k), j = b.hasAttribute('data-up') ? i - 1 : i + 1;
      if (j < 0 || j >= order.length) return;
      order.splice(j, 0, order.splice(i, 1)[0]); lay.tabs = order; paintOrder(); changed();
    });
    ol.addEventListener('change', function (e) {
      if (!e.target.hasAttribute('data-vis')) return;
      var k = e.target.closest('li').dataset.k;
      lay.hidden = lay.hidden.filter(function (x) { return x !== k; }); if (!e.target.checked) lay.hidden.push(k);
      if (orderOf(S, lay).every(function (x) { return lay.hidden.indexOf(x) >= 0; })) { e.target.checked = true; lay.hidden = lay.hidden.filter(function (x) { return x !== k; }); toast('Mindestens ein Reiter bleibt sichtbar.'); return; }
      changed();
    });
    var KEYS = window.Gaming.STAT_KEYS || [];
    sp.innerHTML = KEYS.map(function (s) { return '<label class="pick"><input type="checkbox" value="' + s[0] + '"' + (!lay.stats || lay.stats.indexOf(s[0]) >= 0 ? ' checked' : '') + '><span>' + esc(s[1]) + '</span></label>'; }).join('');
    sp.addEventListener('change', function () {
      var on = $$('input:checked', sp).map(function (x) { return x.value; });
      lay.stats = on.length === KEYS.length ? null : on; changed();
    });
    paintOrder();
    // eigene Reiter
    var cl = $('.custom-list', body), cf = $('.custom-form', body);
    function paintList() {
      var list = S.p.custom || [];
      cl.innerHTML = list.length ? list.map(function (g) {
        var L = g.launcher ? window.GAccounts.launcher(g.platform) : null, n = (g.games || []).length;
        return '<li>' + (L ? '<span class="c-emo l-badge" style="--c:' + esc(L.color) + '">' + esc(L.short) + '</span>' : '<span class="c-emo">🎮</span>') + '<b>' + esc(g.name) + '</b><small class="muted">' +
          esc([L ? 'Launcher' : g.platform, L ? n + (n === 1 ? ' Spiel' : ' Spiele') : '', g.appid ? 'Steam ' + g.appid : '', g.hours != null ? String(g.hours).replace('.', ',') + ' Std' : ''].filter(Boolean).join(' · ')) + '</small>' +
          '<span class="k-act"><button type="button" class="link-btn" data-edit="' + g.id + '">Bearbeiten</button><button type="button" class="link-btn danger-text" data-del="' + g.id + '">Löschen</button></span></li>'; }).join('')
        : '<li class="muted">Noch keine eigenen Reiter.</li>';
    }
    cl.addEventListener('click', async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.edit) gameForm((S.p.custom || []).filter(function (g) { return g.id === b.dataset.edit; })[0]);
      else if (b.dataset.del) {
        if (!confirm('Diesen Reiter mit allen Zahlen und Errungenschaften löschen?')) return;
        try {
          await busy(b, function () { return Api.remove('gp_custom_games', 'id=eq.' + b.dataset.del); });
          S.p.custom = S.p.custom.filter(function (g) { return g.id !== b.dataset.del; }); S.changed = true;
          lay.tabs = lay.tabs.filter(function (k) { return k !== 'c-' + b.dataset.del; }); lay.hidden = lay.hidden.filter(function (k) { return k !== 'c-' + b.dataset.del; }); changed();
          paintList(); paintOrder(); cf.textContent = '';
        } catch (err) { toast(errText(err)); }
      }
    });
    $('[data-new]', body).addEventListener('click', function () { gameForm(null); });
    $('[data-newl]', body).addEventListener('click', function () { gameForm(null, true); });

    // Deine Spiele: Steam-Bibliothek (alle Steam-Konten, nach Spielzeit) und Lieblingsspiele, dazu Spiel-Konten ohne eigenen Reiter
    var gp = $('.game-pick', body), gq = $('.game-q', body), GA = window.GAccounts;
    var ACC_GAME = { epic: ['Fortnite', 'Epic Games'], lol: ['League of Legends', 'Riot Client'], roblox: ['Roblox', 'Roblox'] };
    function candidates() {
      var out = [], seen = {}, c = S.p.cache || {};
      var add = function (g) { var k = g.appid ? 's' + g.appid : 'n' + g.name.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(g); } };
      (S.p.steam_favs || []).forEach(function (f) { add({ appid: f.appid, name: f.name, platform: 'Steam', fav: true }); });
      var lib = [];
      Object.keys(c).forEach(function (k) { if (/^steam(-[2-5])?$/.test(k) && c[k].data && c[k].data.library) lib = lib.concat(c[k].data.library); });
      lib.sort(function (a, b) { return (b.hours || 0) - (a.hours || 0); }).forEach(function (g) { add({ appid: g.appid, name: g.name, platform: 'Steam', hours: g.hours }); });
      // Launcher aus verknuepften Konten (Epic, Battle.net, EA, Ubisoft, GOG, Xbox …) als Launcher-Reiter mit Spieleliste
      (S.p.accounts || []).forEach(function (a) {
        var L = GA.LAUNCHERS.filter(function (l) { return l.kind && l.kind === GA.base(a.kind) && l.kind !== 'hoyoverse'; })[0];
        if (L && !seen['l' + L.name]) { seen['l' + L.name] = 1; out.unshift({ name: L.name, platform: L.name, launcher: true }); }
      });
      (S.p.accounts || []).forEach(function (a) {
        var b = GA.base(a.kind), x = a.extra || {};
        if (ACC_GAME[b]) add({ name: ACC_GAME[b][0], platform: ACC_GAME[b][1] });
        if (b === 'hoyoverse') { var g = (GA.BY.hoyoverse.games || []).filter(function (z) { return z[0] === (x.game || 'genshin'); })[0]; if (g) add({ name: g[1], platform: 'HoYoPlay' }); }
      });
      return out;
    }
    function existing(g) {
      return (S.p.custom || []).filter(function (x) {
        if (g.launcher) return x.launcher && String(x.platform).toLowerCase() === g.platform.toLowerCase();
        return !x.launcher && (g.appid ? x.appid === g.appid : !x.appid && x.name.toLowerCase() === g.name.toLowerCase());
      })[0];
    }
    function paintGames() {
      var q = gq.value.trim().toLowerCase(), all = candidates(), list = all.filter(function (g) { return !q || g.name.toLowerCase().indexOf(q) >= 0; });
      // ohne Suche: die gewaehlten und die 24 meistgespielten zeigen
      if (!q) list = list.filter(function (g, i) { return i < 24 || existing(g); });
      gp.innerHTML = list.length ? list.map(function (g, i) {
        var on = !!existing(g), L = g.launcher ? GA.launcher(g.platform) : null;
        return '<button type="button" class="gtile' + (on ? ' on' : '') + (L ? ' launcher' : '') + '" data-i="' + all.indexOf(g) + '" aria-pressed="' + on + '">' +
          (g.appid ? '<img src="https://cdn.cloudflare.steamstatic.com/steam/apps/' + g.appid + '/capsule_184x69.jpg" alt="" loading="lazy">'
            : L ? '<span class="gph l-badge" style="--c:' + esc(L.color) + '">' + esc(L.short) + '</span>' : '<span class="gph">' + esc(g.name.slice(0, 2).toUpperCase()) + '</span>') +
          '<span class="gt"><b>' + esc(g.name) + '</b><small>' + esc(L ? 'Launcher mit deinen Spielen' : [g.platform, g.hours ? String(Math.round(g.hours)) + ' Std' : '', g.fav ? '★' : ''].filter(Boolean).join(' · ')) + '</small></span>' +
          '<span class="gst" aria-hidden="true">' + (on ? '✓' : '+') + '</span></button>'; }).join('')
        : '<p class="muted">' + (all.length ? 'Nichts gefunden.' : 'Verknüpfe Steam oder Spiel-Konten (Epic, LoL, HoYoverse, Roblox), dann stehen deine Spiele hier zur Wahl.') + '</p>';
      gp._all = all;
    }
    gq.addEventListener('input', paintGames);
    gp.addEventListener('click', async function (e) {
      var b = e.target.closest('.gtile'); if (!b || b.disabled) return;
      var g = gp._all[+b.dataset.i], ex = existing(g);
      b.disabled = true;
      try {
        if (ex) {
          if (((ex.stats || []).length || (ex.achievements || []).length || (ex.games || []).length) && !confirm('„' + ex.name + '“ hat eingetragene Spiele, Zahlen oder Errungenschaften. Reiter trotzdem entfernen?')) return;
          await Api.remove('gp_custom_games', 'id=eq.' + ex.id);
          S.p.custom = S.p.custom.filter(function (x) { return x.id !== ex.id; });
          lay.tabs = lay.tabs.filter(function (k) { return k !== 'c-' + ex.id; }); changed();
          toast(g.name + ' ist kein Reiter mehr');
        } else {
          await E.ensureProfile();
          var row = { owner: S.me, name: g.name.slice(0, 60), platform: g.platform || '', appid: g.appid || null, image: '', hours: null, stats: [], achievements: [], audience: 'friends', sort: (S.p.custom || []).length };
          if (g.launcher) { row.launcher = true; row.games = []; }
          var rows = await Api.insert('gp_custom_games', [row]);
          if (rows && rows[0]) S.p.custom = (S.p.custom || []).concat([rows[0]]);
          toast(g.launcher ? g.name + ' ist jetzt ein Reiter. Trag unten deine Spiele ein.' : g.name + ' ist jetzt ein Reiter');
          if (g.launcher && rows && rows[0]) setTimeout(function () { gameForm(rows[0]); cf.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 0);
        }
        S.changed = true; paintGames(); paintList(); paintOrder();
      } catch (err) { toast(errText(err)); }
      finally { b.disabled = false; }
    });
    paintGames();
    // Launcher-Reiter: Spiele des Launchers mit Spielzeit; Cover kommen ueber die Steam-Suche (appid nur fuers Bild)
    var CAPSULE = function (a) { return 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + a + '/capsule_184x69.jpg'; };
    function gameForm(g, asLauncher) {
      var isL = g ? !!g.launcher : !!asLauncher, GA = window.GAccounts;
      g = g || { name: isL ? 'Epic Games' : '', platform: isL ? 'Epic Games' : '', image: '', appid: null, hours: null, stats: [], achievements: [], games: [], launcher: isL, audience: 'friends' };
      var stats = (g.stats || []).slice(), achs = (g.achievements || []).slice(), games = (g.games || []).map(function (x) { return Object.assign({}, x); });
      var single = '<div class="row2"><label>Spiel<input name="name" maxlength="60" required value="' + esc(g.name) + '" placeholder="z. B. Fortnite, Genshin Impact"></label>' +
        '<label>Plattform<input name="platform" maxlength="30" list="gpPlatforms" value="' + esc(g.platform) + '" placeholder="z. B. Epic Games"></label></div>' +
        '<datalist id="gpPlatforms">' + PLATFORMS.map(function (p) { return '<option value="' + esc(p) + '">'; }).join('') + '</datalist>' +
        '<div class="row2"><label>Spielzeit in Stunden<input name="hours" inputmode="decimal" value="' + (g.hours != null ? esc(String(g.hours).replace('.', ',')) : '') + '" placeholder="z. B. 320"></label>' +
        '<label class="aud-l">Wer sieht das?' + E.audSel('audience', g.audience || 'friends') + '</label></div>' +
        '<label>Steam-Spiel (optional) <small class="muted">Spielzeit und Errungenschaften kommen dann von Steam</small><span class="fav-add"><input type="search" data-q placeholder="Im Steam-Shop suchen" value=""><button type="button" class="btn ghost small" data-find>Suchen</button></span></label>' +
        '<p class="small" data-app>' + (g.appid ? 'Verknüpft mit Steam-Spiel <b>' + g.appid + '</b> <button type="button" class="link-btn" data-unapp>lösen</button>' : '<span class="muted">Kein Steam-Spiel verknüpft.</span>') + '</p><ul class="fav-results" data-res></ul>' +
        '<label>Bild (Link, optional)<input name="image" maxlength="300" value="' + esc(g.image) + '" placeholder="https://… (Cover oder Figur)"></label>';
      var launcherHtml = '<div class="row2"><label>Launcher<select name="platform">' + GA.LAUNCHERS.map(function (l) { return '<option' + (l.name === g.platform ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') +
          (g.platform && !GA.LAUNCHERS.some(function (l) { return l.name === g.platform; }) ? '<option selected>' + esc(g.platform) + '</option>' : '') + '</select></label>' +
        '<label>Überschrift<input name="name" maxlength="60" required value="' + esc(g.name) + '" placeholder="z. B. Epic Games"></label></div>' +
        '<label class="aud-l">Wer sieht das?' + E.audSel('audience', g.audience || 'friends') + '</label>' +
        '<fieldset class="kv lgames"><legend>Spiele auf diesem Launcher <small class="muted">mit Spielzeit; zählen in der Statistik und bei „Zusammen spielen“</small></legend>' +
        '<span class="fav-add"><input type="search" data-lq placeholder="Spiel suchen, z. B. Fortnite" aria-label="Spiel suchen"><button type="button" class="btn ghost small" data-lfind>Suchen</button></span>' +
        '<ul class="fav-results" data-lres></ul><div data-games></div></fieldset>';
      cf.innerHTML = '<form class="gform custom-edit" novalidate><h4>' + (g.id ? (isL ? 'Launcher-Reiter bearbeiten' : 'Reiter bearbeiten') : (isL ? 'Neuer Launcher-Reiter' : 'Neuer Reiter')) + '</h4>' +
        (isL ? launcherHtml : single) +
        '<fieldset class="kv"><legend>Eigene Zahlen <small class="muted">z. B. Rang: Diamant, Siege: 120</small></legend><div data-stats></div><button type="button" class="link-btn" data-addstat>+ Zahl</button></fieldset>' +
        '<fieldset class="kv"><legend>Errungenschaften <small class="muted">' + (g.appid ? 'bei Steam-Spielen kommen sie live von Steam; eigene nur ohne Steam-Daten' : 'eigene Ziele und Erfolge') + '</small></legend><div data-achs></div><button type="button" class="link-btn" data-addach>+ Errungenschaft</button></fieldset>' +
        '<p class="msg" hidden></p><div class="dlg-actions start"><button class="btn" type="submit">' + (g.id ? 'Speichern' : 'Reiter anlegen') + '</button><button type="button" class="link-btn" data-cancel>Abbrechen</button></div></form>';
      var f = $('form', cf), appid = g.appid || null;
      E.circles().then(function () { var s = f.audience, n = document.createElement('div'); n.innerHTML = E.audSel('audience', s.value); s.replaceWith(n.firstChild); });
      function paintKV() {
        $('[data-stats]', f).innerHTML = stats.map(function (s, i) { return '<div class="kv-row" data-i="' + i + '"><input data-f="l" maxlength="30" placeholder="Bezeichnung" value="' + esc(s.l) + '"><input data-f="v" maxlength="40" placeholder="Wert" value="' + esc(s.v) + '"><button type="button" class="link-btn danger-text" data-rmstat="' + i + '" aria-label="Entfernen">✕</button></div>'; }).join('');
        $('[data-achs]', f).innerHTML = achs.map(function (a, i) {
          return '<div class="kv-row ach-row" data-i="' + i + '"><label class="pick small"><input type="checkbox" data-f="done"' + (a.done ? ' checked' : '') + '><span>geschafft</span></label><input data-f="n" maxlength="80" placeholder="Name" value="' + esc(a.n) + '">' +
            '<input data-f="d" maxlength="140" placeholder="Beschreibung (optional)" value="' + esc(a.d || '') + '"><input data-f="at" type="date" value="' + esc(a.at || '') + '" aria-label="Datum"><button type="button" class="link-btn danger-text" data-rmach="' + i + '" aria-label="Entfernen">✕</button></div>'; }).join('');
      }
      function readKV() {
        $$('[data-stats] .kv-row', f).forEach(function (r) { var i = +r.dataset.i; stats[i] = { l: $('[data-f="l"]', r).value.trim(), v: $('[data-f="v"]', r).value.trim() }; });
        $$('[data-achs] .kv-row', f).forEach(function (r) { var i = +r.dataset.i; achs[i] = { n: $('[data-f="n"]', r).value.trim(), d: $('[data-f="d"]', r).value.trim(), done: $('[data-f="done"]', r).checked, at: $('[data-f="at"]', r).value }; });
      }
      paintKV();
      // Spiele des Launchers: Cover (Steam), Name, Spielzeit, entfernen; meistgespielte zuerst beim Speichern
      function readGames() {
        $$('[data-games] .lg-row', f).forEach(function (r) {
          var i = +r.dataset.i, h = $('[data-f="h"]', r).value.trim().replace(',', '.');
          games[i].n = $('[data-f="n"]', r).value.trim(); games[i].h = h === '' ? null : +h;
        });
      }
      function paintGames2() {
        var box = $('[data-games]', f); if (!box) return;
        box.innerHTML = games.length ? games.map(function (x, i) {
          return '<div class="kv-row lg-row" data-i="' + i + '">' + (x.a ? '<img src="' + CAPSULE(x.a) + '" alt="" loading="lazy">' : '<span class="gph">' + esc(String(x.n || '?').slice(0, 2).toUpperCase()) + '</span>') +
            '<input data-f="n" maxlength="80" placeholder="Spiel" value="' + esc(x.n) + '" aria-label="Spiel">' +
            '<input data-f="h" inputmode="decimal" placeholder="Std" value="' + (x.h != null && isFinite(x.h) ? esc(String(x.h).replace('.', ',')) : '') + '" aria-label="Spielzeit in Stunden">' +
            '<button type="button" class="link-btn danger-text" data-rmgame="' + i + '" aria-label="' + esc(x.n) + ' entfernen">✕</button></div>'; }).join('')
          : '<p class="muted small">Noch keine Spiele. Such oben nach einem Spiel und füge es hinzu.</p>';
      }
      function addGame(x) {
        readGames();
        if (games.length >= 300) return toast('Höchstens 300 Spiele je Launcher.');
        if (games.some(function (y) { return (x.a && y.a === x.a) || String(y.n).toLowerCase() === String(x.n).toLowerCase(); })) return toast(x.n + ' steht schon in der Liste.');
        games.unshift(x); paintGames2();
        var h = $('[data-games] .lg-row [data-f="h"]', f); if (h) h.focus();
      }
      if (isL) {
        paintGames2();
        // Ueberschrift folgt dem Launcher, solange sie nicht selbst geaendert wurde
        f.platform.addEventListener('change', function () { if (!f.name.dataset.own) f.name.value = f.platform.value; });
        f.name.addEventListener('input', function () { f.name.dataset.own = '1'; });
        $('[data-lq]', f).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('[data-lfind]', f).click(); } });
      }
      f.addEventListener('click', async function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.hasAttribute('data-cancel')) { cf.textContent = ''; return; }
        if (b.dataset.rmgame != null) { readGames(); games.splice(+b.dataset.rmgame, 1); paintGames2(); return; }
        if (b.hasAttribute('data-lfind')) {
          var lq = $('[data-lq]', f).value.trim(); if (lq.length < 2) return;
          var res = $('[data-lres]', f), own = '<li><span class="gph">' + esc(lq.slice(0, 2).toUpperCase()) + '</span><b>„' + esc(lq) + '“ ohne Cover</b><button type="button" class="btn small ghost" data-addname="' + esc(lq) + '">Hinzufügen</button></li>';
          try {
            var lr = await busy(b, function () { return Api.fn('gp-sync', { action: 'steam-search', q: lq }); });
            res.innerHTML = ((lr && lr.items) || []).slice(0, 5).map(function (x) {
              return '<li><img src="' + CAPSULE(x.appid) + '" alt="" loading="lazy"><b>' + esc(x.name) + '</b><button type="button" class="btn small" data-addgame="' + x.appid + '" data-name="' + esc(x.name) + '">Hinzufügen</button></li>'; }).join('') + own;
          } catch (err) { res.innerHTML = own; }
          return;
        }
        if (b.dataset.addgame || b.dataset.addname) {
          addGame(b.dataset.addgame ? { n: b.dataset.name, a: +b.dataset.addgame, h: null } : { n: b.dataset.addname.slice(0, 80), h: null });
          $('[data-lres]', f).textContent = ''; $('[data-lq]', f).value = ''; return;
        }
        if (b.hasAttribute('data-addstat')) { readKV(); if (stats.length >= 24) return toast('Höchstens 24 Zahlen.'); stats.push({ l: '', v: '' }); paintKV(); return; }
        if (b.hasAttribute('data-addach')) { readKV(); if (achs.length >= 150) return toast('Höchstens 150 Errungenschaften.'); achs.push({ n: '', d: '', done: false, at: '' }); paintKV(); return; }
        if (b.dataset.rmstat != null) { readKV(); stats.splice(+b.dataset.rmstat, 1); paintKV(); return; }
        if (b.dataset.rmach != null) { readKV(); achs.splice(+b.dataset.rmach, 1); paintKV(); return; }
        if (b.hasAttribute('data-unapp')) { appid = null; $('[data-app]', f).innerHTML = '<span class="muted">Kein Steam-Spiel verknüpft.</span>'; return; }
        if (b.hasAttribute('data-find')) {
          var q = $('[data-q]', f).value.trim() || f.name.value.trim(); if (q.length < 2) return;
          try {
            var r = await busy(b, function () { return Api.fn('gp-sync', { action: 'steam-search', q: q }); });
            $('[data-res]', f).innerHTML = ((r && r.items) || []).slice(0, 6).map(function (x) {
              return '<li><img src="https://cdn.cloudflare.steamstatic.com/steam/apps/' + x.appid + '/capsule_184x69.jpg" alt="" loading="lazy"><b>' + esc(x.name) + '</b><button type="button" class="btn small" data-pick="' + x.appid + '" data-name="' + esc(x.name) + '">Wählen</button></li>'; }).join('') || '<li class="muted">Nichts gefunden.</li>';
          } catch (err) { toast(errText(err)); }
          return;
        }
        if (b.dataset.pick) {
          appid = +b.dataset.pick; if (!f.name.value.trim()) f.name.value = b.dataset.name; if (!f.platform.value.trim()) f.platform.value = 'Steam';
          $('[data-app]', f).innerHTML = 'Verknüpft mit <b>' + esc(b.dataset.name) + '</b> (' + appid + ') <button type="button" class="link-btn" data-unapp>lösen</button>';
          $('[data-res]', f).textContent = '';
        }
      });
      f.addEventListener('submit', async function (e) {
        e.preventDefault(); readKV(); if (isL) readGames();
        var m = $('.msg', f), name = f.name.value.trim(), h = isL ? '' : f.hours.value.trim().replace(',', '.'), img = isL ? '' : f.image.value.trim();
        if (!name) return say(m, 'err', isL ? 'Bitte eine Überschrift eintragen.' : 'Bitte den Namen des Spiels eintragen.');
        if (h && !(+h >= 0 && +h < 1e6)) return say(m, 'err', 'Die Spielzeit bitte als Zahl in Stunden.');
        if (img && !/^https:\/\/\S+$/.test(img)) return say(m, 'err', 'Das Bild bitte als https-Link.');
        var list = [];
        if (isL) {
          var bad = games.filter(function (x) { return x.n && x.h != null && !(x.h >= 0 && x.h < 1e6); })[0];
          if (bad) return say(m, 'err', 'Die Spielzeit von „' + bad.n + '“ bitte als Zahl in Stunden.');
          list = games.filter(function (x) { return x.n; }).map(function (x) { var o = { n: x.n.slice(0, 80) }; if (x.a) o.a = x.a; if (x.h != null) o.h = Math.round(x.h * 10) / 10; if (x.i) o.i = x.i; return o; })
            .sort(function (a, b) { return (b.h || 0) - (a.h || 0); });
          var sum = list.reduce(function (s, x) { return s + (x.h || 0); }, 0);
          h = list.some(function (x) { return x.h != null; }) ? String(sum) : '';
        }
        var row = { owner: S.me, name: name.slice(0, 60), platform: f.platform.value.trim().slice(0, 30), image: img.slice(0, 300), appid: isL ? null : appid, hours: h ? Math.round(+h * 10) / 10 : null,
          stats: stats.filter(function (s) { return s.l; }).slice(0, 24), achievements: achs.filter(function (a) { return a.n; }).slice(0, 150).map(function (a) { return { n: a.n, d: a.d, done: a.done, at: a.done ? a.at : '' }; }),
          audience: f.audience.value, sort: g.id ? g.sort || 0 : (S.p.custom || []).length };
        // Spalten fuer Launcher erst mitsenden, wenn sie gebraucht werden (aeltere Datenbank kennt sie nicht)
        if (isL || g.launcher) { row.launcher = true; row.games = list; }
        try {
          var rows = await busy($('button[type="submit"]', f), async function () {
            await E.ensureProfile();
            return g.id ? Api.update('gp_custom_games', 'id=eq.' + g.id, row) : Api.insert('gp_custom_games', [row]);
          });
          var saved = rows && rows[0];
          if (saved) S.p.custom = (S.p.custom || []).filter(function (x) { return x.id !== saved.id; }).concat([saved]).sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
          S.changed = true; cf.textContent = ''; paintList(); paintOrder(); paintGames(); toast(g.id ? 'Reiter gespeichert' : 'Reiter angelegt');
        } catch (err) { say(m, 'err', /check|violates/.test(String(err.message)) ? 'Ein Eintrag ist zu lang oder ungültig.' : errText(err)); }
      });
      if (isL && g.id) $('[data-lq]', f).focus(); else f.name.focus();
    }
    paintList();
  }

  // ---------------------------------------------------------------- Skeison Account
  var COLORS = ['#ffcb05', '#ff6b6b', '#ff9f43', '#2ecc71', '#1abc9c', '#5b85ff', '#a55eea', '#ff5fa2', '#8395a7', '#e1b12c'];
  function account(body) {
    var S = st(), o = S.p.owner || {}, email = (Api.user && Api.user.email) || '';
    body.innerHTML = '<section class="ecard pic-card"><h3>Profilbild</h3><div class="pic-row"><span class="pic-prev"></span><div class="pic-act">' +
      '<p class="muted small">Ein eigenes Bild statt des Emojis: Es wird quadratisch aus der Mitte zugeschnitten und auf 256 × 256 Pixel verkleinert. Es erscheint oben rechts, in der Profilauswahl und bei deinen Freunden.</p>' +
      '<div class="dlg-actions start"><label class="btn small file-btn">Bild wählen<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>' +
      '<button type="button" class="btn ghost small" data-rmpic' + (o.avatar_url ? '' : ' hidden') + '>Entfernen</button></div></div></div><p class="msg" hidden></p></section>' +
      '<form class="gform ecard" id="fAcc" novalidate><h3>Skeison Account</h3><p class="muted">Gilt für alle Skeison-Seiten (Gaming-Profil und Wunschliste). Geburtstag, Größen und „Über mich“ pflegst du im <a href="../wunschliste/?seite=profil">Profil der Wunschliste</a>.</p>' +
      '<div class="row2"><label>Name<input name="name" maxlength="24" required value="' + esc(o.name) + '"></label><label>Avatar (Emoji)<input name="avatar" maxlength="8" value="' + esc(o.avatar) + '"></label></div>' +
      '<fieldset class="colors"><legend>Farbe</legend>' + COLORS.concat(COLORS.indexOf(o.color) < 0 && o.color ? [o.color] : []).map(function (c) {
        return '<label class="color-dot" style="--c:' + c + '"><input type="radio" name="color" value="' + c + '"' + (c === o.color ? ' checked' : '') + '><span aria-label="' + c + '"></span></label>'; }).join('') + '</fieldset>' +
      '<p class="muted small">E-Mail: ' + esc(email) + '</p><p class="msg" hidden></p><div class="dlg-actions start"><button class="btn" type="submit">Speichern</button></div></form>' +
      '<form class="gform ecard" id="fPw" novalidate><h3>Passwort ändern</h3><label>Neues Passwort <small class="muted">mindestens 8 Zeichen</small><input name="pw" type="password" autocomplete="new-password" minlength="8" maxlength="72"></label>' +
      '<label>Wiederholen<input name="pw2" type="password" autocomplete="new-password" minlength="8" maxlength="72"></label><p class="msg" hidden></p><div class="dlg-actions start"><button class="btn" type="submit">Passwort speichern</button></div></form>';
    // Profilbild: Vorschau, Hochladen (Storage-Bucket "avatars", eigener Ordner), Entfernen
    var pc = $('.pic-card', body), pm = $('.msg', pc), G = window.Gaming && window.Gaming.u;
    function paintPic() {
      var prev = $('.pic-prev', pc); prev.textContent = ''; if (G) prev.appendChild(G.avatar(S.p.owner, 'xl'));
      $('[data-rmpic]', pc).hidden = !S.p.owner.avatar_url;
      var h = document.querySelector('#gdlg .gh-av'); if (h && G) { var n = G.avatar(S.p.owner, 'gh-av'); n.setAttribute('aria-hidden', 'true'); h.replaceWith(n); }
      document.dispatchEvent(new CustomEvent('gp:me', { detail: S.p.owner }));
    }
    function oldPath(u) { var i = String(u || '').indexOf('/avatars/'); return i >= 0 ? u.slice(i + 9) : ''; }
    // Quadrat aus der Mitte, 256 px, WebP (sonst JPEG)
    function shrink(file) {
      return new Promise(function (ok, fail) {
        var url = URL.createObjectURL(file), im = new Image();
        im.onload = function () {
          var s = Math.min(im.naturalWidth, im.naturalHeight), c = document.createElement('canvas'); c.width = c.height = 256;
          c.getContext('2d').drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, 0, 0, 256, 256);
          URL.revokeObjectURL(url);
          c.toBlob(function (b) {
            if (b && b.type === 'image/webp') return ok(b);
            c.toBlob(function (j) { j ? ok(j) : fail(new Error('bad_image')); }, 'image/jpeg', 0.88);
          }, 'image/webp', 0.86);
        };
        im.onerror = function () { URL.revokeObjectURL(url); fail(new Error('bad_image')); };
        im.src = url;
      });
    }
    $('input[type="file"]', pc).addEventListener('change', async function (e) {
      var file = e.target.files && e.target.files[0]; e.target.value = ''; if (!file) return;
      if (!/^image\//.test(file.type)) return say(pm, 'err', 'Bitte ein Bild wählen (PNG, JPG, WebP).');
      if (file.size > 15 * 1024 * 1024) return say(pm, 'err', 'Das Bild ist zu groß (höchstens 15 MB).');
      var lbl = $('.file-btn', pc); lbl.classList.add('busy');
      try {
        say(pm, '', 'Wird hochgeladen …');
        var blob = await shrink(file), old = S.p.owner.avatar_url;
        var url = await Api.upload('avatars', S.me + '/avatar-' + Date.now() + (blob.type === 'image/webp' ? '.webp' : '.jpg'), blob);
        await Api.update('wl_profiles', 'id=eq.' + S.me, { avatar_url: url });
        S.p.owner = Object.assign({}, S.p.owner, { avatar_url: url }); S.changed = true; paintPic();
        if (oldPath(old)) Api.removeFiles('avatars', [oldPath(old)]).catch(function () {});
        say(pm, 'ok', 'Profilbild gespeichert ✓');
      } catch (err) { say(pm, 'err', err && err.message === 'bad_image' ? 'Das Bild ließ sich nicht lesen. Bitte ein anderes wählen.' : errText(err)); }
      finally { lbl.classList.remove('busy'); }
    });
    $('[data-rmpic]', pc).addEventListener('click', async function (e) {
      var old = S.p.owner.avatar_url;
      try {
        await busy(e.currentTarget, function () { return Api.update('wl_profiles', 'id=eq.' + S.me, { avatar_url: null }); });
        S.p.owner = Object.assign({}, S.p.owner, { avatar_url: null }); S.changed = true; paintPic();
        if (oldPath(old)) Api.removeFiles('avatars', [oldPath(old)]).catch(function () {});
        say(pm, 'ok', 'Profilbild entfernt. Jetzt erscheint wieder dein Emoji.');
      } catch (err) { say(pm, 'err', errText(err)); }
    });
    paintPic();
    var f = $('#fAcc', body), d = E.keepDraft(f, 'account', function () { E.show('account'); });
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); var m = $('.msg', f), name = f.name.value.trim(), avatar = f.avatar.value.trim(), color = (f.querySelector('input[name="color"]:checked') || {}).value || o.color;
      if (name.length < 2 || name.length > 24 || /#/.test(name)) return say(m, 'err', 'Der Name braucht 2 bis 24 Zeichen, ohne #.');
      if (!avatar) return say(m, 'err', 'Bitte ein Emoji als Avatar eintragen.');
      try {
        await busy($('button[type="submit"]', f), function () { return Api.update('wl_profiles', 'id=eq.' + S.me, { name: name, avatar: avatar, color: color }); });
        S.p.owner = Object.assign({}, S.p.owner, { name: name, avatar: avatar, color: color }); S.changed = true; d.saved(); paintPic(); say(m, 'ok', 'Gespeichert.');
      } catch (err) { say(m, 'err', errText(err)); }
    });
    var pf = $('#fPw', body);
    pf.addEventListener('submit', async function (e) {
      e.preventDefault(); var m = $('.msg', pf), pw = pf.pw.value;
      if (pw.length < 8) return say(m, 'err', 'Mindestens 8 Zeichen.');
      if (pw !== pf.pw2.value) return say(m, 'err', 'Die Passwörter stimmen nicht überein.');
      try {
        var r = await busy($('button[type="submit"]', pf), function () { return Api.fn('wl-account', { action: 'set-password', password: pw }); });
        if (r && r.error) throw Object.assign(new Error(r.error), { code: r.error });
        // Supabase beendet beim Passwortwechsel alle Sitzungen: still mit dem neuen Passwort neu anmelden (wie in der Wunschliste)
        try { await Api.signIn(email, pw, true); } catch (x) { /* api.js meldet ab, sobald die Sitzung gebraucht wird */ }
        pf.reset(); say(m, 'ok', 'Passwort geändert ✓');
      } catch (err) { say(m, 'err', errText(err)); }
    });
  }

  window.EditorExtra = { oeffentlich: oeffentlich, reiter: reiter, account: account };
})();
