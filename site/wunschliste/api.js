// Schlanker Supabase-Client fuer die Wunschliste: Anmeldung (Supabase Auth), Datenbank (REST/RPC) und Edge Functions.
// Der Schluessel unten ist der oeffentliche Publishable Key; was jemand sehen oder aendern darf, regelt die Datenbank (RLS).
(function () {
  'use strict';
  var URL_ = 'https://pumdupjmmvimlxqvuymg.supabase.co', KEY = 'sb_publishable_VcunJmqIHajV3s2gfUMWSQ_MlIpmkas';
  var STORE = 'wl-session', session = null, refreshing = null, onChange = function () {};

  function read() { try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; } }
  function save(s) {
    session = s;
    try { if (s) localStorage.setItem(STORE, JSON.stringify(s)); else localStorage.removeItem(STORE); } catch (e) {}
  }
  function fail(code, status) { var e = new Error(code || 'failed'); e.code = code || 'failed'; e.status = status || 0; return e; }
  function errCode(d) { return (d && (d.error_code || d.message || d.msg || d.error_description || d.error)) || ''; }

  async function call(path, opts) {
    var r;
    try { r = await fetch(URL_ + path, opts); } catch (e) { throw fail('network'); }
    var txt = await r.text(), d = null;
    if (txt) { try { d = JSON.parse(txt); } catch (e) { d = txt; } }
    if (!r.ok) throw fail(errCode(d), r.status);
    return d;
  }
  function store(d) {
    save({ access: d.access_token, refresh: d.refresh_token, exp: Date.now() + (d.expires_in || 3600) * 1000, user: { id: d.user.id, email: d.user.email } });
  }
  function authPost(path, body) {
    return call('/auth/v1/' + path, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  // Gueltigen Zugangsschluessel liefern; laeuft er bald ab, vorher erneuern
  async function token() {
    if (!session) throw fail('not_authenticated', 401);
    if (Date.now() > session.exp - 60000) {
      if (!refreshing) {
        refreshing = authPost('token?grant_type=refresh_token', { refresh_token: session.refresh })
          .then(store, function (e) { if (e.status >= 400 && e.status < 500) { save(null); onChange(); } throw e; })
          .finally(function () { refreshing = null; });
      }
      await refreshing;
    }
    return session.access;
  }

  async function rest(path, opts) {
    opts = opts || {};
    var t = await token(), method = opts.method || 'GET';
    var headers = { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
    if (method !== 'GET') headers.Prefer = opts.prefer || 'return=representation';
    try {
      return await call('/rest/v1/' + path, { method: method, headers: headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    } catch (e) {
      if (e.status === 401) { save(null); onChange(); }
      throw e;
    }
  }

  var Api = window.Api = {
    get user() { return session && session.user; },
    onAuthChange: function (fn) { onChange = fn; },

    signIn: async function (email, password) { store(await authPost('token?grant_type=password', { email: email, password: password })); onChange(); },
    signUp: async function (data) {
      return call('/functions/v1/wl-signup', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    },
    signOut: async function () {
      var t = session && session.access;
      save(null); onChange();
      if (t) fetch(URL_ + '/auth/v1/logout', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + t } }).catch(function () {});
    },
    setPassword: async function (password) {
      var t = await token();
      return call('/auth/v1/user', { method: 'PUT', headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password }) });
    },

    get: function (table, query) { return rest(table + (query ? '?' + query : '')); },
    insert: function (table, rows) { return rest(table, { method: 'POST', body: rows }); },
    update: function (table, filter, patch) { return rest(table + '?' + filter, { method: 'PATCH', body: patch }); },
    upsert: function (table, rows) { return rest(table, { method: 'POST', body: rows, prefer: 'return=representation,resolution=merge-duplicates' }); },
    remove: function (table, filter) { return rest(table + '?' + filter, { method: 'DELETE', prefer: 'return=minimal' }); },
    rpc: function (fn, args) { return rest('rpc/' + fn, { method: 'POST', body: args || {} }); },
    fn: async function (name, body) {
      var t = await token();
      return call('/functions/v1/' + name, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
  };

  session = read();
  // Anmeldung in anderen Tabs uebernehmen
  window.addEventListener('storage', function (e) { if (e.key === STORE) { session = read(); onChange(); } });
})();
