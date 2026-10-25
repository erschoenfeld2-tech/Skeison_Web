// Wunschliste: Startseite, Uebersicht, Listen mit Wunschkarten, Reservierungen, Freunde, Gruppen und Profil.
// Seiten werden per Adresse gewaehlt (./?liste=…, ./?seite=freunde …), damit Links und Zurueck-Taste funktionieren.
(function () {
  'use strict';
  var FX = window.FX || { reduced: false, toast: function () {}, reveal: function (e) { e.classList.add('in'); } };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var app = $('#app'), dlg = $('#dlg');
  var me = null, isAdmin = false, seq = 0;
  var DISCORD = 'https://discord.gg/tjVKFGMRw7';

  var THEMES = [
    { id: 'polarlicht', name: 'Polarlicht', desc: 'Nachthimmel mit Nordlicht und Glas-Karten' },
    { id: 'geschenkpapier', name: 'Geschenkpapier', desc: 'Packpapier, Schleife und Wünsche als Anhänger' },
    { id: 'pixel', name: 'Pixel-Inventar', desc: 'Retro-Pixel wie im Spiel, Herzenswünsche sind verzaubert' },
    { id: 'kaufhaus', name: 'Concept Store', desc: 'Klar und edel wie ein Online-Shop' },
    { id: 'magazin', name: 'Magazin', desc: 'Große Typo wie im Hochglanz-Katalog' }
  ];
  var EMOJIS = '🎁 🎄 🎂 🎉 💍 🍼 🏡 🎓 🐣 ⭐ 🦊 🐻 🐼 🐸 🦄 🐙 🌻 🍀 🌈 🔥 ⚡ 🎮 🎧 📚 🎨 ⚽ 🚲 ✈️ 🍕 ☕ 👾 🧸'.split(' ');
  var GROUP_EMOJIS = '👪 ❤️ 🏠 🎓 💼 ⚽ 🎮 🍻 🌍 ⭐ 👵 🧑‍🤝‍🧑'.split(' ');
  var COLORS = ['#ffcb05', '#ff6b6b', '#ff9f43', '#2ecc71', '#1abc9c', '#5b85ff', '#a55eea', '#ff5fa2', '#8395a7', '#e1b12c'];
  var RELATIONS = ['Mutter', 'Vater', 'Schwester', 'Bruder', 'Oma', 'Opa', 'Tante', 'Onkel', 'Cousin', 'Cousine', 'Nichte', 'Neffe',
    'Partner/in', 'Kind', 'Schwager', 'Schwägerin', 'Schwiegermutter', 'Schwiegervater', 'Pate/Patin', 'Beste/r Freund/in', 'Freund/in', 'Kolleg/in', 'Nachbar/in'];
  var OCCASIONS = ['Geburtstag', 'Weihnachten', 'Hochzeit', 'Ostern', 'Einzug', 'Baby', 'Jubiläum', 'Abschluss', 'Einfach so'];
  var PRIO = { 1: 'Wäre nett', 2: 'Wünsche ich mir', 3: 'Herzenswunsch' };
  var VIS = { private: '🔒 Nur du', friends: '👥 Alle Freunde', custom: '🎯 Ausgewählte' };

  // ---------- Helfer ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { return /^https?:\/\/[^\s]+$/i.test(u || '') ? u : ''; }
  function isId(s) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || ''); }
  function money(v, cur) {
    if (v == null || v === '') return '';
    v = Number(v);
    try { return new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur || 'EUR', minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v); }
    catch (e) { return v + ' ' + cur; }
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function today() { var t = new Date(); t.setHours(0, 0, 0, 0); return t; }
  function asDate(s) { return new Date(s + 'T00:00:00'); }
  function daysUntil(s) { return Math.round((asDate(s) - today()) / 86400000); }
  function nextBirthday(s) {
    var b = asDate(s), t = today(), n = new Date(t.getFullYear(), b.getMonth(), b.getDate());
    if (n < t) n.setFullYear(t.getFullYear() + 1);
    return { date: n, days: Math.round((n - t) / 86400000), age: n.getFullYear() - b.getFullYear() };
  }
  function fmtDate(d, year) { return (typeof d === 'string' ? asDate(d) : d).toLocaleDateString('de-DE', year ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' }); }
  function inDays(n) { return n === 0 ? 'heute' : n === 1 ? 'morgen' : n < 0 ? 'vor ' + -n + ' Tagen' : 'in ' + n + ' Tagen'; }
  function hue(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }
  function avatar(p, cls) { return '<span class="av ' + (cls || '') + '" style="--c:' + esc(p.color) + '" aria-hidden="true">' + esc(p.avatar) + '</span>'; }
  function handle(p) { return esc(p.name) + '<span class="code">#' + esc(p.code) + '</span>'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function parsePrice(s) {
    s = String(s || '').replace(/[^\d.,]/g, '');
    if (!s) return null;
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
    var n = parseFloat(s); return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  }
  function vals(form) {
    var o = {};
    $$('input, select, textarea', form).forEach(function (el) {
      if (!el.name) return;
      if (el.type === 'checkbox') { if (el.hasAttribute('value')) { (o[el.name] = o[el.name] || []); if (el.checked) o[el.name].push(el.value); } else o[el.name] = el.checked; }
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
      else o[el.name] = el.value.trim();
    });
    return o;
  }

  var ERR = {
    invalid_credentials: 'E-Mail oder Passwort stimmt nicht.', 'Invalid login credentials': 'E-Mail oder Passwort stimmt nicht.',
    network: 'Keine Verbindung. Bitte später erneut versuchen.', exists: 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.',
    email: 'Bitte gib eine gültige E-Mail-Adresse ein.', password: 'Das Passwort braucht mindestens 8 Zeichen.', weak_password: 'Das Passwort ist zu schwach.',
    name: 'Der Anzeigename braucht 2–24 Zeichen und darf kein # enthalten.', invite: 'Der Einladungscode stimmt nicht.',
    rate: 'Zu viele Versuche. Bitte in einer Stunde erneut probieren.', already_reserved: 'Das hat gerade jemand anderes reserviert.',
    no_access: 'Diese Liste ist für dich nicht (mehr) freigegeben.', own_item: 'Eigene Wünsche kannst du nicht reservieren.',
    received: 'Dieser Wunsch wurde schon erfüllt.', bad_quantity: 'Diese Anzahl ist nicht möglich.', not_authenticated: 'Bitte melde dich erneut an.',
    no_profile: 'Dein Profil wurde nicht gefunden. Bitte melde dich ab und wieder an.',
    not_admin: 'Dafür brauchst du Admin-Rechte.', self: 'Dein eigenes Konto kannst du hier nicht löschen.', is_admin: 'Admin-Konten können hier nicht gelöscht werden.',
    over_email_send_rate_limit: 'Zu viele Versuche. Bitte später erneut probieren.', same_password: 'Das ist schon dein aktuelles Passwort.'
  };
  function errText(e) {
    var c = (e && e.code) || '';
    if (ERR[c]) return ERR[c];
    if (/check constraint|violates/i.test(c)) return 'Eine Eingabe ist ungültig oder zu lang.';
    if (/relation .* does not exist|Could not find/i.test(c)) return 'Die Wunschliste ist noch nicht eingerichtet.';
    return 'Das hat nicht geklappt. Bitte erneut versuchen.';
  }
  function say(el, text, ok) { if (!el) return; el.textContent = text; el.className = 'msg ' + (text ? ok ? 'ok' : 'err' : ''); }
  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } finally { if (btn) btn.disabled = false; }
  }
  function copy(text, label) {
    var done = function () { FX.toast((label || 'Kopiert') + ': ' + text); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, function () { FX.toast(text); });
    else FX.toast(text);
  }
  function setTheme(t) { if (t) document.body.setAttribute('data-theme', t); else document.body.removeAttribute('data-theme'); }

  // Bilder, die nicht laden, durch einen Platzhalter ersetzen
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t.tagName === 'IMG' && t.hasAttribute('data-ph')) t.outerHTML = placeholder(t.getAttribute('data-ph'), t.getAttribute('alt'));
  }, true);
  function placeholder(emoji, seed) { return '<div class="ph" style="--h:' + hue(seed) + '" aria-hidden="true"><span>' + esc(emoji || '🎁') + '</span></div>'; }

  // ---------- Dialog ----------
  function openDlg(html, cls) {
    dlg.className = 'dlg ' + (cls || '');
    dlg.innerHTML = '<div class="dlg-in">' + html + '</div>';
    if (!dlg.open) dlg.showModal();
    var f = $('[autofocus]', dlg); if (f) f.focus();
    return dlg;
  }
  dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
  function dlgHead(title) { return '<div class="dlg-head"><h2>' + title + '</h2><button type="button" class="x" data-close aria-label="Schließen">✕</button></div>'; }
  function confirmDlg(text, ok) {
    return new Promise(function (resolve) {
      openDlg(dlgHead('Sicher?') + '<p>' + esc(text) + '</p><div class="dlg-actions"><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="button" class="btn danger" id="cfOk">' + esc(ok) + '</button></div>', 'small');
      var answered = false;
      $('#cfOk', dlg).addEventListener('click', function () { answered = true; dlg.close(); resolve(true); });
      dlg.addEventListener('close', function once() { dlg.removeEventListener('close', once); if (!answered) resolve(false); });
    });
  }

  // ---------- Navigation ----------
  function route() {
    var q = new URLSearchParams(location.search);
    if (q.get('liste')) return { page: 'liste', id: q.get('liste') };
    return { page: q.get('seite') || 'home', id: q.get('id') };
  }
  function go(href, replace) {
    if (replace) history.replaceState(null, '', href); else history.pushState(null, '', href);
    render();
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="./"]');
    if (!a || e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || a.target) return;
    e.preventDefault();
    if (dlg.open) dlg.close();
    go(a.getAttribute('href'));
  });
  window.addEventListener('popstate', render);
  Api.onAuthChange(function () { me = null; isAdmin = false; render(); });

  function view(ctx, html, quiet) {
    if (ctx.stale()) return false;
    app.innerHTML = quiet ? html.replace(/ data-stagger/g, '') : html;
    if (!quiet) $$('[data-stagger]', app).forEach(function (c) {
      Array.prototype.forEach.call(c.children, function (ch, i) { ch.style.setProperty('--i', Math.min(i, 8)); });
      FX.reveal(c);
    });
    return true;
  }
  function loading() { return '<div class="loading"><div class="sk" style="height:180px"></div><div class="grid3"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div></div>'; }

  async function render() {
    var my = ++seq, ctx = { stale: function () { return my !== seq; } };
    var signedIn = !!Api.user;
    document.body.classList.toggle('is-in', signedIn);
    if (!signedIn) document.body.classList.remove('is-locked');
    if (!signedIn) { setTheme(null); landing(); return; }
    var r = route();
    $$('[data-nav]').forEach(function (a) {
      var on = a.getAttribute('data-nav') === r.page || (r.page === 'freund' && a.getAttribute('data-nav') === 'freunde');
      a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    app.onclick = app.onchange = app.oninput = app.onsubmit = null;
    if (!app.firstChild || app.getAttribute('data-page') !== r.page) app.innerHTML = loading();
    app.setAttribute('data-page', r.page);
    try {
      if (!me) {
        var rows = await Api.get('wl_profiles', 'id=eq.' + Api.user.id);
        if (!rows.length) throw Object.assign(new Error('no_profile'), { code: 'no_profile' });
        me = rows[0];
        isAdmin = (await Api.get('wl_admins', 'select=user_id&user_id=eq.' + me.id)).length > 0;
      }
      if (ctx.stale()) return;
      $('#adminLink').hidden = !isAdmin;
      document.body.classList.toggle('is-locked', me.must_change_password);
      if (me.must_change_password) return forcePassword(ctx);
      $('#meLink').innerHTML = avatar(me, 'xs') + '<span>' + esc(me.name) + '</span>';
      refreshBadge();
      await (VIEWS[r.page] || VIEWS.home)(ctx, r);
    } catch (e) {
      if (ctx.stale() || !Api.user) return;
      setTheme(me && me.theme);
      app.innerHTML = '<div class="empty big"><span class="e-ico">😕</span><h2>Da ist etwas schiefgelaufen</h2><p>' + esc(errText(e)) + '</p><a class="btn" href="./">Zur Übersicht</a></div>';
    }
  }
  function refreshBadge() {
    Api.get('wl_friendships', 'select=requester&status=eq.pending&addressee=eq.' + me.id).then(function (rows) {
      var b = $('#reqBadge'); b.textContent = rows.length; b.hidden = !rows.length;
    }).catch(function () {});
  }

  // ---------- Daten ----------
  async function loadFriends() {
    var res = await Promise.all([Api.get('wl_friendships', 'select=*'), Api.get('wl_profiles', 'id=neq.' + me.id), Api.get('wl_contacts', 'select=*')]);
    var byId = {}, cById = {}, out = { friends: [], incoming: [], outgoing: [] };
    res[1].forEach(function (p) { byId[p.id] = p; });
    res[2].forEach(function (c) { cById[c.friend] = c; });
    res[0].forEach(function (f) {
      var other = f.requester === me.id ? f.addressee : f.requester, p = byId[other];
      if (!p) return;
      p.contact = cById[other] || { relation: '', tags: [], note: '' };
      if (f.status === 'accepted') out.friends.push(p); else if (f.addressee === me.id) out.incoming.push(p); else out.outgoing.push(p);
    });
    out.friends.sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    return out;
  }
  function loadGroups() { return Api.get('wl_groups', 'select=*,wl_group_members(member)&order=created_at'); }
  async function syncLinks(table, key, id, col, values) {
    await Api.remove(table, key + '=eq.' + id);
    if (values.length) await Api.insert(table, values.map(function (v) { var o = {}; o[key] = id; o[col] = v; return o; }));
  }

  // ---------- Bausteine ----------
  function profileCard(p, opt) {
    opt = opt || {};
    var chips = [];
    if (p.birthday) { var b = nextBirthday(p.birthday); chips.push('<li><span>🎂</span>' + fmtDate(p.birthday) + ' <small>' + (b.days === 0 ? 'heute!' : inDays(b.days)) + '</small></li>'); }
    if (p.sizes) chips.push('<li><span>👕</span>' + esc(p.sizes) + '</li>');
    if (p.likes) chips.push('<li><span>💚</span>' + esc(p.likes) + '</li>');
    if (p.dislikes) chips.push('<li><span>🚫</span>' + esc(p.dislikes) + '</li>');
    var c = p.contact, label = c && (c.relation || (c.tags && c.tags.length))
      ? '<div class="pc-label" title="Nur für dich sichtbar">' + (c.relation ? '<b>' + esc(c.relation) + '</b>' : '') + (c.tags || []).map(function (t) { return '<span class="tagchip">' + esc(t) + '</span>'; }).join('') + '<small>🔒 nur für dich</small></div>' : '';
    return '<article class="pcard2 ' + (opt.big ? 'big' : '') + '" data-theme="' + esc(p.theme) + '">' +
      '<div class="pc-banner"><i></i><i></i></div>' +
      '<div class="pc-main">' + avatar(p, 'xl') +
      '<div class="pc-name"><h3>' + handle(p) + '</h3>' + (opt.copy ? '<button type="button" class="link-btn" data-act="copy-handle">Code kopieren</button>' : '') + '</div>' +
      (p.bio ? '<p class="pc-bio">' + esc(p.bio) + '</p>' : opt.self ? '<p class="pc-bio muted">Noch keine Beschreibung. <a href="./?seite=profil">Profil ausfüllen</a></p>' : '') +
      label + (chips.length ? '<ul class="pc-facts">' + chips.join('') + '</ul>' : '') + '</div></article>';
  }

  // mode: 'mine' zeigt die Sichtbarkeit, 'owner' den Besitzer, sonst nichts davon
  function listCard(l, mode) {
    var n = l.wl_items && l.wl_items[0] ? l.wl_items[0].count : 0, d = l.event_date ? daysUntil(l.event_date) : null;
    return '<a class="lcard' + (l.archived ? ' archived' : '') + '" data-theme="' + esc(l.theme) + '" href="./?liste=' + l.id + '">' +
      '<span class="lc-emoji">' + esc(l.emoji) + '</span>' +
      '<span class="lc-body"><b>' + esc(l.title) + '</b>' +
      '<small>' + [l.occasion && esc(l.occasion), l.event_date && (d >= 0 ? fmtDate(l.event_date) + ' · ' + inDays(d) : fmtDate(l.event_date, true)), plural(n, 'Wunsch', 'Wünsche')].filter(Boolean).join(' · ') + '</small>' +
      (mode === 'owner' ? '<span class="lc-owner">' + avatar(l.owner, 'xs') + esc(l.owner.name) + '</span>' : mode === 'mine' ? '<span class="lc-vis">' + (l.archived ? '📦 Archiviert' : VIS[l.visibility]) + '</span>' : '') +
      '</span>' + (d !== null && d >= 0 && d <= 30 ? '<span class="lc-cd"><b>' + d + '</b>' + (d === 1 ? 'Tag' : 'Tage') + '</span>' : '') + '</a>';
  }

  function wishCard(it, o) {
    o = o || {};
    var url = safeUrl(it.url), img = /^https:\/\//.test(it.image_url || '') ? it.image_url : '';
    var res = o.res || [], mine = null, taken = 0;
    res.forEach(function (r) { taken += r.quantity; if (r.mine) mine = r; });
    var full = !it.group_gift && taken >= it.quantity;
    var title = url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(it.title) + '</a>' : esc(it.title);
    var act = '';
    if (o.demo) act = '<button type="button" class="btn small" tabindex="-1">Reservieren</button>';
    else if (o.owner) {
      act = '<button type="button" class="btn small ghost" data-act="edit-item">Bearbeiten</button>' +
        '<button type="button" class="btn small ghost" data-act="toggle-received" title="Als erhalten markieren">' + (it.received ? '↩︎ Doch nicht' : '✓ Erhalten') + '</button>' +
        '<button type="button" class="icon-btn" data-act="del-item" aria-label="Wunsch löschen">🗑</button>';
    } else if (it.received) act = '<span class="state done">🎉 Schon erfüllt</span>';
    else if (it.group_gift) {
      var names = res.map(function (r) { return r.mine ? 'du' : r.name; });
      act = (names.length ? '<span class="state gg">🧩 ' + esc(names.join(', ')) + (names.length === 1 && !mine ? ' macht' : ' machen') + ' mit</span>' : '') +
        (mine ? '<button type="button" class="btn small ghost" data-act="unreserve">Nicht mehr mitmachen</button>' : '<button type="button" class="btn small" data-act="reserve">Mitmachen</button>');
    } else if (mine) {
      act = '<span class="state mine">✓ Von dir reserviert' + (it.quantity > 1 ? ' (' + mine.quantity + '×)' : '') + '</span>' +
        (taken < it.quantity ? '<button type="button" class="btn small ghost" data-act="reserve-more">+1</button>' : '') +
        '<button type="button" class="btn small ghost" data-act="unreserve">Freigeben</button>';
    } else if (full) {
      act = '<span class="state taken">🔒 Reserviert von ' + esc(res.map(function (r) { return r.name; }).join(', ')) + '</span>';
    } else {
      act = (taken ? '<span class="state part">Noch ' + (it.quantity - taken) + ' von ' + it.quantity + ' frei</span>' : '') + '<button type="button" class="btn small" data-act="reserve">🎁 Reservieren</button>';
    }
    return '<article class="wish p' + it.priority + (it.received ? ' got' : '') + (full && !o.owner && !mine ? ' taken' : '') + (mine ? ' mine' : '') + '" data-id="' + esc(it.id) + '">' +
      '<div class="wish-media">' + (img ? '<img src="' + esc(img) + '" alt="' + esc(it.title) + '" loading="lazy" referrerpolicy="no-referrer" data-ph="' + esc(o.emoji || '🎁') + '">' : placeholder(o.emoji, it.title)) +
      (it.price != null ? '<span class="price">' + esc(money(it.price, it.currency)) + '</span>' : '') +
      (it.priority === 3 ? '<span class="prio">♥ Herzenswunsch</span>' : '') +
      (it.quantity > 1 ? '<span class="qty">' + it.quantity + '×</span>' : '') + '</div>' +
      '<div class="wish-body"><h3>' + title + '</h3>' +
      (it.price != null ? '<p class="price-line">' + esc(money(it.price, it.currency)) + '</p>' : '') +
      (it.note ? '<p class="use"><span>Wofür</span>' + esc(it.note) + '</p>' : '') +
      '<div class="wish-meta"><span class="dots" title="' + PRIO[it.priority] + '">' + '●●●'.slice(0, it.priority) + '<i>' + '●●●'.slice(it.priority) + '</i> ' + PRIO[it.priority] + '</span>' +
      (url ? '<a class="shop" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(host(url)) + ' ↗</a>' : '') +
      (it.group_gift ? '<span class="gg-tag">🧩 Gruppengeschenk</span>' : '') + '</div>' +
      '<div class="wish-act">' + act + '</div></div></article>';
  }

  function themePicker(name, current) {
    return '<div class="tpicks">' + THEMES.map(function (t) {
      return '<label class="tpick" data-theme="' + t.id + '"><input type="radio" name="' + name + '" value="' + t.id + '"' + (t.id === current ? ' checked' : '') + '>' +
        '<span class="tp-prev"><i></i><i></i><i></i></span><b>' + t.name + '</b><small>' + t.desc + '</small></label>';
    }).join('') + '</div>';
  }
  function emojiPicker(name, list, current) {
    if (list.indexOf(current) < 0) list = [current].concat(list);
    return '<div class="epick">' + list.map(function (e) { return '<label><input type="radio" name="' + name + '" value="' + esc(e) + '"' + (e === current ? ' checked' : '') + '><span>' + esc(e) + '</span></label>'; }).join('') + '</div>';
  }
  function colorPicker(name, current) {
    return '<div class="cpick">' + COLORS.map(function (c) { return '<label style="--c:' + c + '"><input type="radio" name="' + name + '" value="' + c + '"' + (c === current ? ' checked' : '') + ' aria-label="Farbe ' + c + '"><span></span></label>'; }).join('') + '</div>';
  }
  function emptyBox(ico, title, text, action) { return '<div class="empty"><span class="e-ico">' + ico + '</span><h3>' + title + '</h3><p>' + text + '</p>' + (action || '') + '</div>'; }

  // ---------- Uebersicht ----------
  async function home(ctx) {
    var res = await Promise.all([
      Api.get('wl_lists', 'owner=eq.' + me.id + '&select=*,wl_items(count)&order=archived.asc,created_at.desc'),
      Api.get('wl_lists', 'owner=neq.' + me.id + '&archived=is.false&select=*,owner:wl_profiles(id,name,code,avatar,color),wl_items(count)&order=event_date.asc.nullslast,created_at.desc'),
      loadFriends(), Api.rpc('wl_my_reservations')
    ]);
    var mine = res[0], others = res[1], fr = res[2], gifts = res[3];
    setTheme(me.theme);
    var open = gifts.filter(function (g) { return !g.purchased; }).length;
    var ev = [];
    fr.friends.forEach(function (f) {
      if (!f.birthday) return;
      var b = nextBirthday(f.birthday);
      if (b.days <= 60) ev.push({ days: b.days, ico: f.avatar, color: f.color, title: esc(f.name) + ' hat Geburtstag', sub: fmtDate(b.date), href: './?seite=freund&id=' + f.id });
    });
    others.concat(mine.filter(function (l) { return !l.archived; })).forEach(function (l) {
      if (!l.event_date) return;
      var d = daysUntil(l.event_date);
      if (d >= 0 && d <= 90) ev.push({ days: d, ico: l.emoji, title: esc(l.title), sub: (l.owner && l.owner.name ? esc(l.owner.name) + ' · ' : 'Deine Liste · ') + fmtDate(l.event_date), href: './?liste=' + l.id });
    });
    ev.sort(function (a, b) { return a.days - b.days; });

    var hello = new Date().getHours() < 11 ? 'Guten Morgen' : new Date().getHours() < 18 ? 'Hallo' : 'Guten Abend';
    view(ctx,
      '<header class="page-head"><p class="eyebrow">' + hello + ', ' + esc(me.name) + '</p><h1>Deine Wunschwelt</h1></header>' +
      (fr.incoming.length ? '<a class="banner" href="./?seite=freunde"><span>🤝</span><b>' + plural(fr.incoming.length, 'neue Freundschaftsanfrage', 'neue Freundschaftsanfragen') + '</b><span class="arr">→</span></a>' : '') +
      '<div class="home-top" data-stagger>' + profileCard(me, { self: true, copy: true }) +
      '<div class="tiles">' +
      '<a class="tile" href="#meine"><b>' + mine.length + '</b><span>' + (mine.length === 1 ? 'Liste' : 'Listen') + '</span></a>' +
      '<a class="tile" href="./?seite=freunde"><b>' + fr.friends.length + '</b><span>' + (fr.friends.length === 1 ? 'Freund' : 'Freunde') + '</span></a>' +
      '<a class="tile" href="./?seite=geschenke"><b>' + open + '</b><span>noch zu besorgen</span></a>' +
      '<div class="tile soon"><h3>Bald anstehend</h3>' + (ev.length ? '<ul class="events">' + ev.slice(0, 5).map(function (e) {
        return '<li><a href="' + e.href + '"><span class="ev-ico"' + (e.color ? ' style="--c:' + esc(e.color) + '"' : '') + '>' + esc(e.ico) + '</span><span><b>' + e.title + '</b><small>' + e.sub + '</small></span><em>' + inDays(e.days) + '</em></a></li>';
      }).join('') + '</ul>' : '<p class="muted">Keine Anlässe in den nächsten Wochen. Trag Geburtstage im Profil und Daten bei Listen ein.</p>') + '</div>' +
      '</div></div>' +
      '<section id="meine"><div class="sec-head"><h2>Meine Listen</h2><button type="button" class="btn" data-act="new-list">+ Neue Liste</button></div>' +
      (mine.length ? '<div class="lgrid" data-stagger>' + mine.map(function (l) { return listCard(l, 'mine'); }).join('') + '</div>'
        : emptyBox('📝', 'Noch keine Liste', 'Leg deine erste Wunschliste an, z. B. für deinen Geburtstag oder Weihnachten.', '<button type="button" class="btn" data-act="new-list">Erste Liste anlegen</button>')) + '</section>' +
      '<section><div class="sec-head"><h2>Listen deiner Freunde</h2><a class="more-link" href="./?seite=freunde">Freunde verwalten <span class="arr">→</span></a></div>' +
      (others.length ? '<div class="lgrid" data-stagger>' + others.map(function (l) { return listCard(l, 'owner'); }).join('') + '</div>'
        : emptyBox('🔭', 'Noch nichts zu sehen', fr.friends.length ? 'Deine Freunde haben noch keine Liste für dich freigegeben.' : 'Füge Freunde mit ihrem Namen und Code hinzu, dann siehst du hier ihre freigegebenen Listen.', '<a class="btn ghost" href="./?seite=freunde">Freunde hinzufügen</a>')) + '</section>');
    app.onclick = function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'new-list') listDialog(null);
      if (b.dataset.act === 'copy-handle') copy(me.name + '#' + me.code, 'Code kopiert');
    };
  }

  // ---------- Liste ----------
  async function listPage(ctx, r) {
    if (!isId(r.id)) throw Object.assign(new Error('no_access'), { code: 'no_access' });
    var rows = await Api.get('wl_lists', 'id=eq.' + r.id + '&select=*,owner:wl_profiles(id,name,code,avatar,color,theme)');
    if (!rows.length) throw Object.assign(new Error('no_access'), { code: 'no_access' });
    var st = { list: rows[0], sort: 'prio', only: false, ctx: ctx };
    st.owner = st.list.owner.id === me.id;
    await loadListData(st);
    paintList(st, false);
    app.onclick = function (e) { listAction(e, st); };
    app.onchange = function (e) {
      if (e.target.name === 'sort') { st.sort = e.target.value; paintList(st, true); }
      if (e.target.name === 'only') { st.only = e.target.checked; paintList(st, true); }
    };
  }
  async function loadListData(st) {
    var res = await Promise.all([
      Api.get('wl_items', 'list_id=eq.' + st.list.id + '&order=priority.desc,created_at.asc'),
      st.owner ? Promise.resolve([]) : Api.rpc('wl_list_reservations', { p_list: st.list.id }),
      st.owner && st.list.visibility === 'custom' ? Promise.all([
        Api.get('wl_list_groups', 'list_id=eq.' + st.list.id + '&select=group:wl_groups(name,emoji)'),
        Api.get('wl_list_people', 'list_id=eq.' + st.list.id + '&select=person:wl_profiles(name)')]) : Promise.resolve(null)
    ]);
    st.items = res[0];
    st.res = {};
    res[1].forEach(function (x) { (st.res[x.item_id] = st.res[x.item_id] || []).push(x); });
    st.share = res[2] ? res[2][0].map(function (g) { return g.group.emoji + ' ' + g.group.name; }).concat(res[2][1].map(function (p) { return p.person.name; })) : null;
  }
  function paintList(st, quiet) {
    var l = st.list, items = st.items.slice(), d = l.event_date ? daysUntil(l.event_date) : null;
    setTheme(l.theme);
    var cmp = {
      prio: function (a, b) { return b.priority - a.priority; },
      cheap: function (a, b) { return (a.price == null ? 1e9 : a.price) - (b.price == null ? 1e9 : b.price); },
      pricey: function (a, b) { return (b.price == null ? -1 : b.price) - (a.price == null ? -1 : a.price); },
      new: function (a, b) { return a.created_at < b.created_at ? 1 : -1; }
    }[st.sort];
    items.sort(function (a, b) { return (a.received - b.received) || cmp(a, b); });
    var free = st.items.filter(function (it) { return isFree(it, st.res[it.id]); }).length;
    if (st.only) items = items.filter(function (it) { return st.owner ? !it.received : isFree(it, st.res[it.id]); });
    var total = st.items.reduce(function (s, it) { return s + (it.received || it.price == null ? 0 : it.price * it.quantity); }, 0);

    var vis = l.visibility === 'custom' ? '🎯 ' + (st.share && st.share.length ? esc(st.share.join(', ')) : 'noch niemand ausgewählt') : VIS[l.visibility];
    view(st.ctx,
      '<header class="list-head" data-theme="' + esc(l.theme) + '">' +
      '<p class="back"><a href="' + (st.owner ? './' : './?seite=freund&id=' + l.owner.id) + '"><span class="arr">←</span> ' + (st.owner ? 'Übersicht' : esc(l.owner.name)) + '</a></p>' +
      '<div class="lh-main"><span class="lh-emoji">' + esc(l.emoji) + '</span><div>' +
      '<p class="eyebrow">' + [l.occasion && esc(l.occasion), l.event_date && fmtDate(l.event_date, true)].filter(Boolean).join(' · ') + (l.archived ? ' · 📦 Archiviert' : '') + '</p>' +
      '<h1>' + esc(l.title) + '</h1>' + (l.description ? '<p class="lead">' + esc(l.description) + '</p>' : '') + '</div>' +
      (d !== null && d >= 0 ? '<div class="lh-cd"><b>' + d + '</b><span>' + (d === 1 ? 'Tag' : 'Tage') + (l.occasion ? ' bis ' + esc(l.occasion) : '') + '</span></div>' : '') + '</div>' +
      '<div class="lh-bar">' + (st.owner
        ? '<span class="pill" title="Wer diese Liste sehen kann">' + vis + '</span><span class="sp"></span><button type="button" class="btn ghost" data-act="edit-list">⚙ Liste bearbeiten</button><button type="button" class="btn" data-act="add-item">+ Wunsch hinzufügen</button>'
        : '<a class="owner-chip" href="./?seite=freund&id=' + l.owner.id + '">' + avatar(l.owner, 'sm') + '<span>Liste von <b>' + esc(l.owner.name) + '</b></span></a><span class="sp"></span><span class="pill">' + free + ' von ' + st.items.length + ' Wünschen noch frei</span>') + '</div>' +
      (st.owner ? '<p class="surprise">🙈 <b>Überraschungsschutz:</b> Was reserviert wurde, siehst du auf deinen eigenen Listen nicht.</p>' : '') +
      '</header>' +
      (st.items.length ? '<div class="toolbar"><label>Sortieren <select name="sort">' +
        [['prio', 'Wichtigste zuerst'], ['cheap', 'Preis aufsteigend'], ['pricey', 'Preis absteigend'], ['new', 'Neueste zuerst']].map(function (o) { return '<option value="' + o[0] + '"' + (st.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
        '</select></label><label class="check"><input type="checkbox" name="only"' + (st.only ? ' checked' : '') + '> ' + (st.owner ? 'Erhaltene ausblenden' : 'Nur freie Wünsche') + '</label>' +
        '<span class="sp"></span><span class="muted">' + plural(st.items.length, 'Wunsch', 'Wünsche') + (total ? ' · zusammen ca. ' + esc(money(total, 'EUR')) : '') + '</span></div>' : '') +
      (items.length ? '<div class="wishes" data-stagger>' + items.map(function (it) { return wishCard(it, { owner: st.owner, res: st.res[it.id], emoji: l.emoji }); }).join('') + '</div>'
        : st.items.length ? emptyBox('🎉', 'Alles vergeben', 'Mit diesem Filter ist gerade nichts übrig.')
          : st.owner ? emptyBox('✨', 'Füge deinen ersten Wunsch hinzu', 'Produktlink einfügen genügt: Bild, Titel und Preis werden automatisch übernommen.', '<button type="button" class="btn" data-act="add-item">+ Wunsch hinzufügen</button>')
            : emptyBox('🕊️', 'Noch leer', esc(l.owner.name) + ' hat hier noch keine Wünsche eingetragen.')), quiet);
  }
  function isFree(it, res) {
    if (it.received) return false;
    if (it.group_gift) return true;
    var taken = (res || []).reduce(function (s, r) { return s + r.quantity; }, 0);
    return taken < it.quantity;
  }
  async function listAction(e, st) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var card = b.closest('.wish'), it = card && st.items.filter(function (x) { return x.id === card.getAttribute('data-id'); })[0];
    var act = b.dataset.act;
    if (act === 'add-item') return itemDialog(st, null);
    if (act === 'edit-item') return itemDialog(st, it);
    if (act === 'edit-list') return listDialog(st.list);
    try {
      if (act === 'del-item') {
        if (!(await confirmDlg('„' + it.title + '“ wirklich löschen?', 'Löschen'))) return;
        await Api.remove('wl_items', 'id=eq.' + it.id); FX.toast('Wunsch gelöscht');
      } else if (act === 'toggle-received') {
        await busy(b, function () { return Api.update('wl_items', 'id=eq.' + it.id, { received: !it.received }); });
        FX.toast(it.received ? 'Wieder offen' : 'Als erhalten markiert 🎉');
      } else if (act === 'reserve' || act === 'reserve-more') {
        var mine = (st.res[it.id] || []).filter(function (r) { return r.mine; })[0];
        await busy(b, function () { return Api.rpc('wl_reserve', { p_item: it.id, p_qty: act === 'reserve-more' && mine ? mine.quantity + 1 : 1 }); });
        FX.toast(it.group_gift ? 'Du machst beim Gruppengeschenk mit 🧩' : 'Reserviert! Steht jetzt in „Meine Geschenke“ 🎁');
      } else if (act === 'unreserve') {
        await busy(b, function () { return Api.rpc('wl_unreserve', { p_item: it.id }); });
        FX.toast('Reservierung freigegeben');
      } else return;
    } catch (err) { FX.toast(errText(err)); }
    await loadListData(st).catch(function () {});
    paintList(st, true);
  }

  function itemDialog(st, it) {
    var x = it || { title: '', url: '', image_url: '', price: null, currency: 'EUR', note: '', priority: 2, quantity: 1, group_gift: false };
    openDlg(dlgHead(it ? 'Wunsch bearbeiten' : 'Neuer Wunsch') +
      '<form class="form item-form" novalidate><div class="item-grid"><div>' +
      '<label>Produktlink <small class="muted">optional</small><span class="url-row"><input name="url" type="url" inputmode="url" placeholder="https://…" value="' + esc(x.url || '') + '" autofocus><button type="button" class="btn small ghost" data-act="fetch">Vorschau laden</button></span></label>' +
      '<p class="msg fetch-msg"></p>' +
      '<label>Was wünschst du dir?<input name="title" required maxlength="120" value="' + esc(x.title) + '" placeholder="z. B. Wanderrucksack 30 l"></label>' +
      '<label>Wofür? <small class="muted">kurzer Einsatzzweck</small><textarea name="note" rows="2" maxlength="400" placeholder="z. B. Für Tagestouren in den Alpen">' + esc(x.note) + '</textarea></label>' +
      '<div class="row2"><label>Preis<input name="price" inputmode="decimal" placeholder="z. B. 49,99" value="' + (x.price != null ? esc(String(x.price).replace('.', ',')) : '') + '"></label>' +
      '<label>Währung<select name="currency">' + ['EUR', 'USD', 'GBP', 'CHF'].map(function (c) { return '<option' + (c === x.currency ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label></div>' +
      '<label>Bildadresse <small class="muted">wird mit der Vorschau gefüllt</small><input name="image_url" type="url" placeholder="https://…/bild.jpg" value="' + esc(x.image_url || '') + '"></label>' +
      '<fieldset class="prio-pick"><legend>Wie sehr wünschst du es dir?</legend>' + [1, 2, 3].map(function (p) {
        return '<label><input type="radio" name="priority" value="' + p + '"' + (x.priority === p ? ' checked' : '') + '><span>' + '●●●'.slice(0, p) + ' ' + PRIO[p] + '</span></label>';
      }).join('') + '</fieldset>' +
      '<div class="row2"><label>Anzahl<input name="quantity" type="number" min="1" max="99" value="' + x.quantity + '"></label>' +
      '<label class="check"><input type="checkbox" name="group_gift"' + (x.group_gift ? ' checked' : '') + '> 🧩 Gruppengeschenk <small class="muted">mehrere legen zusammen</small></label></div>' +
      '</div><div class="item-preview"><p class="eyebrow">Vorschau</p><div class="pv"></div></div></div>' +
      '<p class="msg save-msg"></p><div class="dlg-actions"><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="submit" class="btn">' + (it ? 'Speichern' : 'Hinzufügen') + '</button></div></form>', 'wide');
    var f = $('form', dlg), pv = $('.pv', dlg);
    function data() {
      var v = vals(f);
      return { title: v.title, url: safeUrl(v.url) || null, image_url: /^https:\/\//.test(v.image_url) ? v.image_url : null, price: parsePrice(v.price),
        currency: v.currency, note: v.note, priority: +v.priority || 2, quantity: Math.min(99, Math.max(1, +v.quantity || 1)), group_gift: v.group_gift };
    }
    function preview() { var d = data(); d.id = 'pv'; d.title = d.title || 'Dein Wunsch'; pv.innerHTML = wishCard(d, { demo: true, emoji: st.list.emoji }); }
    async function fetchPreview(btn) {
      var u = safeUrl(f.url.value.trim()), m = $('.fetch-msg', dlg);
      if (!u) return say(m, 'Bitte zuerst einen Link mit https:// einfügen.', false);
      say(m, 'Lese Produktseite …', true);
      try {
        var p = await busy(btn, function () { return Api.fn('wl-link-preview', { url: u }); });
        if (p.error) throw Object.assign(new Error(p.error), { code: p.error });
        if (p.title && (!f.title.value || btn)) f.title.value = p.title.slice(0, 120);
        if (p.image) f.image_url.value = p.image;
        if (p.price != null && (!f.price.value || btn)) { f.price.value = String(p.price).replace('.', ','); f.currency.value = ['EUR', 'USD', 'GBP', 'CHF'].indexOf(p.currency) >= 0 ? p.currency : 'EUR'; }
        if (p.description && !f.note.value) f.note.placeholder = p.description.slice(0, 120) + ' …';
        var got = [p.title && 'Titel', p.image && 'Bild', p.price != null && 'Preis'].filter(Boolean);
        say(m, got.length ? '✓ Übernommen: ' + got.join(', ') + '. Prüf kurz und ergänze den Einsatzzweck.' : 'Der Shop gibt keine Vorschau heraus. Trag Titel, Preis und ggf. Bildadresse selbst ein.', !!got.length);
      } catch (err) { say(m, 'Der Shop lässt sich gerade nicht auslesen. Trag die Angaben einfach selbst ein.', false); }
      preview();
    }
    f.addEventListener('input', preview);
    f.addEventListener('change', preview);
    f.url.addEventListener('paste', function () { setTimeout(function () { if (safeUrl(f.url.value.trim())) fetchPreview(null); }, 0); });
    $('[data-act="fetch"]', f).addEventListener('click', function (e) { fetchPreview(e.currentTarget); });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var d = data(), m = $('.save-msg', dlg);
      if (!d.title) return say(m, 'Bitte gib an, was du dir wünschst.', false);
      if (f.url.value.trim() && !d.url) return say(m, 'Der Link muss mit https:// beginnen.', false);
      try {
        await busy($('[type=submit]', f), function () { return it ? Api.update('wl_items', 'id=eq.' + it.id, d) : Api.insert('wl_items', Object.assign({ list_id: st.list.id }, d)); });
        dlg.close(); FX.toast(it ? 'Gespeichert' : 'Wunsch hinzugefügt ✨');
        await loadListData(st); paintList(st, true);
      } catch (err) { say(m, errText(err), false); }
    });
    preview();
  }

  async function listDialog(l) {
    var res = await Promise.all([loadFriends(), loadGroups(), l ? Api.get('wl_list_groups', 'list_id=eq.' + l.id) : [], l ? Api.get('wl_list_people', 'list_id=eq.' + l.id) : []]).catch(function (e) { FX.toast(errText(e)); return null; });
    if (!res) return;
    var friends = res[0].friends, groups = res[1];
    var gSel = res[2].map(function (x) { return x.group_id; }), pSel = res[3].map(function (x) { return x.person; });
    var x = l || { title: '', description: '', emoji: '🎁', theme: me.theme, occasion: '', event_date: null, visibility: 'friends', archived: false };
    openDlg(dlgHead(l ? 'Liste bearbeiten' : 'Neue Wunschliste') +
      '<form class="form" novalidate>' +
      '<div class="row2 wide-first"><label>Titel<input name="title" required maxlength="60" value="' + esc(x.title) + '" placeholder="z. B. Mein 30. Geburtstag" autofocus></label>' +
      '<label>Anlass<input name="occasion" maxlength="40" list="occasions" value="' + esc(x.occasion) + '" placeholder="Geburtstag"></label></div>' +
      '<datalist id="occasions">' + OCCASIONS.map(function (o) { return '<option value="' + o + '">'; }).join('') + '</datalist>' +
      '<div class="row2"><label>Datum <small class="muted">für den Countdown</small><input name="event_date" type="date" value="' + esc(x.event_date || '') + '"></label>' +
      '<label class="check"><input type="checkbox" name="archived"' + (x.archived ? ' checked' : '') + '> 📦 Archiviert <small class="muted">ausgeblendet bei Freunden</small></label></div>' +
      '<label>Beschreibung <small class="muted">optional</small><textarea name="description" rows="2" maxlength="500" placeholder="Ein paar Worte an alle, die schenken wollen">' + esc(x.description) + '</textarea></label>' +
      '<fieldset><legend>Symbol</legend>' + emojiPicker('emoji', EMOJIS, x.emoji) + '</fieldset>' +
      '<fieldset><legend>Design</legend>' + themePicker('theme', x.theme) + '</fieldset>' +
      '<fieldset class="vis"><legend>Wer darf die Liste sehen und reservieren?</legend>' +
      [['private', '🔒 Nur ich', 'Entwurf, für niemanden sichtbar'], ['friends', '👥 Alle Freunde', 'Jeder bestätigte Freund'], ['custom', '🎯 Ausgewählte', 'Nur bestimmte Gruppen und Personen']].map(function (o) {
        return '<label class="vopt"><input type="radio" name="visibility" value="' + o[0] + '"' + (x.visibility === o[0] ? ' checked' : '') + '><span><b>' + o[1] + '</b><small>' + o[2] + '</small></span></label>';
      }).join('') +
      '<div class="pick-who"' + (x.visibility === 'custom' ? '' : ' hidden') + '>' +
      '<p class="eyebrow">Gruppen</p>' + (groups.length ? '<div class="checks">' + groups.map(function (g) {
        return '<label class="cchip"><input type="checkbox" name="groups" value="' + g.id + '"' + (gSel.indexOf(g.id) >= 0 ? ' checked' : '') + '><span style="--c:' + esc(g.color) + '">' + esc(g.emoji) + ' ' + esc(g.name) + ' <small>' + g.wl_group_members.length + '</small></span></label>';
      }).join('') + '</div>' : '<p class="muted small">Noch keine Gruppen. Lege sie unter <a href="./?seite=freunde">Freunde</a> an.</p>') +
      '<p class="eyebrow">Einzelne Personen</p>' + (friends.length ? '<div class="checks">' + friends.map(function (p) {
        return '<label class="cchip"><input type="checkbox" name="people" value="' + p.id + '"' + (pSel.indexOf(p.id) >= 0 ? ' checked' : '') + '><span>' + avatar(p, 'xs') + esc(p.name) + (p.contact.relation ? ' <small>' + esc(p.contact.relation) + '</small>' : '') + '</span></label>';
      }).join('') + '</div>' : '<p class="muted small">Noch keine Freunde.</p>') + '</div></fieldset>' +
      '<p class="msg"></p><div class="dlg-actions">' + (l ? '<button type="button" class="btn ghost danger-text" data-act="del-list">Liste löschen</button><span class="sp"></span>' : '') +
      '<button type="button" class="btn ghost" data-close>Abbrechen</button><button type="submit" class="btn">' + (l ? 'Speichern' : 'Liste anlegen') + '</button></div></form>', 'wide');
    var f = $('form', dlg);
    f.addEventListener('change', function () { $('.pick-who', f).hidden = vals(f).visibility !== 'custom'; });
    if (l) $('[data-act="del-list"]', f).addEventListener('click', async function () {
      if (!(await confirmDlg('Die Liste „' + l.title + '“ mit allen Wünschen und Reservierungen löschen?', 'Endgültig löschen'))) return;
      try { await Api.remove('wl_lists', 'id=eq.' + l.id); FX.toast('Liste gelöscht'); go('./', true); } catch (err) { FX.toast(errText(err)); }
    });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = vals(f), m = $('.msg', f);
      if (!v.title) return say(m, 'Bitte gib der Liste einen Titel.', false);
      var row = { title: v.title, occasion: v.occasion, event_date: v.event_date || null, description: v.description, emoji: v.emoji || '🎁', theme: v.theme || 'polarlicht', visibility: v.visibility || 'private', archived: !!v.archived };
      try {
        var saved = await busy($('[type=submit]', f), async function () {
          var out = l ? await Api.update('wl_lists', 'id=eq.' + l.id, row) : await Api.insert('wl_lists', row);
          var id = out[0].id;
          await syncLinks('wl_list_groups', 'list_id', id, 'group_id', row.visibility === 'custom' ? v.groups || [] : []);
          await syncLinks('wl_list_people', 'list_id', id, 'person', row.visibility === 'custom' ? v.people || [] : []);
          return out[0];
        });
        dlg.close(); FX.toast(l ? 'Liste gespeichert' : 'Liste angelegt 🎉');
        if (l) render(); else go('./?liste=' + saved.id);
      } catch (err) { say(m, errText(err), false); }
    });
  }

  // ---------- Freunde & Gruppen ----------
  async function friendsPage(ctx) {
    var res = await Promise.all([loadFriends(), loadGroups()]);
    var fr = res[0], groups = res[1], q = '', filter = '';
    setTheme(me.theme);
    var byId = {}; fr.friends.forEach(function (f) { byId[f.id] = f; });
    var labels = {};
    fr.friends.forEach(function (f) { if (f.contact.relation) labels[f.contact.relation] = 1; (f.contact.tags || []).forEach(function (t) { labels[t] = 1; }); });
    labels = Object.keys(labels).sort(function (a, b) { return a.localeCompare(b, 'de'); });

    function friendCard(p) {
      var b = p.birthday ? nextBirthday(p.birthday) : null;
      return '<article class="fcard" data-id="' + p.id + '">' +
        '<a class="fc-main" href="./?seite=freund&id=' + p.id + '">' + avatar(p, 'lg') + '<span><b>' + handle(p) + '</b>' +
        (p.contact.relation ? '<em>' + esc(p.contact.relation) + '</em>' : '') +
        (b && b.days <= 30 ? '<small>🎂 ' + (b.days === 0 ? 'Heute Geburtstag!' : 'Geburtstag ' + inDays(b.days)) + '</small>' : p.bio ? '<small>' + esc(p.bio) + '</small>' : '') + '</span></a>' +
        ((p.contact.tags || []).length ? '<div class="tags">' + p.contact.tags.map(function (t) { return '<span class="tagchip">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
        '<button type="button" class="link-btn" data-act="label">🏷 Kennzeichnen</button></article>';
    }
    function paintGrid() {
      var list = fr.friends.filter(function (p) {
        var hay = (p.name + ' ' + p.code + ' ' + p.contact.relation + ' ' + (p.contact.tags || []).join(' ')).toLowerCase();
        return (!q || hay.indexOf(q) >= 0) && (!filter || p.contact.relation === filter || (p.contact.tags || []).indexOf(filter) >= 0);
      });
      $('#fgrid').innerHTML = list.length ? list.map(friendCard).join('') : '<p class="muted">Keine Treffer.</p>';
    }
    function person(p, btns) { return '<li>' + avatar(p, 'sm') + '<span><b>' + handle(p) + '</b>' + (p.bio ? '<small>' + esc(p.bio) + '</small>' : '') + '</span><span class="sp"></span>' + btns + '</li>'; }

    view(ctx,
      '<header class="page-head"><p class="eyebrow">Nur Freunde sehen sich gegenseitig</p><h1>Freunde &amp; Gruppen</h1></header>' +
      '<div class="friends-top" data-stagger>' +
      '<div class="panel handle-box"><p class="eyebrow">Dein Freundescode</p><button type="button" class="handle-big" data-act="copy-handle">' + handle(me) + ' <small>kopieren</small></button>' +
      '<p class="muted small">Schick ihn Freunden und Familie. Sie geben ihn bei sich ein, du bestätigst die Anfrage, fertig.</p></div>' +
      '<form class="panel add-friend" novalidate><label>Freund hinzufügen<span class="url-row"><input name="handle" placeholder="Name#CODE" autocomplete="off" maxlength="40" required><button type="submit" class="btn">Anfrage senden</button></span></label><p class="msg"></p></form>' +
      '</div>' +
      (fr.incoming.length || fr.outgoing.length ? '<section class="requests"><h2>Anfragen</h2><ul class="plist">' +
        fr.incoming.map(function (p) { return person(p, '<button type="button" class="btn small" data-act="accept" data-id="' + p.id + '">Annehmen</button><button type="button" class="btn small ghost" data-act="decline" data-id="' + p.id + '">Ablehnen</button>'); }).join('') +
        fr.outgoing.map(function (p) { return person(p, '<span class="muted small">wartet auf Bestätigung</span><button type="button" class="btn small ghost" data-act="decline" data-id="' + p.id + '">Zurückziehen</button>'); }).join('') +
        '</ul></section>' : '') +
      '<section><div class="sec-head"><h2>Deine Freunde <small class="muted">' + fr.friends.length + '</small></h2>' +
      (fr.friends.length ? '<div class="filters"><input type="search" name="q" placeholder="Suchen …" aria-label="Freunde suchen">' +
        (labels.length ? '<select name="filter" aria-label="Nach Rolle oder Tag filtern"><option value="">Alle Rollen &amp; Tags</option>' + labels.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select>' : '') + '</div>' : '') + '</div>' +
      (fr.friends.length ? '<div class="fgrid" id="fgrid"></div>' : emptyBox('🤝', 'Noch keine Freunde', 'Gib oben den Namen mit Code eines Freundes ein, z. B. <code>Anna#4F7KD</code>.')) + '</section>' +
      '<section><div class="sec-head"><h2>Gruppen</h2><button type="button" class="btn" data-act="new-group"' + (fr.friends.length ? '' : ' disabled') + '>+ Neue Gruppe</button></div>' +
      '<p class="muted">Nur du siehst deine Gruppen. Mitglieder erfahren nicht, in welcher Gruppe sie sind. Gib Listen für ganze Gruppen frei.</p>' +
      (groups.length ? '<div class="ggrid" data-stagger>' + groups.map(function (g) {
        var ms = g.wl_group_members.map(function (m) { return byId[m.member]; }).filter(Boolean);
        return '<article class="gcard" style="--c:' + esc(g.color) + '" data-id="' + g.id + '"><div class="gc-head"><span class="gc-ico">' + esc(g.emoji) + '</span><b>' + esc(g.name) + '</b><button type="button" class="link-btn" data-act="edit-group">Bearbeiten</button></div>' +
          '<div class="stack">' + (ms.length ? ms.slice(0, 8).map(function (p) { return avatar(p, 'sm'); }).join('') + (ms.length > 8 ? '<span class="more">+' + (ms.length - 8) + '</span>' : '') : '<span class="muted small">Noch leer</span>') + '</div>' +
          '<small class="muted">' + (ms.length ? esc(ms.map(function (p) { return p.name; }).join(', ')) : '') + '</small></article>';
      }).join('') + '</div>' : emptyBox('👪', 'Noch keine Gruppen', 'z. B. „Familie“, „Uni“ oder „Wichtel 2026“.')) + '</section>');
    if (fr.friends.length) paintGrid();

    app.oninput = function (e) {
      if (e.target.name === 'q') { q = e.target.value.trim().toLowerCase(); paintGrid(); }
    };
    app.onchange = function (e) { if (e.target.name === 'filter') { filter = e.target.value; paintGrid(); } };
    app.onsubmit = async function (e) {
      e.preventDefault();
      var f = e.target, m = $('.msg', f), h = f.handle.value.trim();
      if (!/^.{2,24}#[A-Za-z0-9]{5}$/.test(h)) return say(m, 'Bitte im Format Name#CODE eingeben, z. B. Anna#4F7KD.', false);
      try {
        var r = await busy($('[type=submit]', f), function () { return Api.rpc('wl_add_friend', { p_handle: h }); });
        var txt = { requested: ['Anfrage gesendet! Sobald sie bestätigt ist, seht ihr euch.', true], accepted: ['Ihr seid jetzt befreundet 🎉', true],
          not_found: ['Niemanden mit diesem Namen und Code gefunden.', false], self: ['Das bist du selbst 😉', false],
          already_friends: ['Ihr seid schon befreundet.', true], already_requested: ['Anfrage wurde schon gesendet.', true], invalid: ['Bitte im Format Name#CODE eingeben.', false] }[r] || ['Erledigt.', true];
        if (r === 'requested' || r === 'accepted') { FX.toast(txt[0]); render(); } else say(m, txt[0], txt[1]);
      } catch (err) { say(m, errText(err), false); }
    };
    app.onclick = async function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var holder = b.closest('[data-id]'), act = b.dataset.act, id = holder && holder.getAttribute('data-id');
      if (act === 'copy-handle') return copy(me.name + '#' + me.code, 'Code kopiert');
      if (act === 'label') return labelDialog(byId[id], render);
      if (act === 'new-group') return groupDialog(null, fr.friends);
      if (act === 'edit-group') return groupDialog(groups.filter(function (g) { return g.id === id; })[0], fr.friends);
      try {
        if (act === 'accept') { await busy(b, function () { return Api.rpc('wl_accept_friend', { p_other: id }); }); FX.toast('Freundschaft bestätigt 🎉'); }
        if (act === 'decline') { await busy(b, function () { return Api.rpc('wl_remove_friend', { p_other: id }); }); FX.toast('Anfrage entfernt'); }
        render();
      } catch (err) { FX.toast(errText(err)); }
    };
  }

  function labelDialog(p, done) {
    var c = p.contact;
    openDlg(dlgHead('Kennzeichnung für ' + esc(p.name)) +
      '<form class="form" novalidate><p class="muted small">🔒 Nur du siehst diese Angaben. ' + esc(p.name) + ' erfährt davon nichts.</p>' +
      '<label>Rolle / Verwandtschaft<input name="relation" list="relations" maxlength="40" value="' + esc(c.relation) + '" placeholder="z. B. Schwester, Kollegin …" autofocus></label>' +
      '<datalist id="relations">' + RELATIONS.map(function (r) { return '<option value="' + esc(r) + '">'; }).join('') + '</datalist>' +
      '<div class="quick">' + ['Mutter', 'Vater', 'Schwester', 'Bruder', 'Oma', 'Opa', 'Partner/in', 'Freund/in'].map(function (r) { return '<button type="button" class="chip" data-rel="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>' +
      '<label>Eigene Tags <small class="muted">mit Komma trennen</small><input name="tags" maxlength="300" value="' + esc((c.tags || []).join(', ')) + '" placeholder="z. B. Wichteln, Uni, Fußball"></label>' +
      '<label>Notiz <small class="muted">z. B. Geschenkideen</small><textarea name="note" rows="3" maxlength="300">' + esc(c.note) + '</textarea></label>' +
      '<p class="msg"></p><div class="dlg-actions"><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="submit" class="btn">Speichern</button></div></form>', 'small');
    var f = $('form', dlg);
    f.addEventListener('click', function (e) { var r = e.target.closest('[data-rel]'); if (r) f.relation.value = r.getAttribute('data-rel'); });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = vals(f), tags = v.tags.split(',').map(function (t) { return t.trim().slice(0, 30); }).filter(Boolean).slice(0, 12);
      try {
        await busy($('[type=submit]', f), function () { return Api.upsert('wl_contacts', { owner: me.id, friend: p.id, relation: v.relation, tags: tags, note: v.note }); });
        dlg.close(); FX.toast('Gespeichert'); done();
      } catch (err) { say($('.msg', f), errText(err), false); }
    });
  }

  function groupDialog(g, friends) {
    var x = g || { name: '', emoji: '👪', color: '#5b85ff', wl_group_members: [] }, sel = x.wl_group_members.map(function (m) { return m.member; });
    openDlg(dlgHead(g ? 'Gruppe bearbeiten' : 'Neue Gruppe') +
      '<form class="form" novalidate><label>Name<input name="name" required maxlength="40" value="' + esc(x.name) + '" placeholder="z. B. Familie" autofocus></label>' +
      '<fieldset><legend>Symbol</legend>' + emojiPicker('emoji', GROUP_EMOJIS, x.emoji) + '</fieldset>' +
      '<fieldset><legend>Farbe</legend>' + colorPicker('color', x.color) + '</fieldset>' +
      '<fieldset><legend>Mitglieder</legend><div class="checks">' + friends.map(function (p) {
        return '<label class="cchip"><input type="checkbox" name="members" value="' + p.id + '"' + (sel.indexOf(p.id) >= 0 ? ' checked' : '') + '><span>' + avatar(p, 'xs') + esc(p.name) + (p.contact.relation ? ' <small>' + esc(p.contact.relation) + '</small>' : '') + '</span></label>';
      }).join('') + '</div></fieldset>' +
      '<p class="msg"></p><div class="dlg-actions">' + (g ? '<button type="button" class="btn ghost danger-text" data-act="del-group">Gruppe löschen</button><span class="sp"></span>' : '') +
      '<button type="button" class="btn ghost" data-close>Abbrechen</button><button type="submit" class="btn">Speichern</button></div></form>');
    var f = $('form', dlg);
    if (g) $('[data-act="del-group"]', f).addEventListener('click', async function () {
      if (!(await confirmDlg('Gruppe „' + g.name + '“ löschen? Listen, die nur für diese Gruppe freigegeben waren, sehen deren Mitglieder dann nicht mehr.', 'Löschen'))) return;
      try { await Api.remove('wl_groups', 'id=eq.' + g.id); FX.toast('Gruppe gelöscht'); render(); } catch (err) { FX.toast(errText(err)); }
    });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = vals(f), m = $('.msg', f);
      if (!v.name) return say(m, 'Bitte gib der Gruppe einen Namen.', false);
      try {
        await busy($('[type=submit]', f), async function () {
          var row = { name: v.name, emoji: v.emoji || '👪', color: v.color || '#5b85ff' };
          var out = g ? await Api.update('wl_groups', 'id=eq.' + g.id, row) : await Api.insert('wl_groups', row);
          await syncLinks('wl_group_members', 'group_id', out[0].id, 'member', v.members || []);
        });
        dlg.close(); FX.toast('Gruppe gespeichert'); render();
      } catch (err) { say(m, errText(err), false); }
    });
  }

  async function friendPage(ctx, r) {
    if (!isId(r.id)) throw Object.assign(new Error('no_access'), { code: 'no_access' });
    if (r.id === me.id) return go('./?seite=profil', true);
    var res = await Promise.all([loadFriends(), Api.get('wl_lists', 'owner=eq.' + r.id + '&archived=is.false&select=*,wl_items(count)&order=event_date.asc.nullslast'), loadGroups()]);
    var fr = res[0], p = fr.friends.filter(function (x) { return x.id === r.id; })[0];
    if (!p) throw Object.assign(new Error('no_access'), { code: 'no_access' });
    var groups = res[2];
    setTheme(p.theme);
    view(ctx,
      '<p class="back"><a href="./?seite=freunde"><span class="arr">←</span> Freunde</a></p>' +
      '<div class="friend-top" data-stagger>' + profileCard(p, { big: true }) +
      '<div class="panel"><h3>Deine Kennzeichnung</h3><p class="muted small">🔒 Nur für dich sichtbar.</p>' +
      '<p>' + (p.contact.relation ? '<b>' + esc(p.contact.relation) + '</b> ' : '<span class="muted">Keine Rolle</span> ') + (p.contact.tags || []).map(function (t) { return '<span class="tagchip">' + esc(t) + '</span>'; }).join('') + '</p>' +
      (p.contact.note ? '<p class="note">📝 ' + esc(p.contact.note) + '</p>' : '') +
      '<button type="button" class="btn small ghost" data-act="label">🏷 Bearbeiten</button>' +
      (groups.length ? '<h3>In deinen Gruppen</h3><div class="checks">' + groups.map(function (g) {
        var on = g.wl_group_members.some(function (m) { return m.member === p.id; });
        return '<label class="cchip"><input type="checkbox" data-group="' + g.id + '"' + (on ? ' checked' : '') + '><span style="--c:' + esc(g.color) + '">' + esc(g.emoji) + ' ' + esc(g.name) + '</span></label>';
      }).join('') + '</div>' : '') +
      '<button type="button" class="link-btn danger-text" data-act="unfriend">Freundschaft beenden</button></div></div>' +
      '<section><div class="sec-head"><h2>Listen von ' + esc(p.name) + '</h2></div>' +
      (res[1].length ? '<div class="lgrid" data-stagger>' + res[1].map(function (l) { return listCard(l); }).join('') + '</div>'
        : emptyBox('🎈', 'Keine Listen für dich', esc(p.name) + ' hat (noch) keine Liste für dich freigegeben.')) + '</section>');
    app.onchange = async function (e) {
      var gid = e.target.getAttribute('data-group'); if (!gid) return;
      try {
        if (e.target.checked) await Api.insert('wl_group_members', { group_id: gid, member: p.id });
        else await Api.remove('wl_group_members', 'group_id=eq.' + gid + '&member=eq.' + p.id);
        FX.toast(e.target.checked ? 'Zur Gruppe hinzugefügt' : 'Aus Gruppe entfernt');
      } catch (err) { e.target.checked = !e.target.checked; FX.toast(errText(err)); }
    };
    app.onclick = async function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'label') labelDialog(p, render);
      if (b.dataset.act === 'unfriend') {
        if (!(await confirmDlg('Freundschaft mit ' + p.name + ' beenden? Ihr seht dann gegenseitig keine Listen mehr, Gruppen und Kennzeichnungen werden entfernt.', 'Beenden'))) return;
        try { await Api.rpc('wl_remove_friend', { p_other: p.id }); FX.toast('Freundschaft beendet'); go('./?seite=freunde', true); } catch (err) { FX.toast(errText(err)); }
      }
    };
  }

  // ---------- Meine Geschenke ----------
  async function giftsPage(ctx, r, quiet) {
    var rows = await Api.rpc('wl_my_reservations');
    setTheme(me.theme);
    var budget = 0, spent = 0, done = 0, groups = {}, order = [];
    rows.forEach(function (g) {
      var cost = g.price == null || g.group_gift ? 0 : g.price * g.quantity;
      budget += cost; if (g.purchased) { spent += cost; done++; }
      if (!groups[g.list_id]) { groups[g.list_id] = []; order.push(g.list_id); }
      groups[g.list_id].push(g);
    });
    var pct = rows.length ? Math.round(done / rows.length * 100) : 0;
    view(ctx,
      '<header class="page-head"><p class="eyebrow">Deine Einkaufsliste</p><h1>Meine Geschenke</h1><p class="lead">Alles, was du für andere reserviert hast. Hak ab, was du schon besorgt hast.</p></header>' +
      (rows.length ? '<div class="gift-stats" data-stagger><div class="tile"><b>' + rows.length + '</b><span>reserviert</span></div><div class="tile"><b>' + done + '</b><span>schon gekauft</span></div>' +
        '<div class="tile"><b>' + esc(money(budget, 'EUR')) + '</b><span>Budget (ohne Gruppengeschenke)</span></div>' +
        '<div class="tile prog"><span>Fortschritt ' + pct + ' %</span><div class="bar"><i style="width:' + pct + '%"></i></div><small class="muted">' + esc(money(budget - spent, 'EUR')) + ' noch offen</small></div></div>' +
        order.map(function (id) {
          var gs = groups[id], g0 = gs[0], d = g0.event_date ? daysUntil(g0.event_date) : null;
          return '<section class="gift-group"><a class="gg-head" href="./?liste=' + id + '">' + avatar({ avatar: g0.owner_avatar, color: g0.owner_color }, 'sm') +
            '<span><b>' + esc(g0.owner_name) + '</b> · ' + esc(g0.list_emoji) + ' ' + esc(g0.list_title) + (d !== null && d >= 0 ? ' <small>' + fmtDate(g0.event_date) + ', ' + inDays(d) + '</small>' : '') + '</span><span class="arr">→</span></a>' +
            '<ul class="gift-rows">' + gs.map(function (g) {
              var img = /^https:\/\//.test(g.image_url || '') ? '<img src="' + esc(g.image_url) + '" alt="' + esc(g.title) + '" loading="lazy" referrerpolicy="no-referrer" data-ph="' + esc(g.list_emoji) + '">' : placeholder(g.list_emoji, g.title);
              var url = safeUrl(g.url);
              return '<li class="' + (g.purchased ? 'bought' : '') + '" data-id="' + g.item_id + '"><label class="buy"><input type="checkbox" data-act="bought"' + (g.purchased ? ' checked' : '') + '><span>Gekauft</span></label>' +
                '<span class="thumb">' + img + '</span><span class="gr-main"><b>' + esc(g.title) + '</b><small>' + [g.quantity > 1 ? g.quantity + '×' : '', g.group_gift ? '🧩 Gruppengeschenk' : '', g.received ? '🎉 schon erfüllt' : '', g.note ? esc(g.note) : ''].filter(Boolean).join(' · ') + '</small></span>' +
                '<span class="gr-price">' + esc(money(g.price, g.currency)) + '</span>' +
                (url ? '<a class="btn small ghost" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Shop ↗</a>' : '') +
                '<button type="button" class="icon-btn" data-act="unreserve" aria-label="Reservierung freigeben" title="Freigeben">✕</button></li>';
            }).join('') + '</ul></section>';
        }).join('')
        : emptyBox('🛍️', 'Noch nichts reserviert', 'Öffne eine Liste deiner Freunde und reserviere einen Wunsch. Dann erscheint er hier.', '<a class="btn" href="./">Zur Übersicht</a>')), quiet);
    app.onchange = async function (e) {
      if (e.target.getAttribute('data-act') !== 'bought') return;
      var id = e.target.closest('[data-id]').getAttribute('data-id');
      try { await Api.rpc('wl_set_purchased', { p_item: id, p_purchased: e.target.checked }); giftsPage(ctx, r, true); } catch (err) { FX.toast(errText(err)); }
    };
    app.onclick = async function (e) {
      var b = e.target.closest('[data-act="unreserve"]'); if (!b) return;
      if (!(await confirmDlg('Reservierung freigeben? Dann können andere diesen Wunsch wieder reservieren.', 'Freigeben'))) return;
      try { await Api.rpc('wl_unreserve', { p_item: b.closest('[data-id]').getAttribute('data-id') }); FX.toast('Freigegeben'); giftsPage(ctx, r, true); } catch (err) { FX.toast(errText(err)); }
    };
  }

  // ---------- Profil ----------
  async function profilePage(ctx) {
    setTheme(me.theme);
    view(ctx,
      '<header class="page-head"><p class="eyebrow">So sehen dich deine Freunde</p><h1>Dein Profil</h1></header>' +
      '<div class="profile-grid"><form class="panel form" id="pform" novalidate>' +
      '<div class="row2"><label>Anzeigename<input name="name" required minlength="2" maxlength="24" value="' + esc(me.name) + '"></label>' +
      '<label>Geburtstag<input name="birthday" type="date" value="' + esc(me.birthday || '') + '"></label></div>' +
      '<p class="muted small">Dein Code <b>#' + esc(me.code) + '</b> bleibt immer gleich. Freunde finden dich mit Name und Code.</p>' +
      '<fieldset><legend>Avatar</legend>' + emojiPicker('avatar', EMOJIS, me.avatar) + '</fieldset>' +
      '<fieldset><legend>Farbe</legend>' + colorPicker('color', me.color) + '</fieldset>' +
      '<fieldset><legend>Design deiner Profilkarte und Seiten</legend>' + themePicker('theme', me.theme) + '</fieldset>' +
      '<label>Über mich<input name="bio" maxlength="160" value="' + esc(me.bio) + '" placeholder="z. B. Kaffee, Bücher und Bergtouren"></label>' +
      '<label>👕 Größen <small class="muted">hilft beim Schenken</small><input name="sizes" maxlength="200" value="' + esc(me.sizes) + '" placeholder="z. B. Shirt M, Schuhe 43, Ring 56"></label>' +
      '<div class="row2"><label>💚 Mag ich<input name="likes" maxlength="200" value="' + esc(me.likes) + '" placeholder="Lieblingsfarbe, Hobbys …"></label>' +
      '<label>🚫 Lieber nicht<input name="dislikes" maxlength="200" value="' + esc(me.dislikes) + '" placeholder="z. B. Deko, Süßes"></label></div>' +
      '<p class="msg"></p><div class="dlg-actions"><button type="submit" class="btn">Profil speichern</button></div></form>' +
      '<aside class="sticky"><p class="eyebrow">Vorschau</p><div id="pcPrev"></div>' +
      '<div class="panel account"><h3>Konto</h3><p class="muted small">Angemeldet als ' + esc(Api.user.email) + '</p>' +
      '<form id="pwForm" class="form" novalidate><label>Neues Passwort<input name="pw" type="password" autocomplete="new-password" minlength="8" maxlength="72"></label>' +
      '<label>Wiederholen<input name="pw2" type="password" autocomplete="new-password" minlength="8" maxlength="72"></label><p class="msg"></p>' +
      '<button type="submit" class="btn small ghost">Passwort ändern</button></form>' +
      '<button type="button" class="btn ghost wide" data-act="logout">Abmelden</button></div></aside></div>');
    var f = $('#pform');
    function draft() { var v = vals(f); return Object.assign({}, me, v, { birthday: v.birthday || null }); }
    function prev() { var d = draft(); $('#pcPrev').innerHTML = profileCard(d, { self: true }); setTheme(d.theme); }
    prev();
    app.oninput = function (e) { if (e.target.form === f) prev(); };
    app.onchange = app.oninput;
    app.onsubmit = async function (e) {
      e.preventDefault();
      if (e.target.id === 'pwForm') {
        if (await savePassword(e.target)) say($('.msg', e.target), 'Passwort geändert ✓', true);
        return;
      }
      var d = draft(), m = $('.msg', f);
      if (d.name.length < 2 || d.name.indexOf('#') >= 0) return say(m, ERR.name, false);
      try {
        var out = await busy($('[type=submit]', f), function () {
          return Api.update('wl_profiles', 'id=eq.' + me.id, { name: d.name, birthday: d.birthday, avatar: d.avatar, color: d.color, theme: d.theme, bio: d.bio, sizes: d.sizes, likes: d.likes, dislikes: d.dislikes });
        });
        me = out[0]; $('#meLink').innerHTML = avatar(me, 'xs') + '<span>' + esc(me.name) + '</span>';
        say(m, 'Gespeichert ✓', true); FX.toast('Profil gespeichert');
      } catch (err) { say(m, errText(err), false); }
    };
    app.onclick = function (e) { if (e.target.closest('[data-act="logout"]')) { Api.signOut(); history.replaceState(null, '', './'); } };
  }

  // Neues Passwort speichern (Formular mit pw und pw2); hebt auch den Zwang nach einem Admin-Reset auf
  async function savePassword(pf) {
    var pm = $('.msg', pf);
    if (pf.pw.value.length < 8) return say(pm, ERR.password, false);
    if (pf.pw.value !== pf.pw2.value) return say(pm, 'Die Passwörter stimmen nicht überein.', false);
    try {
      var r = await busy($('[type=submit]', pf), function () { return Api.fn('wl-account', { action: 'set-password', password: pf.pw.value }); });
      if (r && r.error) throw Object.assign(new Error(r.error), { code: r.error });
      pf.reset(); return true;
    } catch (err) { say(pm, errText(err), false); return false; }
  }

  // Nach einem Admin-Reset: erst ein eigenes Passwort festlegen
  function forcePassword(ctx) {
    setTheme(me.theme);
    view(ctx, '<div class="force-pw"><div class="panel"><span class="e-ico">🔑</span><h1>Neues Passwort festlegen</h1>' +
      '<p class="lead">Dein Passwort wurde zurückgesetzt. Lege jetzt ein eigenes fest, danach geht es ganz normal weiter.</p>' +
      '<form class="form" novalidate><label>Neues Passwort <small class="muted">mindestens 8 Zeichen</small><input name="pw" type="password" autocomplete="new-password" minlength="8" maxlength="72" autofocus></label>' +
      '<label>Wiederholen<input name="pw2" type="password" autocomplete="new-password" minlength="8" maxlength="72"></label><p class="msg"></p>' +
      '<button type="submit" class="btn wide">Passwort speichern</button></form>' +
      '<p class="muted small">Probleme? Schreib im <a href="' + DISCORD + '" target="_blank" rel="noopener">Discord</a> der Rolle <b>@Admin</b> oder Skeison direkt.</p>' +
      '<button type="button" class="link-btn" data-act="logout">Abmelden</button></div></div>');
    var f = $('input', app); if (f) f.focus();
    app.onsubmit = async function (e) {
      e.preventDefault();
      if (!(await savePassword(e.target))) return;
      me.must_change_password = false; FX.toast('Passwort gespeichert. Willkommen zurück!'); render();
    };
    app.onclick = function (e) { if (e.target.closest('[data-act="logout"]')) Api.signOut(); };
  }

  // ---------- Admin ----------
  async function adminPage(ctx) {
    if (!isAdmin) return go('./', true);
    var users = await Api.rpc('wl_admin_users'), q = '';
    setTheme(me.theme);
    var byId = {}; users.forEach(function (u) { byId[u.id] = u; });
    function sum(k) { return users.reduce(function (s, u) { return s + Number(u[k]); }, 0); }
    function when(t) { return t ? new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' }) : 'nie'; }
    function row(u) {
      return '<li data-id="' + u.id + '">' + avatar(u, 'sm') +
        '<span class="au-main"><b>' + handle(u) + (u.is_admin ? ' <span class="tagchip">Admin</span>' : '') + (u.must_change_password ? ' <span class="tagchip warn">muss Passwort ändern</span>' : '') + '</b><small>' + esc(u.email) + '</small></span>' +
        '<span class="au-stats"><small>Seit ' + when(u.created_at) + ' · zuletzt da: ' + when(u.last_sign_in_at) + '</small><small>' +
        [plural(+u.lists, 'Liste', 'Listen'), plural(+u.items, 'Wunsch', 'Wünsche'), plural(+u.friends, 'Freund', 'Freunde'), +u.reservations + ' reserviert'].join(' · ') + '</small></span>' +
        '<span class="au-act"><button type="button" class="btn small" data-act="reset">🔑 Passwort zurücksetzen</button>' +
        (u.is_admin ? '' : '<button type="button" class="icon-btn" data-act="delete" aria-label="Konto löschen" title="Konto löschen">🗑</button>') + '</span></li>';
    }
    function paintRows() {
      var list = users.filter(function (u) { return !q || (u.name + '#' + u.code + ' ' + u.email).toLowerCase().indexOf(q) >= 0; });
      $('#ulist').innerHTML = list.length ? list.map(row).join('') : '<li class="muted">Keine Treffer.</li>';
    }
    view(ctx,
      '<header class="page-head"><p class="eyebrow">Nur für Admins</p><h1>Verwaltung</h1><p class="lead">Konten im Überblick. Passwörter setzt du hier zurück: Der Nutzer bekommt ein Einmal-Passwort und muss beim nächsten Anmelden ein eigenes festlegen.</p></header>' +
      '<div class="gift-stats" data-stagger>' + [[users.length, 'Konten'], [sum('lists'), 'Listen'], [sum('items'), 'Wünsche'], [sum('reservations'), 'Reservierungen']].map(function (t) {
        return '<div class="tile"><b>' + t[0] + '</b><span>' + t[1] + '</span></div>';
      }).join('') + '</div>' +
      '<section><div class="sec-head"><h2>Konten</h2><div class="filters"><input type="search" name="q" placeholder="Name, Code oder E-Mail …" aria-label="Konten suchen"></div></div>' +
      '<ul class="ulist" id="ulist"></ul></section>');
    paintRows();
    app.oninput = function (e) { if (e.target.name === 'q') { q = e.target.value.trim().toLowerCase(); paintRows(); } };
    app.onclick = async function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var u = byId[b.closest('[data-id]').getAttribute('data-id')];
      if (b.dataset.act === 'reset') return resetDialog(u);
      if (b.dataset.act === 'delete') {
        if (!(await confirmDlg('Konto von ' + u.name + '#' + u.code + ' (' + u.email + ') mit allen Listen, Wünschen und Reservierungen endgültig löschen?', 'Endgültig löschen'))) return;
        try {
          var r = await Api.fn('wl-account', { action: 'admin-delete', user_id: u.id });
          if (r && r.error) throw Object.assign(new Error(r.error), { code: r.error });
          FX.toast('Konto gelöscht'); render();
        } catch (err) { FX.toast(errText(err)); }
      }
    };
  }
  function resetDialog(u) {
    openDlg(dlgHead('Passwort zurücksetzen') +
      '<form class="form" novalidate><p class="muted">Für <b>' + handle(u) + '</b> (' + esc(u.email) + '). Beim nächsten Anmelden muss ein eigenes Passwort festgelegt werden.</p>' +
      '<label class="vopt"><input type="radio" name="mode" value="random" checked><span><b>🎲 Einmal-Passwort erzeugen</b><small>Zufällig; du siehst es gleich und gibst es weiter.</small></span></label>' +
      '<label class="vopt"><input type="radio" name="mode" value="own"><span><b>✍️ Standardpasswort vergeben</b><small>Ein Passwort deiner Wahl, z. B. dein übliches Reset-Passwort.</small></span></label>' +
      '<label class="own-pw" hidden>Standardpasswort <small class="muted">mindestens 8 Zeichen</small><input name="password" minlength="8" maxlength="72" autocomplete="off"></label>' +
      '<p class="msg"></p><div class="dlg-actions"><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="submit" class="btn">Zurücksetzen</button></div></form>', 'small');
    var f = $('form', dlg);
    f.addEventListener('change', function () { $('.own-pw', f).hidden = vals(f).mode !== 'own'; });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = vals(f), m = $('.msg', f), body = { action: 'admin-reset', user_id: u.id };
      if (v.mode === 'own') { if (v.password.length < 8) return say(m, ERR.password, false); body.password = v.password; }
      try {
        var r = await busy($('[type=submit]', f), function () { return Api.fn('wl-account', body); });
        if (r.error) throw Object.assign(new Error(r.error), { code: r.error });
        openDlg(dlgHead('Passwort zurückgesetzt') + '<p>Gib dieses Passwort an <b>' + esc(u.name) + '</b> weiter, am besten per Discord-Direktnachricht:</p>' +
          '<button type="button" class="handle-big" id="pwCopy">' + esc(r.password) + ' <small>kopieren</small></button>' +
          '<p class="muted small">Beim nächsten Anmelden muss ' + esc(u.name) + ' ein eigenes Passwort festlegen.</p>' +
          '<div class="dlg-actions"><button type="button" class="btn" data-close>Fertig</button></div>', 'small');
        $('#pwCopy', dlg).addEventListener('click', function () { copy(r.password, 'Passwort kopiert'); });
        dlg.addEventListener('close', function once() { dlg.removeEventListener('close', once); render(); });
      } catch (err) { say(m, errText(err), false); }
    });
  }

  var VIEWS = { home: home, liste: listPage, freunde: friendsPage, freund: friendPage, geschenke: giftsPage, profil: profilePage, admin: adminPage };

  // ---------- Startseite fuer Abgemeldete ----------
  var DEMO = [
    { title: 'Kopfhörer mit Geräuschunterdrückung', note: 'Für die Bahnfahrten zur Arbeit', price: 129, priority: 3, emoji: '🎧' },
    { title: 'Kochbuch „Italien vegetarisch“', note: 'Für gemütliche Sonntage', price: 28, priority: 2, emoji: '📖' },
    { title: 'Retro-Konsole mit 2 Controllern', note: 'Für Spieleabende mit Freunden', price: 89.99, priority: 3, emoji: '🕹️' },
    { title: 'Ledersneaker in Weiß', note: 'Für jeden Tag', price: 119, priority: 3, emoji: '👟' },
    { title: 'Bildband Architektur', note: 'Fürs Wohnzimmer-Regal', price: 59, priority: 2, emoji: '🏛️' }
  ];
  $('#themeShow').innerHTML = THEMES.map(function (t, i) {
    var d = DEMO[i];
    return '<figure class="tshow" data-theme="' + t.id + '"><div class="ts-stage">' + wishCard({ id: 'demo' + i, title: d.title, note: d.note, price: d.price, currency: 'EUR', priority: d.priority, quantity: 1 }, { demo: true, emoji: d.emoji }) + '</div>' +
      '<figcaption><b>' + t.name + '</b><span>' + t.desc + '</span></figcaption></figure>';
  }).join('');

  function setTab(tab) {
    $$('.auth-tabs button').forEach(function (b) { var on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    $('#loginForm').hidden = tab !== 'login'; $('#registerForm').hidden = tab !== 'register';
  }
  $$('.auth-tabs button').forEach(function (b) { b.addEventListener('click', function () { setTab(b.dataset.tab); }); });
  function landing() {
    var q = location.search;
    if (/registrieren|login/.test(q)) {
      setTab(/registrieren/.test(q) ? 'register' : 'login');
      requestAnimationFrame(function () { $('#auth').scrollIntoView({ behavior: FX.reduced ? 'auto' : 'smooth', block: 'center' }); });
    }
  }
  $('#loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var f = e.target, m = $('.msg', f), email = f.email.value.trim(), pw = f.password.value;
    if (!email || !pw) return say(m, 'Bitte E-Mail und Passwort eingeben.', false);
    say(m, 'Anmelden …', true);
    try { await busy($('[type=submit]', f), function () { return Api.signIn(email, pw); }); f.reset(); say(m, '', true); history.replaceState(null, '', location.search.indexOf('liste=') >= 0 || location.search.indexOf('seite=') >= 0 ? location.search : './'); render(); }
    catch (err) { say(m, errText(err), false); }
  });
  $('#registerForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var f = e.target, m = $('.msg', f), v = vals(f);
    if (v.name.length < 2 || v.name.indexOf('#') >= 0) return say(m, ERR.name, false);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) return say(m, ERR.email, false);
    if (f.password.value.length < 8) return say(m, ERR.password, false);
    if (f.password.value !== f.password2.value) return say(m, 'Die Passwörter stimmen nicht überein.', false);
    say(m, 'Konto wird erstellt …', true);
    try {
      await busy($('[type=submit]', f), async function () {
        await Api.signUp({ name: v.name, email: v.email, password: f.password.value, invite: v.invite });
        await Api.signIn(v.email, f.password.value);
      });
      f.reset(); say(m, '', true); history.replaceState(null, '', './'); FX.toast('Willkommen, ' + v.name + '! 🎉'); render();
    } catch (err) {
      if (err.code === 'invite') $('.invite', f).hidden = false;
      say(m, errText(err), false);
    }
  });

  render();
})();
