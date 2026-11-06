// Registrierung fuer die Wunschliste: legt das Konto direkt bestaetigt an (keine Bestaetigungs-Mail noetig).
// Optional schuetzt das Secret WL_INVITE_CODE die Registrierung mit einem Einladungscode.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Grobe Bremse gegen Massen-Registrierungen (pro Instanz und IP). Die IP stammt aus einem Header, den ein
// Angreifer beeinflussen kann; deshalb gibt es zusaetzlich eine feste Obergrenze pro Stunde in der Datenbank (siehe unten).
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now(), recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  recent.push(now); hits.set(ip, recent);
  // Alte Eintraege aufraeumen, damit die Liste nicht endlos waechst
  if (hits.size > 2000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 3600_000) hits.delete(k);
  return recent.length > 5;
}
const CAP = Number(Deno.env.get('WL_SIGNUP_CAP') ?? 20); // Konten pro Stunde insgesamt

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const b = await req.json().catch(() => null);
  if (!b) return json({ error: 'bad_request' }, 400);
  const email = String(b.email ?? '').trim().toLowerCase(), password = String(b.password ?? ''), name = String(b.name ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return json({ error: 'email' }, 400);
  if (password.length < 8 || password.length > 72) return json({ error: 'password' }, 400);
  if (name.length < 2 || name.length > 24 || name.includes('#')) return json({ error: 'name' }, 400);
  const invite = Deno.env.get('WL_INVITE_CODE');
  if (invite && String(b.invite ?? '').trim() !== invite) return json({ error: 'invite' }, 403);
  if (limited(req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '?')) return json({ error: 'rate' }, 429);

  const url = Deno.env.get('SUPABASE_URL')!, key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  // Feste Obergrenze (nicht ueber Header zu umgehen); faellt die Abfrage aus, entscheidet nur die IP-Bremse
  const recent = await fetch(`${url}/rest/v1/rpc/wl_recent_signups`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}',
  }).then((r) => (r.ok ? r.json() : 0)).catch(() => 0);
  if (typeof recent === 'number' && recent >= CAP) return json({ error: 'rate' }, 429);
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } }),
  });
  if (r.ok) return json({ ok: true });
  const err = await r.json().catch(() => ({}));
  const msg = String(err.msg ?? err.message ?? err.error_code ?? '');
  if (r.status === 422 && /already|exists|registered/i.test(msg)) return json({ error: 'exists' }, 409);
  if (/password/i.test(msg)) return json({ error: 'weak_password' }, 400);
  return json({ error: 'failed' }, 502);
});
