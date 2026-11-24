// Editor fuer das eigene Gaming-Profil (Dialog #gdlg): Profil und Freigaben, Konten, Valorant-Skins, Minecraft, Steam.
// Jeder Bereich speichert fuer sich (Supabase ueber Api aus wunschliste/api.js). Konten mit Live-Daten werden vorher ueber
// die Edge Function gp-sync geprueft ("check"), damit nur Konten gespeichert werden, die es wirklich gibt.
(function () {
  'use strict';
  var dlg = document.getElementById('gdlg'), FX = window.FX || {};
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var $ = function (sel, root) { return (root || dlg).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || dlg).querySelectorAll(sel)); };
  function toast(t) { if (FX.toast) FX.toast(t); }
  var ERR = {
    not_found: 'Nicht gefunden. Stimmt die Schreibweise?', bad_handle: 'Bitte im angegebenen Format eingeben.', rate_limited: 'Gerade zu viele Abfragen. Bitte in einer Minute nochmal.',
    timeout: 'Der Dienst antwortet gerade nicht. Bitte später nochmal.', network: 'Keine Verbindung. Bitte später nochmal.', upstream_denied: 'Der Dienst hat die Abfrage abgelehnt.',
    too_many: 'Das sind zu viele Einträge.', no_access: 'Keine Berechtigung.', not_authenticated: 'Bitte neu anmelden.', too_big: 'Die Datei ist zu groß.', bad_png: 'Das ist kein Minecraft-Skin (PNG, 64×64 oder 64×32 Pixel).'
  };
  function errText(e) { var c = (e && (e.code || e.message || e.error)) || String(e || ''); return ERR[c] || (/^upstream_/.test(c) ? 'Der Dienst hat gerade ein Problem. Bitte später nochmal.' : 'Das hat nicht geklappt (' + c + ').'); }
  async function busy(btn, fn) { var t = btn.innerHTML; btn.disabled = true; btn.innerHTML = '…'; try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = t; } }

  var st = null;   // { p, me, changed, tab, onDone }
  var TABS = [['profil', 'Profil & Freigabe'], ['konten', 'Konten'], ['valorant', 'Valorant-Skins'], ['minecraft', 'Minecraft'], ['steam', 'Steam']];

  function close() { if (dlg.open) dlg.close(); }
  dlg.addEventListener('close', function () { if (st && st.onDone && st.changed) st.onDone(); st = null; dlg.textContent = ''; });
  dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.closest('[data-close]')) close(); });

  async function ensureProfile() {
    if (st.p.profile) return;
    var rows = await Api.upsert('gp_profiles', [{ id: st.me }]);
    st.p.profile = rows && rows[0] || { id: st.me, visibility: 'friends', tagline: '', pioneer: 'pionier-gruen', mc_server: '' };
    st.changed = true;
  }
  async function saveProfile(patch) {
    await ensureProfile();
    patch.id = st.me; patch.updated_at = new Date().toISOString();
    var rows = await Api.upsert('gp_profiles', [patch]);
    st.p.profile = Object.assign({}, st.p.profile, patch, rows && rows[0]);
    st.changed = true;
  }

  function open(p, onDone, tab) {
    st = { p: JSON.parse(JSON.stringify(p)), me: Api.user.id, changed: false, tab: tab || 'profil', onDone: onDone };
    dlg.innerHTML = '<div class="gdlg-head"><h2 id="gdlgTitle">Gaming-Profil bearbeiten</h2><button type="button" class="link-btn" data-close aria-label="Schließen">✕</button></div>' +
      '<nav class="gdlg-tabs hscroll" role="tablist">' + TABS.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</nav>' +
      '<div class="gdlg-body" id="gdlgBody"></div>' +
      '<div class="gdlg-foot"><button type="button" class="btn" data-close>Fertig</button></div>';
    $('.gdlg-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
    if (!dlg.open) dlg.showModal();
    show(st.tab);
  }
  function show(tab) {
    st.tab = tab;
    $$('.gdlg-tabs [data-tab]').forEach(function (b) { var on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    var body = $('#gdlgBody'); body.textContent = '';
    ({ profil: tabProfil, konten: tabKonten, valorant: tabValorant, minecraft: tabMinecraft, steam: tabSteam })[tab](body);
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
      '<label>Spruch unter deinem Namen<input name="tagline" maxlength="120" value="' + esc(pr.tagline) + '" placeholder="z. B. Ranked-Grinder, Fabrikplaner, Pokémon-Sammler"></label>' +
      '<label>Lieblingsagent (Valorant)<select name="val_agent"><option value="">KAY/O (Standard)</option></select></label>' +
      '<fieldset class="vis"><legend>Wer darf dein Gaming-Profil sehen?</legend>' +
      [['private', 'Nur ich', 'Niemand außer dir.'], ['friends', 'Alle Freunde', 'Alle Freunde aus der Wunschliste mit der Stufe „Freund“ (nicht „Bekannt“).'], ['custom', 'Ausgewählte', 'Nur die Personen und Gruppen, die du unten auswählst, und wer über deinen Link kommt.']]
        .map(function (v) { return '<label class="radio"><input type="radio" name="visibility" value="' + v[0] + '"' + (pr.visibility === v[0] ? ' checked' : '') + '><span><b>' + v[1] + '</b><small>' + v[2] + '</small></span></label>'; }).join('') +
      '<div class="pick-who" hidden><p class="muted">Lädt Freunde und Gruppen …</p></div></fieldset>' +
      '<p class="muted small">Freunde und Gruppen verwaltest du in der <a href="../wunschliste/?seite=freunde">Wunschliste</a>; sie gelten hier genauso.</p>' +
      '<p class="msg" hidden></p>' +
      '<div class="dlg-actions start"><button class="btn" type="submit">Speichern</button><button class="btn ghost" type="button" id="btnLink">🔗 Teilen-Link & QR-Code</button></div></form>';
    var f = $('#fProfil'), who = $('.pick-who', f), people = null;
    window.ValCat.load().then(function (c) {
      var sel = f.val_agent;
      c.agents.forEach(function (a) { var o = document.createElement('option'); o.value = a.id; o.textContent = a.n; if (a.id === pr.val_agent) o.selected = true; sel.appendChild(o); });
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
    }).catch(function (e) { who.innerHTML = '<p class="msg err">' + esc(errText(e)) + '</p>'; });
    $('#btnLink', f).addEventListener('click', function () { share(); });
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
        msg.className = 'msg ok'; msg.textContent = 'Gespeichert.'; msg.hidden = false;
      } catch (err) { msg.className = 'msg err'; msg.textContent = errText(err); msg.hidden = false; }
    });
  }

  // ---------------------------------------------------------------- Konten
  function tabKonten(body) {
    var GA = window.GAccounts, have = {};
    (st.p.accounts || []).forEach(function (a) { have[a.kind] = a; });
    body.innerHTML = '<p class="muted">Trag nur ein, was andere sehen dürfen. Konten mit ✓ werden beim Speichern geprüft und liefern Live-Daten.</p><div class="acc-edit-list"></div>';
    var box = $('.acc-edit-list', body);
    GA.KINDS.forEach(function (k, i) {
      var a = have[k.key], row = document.createElement('form');
      row.className = 'acc-edit' + (a ? ' set' : ''); row.noValidate = true; row.style.setProperty('--c', k.color);
      row.innerHTML = '<div class="acc-edit-head"><span class="acc-badge" style="--c:' + k.color + '">' + esc(k.short) + '</span><b>' + esc(k.name) + '</b>' + (k.live ? '<span class="live" title="wird geprüft, mit Live-Daten">✓</span>' : '') + '</div>' +
        '<div class="acc-edit-row"><input name="handle" aria-label="' + esc(k.label) + '" placeholder="' + esc(k.placeholder) + '" value="' + esc(a ? a.handle : '') + '" autocomplete="off" spellcheck="false">' +
        (k.regions ? '<select name="region" aria-label="Region">' + k.regions.map(function (r) { return '<option value="' + r[0] + '"' + (a && a.extra && a.extra.region === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select>' : '') +
        '<label class="pick small"><input type="checkbox" name="in_sidebar"' + (!a || a.in_sidebar !== false ? ' checked' : '') + '><span>In Leiste</span></label>' +
        '<button class="btn small" type="submit">' + (a ? 'Speichern' : 'Verknüpfen') + '</button>' +
        (a ? '<button class="link-btn danger-text" type="button" data-act="del">Entfernen</button>' : '') + '</div>' +
        (k.hint ? '<p class="muted small">' + esc(k.hint) + '</p>' : '') + '<p class="msg" hidden></p>';
      row.addEventListener('submit', function (e) { e.preventDefault(); saveAccount(k, row, i); });
      var del = $('[data-act="del"]', row);
      if (del) del.addEventListener('click', async function () {
        try {
          await busy(del, function () { return Api.remove('gp_accounts', 'owner=eq.' + st.me + '&kind=eq.' + k.key); });
          st.p.accounts = st.p.accounts.filter(function (x) { return x.kind !== k.key; }); st.changed = true; show('konten'); toast(k.name + ' entfernt');
        } catch (err) { var m = $('.msg', row); m.className = 'msg err'; m.textContent = errText(err); m.hidden = false; }
      });
      box.appendChild(row);
    });
  }
  async function saveAccount(k, row, sort) {
    var msg = $('.msg', row), btn = $('button[type="submit"]', row), raw = row.handle.value;
    var say = function (cls, t) { msg.className = 'msg ' + cls; msg.textContent = t; msg.hidden = false; };
    var handle = k.check(raw);
    if (!handle) return say('err', raw.trim() ? 'Bitte so eingeben: ' + k.placeholder : 'Bitte ' + k.label + ' eintragen.');
    var extra = row.region ? { region: row.region.value } : {};
    try {
      await busy(btn, async function () {
        var checked = null;
        if (k.live && (k.key !== 'discord' || k.invite(handle))) {
          var r = await Api.fn('gp-sync', { action: 'check', kind: k.key, handle: handle, extra: extra });
          if (!r || !r.ok) throw { code: (r && r.error) || 'failed' };
          if (!r.unchecked) checked = new Date().toISOString();
          if (r.data) {
            var d = r.data, found = d.riotId || d.name || d.code || handle;
            say('ok', (r.unchecked ? 'Gespeichert (ohne Prüfung, Live-Daten sind noch nicht eingerichtet): ' : 'Gefunden: ') + found + (d.rank ? ' · ' + d.rank.name : '') + (d.members ? ' · ' + d.members + ' Mitglieder' : ''));
          } else if (r.unchecked) say('ok', 'Gespeichert (ohne Prüfung, Live-Daten sind noch nicht eingerichtet).');
        }
        await ensureProfile();
        var rows = await Api.upsert('gp_accounts?on_conflict=owner,kind', [{ owner: st.me, kind: k.key, handle: handle, extra: extra, in_sidebar: row.in_sidebar.checked, sort: sort, checked_at: checked }]);
        var a = rows && rows[0];
        st.p.accounts = (st.p.accounts || []).filter(function (x) { return x.kind !== k.key; }).concat(a ? [a] : []);
        st.changed = true;
      });
      row.handle.value = handle; row.classList.add('set');
      if (msg.hidden || !/^Gefunden|^Gespeichert/.test(msg.textContent)) say('ok', 'Gespeichert.');
    } catch (err) { say('err', errText(err)); }
  }

  // ---------------------------------------------------------------- Valorant-Skins und Bundles
  function tabValorant(body) {
    body.innerHTML = '<p class="muted">Wähle alle Skins aus, die du besitzt. Ein Bundle nimmt alle Skins mit seinem Namen mit. Die Liste kommt von valorant-api.com.</p><p class="muted">Lädt den Katalog …</p>';
    var skins = {}, bundles = {};
    (st.p.val_items || []).forEach(function (x) { (x.kind === 'bundle' ? bundles : skins)[x.item] = 1; });
    window.ValCat.load().then(function (c) {
      var mode = 'skins', q = '', weapon = '', onlySel = false, limit = 60;
      body.innerHTML = '<div class="vpick-bar"><div class="seg" role="tablist"><button type="button" data-mode="skins" class="on">Skins</button><button type="button" data-mode="bundles">Bundles</button></div>' +
        '<input type="search" placeholder="Suchen, z. B. Prime oder Vandal" aria-label="Suchen">' +
        '<select aria-label="Waffe"><option value="">Alle Waffen</option>' + c.weapons.map(function (w) { return '<option>' + esc(w) + '</option>'; }).join('') + '</select>' +
        '<label class="pick small"><input type="checkbox" data-only><span>Nur ausgewählte</span></label></div>' +
        '<p class="vpick-count muted"></p><div class="vpick-grid"></div><div class="dlg-actions start"><button type="button" class="btn ghost small" data-more hidden>Mehr anzeigen</button></div>' +
        '<p class="msg" hidden></p><div class="dlg-actions start"><button type="button" class="btn" data-save>Auswahl speichern</button></div>';
      var grid = $('.vpick-grid', body), count = $('.vpick-count', body), more = $('[data-more]', body), sel = $('select', body);
      function list() {
        var n = window.ValCat.norm(q);
        if (mode === 'skins') return c.skins.filter(function (s) { return (!weapon || s.w === weapon) && (!n || s.k.indexOf(n) >= 0) && (!onlySel || skins[s.id]); });
        return c.bundles.filter(function (b) { return (!n || window.ValCat.norm(b.n).indexOf(n) >= 0) && (!onlySel || bundles[b.id]); });
      }
      function paint() {
        var all = list(), nS = Object.keys(skins).length, nB = Object.keys(bundles).length;
        var total = window.ValCat.resolve(c, Object.keys(skins).map(function (id) { return { kind: 'skin', item: id }; }).concat(Object.keys(bundles).map(function (id) { return { kind: 'bundle', item: id }; }))).skins.length;
        count.textContent = nS + ' Skins und ' + nB + ' Bundles gewählt (zusammen ' + total + ' Skins) · ' + all.length + ' Treffer';
        sel.hidden = mode !== 'skins';
        grid.textContent = '';
        all.slice(0, limit).forEach(function (x) {
          var on = mode === 'skins' ? skins[x.id] : bundles[x.id], b = document.createElement('button');
          b.type = 'button'; b.className = 'vtile' + (on ? ' on' : ''); b.setAttribute('aria-pressed', String(!!on)); b.dataset.id = x.id;
          if (x.c) b.style.setProperty('--tier', x.c);
          b.innerHTML = '<span class="im">' + (x.i ? '<img loading="lazy" alt="" src="' + esc(x.i) + '">' : '🔫') + '</span><b>' + esc(x.n) + '</b><small>' +
            esc(mode === 'skins' ? [x.w, x.t].filter(Boolean).join(' · ') : window.ValCat.bundleSkins(c, x).length + ' Skins') + '</small>';
          grid.appendChild(b);
        });
        more.hidden = all.length <= limit;
      }
      grid.addEventListener('click', function (e) {
        var b = e.target.closest('.vtile'); if (!b) return;
        var map = mode === 'skins' ? skins : bundles, id = b.dataset.id;
        if (map[id]) delete map[id]; else map[id] = 1;
        b.classList.toggle('on', !!map[id]); b.setAttribute('aria-pressed', String(!!map[id]));
        var keep = limit; paint(); limit = keep;
      });
      $('.seg', body).addEventListener('click', function (e) {
        var b = e.target.closest('[data-mode]'); if (!b) return; mode = b.dataset.mode; limit = 60;
        $$('.seg button', body).forEach(function (x) { x.classList.toggle('on', x === b); }); paint();
      });
      var t = 0; $('input[type="search"]', body).addEventListener('input', function (e) { clearTimeout(t); t = setTimeout(function () { q = e.target.value; limit = 60; paint(); }, 150); });
      sel.addEventListener('change', function () { weapon = sel.value; limit = 60; paint(); });
      $('[data-only]', body).addEventListener('change', function (e) { onlySel = e.target.checked; limit = 60; paint(); });
      more.addEventListener('click', function () { limit += 60; paint(); });
      $('[data-save]', body).addEventListener('click', async function (e) {
        var m = $('.msg', body);
        try {
          await busy(e.target, async function () {
            await ensureProfile();
            await Api.rpc('gp_set_val_items', { p_skins: Object.keys(skins), p_bundles: Object.keys(bundles) });
          });
          st.p.val_items = Object.keys(skins).map(function (id) { return { kind: 'skin', item: id }; }).concat(Object.keys(bundles).map(function (id) { return { kind: 'bundle', item: id }; }));
          st.changed = true; m.className = 'msg ok'; m.textContent = 'Gespeichert.'; m.hidden = false;
        } catch (err) { m.className = 'msg err'; m.textContent = errText(err); m.hidden = false; }
      });
      paint();
    }).catch(function () { body.innerHTML = '<p class="msg err">Der Valorant-Katalog konnte nicht geladen werden. Bitte später nochmal.</p>'; });
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
    body.innerHTML = '<h3>Skins</h3><p class="muted">Bis zu 12 Skins (PNG, 64×64). Den Skin deines verknüpften Minecraft-Kontos zeigen wir automatisch dazu.</p>' +
      '<ul class="mc-skin-list">' + skins.map(function (s) {
        return '<li data-id="' + s.id + '">' + face(s.png) + '<input value="' + esc(s.name) + '" maxlength="30" aria-label="Name des Skins"><select aria-label="Arme"><option value="classic"' + (s.model !== 'slim' ? ' selected' : '') + '>Breite Arme</option><option value="slim"' + (s.model === 'slim' ? ' selected' : '') + '>Schmale Arme</option></select>' +
          '<button type="button" class="link-btn" data-act="save">Speichern</button><button type="button" class="link-btn danger-text" data-act="del">Löschen</button></li>';
      }).join('') + '</ul>' +
      (skins.length < 12 ? '<label class="btn ghost small upload">Skin hochladen …<input type="file" accept="image/png" multiple hidden></label>' : '<p class="muted">Maximal 12 Skins.</p>') +
      '<p class="msg" data-m="skins" hidden></p>' +
      '<h3>Lieblingsserver</h3><form class="gform" id="fSrv" novalidate><label>Serveradresse<input name="addr" value="' + esc(pr.mc_server || '') + '" placeholder="play.beispiel.de" autocomplete="off" spellcheck="false"></label>' +
      '<div class="srv-preview" hidden></div><p class="msg" hidden></p>' +
      '<div class="dlg-actions start"><button type="button" class="btn ghost" data-act="check">Vorschau prüfen</button><button class="btn" type="submit">Speichern</button></div></form>';
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
        say(mS, 'ok', f.addr.value.trim() ? 'Gespeichert. Die Vorschau erscheint im Reiter Minecraft.' : 'Server entfernt.');
      } catch (err) { say(mS, 'err', err.code === 'not_found' ? 'Server nicht gefunden. Stimmt die Adresse?' : errText(err)); }
    });
  }

  // ---------------------------------------------------------------- Steam: Lieblingsspiele
  function tabSteam(body) {
    var favs = (st.p.steam_favs || []).map(function (f) { return { appid: f.appid, name: f.name }; });
    var lib = ((st.p.cache && st.p.cache.steam && st.p.cache.steam.data && st.p.cache.steam.data.library) || []);
    var img = function (id) { return 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + id + '/capsule_184x69.jpg'; };
    body.innerHTML = '<p class="muted">Wähle bis zu 24 Lieblingsspiele und bring sie in deine Reihenfolge. ' + (lib.length ? 'Aus deiner Bibliothek (' + lib.length + ' Spiele) oder' : 'Verknüpfe Steam, dann stehen deine Spiele hier zur Auswahl; sonst') + ' über die Suche im Steam-Shop.</p>' +
      '<ol class="fav-list"></ol><div class="fav-add"><input type="search" placeholder="Spiel suchen" aria-label="Spiel suchen"><button type="button" class="btn ghost small" data-act="shop">Im Shop suchen</button></div>' +
      '<ul class="fav-results"></ul><p class="msg" hidden></p><div class="dlg-actions start"><button type="button" class="btn" data-act="save">Lieblingsspiele speichern</button></div>';
    var ol = $('.fav-list', body), res = $('.fav-results', body), inp = $('input', body), msg = $('.msg', body);
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
      paint(); fromLib();
    });
    res.addEventListener('click', function (e) {
      var b = e.target.closest('[data-add]'); if (!b) return;
      if (favs.length >= 24) { msg.className = 'msg err'; msg.textContent = 'Maximal 24 Lieblingsspiele.'; msg.hidden = false; return; }
      favs.push({ appid: +b.dataset.add, name: b.dataset.name }); paint(); b.disabled = true; b.textContent = 'Gewählt'; b.classList.add('ghost');
    });
    var t = 0; inp.addEventListener('input', function () { clearTimeout(t); t = setTimeout(fromLib, 120); });
    $('[data-act="shop"]', body).addEventListener('click', async function (e) {
      if (inp.value.trim().length < 2) { inp.focus(); return; }
      try { var r = await busy(e.target, function () { return Api.fn('gp-sync', { action: 'steam-search', q: inp.value }); }); results((r && r.items) || []); if (!r.items || !r.items.length) res.innerHTML = '<li class="muted">Nichts gefunden.</li>'; }
      catch (err) { msg.className = 'msg err'; msg.textContent = errText(err); msg.hidden = false; }
    });
    $('[data-act="save"]', body).addEventListener('click', async function (e) {
      try {
        await busy(e.target, async function () { await ensureProfile(); await Api.rpc('gp_set_steam_favs', { p_items: favs }); });
        st.p.steam_favs = favs.slice(); st.changed = true; msg.className = 'msg ok'; msg.textContent = 'Gespeichert.'; msg.hidden = false;
      } catch (err) { msg.className = 'msg err'; msg.textContent = errText(err); msg.hidden = false; }
    });
    paint(); fromLib();
  }

  // ---------------------------------------------------------------- Teilen per Link / QR-Code (wie bei Wunschlisten)
  function urlOf(t) { return location.origin + location.pathname + '?profil=' + t; }
  function qrSvg(url) { var q = window.qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
  async function share() {
    var me = Api.user.id, token = null, prevTab = st && st.tab, keep = st;
    try { var rows = await Api.get('gp_share_links', 'select=token'); token = rows[0] && rows[0].token; } catch (e) { return toast(errText(e)); }
    function paint() {
      var url = token && urlOf(token);
      dlg.innerHTML = '<div class="gdlg-head"><h2 id="gdlgTitle">Gaming-Profil teilen</h2><button type="button" class="link-btn" data-close aria-label="Schließen">✕</button></div><div class="gdlg-body">' +
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
        } else if (act === 'back') { dlg.onclick = null; open(keep.p, keep.onDone, prevTab); st.changed = keep.changed; }
      } catch (err) { toast(errText(err)); }
    };
    paint();
    if (!dlg.open) dlg.showModal();
    void me;
  }

  window.Editor = { open: open, share: share, errText: errText };
})();
