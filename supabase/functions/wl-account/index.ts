// Passwoerter der Wunschliste: eigenes Passwort aendern (hebt den Zwang zum Aendern auf),
// fuer Admins ausserdem Einmal-/Standardpasswort vergeben und Konten loeschen.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!, SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE;
const admin = (path: string, init: RequestInit = {}) => fetch(URL_ + path, {
  ...init,
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
});

// Gut lesbares Einmal-Passwort (ohne 0/O, 1/l/I)
function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}
async function setPassword(id: string, password: string, mustChange: boolean) {
  const r = await admin(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ password }) });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    return /password/i.test(String(e.msg ?? e.message ?? e.error_code ?? '')) ? 'weak_password' : 'failed';
  }
  const p = await admin(`/rest/v1/wl_profiles?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ must_change_password: mustChange }) });
  return p.ok ? null : 'failed';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const who = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: req.headers.get('authorization') ?? '' } }).catch(() => null);
  if (!who?.ok) return json({ error: 'unauthorized' }, 401);
  const me = (await who.json()).id as string;
  const b = await req.json().catch(() => ({}));
  const isId = (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
  const valid = (p: unknown) => typeof p === 'string' && p.length >= 8 && p.length <= 72;

  if (b.action === 'set-password') {
    if (!valid(b.password)) return json({ error: 'password' }, 400);
    const err = await setPassword(me, b.password, false);
    return err ? json({ error: err }, 400) : json({ ok: true });
  }

  const adm = await admin(`/rest/v1/wl_admins?user_id=eq.${me}&select=user_id`).then((r) => r.json()).catch(() => []);
  if (!Array.isArray(adm) || !adm.length) return json({ error: 'not_admin' }, 403);
  if (!isId(b.user_id)) return json({ error: 'bad_request' }, 400);

  if (b.action === 'admin-reset') {
    if (b.password != null && !valid(b.password)) return json({ error: 'password' }, 400);
    const password = b.password ?? tempPassword();
    const err = await setPassword(b.user_id, password, true);
    return err ? json({ error: err }, 400) : json({ ok: true, password });
  }
  if (b.action === 'admin-delete') {
    if (b.user_id === me) return json({ error: 'self' }, 400);
    const other = await admin(`/rest/v1/wl_admins?user_id=eq.${b.user_id}&select=user_id`).then((r) => r.json()).catch(() => []);
    if (Array.isArray(other) && other.length) return json({ error: 'is_admin' }, 400);
    const r = await admin(`/auth/v1/admin/users/${b.user_id}`, { method: 'DELETE' });
    return r.ok ? json({ ok: true }) : json({ error: 'failed' }, 502);
  }
  return json({ error: 'bad_request' }, 400);
});
