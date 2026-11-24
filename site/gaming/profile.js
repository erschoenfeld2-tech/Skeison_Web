// Gaming-Profile mit dem Skeison Account (gleiche Anmeldung wie die Wunschliste, Sitzung aus wunschliste/api.js).
// Ohne Anmeldung: Anmelden/Registrieren, Beispiel-Buehne (Gaming.demo) und Karte zum Cobblemon Server; ein geteilter Link
// (?profil=<token>) zeigt eine Vorschau (gp_preview). Angemeldet: Profile waehlen (?u=<id>), gp_profile laden, zeichnen
// (Gaming.render) und die Live-Daten ueber die Edge Function gp-sync nachladen; "Zusammen spielen" vergleicht die Spiele
// aller sichtbaren Profile (gp_games, Gaming.team). Bearbeiten und Teilen: editor.js.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var FX = window.FX || {};
  function toast(t) { if (FX.toast) FX.toast(t); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  var ERR = {
    invalid_credentials: 'E-Mail oder Passwort stimmt nicht.', 'Invalid login credentials': 'E-Mail oder Passwort stimmt nicht.', email_not_confirmed: 'Die E-Mail-Adresse ist noch nicht bestätigt.',
    network: 'Keine Verbindung. Bitte später nochmal.', no_access: 'Dieses Gaming-Profil ist nicht für dich freigegeben.', email_exists: 'Diese E-Mail ist schon registriert. Melde dich an.',
    weak_password: 'Das Passwort ist zu schwach (mindestens 8 Zeichen).', invite: 'Zum Registrieren wird gerade ein Einladungscode gebraucht.', name: 'Der Name muss 2 bis 24 Zeichen haben.',
    cap: 'Heute sind schon viele neue Konten entstanden. Bitte morgen nochmal.', rate_limited: 'Zu viele Versuche. Bitte kurz warten.'
  };
  function errText(e) { var c = (e && (e.code || e.message)) || ''; return ERR[c] || (window.Editor ? Editor.errText(e) : 'Das hat nicht geklappt.'); }
  var VAL_ERR = { not_found: 'Die Riot-ID wurde nicht gefunden. Bitte im Editor prüfen.', rate_limited: 'Die Valorant-Schnittstelle ist gerade ausgelastet.', upstream_denied: 'Der Valorant-Schlüssel wurde abgelehnt.' };

  var params = new URLSearchParams(location.search);
  var token = params.get('profil'), wanted = params.get('u');
  var me = null, current = null, list = [], shown = null;

  // Anmelden/Abmelden in diesem oder einem anderen Tab: Seite neu aufbauen (behaelt ?profil= und ?u=)
  Api.onAuthChange(function () { location.reload(); });

  // ---------------------------------------------------------------- ohne Anmeldung
  function gate() {
    document.body.classList.remove('is-in');
    Gaming.demo();
    Gaming.cobblemon($('gateSrv'), null, null);
    var tabs = document.querySelector('.gate-tabs');
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]'); if (!b) return;
      Array.prototype.forEach.call(tabs.children, function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); });
      $('gLogin').hidden = b.dataset.tab !== 'login'; $('gRegister').hidden = b.dataset.tab !== 'register';
    });
    function fail(form, e) { var m = form.querySelector('.msg'); m.textContent = errText(e); m.hidden = false; }
    $('gLogin').addEventListener('submit', async function (e) {
      e.preventDefault(); var f = e.target, b = f.querySelector('button[type="submit"]');
      f.querySelector('.msg').hidden = true; b.disabled = true;
      try { await Api.signIn(f.email.value.trim(), f.password.value); } catch (err) { fail(f, err); } finally { b.disabled = false; }
    });
    $('gRegister').addEventListener('submit', async function (e) {
      e.preventDefault(); var f = e.target, b = f.querySelector('button[type="submit"]'), name = f.name.value.trim();
      f.querySelector('.msg').hidden = true;
      if (name.length < 2 || name.length > 24 || /#/.test(name)) return fail(f, { code: 'name' });
      if (f.password.value.length < 8) return fail(f, { code: 'weak_password' });
      if (f.password.value !== f.password2.value) return fail(f, { message: 'Die Passwörter sind nicht gleich.' });
      b.disabled = true;
      try {
        await Api.signUp({ name: name, email: f.email.value.trim(), password: f.password.value, invite: f.invite.value.trim() || undefined });
        await Api.signIn(f.email.value.trim(), f.password.value);
      } catch (err) {
        if (err.code === 'invite') f.querySelector('.gate-invite').hidden = false;
        if (/^Die Pass/.test(err.message || '')) { var m = f.querySelector('.msg'); m.textContent = err.message; m.hidden = false; } else fail(f, err);
      } finally { b.disabled = false; }
    });
    if (token) Api.pub('gp_preview', { p_token: token }).then(sharePreview, function () { sharePreview(null); });
  }
  // Vorschau eines geteilten Profils (ohne Anmeldung): Name, Avatar, Spruch, welche Konten verknuepft sind
  function sharePreview(p) {
    var box = $('gateShare'); box.textContent = ''; box.hidden = false;
    if (!p) { box.appendChild(el('p', 'msg err', 'Dieser Link ist nicht mehr gültig. Frag nach einem neuen.')); return; }
    var head = el('div', 'gs-head'), av = el('span', 'av big', p.owner.avatar); av.style.setProperty('--c', p.owner.color);
    head.appendChild(av); var t = el('div'); t.appendChild(el('b', '', p.owner.name + ' hat dir sein Gaming-Profil geteilt'));
    if (p.tagline) t.appendChild(el('span', 'muted', p.tagline)); head.appendChild(t); box.appendChild(head);
    var kinds = el('div', 'gs-kinds');
    (p.kinds || []).forEach(function (k) { var d = window.GAccounts.BY[k]; if (!d) return; var s = el('span', 'acc-badge', d.short); s.style.setProperty('--c', d.color); s.title = d.name; kinds.appendChild(s); });
    if (kinds.children.length) box.appendChild(kinds);
    var facts = [p.skins ? p.skins + ' Valorant-Skins' : '', p.favs ? p.favs + ' Lieblingsspiele' : '', p.mc_skins ? p.mc_skins + ' Minecraft-Skins' : ''].filter(Boolean);
    if (facts.length) box.appendChild(el('p', 'muted', facts.join(' · ')));
    box.appendChild(el('p', '', 'Melde dich an oder leg ein Konto an, um das ganze Profil zu sehen.'));
  }

  // ---------------------------------------------------------------- angemeldet
  function note(text) { var n = $('pbarNote'); n.textContent = text || ''; n.hidden = !text; }
  async function app() {
    document.body.classList.add('is-in');
    me = Api.user.id;
    if (token) {
      try { wanted = await Api.rpc('gp_redeem', { p_token: token }); toast('Gaming-Profil freigeschaltet'); }
      catch (e) { note(errText(e)); }
      history.replaceState(null, '', location.pathname + (wanted && wanted !== me ? '?u=' + wanted : '') + location.hash);
    }
    try { list = await Api.rpc('gp_visible_profiles'); } catch (e) { list = []; note(errText(e)); }
    if (!list.some(function (p) { return p.id === me; })) list.unshift({ id: me, name: 'Ich', avatar: '🎮', color: '#5b85ff', me: true });
    paintBar();
    loadTeam(true);
    open(wanted && list.some(function (p) { return p.id === wanted; }) ? wanted : me);
  }
  function paintBar() {
    var box = $('pbarList'); box.textContent = '';
    list.forEach(function (p) {
      var b = el('button', 'pchip' + (p.id === current ? ' on' : '')); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(p.id === current));
      var av = el('span', 'av', p.avatar); av.style.setProperty('--c', p.color); b.appendChild(av);
      b.appendChild(el('span', '', p.me ? 'Ich' : p.name));
      b.addEventListener('click', function () { if (p.id !== current) open(p.id); });
      box.appendChild(b);
    });
  }
  async function open(id) {
    current = id; paintBar(); note(''); Gaming.team(undefined, id);
    var mine = id === me;
    $('btnEdit').hidden = !mine; $('btnShare').hidden = !mine;
    history.replaceState(null, '', location.pathname + (mine ? '' : '?u=' + id) + location.hash);
    var p;
    try { p = await Api.rpc('gp_profile', { p_owner: id }); }
    catch (e) { note(errText(e)); if (!mine) return open(me); return; }
    if (current !== id) return;
    shown = p;
    if (mine && !p.profile) note('Dein Gaming-Profil ist noch leer und für niemanden sichtbar. Über „Bearbeiten“ verknüpfst du Konten und legst fest, wer es sehen darf.');
    draw(p);
    refresh(false);
  }

  // gp_profile -> Ansicht fuer Gaming.render
  function draw(p) {
    var c = p.cache || {}, acc = p.accounts || [], pr = p.profile || {};
    var get = function (k) { return acc.filter(function (a) { return a.kind === k; })[0]; };
    var data = function (k) { return c[k] && c[k].data ? Object.assign({}, c[k].data, { updated: c[k].fetched_at }) : null; };
    var err = function (k) { return c[k] && c[k].error; };
    var val = get('valorant'), vd = data('valorant'), ve = err('valorant');
    var valState = !val ? 'none' : vd ? 'ok' : ve === 'not_configured' ? 'setup' : ve ? 'error' : 'loading';
    var st = get('steam'), sd = data('steam');
    var mcAcc = get('minecraft'), md = data('minecraft');
    var skins = (p.mc_skins || []).map(function (s) { return { id: s.id, name: s.name, src: s.png, model: s.model }; });
    if (md && md.skin) skins.unshift({ id: 'account', name: md.name || mcAcc.handle, src: md.skin, model: md.model });
    if (!skins.length) skins.push({ id: 'standard', name: 'Standard', src: '../skin/pionier-blau.png' });
    var dc = get('discord'), dd = dc && window.GAccounts.BY.discord.invite(dc.handle) ? data('discord') : null;
    var v = {
      demo: false, mine: p.mine, owner: p.owner, tagline: pr.tagline,
      agent: null, val: vd ? Object.assign(vd, { message: null }) : (ve ? { message: VAL_ERR[ve] } : null), valState: valState,
      valSkins: (p.val_items || []).length ? 'loading' : null,
      steam: sd, steamState: !st ? 'none' : sd ? 'ok' : err('steam') ? 'error' : 'loading', favs: p.steam_favs || [],
      pioneer: pr.pioneer, mcSkins: skins, mcActive: pr.mc_active_skin || (md && md.skin ? 'account' : null),
      mcName: md ? md.name : mcAcc ? mcAcc.handle : '',
      server: pr.mc_server ? { kind: 'fav', address: pr.mc_server, data: data('mcserver'), error: err('mcserver'), fetched: c.mcserver && c.mcserver.fetched_at } : null,
      accounts: acc.map(function (a) { return Object.assign({}, a, { data: data(a.kind) }); }),
      discord: dd
    };
    Gaming.render(v);
    // Valorant-Katalog: ausgewaehlte Skins/Bundles und Lieblingsagent (eine Woche im Browser zwischengespeichert)
    if ((p.val_items || []).length || pr.val_agent) window.ValCat.load().then(function (cat) {
      if (shown !== p) return;
      v.valSkins = (p.val_items || []).length ? window.ValCat.resolve(cat, p.val_items) : null;
      v.agent = pr.val_agent ? cat.agentById[pr.val_agent] || null : null;
      Gaming.render(v);
    }).catch(function () { if (shown === p) { v.valSkins = null; Gaming.render(v); } });
  }

  // Live-Daten erneuern (gp-sync entscheidet, was veraltet ist); force nur fuer das eigene Profil, hoechstens alle 5 min
  async function refresh(force) {
    var id = current, p = shown, btn = $('btnRefresh');
    btn.disabled = true; btn.classList.add('spin');
    try {
      var r = await Api.fn('gp-sync', { action: 'refresh', owner: id, force: !!force });
      if (id !== current || p !== shown) return;
      if (r && r.cache) {
        p.cache = r.cache;
        if ((r.updated || []).length) draw(p);
        if ((r.updated || []).indexOf('steam') >= 0) loadTeam(false);
        if (force) toast((r.updated || []).length ? 'Live-Daten aktualisiert' : 'Schon aktuell (höchstens alle 5 Minuten neu)');
        var missing = [];
        if (r.configured && !r.configured.valorant && (p.accounts || []).some(function (a) { return a.kind === 'valorant'; })) missing.push('Valorant');
        if (missing.length && p.mine) note('Live-Daten für ' + missing.join(' und ') + ' sind noch nicht eingerichtet. Konten, Skins und Lieblingsspiele funktionieren trotzdem.');
      }
    } catch (e) { if (force) toast(errText(e)); }
    finally { btn.disabled = false; btn.classList.remove('spin'); }
  }

  // Zusammen spielen: Spiele aller sichtbaren Profile. Fehlt bei jemandem mit Steam die Bibliothek oder ist sie aelter als
  // einen Tag, holt gp-sync sie einmal je Besuch nach (hoechstens 6 Profile nacheinander), danach wird neu verglichen.
  async function loadTeam(sync) {
    var g;
    try { g = await Api.rpc('gp_games'); } catch (e) { Gaming.team(false); return; }
    Gaming.team(g);
    if (!sync) return;
    var old = Date.now() - 864e5;
    var todo = g.filter(function (p) { return !p.me && p.has_steam && (!p.steam_at || new Date(p.steam_at).getTime() < old); }).slice(0, 6);
    if (!todo.length) return;
    for (var i = 0; i < todo.length; i++) { try { await Api.fn('gp-sync', { action: 'refresh', owner: todo[i].id }); } catch (e) { /* naechstes Profil */ } }
    loadTeam(false);
  }

  // ---------------------------------------------------------------- Bearbeiten, Teilen, Abmelden
  function edit(tab) {
    if (!shown || !shown.mine) return open(me).then(function () { if (shown && shown.mine) edit(tab); });
    Editor.open(shown, function () {
      // nach dem Bearbeiten neu laden; danach holt gp-sync die Live-Daten fuer neue Konten
      Api.rpc('gp_visible_profiles').then(function (l) { list = l; paintBar(); }).catch(function () {});
      loadTeam(false);
      open(me);
    }, tab);
  }
  Gaming.onEdit = function () { edit(); };
  // Auswahl auf der Buehne merkt sich das eigene Profil (Pionier-Design, aktiver Minecraft-Skin)
  Gaming.pioneer.onPick = function (id) { if (shown && shown.mine) Api.upsert('gp_profiles', [{ id: me, pioneer: id, updated_at: new Date().toISOString() }]).then(function () { if (shown.profile) shown.profile.pioneer = id; }).catch(function () {}); };
  Gaming.onMcSkin = function (id) {
    if (!shown || !shown.mine) return;
    Api.upsert('gp_profiles', [{ id: me, mc_active_skin: /^[0-9a-f-]{36}$/.test(id) ? id : null, updated_at: new Date().toISOString() }])
      .then(function () { if (shown.profile) shown.profile.mc_active_skin = /^[0-9a-f-]{36}$/.test(id) ? id : null; }).catch(function () {});
  };
  $('btnEdit').addEventListener('click', function () { edit(); });
  $('navEdit').addEventListener('click', function (e) { e.preventDefault(); if (Api.user) edit(); });
  $('btnShare').addEventListener('click', function () { Editor.share(); });
  $('btnRefresh').addEventListener('click', function () { refresh(current === me); });
  $('btnLogout').addEventListener('click', function () { Api.signOut(); });

  if (Api.user) app(); else gate();
})();
