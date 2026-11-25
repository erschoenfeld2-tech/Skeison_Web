// Gaming-Profile mit dem Skeison Account (gleiche Anmeldung wie die Wunschliste, Sitzung aus wunschliste/api.js).
// Ohne Anmeldung: Anmelden/Registrieren, Beispiel-Buehne (Gaming.demo) und Karte zum Cobblemon Server; ein geteilter Link
// (?profil=<token>) zeigt eine Vorschau (gp_preview). Angemeldet: Profile waehlen (?u=<id>; Freunde, Bekannte und aus der
// Ausstellung auch oeffentliche Profile), gp_view laden (liefert nur, was ich sehen darf), zeichnen (Gaming.render) und die
// Live-Daten ueber die Edge Function gp-sync nachladen; "Zusammen spielen" vergleicht die Spiele aller sichtbaren Profile
// (gp_games, Gaming.team). Eigenes Profil: "Ansehen als" zeigt es so, wie Freunde, Bekannte oder alle es sehen.
// Bearbeiten und Teilen: editor.js und editor-extra.js.
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
    (p.kinds || []).filter(function (k, i, a) { return a.indexOf(k) === i; }).forEach(function (k) { var d = window.GAccounts.kindOf({ kind: k }); if (!d || kinds.querySelector('[title="' + d.name + '"]')) return; var s = el('span', 'acc-badge', d.short); s.style.setProperty('--c', d.color); s.title = d.name; kinds.appendChild(s); });
    if (kinds.children.length) box.appendChild(kinds);
    var facts = [p.skins ? p.skins + ' Valorant-Skins' : '', p.favs ? p.favs + ' Lieblingsspiele' : '', p.mc_skins ? p.mc_skins + ' Minecraft-Skins' : ''].filter(Boolean);
    if (facts.length) box.appendChild(el('p', 'muted', facts.join(' · ')));
    box.appendChild(el('p', '', 'Melde dich an oder leg ein Konto an, um das ganze Profil zu sehen.'));
  }

  // ---------------------------------------------------------------- angemeldet
  function note(text, act) {
    var n = $('pbarNote'); n.textContent = text || ''; n.hidden = !text;
    if (text && act) { var b = el('button', 'link-btn', act[0]); b.type = 'button'; b.addEventListener('click', act[1]); n.appendChild(document.createTextNode(' ')); n.appendChild(b); }
  }
  var asView = '';   // "Ansehen als" (nur eigenes Profil): '', 'friend', 'known', 'public'
  var TIER = { friend: 'Freund', known: 'Bekannt', public: 'Öffentlich' };
  async function loadPeople() {
    try { list = await Api.rpc('gp_people'); }
    catch (e) { try { list = await Api.rpc('gp_visible_profiles'); } catch (e2) { list = []; note(errText(e2)); } }
    if (!list.some(function (p) { return p.id === me; })) list.unshift({ id: me, name: 'Ich', avatar: '🎮', color: '#5b85ff', me: true });
  }
  async function app() {
    document.body.classList.add('is-in');
    me = Api.user.id;
    if (token) {
      try { wanted = await Api.rpc('gp_redeem', { p_token: token }); toast('Gaming-Profil freigeschaltet'); }
      catch (e) { note(errText(e)); }
      history.replaceState(null, '', location.pathname + (wanted && wanted !== me ? '?u=' + wanted : '') + location.hash);
    }
    await loadPeople();
    paintBar();
    loadTeam(true);
    // ?u= darf auch ein oeffentliches Profil aus der Ausstellung sein; gp_view entscheidet
    open(wanted && wanted !== me ? wanted : me);
    checkRequests();
  }
  // Offene Bekannten-Anfragen an mich: Hinweis mit Weg in den Editor
  function checkRequests() {
    Api.rpc('gp_known_list').then(function (l) {
      var n = (l || []).filter(function (x) { return x.state === 'received'; }).length;
      if (n && current === me) note(n === 1 ? 'Eine neue Bekannten-Anfrage.' : n + ' neue Bekannten-Anfragen.', ['Ansehen', function () { edit('oeffentlich'); }]);
    }).catch(function () {});
  }
  function paintBar() {
    var box = $('pbarList'); box.textContent = '';
    var shownList = list.slice();
    if (current && !shownList.some(function (p) { return p.id === current; }) && shown && shown.owner) shownList.push({ id: current, name: shown.owner.name, avatar: shown.owner.avatar, color: shown.owner.color, tier: shown.tier });
    shownList.forEach(function (p) {
      var b = el('button', 'pchip' + (p.id === current ? ' on' : '')); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(p.id === current));
      var av = el('span', 'av', p.avatar); av.style.setProperty('--c', p.color); b.appendChild(av);
      b.appendChild(el('span', '', p.me ? 'Ich' : p.name));
      if (!p.me && p.tier && p.tier !== 'friend') b.appendChild(el('small', 'pchip-tier', TIER[p.tier] || ''));
      b.addEventListener('click', function () { if (p.id !== current) open(p.id); });
      box.appendChild(b);
    });
  }
  async function open(id) {
    current = id; note(''); Gaming.team(undefined, id);
    var mine = id === me;
    $('btnEdit').hidden = !mine; $('btnShare').hidden = !mine; $('asWrap').hidden = !mine; $('btnKnown').hidden = true;
    if (!mine) { asView = ''; $('asSel').value = ''; }
    history.replaceState(null, '', location.pathname + (mine ? '' : '?u=' + id) + location.hash);
    var p;
    try { p = await Api.rpc('gp_view', { p_owner: id, p_as: mine && asView ? asView : null }); }
    catch (e) { note(errText(e)); if (!mine) return open(me); return; }
    if (current !== id) return;
    shown = p; paintBar(); relation(p);
    if (mine && !p.profile) note('Dein Gaming-Profil ist noch leer und für niemanden sichtbar. Über „Bearbeiten“ verknüpfst du Konten und legst fest, wer es sehen darf.');
    else if (!mine && p.tier === 'public') note('Du siehst das öffentliche Profil. Spielernamen sind gekürzt, Werte bleiben verborgen.');
    else if (!mine && p.tier === 'known') note('Du siehst, was ' + p.owner.name + ' mit Bekannten teilt.');
    draw(p);
    if (!p.preview) refresh(false);
  }
  // Knopf "Als Bekannte anfragen" auf fremden Profilen, die keine Freundes-Profile sind
  function relation(p) {
    var b = $('btnKnown'), r = p.relation;
    b.hidden = p.mine || p.tier === 'friend';
    if (b.hidden) return;
    b.disabled = r === 'sent' || r === 'known';
    b.textContent = r === 'sent' ? 'Anfrage gesendet' : r === 'received' ? 'Bekannten-Anfrage annehmen' : r === 'known' ? 'Bekannt ✓' : 'Als Bekannte anfragen';
    b.className = 'btn small' + (b.disabled ? ' ghost' : '');
    b.onclick = async function () {
      b.disabled = true;
      try {
        if (r === 'received') { await Api.rpc('gp_known_answer', { p_user: p.owner.id, p_accept: true }); toast('Ihr seid jetzt Bekannte'); }
        else { var s = await Api.rpc('gp_known_request', { p_user: p.owner.id }); toast(s === 'known' ? 'Ihr seid jetzt Bekannte' : 'Anfrage gesendet'); }
        await loadPeople(); open(p.owner.id);
      } catch (e) { b.disabled = false; toast(errText(e)); }
    };
  }

  // Reiter: eigene Reihenfolge (layout.tabs), ausgeblendete (layout.hidden), fuer andere nur freigegebene Bereiche
  function tabsOf(p) {
    var lay = (p.profile && p.profile.layout) || {}, hidden = lay.hidden || [], sec = p.sections || {};
    var all = ['val', 'steam', 'mc', 'stats'].concat((p.custom || []).map(function (g) { return 'c-' + g.id; })).concat(['team']);
    var order = (lay.tabs || []).filter(function (k) { return all.indexOf(k) >= 0; });
    all.forEach(function (k) {
      if (order.indexOf(k) >= 0) return;
      var t = order.indexOf('team'); if (k !== 'team' && t >= 0) order.splice(t, 0, k); else order.push(k);
    });
    order = order.filter(function (k) { return hidden.indexOf(k) < 0; });
    if (!p.mine) order = order.filter(function (k) {
      if (k === 'val' || k === 'steam' || k === 'mc' || k === 'stats') return sec[k] !== false;
      if (k === 'team') return p.tier === 'friend' && !p.preview;
      return true;
    });
    return order.length ? order : ['stats'];
  }

  // gp_view -> Ansicht fuer Gaming.render
  function draw(p) {
    var c = p.cache || {}, acc = p.accounts || [], pr = p.profile || {}, GA = window.GAccounts, sec = p.sections || {};
    var data = function (k) { return c[k] && c[k].data ? Object.assign({}, c[k].data, { updated: c[k].fetched_at }) : null; };
    var err = function (k) { return c[k] && c[k].error; };
    var of = function (b) { return acc.filter(function (a) { return GA.base(a.kind) === b; }); };
    var lab = function (a, i, n) { return GA.label(a) || (n > 1 ? (i ? (i + 1) + '. Konto' : 'Hauptkonto') : ''); };
    // Valorant und Steam: ein Eintrag je Konto (Umschalter auf der Buehne)
    var vals = of('valorant'), valList = vals.map(function (a, i) {
      var d = data(a.kind), e = err(a.kind);
      return { label: lab(a, i, vals.length), val: d ? Object.assign(d, { message: null, playHours: GA.hours(a, d) }) : e ? { message: VAL_ERR[e] } : null, state: d ? 'ok' : e === 'not_configured' ? 'setup' : e ? 'error' : 'loading' };
    });
    var sts = of('steam'), steamList = sts.map(function (a, i) { var d = data(a.kind); return { label: lab(a, i, sts.length), steam: d, state: d ? 'ok' : err(a.kind) ? 'error' : 'loading' }; });
    var mcs = of('minecraft'), skins = (p.mc_skins || []).map(function (s) { return { id: s.id, name: s.name, src: s.png, model: s.model }; });
    var first = mcs[0], md = first ? data(first.kind) : null;
    mcs.slice().reverse().forEach(function (a) { var d = data(a.kind); if (d && d.skin) skins.unshift({ id: a.kind === 'minecraft' ? 'account' : 'account-' + a.kind, name: d.name || (a.masked ? 'Konto' : a.handle), src: d.skin, model: d.model }); });
    if (!skins.length) skins.push({ id: 'standard', name: 'Standard', src: '../skin/pionier-blau.png' });
    var dc = of('discord').filter(function (a) { return !a.masked && GA.BY.discord.invite(a.handle); })[0], dd = dc ? data(dc.kind) : null;
    var s0 = steamList[0] && steamList[0].steam;
    // Spielzeit je Steam-Spiel (fuer eigene Reiter) und Errungenschaften aus dem Cache ("ach:<appid>")
    var libHours = {}, ach = {};
    steamList.forEach(function (s) { ((s.steam && s.steam.library) || []).forEach(function (g) { libHours[g.appid] = Math.max(libHours[g.appid] || 0, g.hours || 0); }); });
    Object.keys(c).forEach(function (k) { if (/^ach:\d+$/.test(k) && c[k].data) ach[k.slice(4)] = c[k].data; });
    var badge = p.preview ? 'Vorschau: so sehen dich ' + { friend: 'Freunde', known: 'Bekannte', public: 'alle mit öffentlichem Profil' }[p.tier]
      : p.tier === 'public' ? 'Öffentliches Profil' : p.tier === 'known' ? 'Für Bekannte' : '';
    var v = {
      demo: false, mine: p.mine, owner: p.owner, tagline: pr.tagline, tier: p.tier, sections: sec, badge: badge,
      agent: null, valList: valList, val: null, valState: vals.length ? 'loading' : 'none', valSel: 0,
      valSkins: (p.val_items || []).length ? 'loading' : null,
      steamList: steamList, steam: null, steamState: sts.length ? 'loading' : 'none', steamSel: 0, favs: p.steam_favs || [],
      heroGames: (p.steam_favs || []).concat((s0 && s0.top) || []),
      pioneer: pr.pioneer, mcSkins: skins, mcActive: pr.mc_active_skin || (md && md.skin ? 'account' : null),
      mcName: md ? md.name || '' : first && !first.masked ? first.handle : '',
      mcNames: mcs.map(function (a) { var d = data(a.kind); return d && d.name ? d.name : a.masked ? '' : a.handle; }),
      server: pr.mc_server ? { kind: 'fav', address: pr.mc_server, data: data('mcserver'), error: err('mcserver'), fetched: c.mcserver && c.mcserver.fetched_at } : null,
      accounts: acc.map(function (a) { return Object.assign({}, a, { data: data(a.kind) }); }),
      discord: dd, custom: p.custom || [], ach: ach, libHours: libHours,
      showValue: p.mine || sec.value !== false, statsPick: (pr.layout && pr.layout.stats) || null,
      tabs: tabsOf(p)
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

  // Live-Daten erneuern (gp-sync entscheidet, was veraltet ist); force nur fuer das eigene Profil, hoechstens alle 5 min.
  // In der Vorschau "Ansehen als" kommt der Cache ungefiltert zurueck: dann die Vorschau neu laden statt ihn zu nehmen.
  async function refresh(force) {
    var id = current, p = shown, btn = $('btnRefresh');
    btn.disabled = true; btn.classList.add('spin');
    try {
      var r = await Api.fn('gp-sync', { action: 'refresh', owner: id, force: !!force });
      if (id !== current || p !== shown) return;
      if (r && r.cache) {
        if (p.preview) { if ((r.updated || []).length) open(id); return; }
        p.cache = r.cache;
        if ((r.updated || []).length) draw(p);
        if ((r.updated || []).some(function (k) { return /^steam/.test(k); })) loadTeam(false);
        if (force) toast((r.updated || []).length ? 'Live-Daten aktualisiert' : 'Schon aktuell (höchstens alle 5 Minuten neu)');
        var missing = [];
        if (r.configured && !r.configured.valorant && (p.accounts || []).some(function (a) { return /^valorant/.test(a.kind); })) missing.push('Valorant');
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

  // ---------------------------------------------------------------- Ausstellung
  // Nur mit eigenem oeffentlichem Profil (gp_showcase wirft sonst no_public); Klick auf eine Karte oeffnet das Profil
  async function showcase(on) {
    var sec = $('ausstellung'), b = $('btnShow');
    sec.hidden = !on; b.setAttribute('aria-expanded', String(on)); b.classList.toggle('on', on);
    if (!on) return;
    sec.textContent = ''; sec.appendChild(el('p', 'muted', 'Ausstellung wird geladen …'));
    try {
      var l = await Api.rpc('gp_showcase');
      Gaming.showcase(sec, l || [], function (id) { open(id); $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    } catch (e) {
      sec.textContent = '';
      var box = el('div', 'empty-state');
      if ((e.code || e.message) === 'no_public') {
        box.appendChild(el('h3', '', 'Erst ein öffentliches Profil'));
        box.appendChild(el('p', '', 'Die Ausstellung sehen nur alle, die selbst ein öffentliches Profil zeigen. Leg im Editor fest, was dort stehen soll (Spielernamen sind gekürzt, Werte bleiben verborgen).'));
        var go = el('button', 'btn small', 'Öffentliches Profil einrichten'); go.type = 'button'; go.addEventListener('click', function () { edit('oeffentlich'); }); box.appendChild(go);
      } else box.appendChild(el('p', 'msg err', errText(e)));
      sec.appendChild(box);
    }
  }

  // ---------------------------------------------------------------- Bearbeiten, Teilen, Abmelden
  function edit(tab) {
    if (!shown || !shown.mine || shown.preview) { asView = ''; $('asSel').value = ''; return open(me).then(function () { if (shown && shown.mine) edit(tab); }); }
    Editor.open(shown, function () {
      // nach dem Bearbeiten neu laden; danach holt gp-sync die Live-Daten fuer neue Konten
      loadPeople().then(paintBar).catch(function () {});
      loadTeam(false);
      if (!$('ausstellung').hidden) showcase(true);
      open(me);
    }, tab);
  }
  // tab: Bereich des Editors; hoursOf: Konto-Art, deren leeres Spielzeit-Feld gleich den Fokus bekommt (z. B. 'valorant')
  Gaming.onEdit = function (tab, hoursOf) {
    var p = edit(typeof tab === 'string' ? tab : undefined);
    if (hoursOf) Promise.resolve(p).then(function () {
      setTimeout(function () {
        var all = Array.prototype.slice.call(document.querySelectorAll('#gdlg form[data-kind^="' + hoursOf + '"] input[name="hours"]'));
        var f = all.filter(function (x) { return !x.value; })[0] || all[0];
        if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); }
      }, 60);
    });
  };
  // Auswahl auf der Buehne merkt sich das eigene Profil (Steam-Figur, aktiver Minecraft-Skin); nicht in der Vorschau
  var ownLive = function () { return shown && shown.mine && !shown.preview; };
  Gaming.pioneer.onPick = function (id) { if (ownLive()) Api.upsert('gp_profiles', [{ id: me, pioneer: id, updated_at: new Date().toISOString() }]).then(function () { if (shown.profile) shown.profile.pioneer = id; }).catch(function () {}); };
  Gaming.onMcSkin = function (id) {
    if (!ownLive()) return;
    Api.upsert('gp_profiles', [{ id: me, mc_active_skin: /^[0-9a-f-]{36}$/.test(id) ? id : null, updated_at: new Date().toISOString() }])
      .then(function () { if (shown.profile) shown.profile.mc_active_skin = /^[0-9a-f-]{36}$/.test(id) ? id : null; }).catch(function () {});
  };
  // Menue "⋯" der Profil-Leiste: oeffnet unter dem Knopf, schliesst bei Klick daneben, Escape oder nach einer Aktion
  (function () {
    var btn = $('btnMore'), menu = $('pbarMenu');
    function items() { return Array.prototype.filter.call(menu.querySelectorAll('button, select'), function (x) { return !x.closest('[hidden]'); }); }
    function set(open, focus) {
      menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.classList.toggle('on', open);
      if (open && focus) { var f = items()[0]; if (f) f.focus(); }
    }
    btn.addEventListener('click', function () { set(menu.hidden, true); });
    menu.addEventListener('click', function (e) { if (e.target.closest('button')) set(false); });
    menu.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); set(false); btn.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (e.target.tagName === 'SELECT') return;
      e.preventDefault(); var l = items(), i = l.indexOf(document.activeElement);
      l[(i + (e.key === 'ArrowDown' ? 1 : -1) + l.length) % l.length].focus();
    });
    document.addEventListener('click', function (e) { if (!menu.hidden && !e.target.closest('.pmenu')) set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { set(false); btn.focus(); } });
    $('asSel').addEventListener('change', function () { set(false); });
  })();
  $('btnEdit').addEventListener('click', function () { edit(); });
  $('navEdit').addEventListener('click', function (e) { e.preventDefault(); if (Api.user) edit(); });
  $('btnShare').addEventListener('click', function () { Editor.share(); });
  $('btnShow').addEventListener('click', function () { showcase($('ausstellung').hidden); });
  $('asSel').addEventListener('change', function (e) { asView = e.target.value; open(me); });
  $('btnRefresh').addEventListener('click', function () { refresh(current === me && !(shown && shown.preview)); });
  $('btnLogout').addEventListener('click', function () { Api.signOut(); });
  window.GProfile = { edit: edit, reload: function () { return open(current || me); } };

  if (Api.user) app(); else gate();
})();
