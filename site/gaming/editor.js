// Editor fuer das eigene Gaming-Profil (Dialog #gdlg): Profil und Freigaben, Konten, Valorant-Skins, Minecraft, Steam.
// Gespeichert wird in Supabase (Api aus wunschliste/api.js). Konten mit Live-Daten werden vorher ueber die Edge Function
// gp-sync geprueft ("check"), damit nur Konten gespeichert werden, die es wirklich gibt.
// Nichts geht verloren: Valorant-Auswahl und Steam-Lieblingsspiele speichern sich selbst (kurz nach der letzten Aenderung,
// beim Wechsel des Bereichs und beim Schliessen). Formulare (Profil, Konten, Server) merken sich nicht gespeicherte
// Eingaben als Entwurf im Browser und fuellen sie beim naechsten Oeffnen wieder ein. Ein Klick neben den Dialog schliesst
// ihn nicht (wie bei der Wunschliste: sonst flog man beim Markieren ueber den Rand hinaus raus), nur ✕, "Fertig" oder Escape.
(function () {
  'use strict';
  var dlg = document.getElementById('gdlg'), FX = window.FX || {};
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $ = function (sel, root) { return (root || dlg).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || dlg).querySelectorAll(sel)); };
  var nf = new Intl.NumberFormat('de-DE');
  function toast(t) { if (FX.toast) FX.toast(t); }
  var ERR = {
    not_found: 'Nicht gefunden. Stimmt die Schreibweise?', bad_handle: 'Bitte im angegebenen Format eingeben.', rate_limited: 'Gerade zu viele Abfragen. Bitte in einer Minute nochmal.',
    timeout: 'Der Dienst antwortet gerade nicht. Bitte später nochmal.', network: 'Keine Verbindung. Bitte später nochmal.', upstream_denied: 'Der Dienst hat die Abfrage abgelehnt.',
    too_many: 'Das sind zu viele Einträge.', no_access: 'Keine Berechtigung.', not_authenticated: 'Bitte neu anmelden.', too_big: 'Die Datei ist zu groß.', bad_png: 'Das ist kein Minecraft-Skin (PNG, 64×64 oder 64×32 Pixel).',
    unauthorized: 'Deine Anmeldung ist abgelaufen. Bitte neu anmelden.'
  };
  function errText(e) { var c = (e && (e.code || e.message || e.error)) || String(e || ''); return ERR[c] || (/^upstream_/.test(c) ? 'Der Dienst hat gerade ein Problem. Bitte später nochmal.' : 'Das hat nicht geklappt (' + c + ').'); }
  async function busy(btn, fn) { var t = btn.innerHTML; btn.disabled = true; btn.innerHTML = '…'; try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = t; } }

  var st = null, meId = null;   // st: { p, me, changed, tab, onDone }; meId bleibt nach dem Schliessen fuer laufende Speicherungen
  // Bereiche: [Schluessel, Symbol, Name, Gruppe in der Navigation, Erklaerung oben im Bereich, Zaehler]
  var TABS = [
    ['profil', '👤', 'Profil & Sichtbarkeit', 'Profil', 'Spruch, Lieblingsagent und wer dein Gaming-Profil sehen darf.'],
    ['oeffentlich', '🌐', 'Öffentlich & Bekannte', 'Profil', 'Dein öffentliches Profil für die Ausstellung, Gaming-Bekannte, Kreise und wer welchen Bereich sieht.'],
    ['konten', '🔗', 'Konten', 'Inhalte', 'Spiele, Launcher und Kanäle verknüpfen. Konten mit ✓ werden geprüft und liefern Live-Daten.', function (p) { return (p.accounts || []).length; }],
    ['reiter', '🗂️', 'Reiter & Statistik', 'Inhalte', 'Reihenfolge der Bühne, Statistik-Kacheln und eigene Reiter für Spiele und Launcher.', function (p) { return (p.custom || []).length; }],
    ['valorant', '🎯', 'Valorant-Skins', 'Spiele', 'Skins, Bundles und Battlepässe auswählen, die du besitzt. Speichert sich selbst.', function (p) { return (p.val_items || []).length; }],
    ['minecraft', '⛏️', 'Minecraft', 'Spiele', 'Eigene Skins hochladen und deinen Lieblingsserver zeigen.', function (p) { return (p.mc_skins || []).length; }],
    ['steam', '🎮', 'Steam', 'Spiele', 'Bis zu 24 Lieblingsspiele aus deiner Bibliothek oder dem Steam-Shop. Speichert sich selbst.', function (p) { return (p.steam_favs || []).length; }],
    ['account', '🪪', 'Skeison Account', 'Konto', 'Name, Avatar, Farbe und Passwort. Gilt auch für die Wunschliste.']];

  // ---------------------------------------------------------------- Publikum ("Wer sieht das?") je Konto, Reiter und Bereich
  // Werte wie in der Datenbank (private.gp_aud): public, known, friends, circle:<id>, me. Kreise laedt circles() einmal je Editor.
  var AUD = [['public', 'Öffentlich', 'alle mit öffentlichem Profil, Bekannte und Freunde'], ['known', 'Bekannte und Freunde', ''], ['friends', 'Freunde', 'wer dein Freundes-Profil sehen darf'], ['me', 'Nur ich', 'ausgeblendet']];
  function circles() {
    if (!st) return Promise.resolve([]);
    if (!st.circlesP) st.circlesP = Api.get('gp_circles', 'select=id,name,emoji&order=created_at').then(function (c) { st.circles = c || []; return st.circles; }, function () { st.circles = []; return []; });
    return st.circlesP;
  }
  function audSel(name, value, label) {
    value = value || 'friends';
    var cs = (st && st.circles) || [], opts = AUD.slice(0, 3).map(function (a) { return [a[0], a[1]]; })
      .concat(cs.map(function (c) { return ['circle:' + c.id, 'Kreis: ' + c.emoji + ' ' + c.name]; })).concat([[AUD[3][0], AUD[3][1]]]);
    if (!opts.some(function (o) { return o[0] === value; })) opts.splice(3, 0, [value, /^circle:/.test(value) ? 'Kreis (gelöscht)' : value]);
    return '<select class="aud" name="' + esc(name) + '" aria-label="' + esc(label || 'Wer sieht das?') + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (o[0] === value ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  }

  // ---------------------------------------------------------------- Entwuerfe (je Konto im Browser)
  function dkey() { return 'gp-editor-' + meId; }
  function drafts() { try { return JSON.parse(localStorage.getItem(dkey())) || {}; } catch (e) { return {}; } }
  function setDraft(k, v) { var d = drafts(); if (v == null) delete d[k]; else d[k] = v; try { localStorage.setItem(dkey(), JSON.stringify(d)); } catch (e) { /* voll oder gesperrt */ } }
  function formValues(f) {
    var v = {};
    Array.prototype.forEach.call(f.elements, function (x) {
      if (!x.name || /^(file|submit|button)$/.test(x.type)) return;
      if (x.type === 'checkbox') { v[x.name] = v[x.name] || []; if (x.checked) v[x.name].push(x.value); }
      else if (x.type === 'radio') { if (x.checked) v[x.name] = x.value; }
      else v[x.name] = x.value;
    });
    return v;
  }
  function applyValues(f, v) {
    Array.prototype.forEach.call(f.elements, function (x) {
      if (!x.name || !(x.name in v) || /^(file|submit|button)$/.test(x.type)) return;
      if (x.type === 'checkbox') x.checked = [].concat(v[x.name]).indexOf(x.value) >= 0;
      else if (x.type === 'radio') x.checked = v[x.name] === x.value;
      else x.value = v[x.name];
    });
  }
  var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  // Formular an einen Entwurf binden. Hinweis mit "Verwerfen", wenn ein Entwurf wiederhergestellt wurde.
  // Rueckgabe: saved() nach dem Speichern, more() wenn spaeter weitere Felder dazukommen (z. B. Freunde geladen).
  function keepDraft(f, key, rerender) {
    var start = formValues(f), d = drafts()[key], note = null;
    function showNote() {
      if (note) return;
      note = document.createElement('p'); note.className = 'draft-note';
      note.innerHTML = '<span>✎ Nicht gespeicherte Eingaben von vorhin sind wieder da.</span><button type="button" class="link-btn">Verwerfen</button>';
      note.querySelector('button').addEventListener('click', function () { setDraft(key, null); rerender(); });
      f.insertBefore(note, f.firstChild);
    }
    function apply() { d = drafts()[key]; if (!d) return; applyValues(f, d); if (!same(formValues(f), start)) showNote(); }
    apply();
    var keep = function () { var v = formValues(f); setDraft(key, same(v, start) ? null : v); };
    f.addEventListener('input', keep); f.addEventListener('change', keep);
    return {
      saved: function () { start = formValues(f); setDraft(key, null); if (note) { note.remove(); note = null; } },
      more: function () { var v = formValues(f); Object.keys(v).forEach(function (k) { if (!(k in start)) start[k] = v[k]; }); apply(); }
    };
  }

  // ---------------------------------------------------------------- Automatisch speichern
  // send(data) speichert auf dem Server. Bis das geklappt hat, liegt data als Entwurf im Browser (Schluessel key).
  var savers = {};
  function status(state, text) {
    var s = dlg.open && $('#gdlgStatus'); if (!s) return;
    s.className = 'gdlg-status ' + state;
    s.textContent = text || { saving: 'Speichert …', saved: 'Alles gespeichert ✓', pending: 'Änderungen werden gleich gespeichert …', error: 'Nicht gespeichert, neuer Versuch gleich', idle: 'Auswahl und Reihenfolge speichern sich selbst' }[state] || '';
  }
  function autosaver(key, send, onSaved) {
    var t = 0, data = null, running = null, tries = 0;
    function flush() {
      clearTimeout(t);
      if (running) return running.then(function () { return data ? flush() : null; });
      if (!data) return Promise.resolve();
      var d = data; data = null; status('saving');
      running = send(d).then(function () {
        tries = 0;
        if (!data) setDraft(key, null);
        status(data ? 'pending' : 'saved'); onSaved(d);
      }, function (e) {
        if (!data) data = d;
        // bis zu 5 neue Versuche; danach bleibt die Auswahl als Entwurf und kommt beim naechsten Oeffnen wieder
        if (++tries <= 5) { status('error', 'Nicht gespeichert: ' + errText(e) + ' Neuer Versuch gleich.'); t = setTimeout(flush, 8000); }
        else { status('error', 'Nicht gespeichert: ' + errText(e) + ' Deine Auswahl bleibt erhalten.'); tries = 0; data = null; }
        if (!dlg.open) toast('Auswahl noch nicht gespeichert, sie bleibt als Entwurf erhalten.');
      }).then(function () { running = null; });
      return running;
    }
    return savers[key] = { set: function (d) { data = d; setDraft(key, d); status('pending'); clearTimeout(t); t = setTimeout(flush, 1000); }, flush: flush };
  }
  function flushAll() { return Promise.all(Object.keys(savers).map(function (k) { return savers[k].flush(); })); }

  // ---------------------------------------------------------------- Dialog
  // Aufraeumen sofort beim Schliessen (nicht erst im "close"-Ereignis: das kommt verzoegert und wuerde einen gleich
  // wieder geoeffneten Editor leeren). Offene Speicherungen abschliessen, danach die Seite neu zeichnen (onSaved setzt changed).
  function finish() {
    var s = st; st = null;
    dlg.textContent = ''; dlg.classList.remove('wide', 'nudge'); dlg.onclick = null;
    flushAll().then(function () { if (s && s.onDone && s.changed) s.onDone(); });
  }
  function close() { if (!dlg.open) return; finish(); dlg.close(); }
  dlg.addEventListener('cancel', function () { finish(); });   // Escape
  dlg.addEventListener('close', function () { if (!dlg.open && dlg.childNodes.length) finish(); });
  // Klick neben den Dialog: nur kurz wackeln, nicht schliessen (der Klick muss dort auch begonnen haben)
  var downOut = false;
  function outside(e) { var r = dlg.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; }
  dlg.addEventListener('pointerdown', function (e) { downOut = e.target === dlg && outside(e); });
  dlg.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) return close();
    var out = e.target === dlg && downOut && outside(e); downOut = false;
    if (out) { dlg.classList.remove('nudge'); void dlg.offsetWidth; dlg.classList.add('nudge'); }
  });

  async function ensureProfileOf(s) {
    if (s.p.profile) return;
    var rows = await Api.upsert('gp_profiles', [{ id: s.me }]);
    s.p.profile = rows && rows[0] || { id: s.me, visibility: 'friends', tagline: '', pioneer: 'void', mc_server: '' };
    s.changed = true;
  }
  function ensureProfile() { return ensureProfileOf(st); }
  async function saveProfile(patch) {
    await ensureProfile();
    patch.id = st.me; patch.updated_at = new Date().toISOString();
    var rows = await Api.upsert('gp_profiles', [patch]);
    st.p.profile = Object.assign({}, st.p.profile, patch, rows && rows[0]);
    st.changed = true;
  }

  function open(p, onDone, tab) {
    st = { p: JSON.parse(JSON.stringify(p)), me: Api.user.id, changed: false, tab: TABS.some(function (t) { return t[0] === tab; }) ? tab : 'profil', onDone: onDone };
    meId = st.me;
    dlg.classList.add('wide');
    var o = st.p.owner || {}, group = '';
    // Kopf: Titel und wessen Profil; links die Bereiche in Gruppen; unten Speicherstand und "Fertig"
    dlg.innerHTML = '<div class="gdlg-head"><span class="gh-av av" style="--c:' + esc(o.color || '#5b85ff') + '" aria-hidden="true">' + esc(o.avatar || '🎮') + '</span>' +
      '<div class="gh-t"><h2 id="gdlgTitle">Gaming-Profil bearbeiten</h2><small class="muted">' + esc(o.name || '') + '</small></div>' +
      '<button type="button" class="gdlg-x" data-close aria-label="Schließen">✕</button></div>' +
      '<div class="gdlg-main"><nav class="gdlg-tabs" role="tablist" aria-label="Bereiche">' + TABS.map(function (t) {
        var g = t[3] !== group ? '<p class="gt-group" aria-hidden="true">' + esc(t[3]) + '</p>' : ''; group = t[3];
        return g + '<button type="button" role="tab" data-tab="' + t[0] + '"><span class="ti" aria-hidden="true">' + t[1] + '</span><span class="tl">' + esc(t[2]) + '</span><i class="tc" hidden></i></button>'; }).join('') + '</nav>' +
      '<div class="gdlg-body" id="gdlgBody"></div></div>' +
      '<div class="gdlg-foot"><span class="gdlg-status idle" id="gdlgStatus" aria-live="polite"></span><button type="button" class="btn" data-close>Fertig</button></div>';
    $('.gdlg-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b && b.dataset.tab !== st.tab) show(b.dataset.tab); });
    if (!dlg.open) dlg.showModal();
    status('idle');
    show(st.tab);
  }
  // Zaehler in der Navigation (Konten, Reiter, Skins …) nach jedem Wechsel auffrischen
  function paintNav() {
    TABS.forEach(function (t) {
      var c = $('.gdlg-tabs [data-tab="' + t[0] + '"] .tc'); if (!c) return;
      var n = t[5] ? t[5](st.p) : 0; c.hidden = !n; c.textContent = n || '';
    });
  }
  function show(tab) {
    flushAll();
    st.tab = tab;
    var t = TABS.filter(function (x) { return x[0] === tab; })[0] || TABS[0];
    $$('.gdlg-tabs [data-tab]').forEach(function (b) {
      var on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
      if (on && b.scrollIntoView && window.matchMedia('(max-width: 760px)').matches) b.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
    paintNav();
    var body = $('#gdlgBody'); body.textContent = ''; body.scrollTop = 0;
    body.setAttribute('data-tab', tab);
    body.innerHTML = '<header class="ed-head"><span class="ed-ic" aria-hidden="true">' + t[1] + '</span><div><h3>' + esc(t[2]) + '</h3><p class="muted">' + esc(t[4]) + '</p></div></header><div class="ed-content"></div>';
    var X = window.EditorExtra || {};
    var fn = ({ profil: tabProfil, konten: tabKonten, valorant: tabValorant, minecraft: tabMinecraft, steam: tabSteam, oeffentlich: X.oeffentlich, reiter: X.reiter, account: X.account })[tab] || tabProfil;
    fn($('.ed-content', body));
  }

  // ---------------------------------------------------------------- Profil & Freigabe
  async function loadPeople() {
    var r = await Promise.all([
      Api.get('wl_friendships', 'status=eq.accepted&select=requester,addressee'),
      Api.get('wl_profiles', 'select=id,name,avatar,color&id=neq.' + st.me),
      Api.get('wl_groups', 'select=id,name,emoji,color&order=created_at'),
      Api.get('gp_share_people', 'select=person'),
      Api.get('gp_share_groups', 'select=group_id')
    ]);
    var ids = {}; r[0].forEach(function (f) { ids[f.requester === st.me ? f.addressee : f.requester] = 1; });
    return { friends: r[1].filter(function (p) { return ids[p.id]; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); }),
      groups: r[2], people: r[3].map(function (x) { return x.person; }), groupSel: r[4].map(function (x) { return x.group_id; }) };
  }
  function tabProfil(body) {
    var pr = st.p.profile || { visibility: 'friends', tagline: '', val_agent: null };
    body.innerHTML = '<form class="gform" id="fProfil">' +
      '<section class="ecard"><h3>Über dich</h3>' +
      '<label>Spruch unter deinem Namen<input name="tagline" maxlength="120" value="' + esc(pr.tagline) + '" placeholder="z. B. Ranked-Grinder, Fabrikplaner, Pokémon-Sammler"></label>' +
      '<label>Lieblingsagent (Valorant)<select name="val_agent"><option value="">KAY/O (Standard)</option>' + (pr.val_agent ? '<option value="' + esc(pr.val_agent) + '" selected>…</option>' : '') + '</select></label></section>' +
      '<section class="ecard"><fieldset class="vis"><legend>Wer darf dein Gaming-Profil sehen?</legend>' +
      [['private', 'Nur ich', 'Niemand außer dir.'], ['friends', 'Alle Freunde', 'Alle Freunde aus der Wunschliste mit der Stufe „Freund“ (nicht „Bekannt“).'], ['custom', 'Ausgewählte', 'Nur die Personen und Gruppen, die du unten auswählst, und wer über deinen Link kommt.']]
        .map(function (v) { return '<label class="radio"><input type="radio" name="visibility" value="' + v[0] + '"' + (pr.visibility === v[0] ? ' checked' : '') + '><span><b>' + v[1] + '</b><small>' + v[2] + '</small></span></label>'; }).join('') +
      '<div class="pick-who" hidden><p class="muted">Lädt Freunde und Gruppen …</p></div></fieldset>' +
      '<p class="muted small">Freunde und Gruppen verwaltest du in der <a href="../wunschliste/?seite=freunde">Wunschliste</a>; sie gelten hier genauso. Was Bekannte und alle mit öffentlichem Profil sehen, stellst du unter <button type="button" class="link-btn" data-goto="oeffentlich">Öffentlich & Bekannte</button> ein.</p></section>' +
      '<p class="msg" hidden></p>' +
      '<div class="dlg-actions start sticky-actions"><button class="btn" type="submit">Speichern</button><button class="btn ghost" type="button" id="btnLink" title="Teilen-Link und QR-Code für dein Profil">🔗 Link & QR-Code</button></div></form>';
    var f = $('#fProfil'), who = $('.pick-who', f), people = null;
    var draft = keepDraft(f, 'profil', function () { show('profil'); });
    window.ValCat.load().then(function (c) {
      var sel = f.val_agent, want = (drafts().profil || {}).val_agent || pr.val_agent;
      sel.length = 1;
      c.agents.forEach(function (a) { var o = document.createElement('option'); o.value = a.id; o.textContent = a.n; if (a.id === want) o.selected = true; sel.appendChild(o); });
    }).catch(function () {});
    function paintWho() { who.hidden = f.querySelector('input[name="visibility"]:checked').value !== 'custom'; }
    f.addEventListener('change', function (e) { if (e.target.name === 'visibility') paintWho(); });
    paintWho();
    loadPeople().then(function (d) {
      people = d;
      who.innerHTML = (d.groups.length ? '<p class="small"><b>Gruppen</b></p><div class="pick-list">' + d.groups.map(function (g) {
        return '<label class="pick"><input type="checkbox" name="groups" value="' + g.id + '"' + (d.groupSel.indexOf(g.id) >= 0 ? ' checked' : '') + '><span>' + esc(g.emoji) + ' ' + esc(g.name) + '</span></label>'; }).join('') + '</div>' : '') +
        '<p class="small"><b>Personen</b></p>' + (d.friends.length ? '<div class="pick-list">' + d.friends.map(function (p) {
          return '<label class="pick"><input type="checkbox" name="people" value="' + p.id + '"' + (d.people.indexOf(p.id) >= 0 ? ' checked' : '') + '><span><i class="av" style="--c:' + esc(p.color) + '">' + esc(p.avatar) + '</i> ' + esc(p.name) + '</span></label>'; }).join('') + '</div>'
          : '<p class="muted">Noch keine Freunde. Füge sie in der Wunschliste hinzu oder teile deinen Link.</p>');
      draft.more(); paintWho();
    }).catch(function (e) { who.innerHTML = '<p class="msg err">' + esc(errText(e)) + '</p>'; });
    $('#btnLink', f).addEventListener('click', function () { share(); });
    $('[data-goto]', f).addEventListener('click', function () { show('oeffentlich'); });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var msg = $('.msg', f), btn = $('button[type="submit"]', f);
      try {
        await busy(btn, async function () {
          var vis = f.querySelector('input[name="visibility"]:checked').value;
          await saveProfile({ tagline: f.tagline.value.trim().slice(0, 120), val_agent: f.val_agent.value || null });
          var groups = $$('input[name="groups"]:checked', f).map(function (x) { return x.value; });
          var ppl = people ? $$('input[name="people"]:checked', f).map(function (x) { return x.value; }) : null;
          await Api.rpc('gp_set_shares', { p_visibility: vis, p_groups: vis === 'custom' ? groups : [], p_people: vis === 'custom' ? ppl : null });
          st.p.profile.visibility = vis;
        });
        draft.saved();
        msg.className = 'msg ok'; msg.textContent = 'Gespeichert.'; msg.hidden = false;
      } catch (err) { msg.className = 'msg err'; msg.textContent = errText(err); msg.hidden = false; }
    });
  }

  // ---------------------------------------------------------------- Konten
  // Je Anbieter bis zu 5 Konten (Zweitkonten heissen <art>-2 ... <art>-5), je Konto ein eigener Name ("Smurf"), wer es sieht
  // und ob es im oeffentlichen Profil ungekuerzt erscheint. Verknuepfte Anbieter stehen oben, weitere kommen ueber die Auswahl.
  function tabKonten(body) {
    var GA = window.GAccounts, extra = {};   // extra: zusaetzlich geoeffnete, noch leere Zeilen je Art
    // Anbieter-Auswahl: Kacheln in drei Gruppen mit Suche (statt eines langen Auswahlmenues)
    var GROUPS = [['Spiele', ['valorant', 'lol', 'minecraft', 'hoyoverse', 'roblox']],
      ['Plattformen & Launcher', ['steam', 'epic', 'battlenet', 'ea', 'ubisoft', 'gog', 'rockstar', 'xbox', 'playstation', 'nintendo']],
      ['Community & Kanäle', ['discord', 'twitch', 'youtube', 'kick', 'tiktok', 'instagram', 'x', 'reddit', 'snapchat', 'spotify']]];
    var listed = [].concat.apply([], GROUPS.map(function (g) { return g[1]; }));
    GA.KINDS.forEach(function (k) { if (listed.indexOf(k.key) < 0) GROUPS[2][1].push(k.key); });
    body.innerHTML = '<details class="ed-help"><summary>Wie funktioniert das?</summary><p>Konten mit ✓ werden beim Speichern geprüft und liefern Live-Daten (Rang, Spielzeit, Mitglieder). Bei Spielen wie Valorant kannst du die Spielzeit eintragen (z. B. „Total Playtime“ von tracker.gg), sie zählt in der Statistik mit. Je Anbieter gehen bis zu ' + GA.MAX_PER_KIND + ' Konten, z. B. ein Zweitkonto. Bei „Wer sieht das?“ legst du je Konto fest, ob es öffentlich, für Bekannte, Freunde, einen Kreis oder nur dich sichtbar ist. Im öffentlichen Profil werden Spielernamen gekürzt (empfohlen).</p></details>' +
      '<div class="acc-add"><button type="button" class="btn small" data-addacc aria-expanded="false" aria-controls="accPick">+ Konto verknüpfen</button>' +
      '<div class="acc-pick" id="accPick" hidden><input type="search" class="acc-q" placeholder="Anbieter suchen, z. B. Epic oder Twitch" aria-label="Anbieter suchen"><div class="acc-pick-groups"></div></div></div>' +
      '<div class="acc-edit-list"></div>';
    var box = $('.acc-edit-list', body), pick = $('.acc-pick', body), pq = $('.acc-q', body), addBtn = $('[data-addacc]', body);
    function paintPick() {
      var q = pq.value.trim().toLowerCase();
      $('.acc-pick-groups', body).innerHTML = GROUPS.map(function (g) {
        var ks = g[1].map(function (key) { return GA.BY[key]; }).filter(function (k) { return k && (!q || k.name.toLowerCase().indexOf(q) >= 0 || k.key.indexOf(q) >= 0); });
        if (!ks.length) return '';
        return '<div class="acc-pick-g"><p class="gt-group">' + esc(g[0]) + '</p><div class="acc-tiles">' + ks.map(function (k) {
          var n = mine(k.key).length;
          return '<button type="button" class="acc-tile' + (n ? ' has' : '') + '" data-kind="' + k.key + '"' + (n >= GA.MAX_PER_KIND ? ' disabled' : '') + '><span class="acc-badge" style="--c:' + k.color + '">' + esc(k.short) + '</span>' +
            '<span class="at-t"><b>' + esc(k.name) + '</b><small>' + (n ? '✓ ' + n + ' verknüpft' : k.live ? 'mit Live-Daten' : 'Profil-Link') + '</small></span></button>'; }).join('') + '</div></div>';
      }).join('') || '<p class="muted">Kein Anbieter mit diesem Namen.</p>';
    }
    function setPick(open) { pick.hidden = !open; addBtn.setAttribute('aria-expanded', String(open)); addBtn.textContent = open ? 'Auswahl schließen' : '+ Konto verknüpfen'; if (open) { pq.value = ''; paintPick(); pq.focus(); } }
    addBtn.addEventListener('click', function () { setPick(pick.hidden); });
    pq.addEventListener('input', paintPick);
    pick.addEventListener('click', function (e) {
      var t = e.target.closest('.acc-tile'); if (!t || t.disabled) return;
      var key = t.dataset.kind; extra[key] = extra[key] || [];
      var kk = freeKind(key); if (!kk) { toast('Höchstens ' + GA.MAX_PER_KIND + ' Konten je Anbieter.'); return; }
      extra[key].push(kk); setPick(false); paint();
      var f = box.querySelector('form[data-kind="' + kk + '"] input[name="handle"]'); if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); }
    });
    // Anzeigename fuer "Wer sieht das?" in der zugeklappten Zeile
    function audName(v) {
      if (/^circle:/.test(v)) { var c = (st.circles || []).filter(function (x) { return 'circle:' + x.id === v; })[0]; return c ? c.emoji + ' ' + c.name : 'Kreis'; }
      var a = AUD.filter(function (x) { return x[0] === v; })[0]; return a ? a[1] : 'Freunde';
    }
    function mine(key) { return (st.p.accounts || []).filter(function (a) { return GA.base(a.kind) === key; }).sort(function (a, b) { return GA.slot(a.kind) - GA.slot(b.kind); }); }
    function freeKind(key) { for (var i = 1; i <= GA.MAX_PER_KIND; i++) { var kk = i === 1 ? key : key + '-' + i; if (!(st.p.accounts || []).some(function (a) { return a.kind === kk; }) && extra[key].indexOf(kk) < 0) return kk; } return ''; }
    function paint() {
      box.textContent = '';
      GA.KINDS.forEach(function (k, ki) {
        extra[k.key] = extra[k.key] || [];
        var have = mine(k.key), rows = have.map(function (a) { return { kind: a.kind, a: a }; }).concat(extra[k.key].map(function (kk) { return { kind: kk, a: null }; }));
        if (!rows.length) return;
        var sec = document.createElement('section'); sec.className = 'acc-group'; sec.style.setProperty('--c', k.color);
        sec.innerHTML = '<div class="acc-edit-head"><span class="acc-badge" style="--c:' + k.color + '">' + esc(k.short) + '</span><b>' + esc(k.name) + '</b>' + (k.live ? '<span class="live" title="wird geprüft, mit Live-Daten">✓</span>' : '') +
          (rows.length < GA.MAX_PER_KIND ? '<button type="button" class="link-btn" data-more>+ weiteres Konto</button>' : '') + '</div>' + (k.hint ? '<p class="muted small">' + esc(k.hint) + '</p>' : '');
        rows.forEach(function (r) { sec.appendChild(accRow(k, ki, r.kind, r.a)); });
        var more = $('[data-more]', sec);
        if (more) more.addEventListener('click', function () { var kk = freeKind(k.key); if (kk) { extra[k.key].push(kk); paint(); var f = box.querySelector('form[data-kind="' + kk + '"] input[name="handle"]'); if (f) f.focus(); } });
        box.appendChild(sec);
      });
      if (!box.children.length) { box.innerHTML = '<p class="muted">Noch keine Konten. Wähle oben einen Anbieter.</p>'; setPick(true); }
    }
    function accRow(k, ki, kind, a) {
      var row = document.createElement('form'), x = (a && a.extra) || {};
      row.className = 'acc-edit' + (a ? ' set collapsed' : ''); row.noValidate = true; row.setAttribute('data-kind', kind);
      // Gespeicherte Konten erscheinen zugeklappt als eine Zeile (Name, eigener Name, wer es sieht); Klick klappt das Formular auf
      var aud = a ? (a.in_sidebar === false ? 'me' : a.audience) : 'friends';
      row.innerHTML = (a ? '<button type="button" class="acc-sum" aria-expanded="false"><span class="as-h">' + esc(a.handle) + '</span>' + (x.label ? '<span class="as-l">' + esc(x.label) + '</span>' : '') +
          (x.hours != null && x.hours !== '' ? '<span class="as-l">' + esc(String(x.hours).replace('.', ',')) + ' Std</span>' : '') +
          '<span class="as-aud" data-aud="' + esc(aud) + '">' + esc(audName(aud)) + '</span><span class="as-chev" aria-hidden="true">Bearbeiten</span></button>' : '') +
        '<div class="acc-edit-row"><input name="handle" aria-label="' + esc(k.label) + '" placeholder="' + esc(k.placeholder) + '" value="' + esc(a ? a.handle : '') + '" autocomplete="off" spellcheck="false">' +
        (k.regions ? '<select name="region" aria-label="Region">' + k.regions.map(function (r) { return '<option value="' + r[0] + '"' + (x.region === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select>' : '') +
        (k.games ? '<select name="game" aria-label="Spiel">' + k.games.map(function (g) { return '<option value="' + g[0] + '"' + (x.game === g[0] ? ' selected' : '') + '>' + g[1] + '</option>'; }).join('') + '</select>' : '') +
        '<input name="label" class="acc-label" maxlength="24" placeholder="' + (GA.slot(kind) > 1 ? 'z. B. Smurf, Zweitkonto' : 'Name (optional)') + '" aria-label="Eigener Name für dieses Konto" value="' + esc(x.label || '') + '">' +
        (k.hours ? '<input name="hours" class="acc-hours" inputmode="decimal" maxlength="9" placeholder="Spielzeit (Std)" aria-label="Spielzeit in Stunden (optional)" title="' +
          (k.key === 'valorant' ? 'Gesamtspielzeit, z. B. „Total Playtime“ von tracker.gg. Leer lassen: Schätzung aus den gespeicherten Spielen.' : 'Gesamtspielzeit in Stunden, zählt in der Statistik mit.') +
          '" value="' + esc(x.hours != null ? String(x.hours).replace('.', ',') : '') + '">' : '') + '</div>' +
        '<div class="acc-edit-row"><label class="aud-l"><span class="muted small">Wer sieht das?</span>' + audSel('audience', a ? (a.in_sidebar === false ? 'me' : a.audience) : 'friends') + '</label>' +
        '<label class="pick small" title="Nicht empfohlen: vollständige Spielernamen lassen sich leicht weitergeben"><input type="checkbox" name="public_full"' + (a && a.public_full ? ' checked' : '') + '><span>Öffentlich ungekürzt zeigen</span></label>' +
        '<button class="btn small" type="submit">' + (a ? 'Speichern' : 'Verknüpfen') + '</button>' +
        '<button class="link-btn danger-text" type="button" data-act="del">' + (a ? 'Entfernen' : 'Verwerfen') + '</button></div><p class="msg" hidden></p>';
      var draft = keepDraft(row, 'acc:' + kind, function () { show('konten'); });
      var sum = $('.acc-sum', row);
      if (sum) {
        if ($('.draft-note', row)) row.classList.remove('collapsed');   // nicht gespeicherte Eingaben: gleich offen zeigen
        var syncSum = function () { var open = !row.classList.contains('collapsed'); sum.setAttribute('aria-expanded', String(open)); $('.as-chev', sum).textContent = open ? 'Zuklappen' : 'Bearbeiten'; };
        sum.addEventListener('click', function () { row.classList.toggle('collapsed'); syncSum(); if (!row.classList.contains('collapsed')) row.handle.focus(); });
        syncSum();
      }
      row.addEventListener('submit', function (e) { e.preventDefault(); saveAccount(k, row, kind, ki * 10 + GA.slot(kind), draft); });
      $('[data-act="del"]', row).addEventListener('click', async function (e) {
        var del = e.currentTarget;
        if (!a) { extra[k.key] = extra[k.key].filter(function (z) { return z !== kind; }); setDraft('acc:' + kind, null); paint(); return; }
        try {
          await busy(del, function () { return Api.remove('gp_accounts', 'owner=eq.' + st.me + '&kind=eq.' + encodeURIComponent(kind)); });
          setDraft('acc:' + kind, null);
          st.p.accounts = st.p.accounts.filter(function (z) { return z.kind !== kind; }); st.changed = true; paint(); toast(k.name + ' entfernt');
        } catch (err) { var m = $('.msg', row); m.className = 'msg err'; m.textContent = errText(err); m.hidden = false; }
      });
      return row;
    }
    // Entwuerfe von Zeilen, die noch nicht gespeichert waren, wieder oeffnen
    Object.keys(drafts()).forEach(function (d) { var m = d.match(/^acc:([a-z]+)(-[2-5])?$/); if (m && GA.BY[m[1]] && !(st.p.accounts || []).some(function (a) { return a.kind === m[1] + (m[2] || ''); })) { extra[m[1]] = extra[m[1]] || []; extra[m[1]].push(m[1] + (m[2] || '')); } });
    paint();
    circles().then(function (cs) { if (cs.length && st && st.tab === 'konten') $$('select.aud', box).forEach(function (s) { var v = s.value, n = document.createElement('div'); n.innerHTML = audSel(s.name, v); s.replaceWith(n.firstChild); }); });
  }
  async function saveAccount(k, row, kind, sort, draft) {
    var msg = $('.msg', row), btn = $('button[type="submit"]', row), raw = row.handle.value;
    var say = function (cls, t) { msg.className = 'msg ' + cls; msg.textContent = t; msg.hidden = false; };
    var handle = k.check(raw);
    if (!handle) return say('err', raw.trim() ? 'Bitte so eingeben: ' + k.placeholder : 'Bitte ' + k.label + ' eintragen.');
    var extra = {};
    if (row.region) extra.region = row.region.value;
    if (row.game) extra.game = row.game.value;
    if (row.label.value.trim()) extra.label = row.label.value.trim().slice(0, 24);
    if (row.hours && row.hours.value.trim()) {
      // "1.234,5" und "629,5" wie im Deutschen, "629.5" als Dezimalzahl, "1.234" als Tausender
      var hv = row.hours.value.trim().replace(/\s|std\.?|hrs?|h$/gi, '');
      hv = /,/.test(hv) || /^\d{1,3}(\.\d{3})+$/.test(hv) ? hv.replace(/\./g, '').replace(',', '.') : hv;
      var h = +hv;
      if (!(h >= 0 && h < 1e6)) return say('err', 'Die Spielzeit bitte als Zahl in Stunden, z. B. 629.');
      extra.hours = Math.round(h * 10) / 10;
    }
    var aud = row.audience.value;
    try {
      await busy(btn, async function () {
        var checked = null;
        if (k.live && (k.key !== 'discord' || k.invite(handle))) {
          var r = await Api.fn('gp-sync', { action: 'check', kind: kind, handle: handle, extra: extra });
          if (!r || !r.ok) throw { code: (r && r.error) || 'failed' };
          if (!r.unchecked) checked = new Date().toISOString();
          if (r.data) {
            var d = r.data, found = d.riotId || d.name || d.code || handle;
            say('ok', (r.unchecked ? 'Gespeichert (ohne Prüfung, Live-Daten sind noch nicht eingerichtet): ' : 'Gefunden: ') + found + (d.rank ? ' · ' + d.rank.name : '') + (d.members ? ' · ' + d.members + ' Mitglieder' : ''));
          } else if (r.unchecked) say('ok', 'Gespeichert (ohne Prüfung, Live-Daten sind noch nicht eingerichtet).');
        }
        await ensureProfile();
        var rows = await Api.upsert('gp_accounts?on_conflict=owner,kind', [{ owner: st.me, kind: kind, handle: handle, extra: extra, in_sidebar: aud !== 'me', audience: aud === 'me' ? 'me' : aud,
          public_full: row.public_full.checked, sort: sort, checked_at: checked }]);
        var a = rows && rows[0];
        st.p.accounts = (st.p.accounts || []).filter(function (x) { return x.kind !== kind; }).concat(a ? [a] : []);
        st.changed = true;
      });
      row.handle.value = handle; row.classList.add('set'); draft.saved(); btn.textContent = 'Speichern';
      if (msg.hidden || !/^Gefunden|^Gespeichert/.test(msg.textContent)) say('ok', 'Gespeichert.');
    } catch (err) { say('err', errText(err)); }
  }

  // ---------------------------------------------------------------- Valorant: Skins, Bundles, Battlepaesse
  // Auswahl speichert sich selbst (gp_set_val_items; Battlepaesse wie Bundles mit ihrer Vertrags-UUID).
  function valItems(sel) {
    return Object.keys(sel.skins).map(function (id) { return { kind: 'skin', item: id }; }).concat(Object.keys(sel.bundles).map(function (id) { return { kind: 'bundle', item: id }; }));
  }
  function tabValorant(body) {
    var VC = window.ValCat, sel = { skins: {}, bundles: {} }, restored = drafts().val;
    (st.p.val_items || []).forEach(function (x) { (x.kind === 'bundle' ? sel.bundles : sel.skins)[x.item] = 1; });
    if (restored && restored.skins && restored.bundles) sel = { skins: restored.skins, bundles: restored.bundles };
    var S = st;   // auch nach dem Schliessen noch dasselbe Objekt (close wartet auf die Speicherung)
    var saver = autosaver('val', function (d) {
      return ensureProfileOf(S).then(function () { return Api.rpc('gp_set_val_items', { p_skins: Object.keys(d.skins), p_bundles: Object.keys(d.bundles) }); });
    }, function (d) { S.p.val_items = valItems(d); S.changed = true; });
    var copy = function () { return { skins: Object.assign({}, sel.skins), bundles: Object.assign({}, sel.bundles) }; };
    if (restored) saver.set(copy());

    var mode = 'skins', q = '', weapon = '', onlySel = false, limit = 72, c = null, altTried = false;
    body.innerHTML = '<p class="muted">Lade den Katalog …</p>';
    function start(cat) {
      c = cat;
      body.innerHTML = '<div class="vp-top">' +
        '<div class="seg vp-modes" role="tablist" aria-label="Was auswählen?"><button type="button" data-mode="skins">Skins <i></i></button><button type="button" data-mode="bundles">Bundles <i></i></button><button type="button" data-mode="passes">Battlepässe <i></i></button></div>' +
        '<div class="vp-filters"><input type="search" placeholder="Suchen, z. B. Kuronami oder Vandal" aria-label="Suchen" value="' + esc(q) + '">' +
        '<select aria-label="Waffe"><option value="">Alle Waffen</option>' + c.weapons.map(function (w) { return '<option' + (w === weapon ? ' selected' : '') + '>' + esc(w) + '</option>'; }).join('') + '</select>' +
        '<label class="pick small"><input type="checkbox" data-only' + (onlySel ? ' checked' : '') + '><span>Nur ausgewählte</span></label>' +
        '<div class="seg seg-sm" role="group" aria-label="Sprache der Namen"><button type="button" data-lang="de">DE</button><button type="button" data-lang="en">EN</button></div></div>' +
        '<p class="vp-sum"></p></div>' +
        (restored ? '<p class="draft-note"><span>✎ Deine letzte Auswahl war noch nicht gespeichert. Sie ist wieder da und wird jetzt gespeichert.</span></p>' : '') +
        '<p class="muted small vp-hint"></p><div class="vpick-grid"></div><div class="dlg-actions start"><button type="button" class="btn ghost" data-more hidden>Mehr anzeigen</button></div>';
      restored = null;
      var grid = $('.vpick-grid', body), more = $('[data-more]', body), wsel = $('select', body);
      $$('[data-mode]', body).forEach(function (b) { b.classList.toggle('on', b.dataset.mode === mode); });
      $$('[data-lang]', body).forEach(function (b) { b.classList.toggle('on', b.dataset.lang === c.lang); });
      // Welche Skins sind schon ueber ein gewaehltes Bundle oder einen Battlepass dabei?
      function via() { var m = {}; Object.keys(sel.bundles).forEach(function (id) { var b = c.bundleById[id]; if (b) b.s.forEach(function (s) { if (!m[s]) m[s] = b.n; }); }); return m; }
      function list() {
        var n = VC.norm(q);
        if (mode === 'skins') return c.skins.filter(function (s) { return (!weapon || s.w === weapon) && (!n || s.k.indexOf(n) >= 0) && (!onlySel || sel.skins[s.id]); });
        return (mode === 'bundles' ? c.bundles : c.passes).filter(function (b) { return (!n || b.k.indexOf(n) >= 0) && (!onlySel || sel.bundles[b.id]); });
      }
      function weaponsOf(b) { var ws = []; VC.bundleSkins(c, b).forEach(function (s) { var w = s.wl || s.w; if (ws.indexOf(w) < 0) ws.push(w); }); return ws; }
      function summary() {
        var r = VC.resolve(c, valItems(sel)), nS = Object.keys(sel.skins).length, nB = 0, nP = 0;
        Object.keys(sel.bundles).forEach(function (id) { var b = c.bundleById[id]; if (b && b.pass) nP++; else if (b) nB++; });
        var tabs = $$('[data-mode] i', body); tabs[0].textContent = nS || ''; tabs[1].textContent = nB || ''; tabs[2].textContent = nP || '';
        $('.vp-sum', body).innerHTML = '<b>' + nf.format(r.skins.length) + ' Skins</b> in deinem Profil' + (nB || nP ? ' (' + [nB ? nB + (nB === 1 ? ' Bundle' : ' Bundles') : '', nP ? nP + (nP === 1 ? ' Battlepass' : ' Battlepässe') : ''].filter(Boolean).join(', ') + ' eingerechnet)' : '') +
          (r.value.vp ? ' · Wert grob <b>' + nf.format(r.value.vp) + ' VP ≈ ' + nf.format(r.value.eur) + ' €</b>' : '');
      }
      function tile(x) {
        var b = document.createElement('button'), on, sub, v = mode === 'skins' && !sel.skins[x.id] && via()[x.id];
        b.type = 'button'; b.dataset.id = x.id;
        if (mode === 'skins') {
          on = !!sel.skins[x.id]; sub = [x.wl || x.w, x.t].filter(Boolean).join(' · ');
          b.className = 'vtile' + (on ? ' on' : '') + (v ? ' via' : '');
          if (x.c) b.style.setProperty('--tier', x.c);
          b.title = x.full + (v ? ' (schon dabei über ' + v + ')' : '');
        } else {
          on = !!sel.bundles[x.id]; var ws = weaponsOf(x);
          sub = x.s.length + ' Skins: ' + ws.slice(0, 5).join(', ') + (ws.length > 5 ? ' …' : '') + (x.pass && x.at ? ' · ' + new Date(x.at).getFullYear() : '');
          b.className = 'vtile vbundle' + (on ? ' on' : '');
          b.title = x.n + ': ' + VC.bundleSkins(c, x).map(function (s) { return s.n + ' (' + (s.wl || s.w) + ')'; }).join(', ');
        }
        b.setAttribute('aria-pressed', String(on));
        b.innerHTML = '<span class="im">' + (x.i ? '<img loading="lazy" alt="" src="' + esc(x.i) + '">' : '<span class="noimg">🎯</span>') + '</span>' +
          '<span class="tx"><b>' + esc(x.n) + '</b><small>' + esc(sub) + '</small>' + (v ? '<small class="via-t">✓ über ' + esc(v) + '</small>' : '') + '</span>';
        return b;
      }
      function paint() {
        var all = list();
        grid.className = 'vpick-grid' + (mode === 'skins' ? '' : ' wide');
        wsel.hidden = mode !== 'skins';
        $('.vp-hint', body).textContent = { skins: 'Tippe die Skins an, die du besitzt. Skins aus gewählten Bundles und Battlepässen sind schon dabei (grünes Häkchen).',
          bundles: 'Ein Bundle nimmt genau die Skins mit, die in diesem Bundle verkauft wurden. Gleichnamige Bundles (z. B. Kuronami und Kuronami 2) sind getrennt; die Waffen zeigen, welches welches ist.',
          passes: 'Ein Battlepass nimmt alle Skins dieses Akts mit. Gewertet wird er mit seinem Preis (meist 1.000 VP).' }[mode] + ' ' + nf.format(all.length) + ' Treffer.';
        grid.textContent = '';
        var frag = document.createDocumentFragment();
        all.slice(0, limit).forEach(function (x) { frag.appendChild(tile(x)); });
        grid.appendChild(frag);
        if (!all.length) grid.innerHTML = '<p class="muted">Nichts gefunden.</p>';
        more.hidden = all.length <= limit; more.textContent = 'Mehr anzeigen (' + nf.format(all.length - limit) + ' weitere)';
        summary();
        // nichts gefunden: Namen der anderen Sprache dazuladen und nochmal suchen
        if (!all.length && q && !altTried) { altTried = true; VC.load(c.lang === 'de' ? 'en' : 'de').then(function (o) { VC.addAlt(c, o); paint(); }).catch(function () {}); }
      }
      grid.addEventListener('click', function (e) {
        var b = e.target.closest('.vtile'); if (!b) return;
        var id = b.dataset.id, map = mode === 'skins' ? sel.skins : sel.bundles;
        if (mode === 'skins' && !map[id] && b.classList.contains('via')) { toast('Schon dabei über „' + via()[id] + '“'); return; }
        if (map[id]) delete map[id]; else map[id] = 1;
        var nb = tile(mode === 'skins' ? c.byId[id] : c.bundleById[id]); b.replaceWith(nb);
        summary(); saver.set(copy());
      });
      $('.vp-modes', body).addEventListener('click', function (e) {
        var b = e.target.closest('[data-mode]'); if (!b || b.dataset.mode === mode) return; mode = b.dataset.mode; limit = 72;
        $$('[data-mode]', body).forEach(function (x) { x.classList.toggle('on', x === b); }); paint();
      });
      var t = 0; $('input[type="search"]', body).addEventListener('input', function (e) { clearTimeout(t); t = setTimeout(function () { q = e.target.value; limit = 72; paint(); }, 150); });
      wsel.addEventListener('change', function () { weapon = wsel.value; limit = 72; paint(); });
      $('[data-only]', body).addEventListener('change', function (e) { onlySel = e.target.checked; limit = 72; paint(); });
      more.addEventListener('click', function () { limit += 96; paint(); });
      $$('[data-lang]', body).forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.dataset.lang === c.lang) return;
          VC.setLang(b.dataset.lang); weapon = ''; altTried = false; st.changed = true;
          body.querySelector('.vp-sum').textContent = 'Lade die Namen …';
          VC.load(b.dataset.lang).then(start).catch(function () { toast('Die Namen konnten nicht geladen werden.'); });
        });
      });
      paint();
    }
    VC.load().then(start).catch(function () { body.innerHTML = '<p class="msg err">Der Valorant-Katalog konnte nicht geladen werden. Bitte später nochmal. Deine Auswahl bleibt erhalten.</p>'; });
  }

  // ---------------------------------------------------------------- Minecraft: Skins hochladen, Lieblingsserver
  // PNG pruefen (64x64 oder 64x32) und klein halten (Metadaten fallen beim Neu-Kodieren weg)
  function readSkin(file) {
    return new Promise(function (ok, no) {
      if (!file || file.size > 300000) return no({ code: 'too_big' });
      var r = new FileReader();
      r.onerror = function () { no({ code: 'bad_png' }); };
      r.onload = function () {
        var im = new Image();
        im.onerror = function () { no({ code: 'bad_png' }); };
        im.onload = function () {
          if (im.width !== 64 || (im.height !== 64 && im.height !== 32)) return no({ code: 'bad_png' });
          var data = String(r.result);
          if (!/^data:image\/png;base64,/.test(data) || data.length > 24000) {
            var cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; cv.getContext('2d').drawImage(im, 0, 0);
            data = cv.toDataURL('image/png');
          }
          if (data.length > 24000) return no({ code: 'too_big' });
          // schmale Arme (Alex): bei 64x64 ist die Spalte 54 im rechten Arm durchsichtig
          var slim = false;
          if (im.height === 64) { var c2 = document.createElement('canvas'); c2.width = 64; c2.height = 64; var x = c2.getContext('2d'); x.drawImage(im, 0, 0); slim = x.getImageData(54, 20, 1, 1).data[3] === 0; }
          ok({ png: data, model: slim ? 'slim' : 'classic' });
        };
        im.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }
  function face(png) { return '<canvas class="face-mini" width="8" height="8" data-png="' + esc(png) + '"></canvas>'; }
  function drawFaces(root) {
    $$('canvas[data-png]', root).forEach(function (c) {
      var i = new Image(); i.onload = function () { var x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(i, 8, 8, 8, 8, 0, 0, 8, 8); x.drawImage(i, 40, 8, 8, 8, 0, 0, 8, 8); }; i.src = c.dataset.png;
    });
  }
  function tabMinecraft(body) {
    var pr = st.p.profile || {}, skins = st.p.mc_skins || [];
    body.innerHTML = '<section class="ecard"><h3>Skins</h3><p class="muted">Bis zu 12 Skins (PNG, 64×64). Den Skin deines verknüpften Minecraft-Kontos zeigen wir automatisch dazu.</p>' +
      '<ul class="mc-skin-list">' + skins.map(function (s) {
        return '<li data-id="' + s.id + '">' + face(s.png) + '<input value="' + esc(s.name) + '" maxlength="30" aria-label="Name des Skins"><select aria-label="Arme"><option value="classic"' + (s.model !== 'slim' ? ' selected' : '') + '>Breite Arme</option><option value="slim"' + (s.model === 'slim' ? ' selected' : '') + '>Schmale Arme</option></select>' +
          '<button type="button" class="link-btn" data-act="save">Speichern</button><button type="button" class="link-btn danger-text" data-act="del">Löschen</button></li>';
      }).join('') + '</ul>' +
      (skins.length < 12 ? '<label class="btn ghost small upload">Skin hochladen …<input type="file" accept="image/png" multiple hidden></label>' : '<p class="muted">Maximal 12 Skins.</p>') +
      '<p class="msg" data-m="skins" hidden></p></section>' +
      '<section class="ecard"><h3>Lieblingsserver</h3><form class="gform" id="fSrv" novalidate><label>Serveradresse<input name="addr" value="' + esc(pr.mc_server || '') + '" placeholder="play.beispiel.de" autocomplete="off" spellcheck="false"></label>' +
      '<div class="srv-preview" hidden></div><p class="msg" hidden></p>' +
      '<div class="dlg-actions start"><button type="button" class="btn ghost" data-act="check">Vorschau prüfen</button><button class="btn" type="submit">Speichern</button></div></form></section>';
    drawFaces(body);
    var mSk = $('[data-m="skins"]', body), say = function (m, cls, t) { m.className = 'msg ' + cls; m.textContent = t; m.hidden = false; };
    var up = $('.upload input', body);
    if (up) up.addEventListener('change', async function () {
      var files = Array.prototype.slice.call(up.files || []).slice(0, 12 - skins.length), n = 0;
      try {
        await ensureProfile();
        for (var i = 0; i < files.length; i++) {
          var s = await readSkin(files[i]);
          var rows = await Api.insert('gp_mc_skins', [{ owner: st.me, name: files[i].name.replace(/\.png$/i, '').slice(0, 30) || 'Skin', model: s.model, png: s.png }]);
          if (rows && rows[0]) { st.p.mc_skins = (st.p.mc_skins || []).concat(rows[0]); n++; }
        }
        st.changed = true; show('minecraft'); toast(n === 1 ? 'Skin hochgeladen' : n + ' Skins hochgeladen');
      } catch (err) { say(mSk, 'err', errText(err)); if (n) { st.changed = true; } }
    });
    $('.mc-skin-list', body).addEventListener('click', async function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var li = b.closest('li'), id = li.dataset.id;
      try {
        if (b.dataset.act === 'del') {
          await busy(b, function () { return Api.remove('gp_mc_skins', 'id=eq.' + id); });
          st.p.mc_skins = st.p.mc_skins.filter(function (s) { return s.id !== id; });
          if (pr.mc_active_skin === id) await saveProfile({ mc_active_skin: null });
          st.changed = true; show('minecraft');
        } else {
          var name = $('input', li).value.trim().slice(0, 30) || 'Skin', model = $('select', li).value;
          await busy(b, function () { return Api.update('gp_mc_skins', 'id=eq.' + id, { name: name, model: model }); });
          st.p.mc_skins.forEach(function (s) { if (s.id === id) { s.name = name; s.model = model; } });
          st.changed = true; say(mSk, 'ok', 'Gespeichert.');
        }
      } catch (err) { say(mSk, 'err', errText(err)); }
    });
    var f = $('#fSrv', body), pv = $('.srv-preview', f), mS = $('.msg', f);
    var draft = keepDraft(f, 'mcsrv', function () { show('minecraft'); });
    var norm = function (v) { return v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''); };
    async function check() {
      var a = norm(f.addr.value); if (!a) { pv.hidden = true; return null; }
      if (!/^[a-z0-9.-]{3,80}(:\d{2,5})?$/.test(a)) throw { code: 'bad_handle' };
      var r = await Api.fn('gp-sync', { action: 'check', kind: 'mcserver', handle: a });
      if (!r || !r.ok) throw { code: (r && r.error) || 'failed' };
      var d = r.data;
      pv.innerHTML = (d.icon ? '<img src="' + esc(d.icon) + '" alt="" width="48" height="48">' : '') + '<div><b>' + esc(d.address) + '</b><span class="srv ' + (d.online ? 'up' : 'down') + '"><span class="ping"></span>' +
        (d.online ? 'Online · ' + d.players + '/' + d.max + ' Spieler' : 'Gefunden, gerade offline') + '</span>' + (d.motd ? '<small>' + esc(d.motd) + '</small>' : '') + '</div>';
      pv.hidden = false; return a;
    }
    $('[data-act="check"]', f).addEventListener('click', async function (e) {
      try { await busy(e.target, check); mS.hidden = true; } catch (err) { pv.hidden = true; say(mS, 'err', err.code === 'not_found' ? 'Server nicht gefunden. Stimmt die Adresse?' : errText(err)); }
    });
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      try {
        await busy($('button[type="submit"]', f), async function () {
          var a = norm(f.addr.value);
          if (a) a = await check();
          await saveProfile({ mc_server: a || '' });
        });
        draft.saved();
        say(mS, 'ok', f.addr.value.trim() ? 'Gespeichert. Die Vorschau erscheint im Reiter Minecraft.' : 'Server entfernt.');
      } catch (err) { say(mS, 'err', err.code === 'not_found' ? 'Server nicht gefunden. Stimmt die Adresse?' : errText(err)); }
    });
  }

  // ---------------------------------------------------------------- Steam: Lieblingsspiele (speichern sich selbst)
  function tabSteam(body) {
    var restored = drafts().steam;
    var favs = (Array.isArray(restored) ? restored : (st.p.steam_favs || [])).map(function (f) { return { appid: f.appid, name: f.name }; });
    var lib = ((st.p.cache && st.p.cache.steam && st.p.cache.steam.data && st.p.cache.steam.data.library) || []);
    var img = function (id) { return 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + id + '/capsule_184x69.jpg'; };
    var S = st;
    var saver = autosaver('steam', function (d) { return ensureProfileOf(S).then(function () { return Api.rpc('gp_set_steam_favs', { p_items: d }); }); },
      function (d) { S.p.steam_favs = d.slice(); S.changed = true; });
    if (restored) saver.set(favs.slice());
    body.innerHTML = '<section class="ecard"><h3>Deine Lieblingsspiele <small class="muted">(' + favs.length + ' von 24)</small></h3>' +
      (restored ? '<p class="draft-note"><span>✎ Deine letzte Auswahl war noch nicht gespeichert. Sie ist wieder da und wird jetzt gespeichert.</span></p>' : '') +
      '<ol class="fav-list"></ol></section>' +
      '<section class="ecard"><h3>Hinzufügen</h3><p class="muted">' + (lib.length ? 'Aus deiner Bibliothek (' + lib.length + ' Spiele) oder' : 'Verknüpfe Steam, dann stehen deine Spiele hier zur Auswahl; sonst') + ' über die Suche im Steam-Shop. Alles speichert sich selbst.</p>' +
      '<div class="fav-add"><input type="search" placeholder="Spiel suchen" aria-label="Spiel suchen"><button type="button" class="btn ghost small" data-act="shop">Im Shop suchen</button></div>' +
      '<ul class="fav-results"></ul><p class="msg" hidden></p></section>';
    var ol = $('.fav-list', body), res = $('.fav-results', body), inp = $('input', body), msg = $('.msg', body), cnt = $('h3 small', body);
    function changed() { cnt.textContent = '(' + favs.length + ' von 24)'; saver.set(favs.slice()); }
    function paint() {
      ol.innerHTML = favs.map(function (f, i) {
        return '<li><img src="' + img(f.appid) + '" alt="" loading="lazy"><b>' + esc(f.name) + '</b><span class="fav-act"><button type="button" class="link-btn" data-up="' + i + '" aria-label="Nach oben"' + (i ? '' : ' disabled') + '>↑</button>' +
          '<button type="button" class="link-btn" data-down="' + i + '" aria-label="Nach unten"' + (i < favs.length - 1 ? '' : ' disabled') + '>↓</button><button type="button" class="link-btn danger-text" data-rm="' + i + '" aria-label="Entfernen">✕</button></span></li>';
      }).join('') || '<li class="muted">Noch keine Lieblingsspiele.</li>';
    }
    function results(items) {
      res.innerHTML = items.slice(0, 12).map(function (g) {
        var on = favs.some(function (f) { return f.appid === g.appid; });
        return '<li><img src="' + img(g.appid) + '" alt="" loading="lazy"><b>' + esc(g.name) + '</b>' + (g.hours ? '<small>' + Math.round(g.hours) + ' Std</small>' : '') +
          '<button type="button" class="btn small' + (on ? ' ghost' : '') + '" data-add="' + g.appid + '" data-name="' + esc(g.name) + '"' + (on ? ' disabled' : '') + '>' + (on ? 'Gewählt' : 'Hinzufügen') + '</button></li>';
      }).join('');
    }
    function fromLib() { var q = inp.value.trim().toLowerCase(); results(lib.filter(function (g) { return !q || g.name.toLowerCase().indexOf(q) >= 0; })); }
    ol.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.rm != null) favs.splice(+b.dataset.rm, 1);
      else if (b.dataset.up != null) { var i = +b.dataset.up; favs.splice(i - 1, 0, favs.splice(i, 1)[0]); }
      else if (b.dataset.down != null) { var j = +b.dataset.down; favs.splice(j + 1, 0, favs.splice(j, 1)[0]); }
      paint(); fromLib(); changed();
    });
    res.addEventListener('click', function (e) {
      var b = e.target.closest('[data-add]'); if (!b) return;
      if (favs.length >= 24) { msg.className = 'msg err'; msg.textContent = 'Maximal 24 Lieblingsspiele.'; msg.hidden = false; return; }
      favs.push({ appid: +b.dataset.add, name: b.dataset.name }); paint(); b.disabled = true; b.textContent = 'Gewählt'; b.classList.add('ghost'); changed();
    });
    var t = 0; inp.addEventListener('input', function () { clearTimeout(t); t = setTimeout(fromLib, 120); });
    $('[data-act="shop"]', body).addEventListener('click', async function (e) {
      if (inp.value.trim().length < 2) { inp.focus(); return; }
      try { var r = await busy(e.target, function () { return Api.fn('gp-sync', { action: 'steam-search', q: inp.value }); }); results((r && r.items) || []); if (!r.items || !r.items.length) res.innerHTML = '<li class="muted">Nichts gefunden.</li>'; }
      catch (err) { msg.className = 'msg err'; msg.textContent = errText(err); msg.hidden = false; }
    });
    paint(); fromLib();
  }

  // ---------------------------------------------------------------- Teilen per Link / QR-Code (wie bei Wunschlisten)
  function urlOf(t) { return location.origin + location.pathname + '?profil=' + t; }
  function qrSvg(url) { var q = window.qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
  async function share() {
    var token = null, prevTab = st && st.tab, keep = st;
    if (keep) await flushAll();
    try { var rows = await Api.get('gp_share_links', 'select=token'); token = rows[0] && rows[0].token; } catch (e) { return toast(errText(e)); }
    function paint() {
      var url = token && urlOf(token);
      dlg.classList.remove('wide');
      dlg.innerHTML = '<div class="gdlg-head"><h2 id="gdlgTitle">Gaming-Profil teilen</h2><button type="button" class="gdlg-x" data-close aria-label="Schließen">✕</button></div><div class="gdlg-body">' +
        '<p class="muted">Wer den Link öffnet, sieht <b>ohne Anmeldung nur eine Vorschau</b> (Name und welche Konten verknüpft sind). Nach der Anmeldung ist man bei dir <b>Bekannt</b> und sieht dein Gaming-Profil.</p>' +
        (url ? '<div class="share-box"><div class="share-qr" aria-label="QR-Code zum Scannen">' + qrSvg(url) + '</div><div class="share-side"><label>Dein Link<input readonly value="' + esc(url) + '"></label>' +
          '<div class="dlg-actions start"><button type="button" class="btn" data-act="copy">Link kopieren</button>' + (navigator.share ? '<button type="button" class="btn ghost" data-act="native">Teilen …</button>' : '') + '<button type="button" class="btn ghost" data-act="qr">QR speichern</button></div>' +
          '<div class="dlg-actions start"><button type="button" class="link-btn" data-act="reset">↻ Neuen Link erzeugen</button><button type="button" class="link-btn danger-text" data-act="off">Link deaktivieren</button></div></div></div>'
          : '<div class="dlg-actions start"><button type="button" class="btn" data-act="on">🔗 Link erstellen</button></div>') +
        '</div><div class="gdlg-foot">' + (keep ? '<button type="button" class="btn ghost" data-act="back">Zurück zum Editor</button>' : '') + '<button type="button" class="btn" data-close>Fertig</button></div>';
    }
    dlg.onclick = async function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      try {
        var act = b.dataset.act;
        if (act === 'on' || act === 'reset') { token = await busy(b, function () { return Api.rpc('gp_share_enable', { p_reset: act === 'reset' }); }); if (keep) keep.changed = true; paint(); }
        else if (act === 'off') { await busy(b, function () { return Api.rpc('gp_share_disable'); }); token = null; paint(); toast('Link deaktiviert'); }
        else if (act === 'copy') { await navigator.clipboard.writeText(urlOf(token)); toast('Link kopiert'); }
        else if (act === 'native') navigator.share({ title: 'Mein Gaming-Profil', url: urlOf(token) }).catch(function () {});
        else if (act === 'qr') {
          var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString($('.share-qr svg'))], { type: 'image/svg+xml' }));
          a.download = 'gaming-profil-qr.svg'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        } else if (act === 'back') { dlg.onclick = null; var ch = keep.changed; open(keep.p, keep.onDone, prevTab); st.changed = ch; }
      } catch (err) { toast(errText(err)); }
    };
    paint();
    if (!dlg.open) dlg.showModal();
  }

  window.Editor = { open: open, share: share, errText: errText,
    // fuer editor-extra.js (weitere Bereiche des Editors)
    _: { get st() { return st; }, $: $, $$: $$, esc: esc, toast: toast, busy: busy, errText: errText, keepDraft: keepDraft, drafts: drafts, setDraft: setDraft,
      autosaver: autosaver, saveProfile: saveProfile, ensureProfile: ensureProfile, ensureProfileOf: ensureProfileOf, show: show, audSel: audSel, circles: circles, AUD: AUD } };
})();
