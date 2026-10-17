// Wird nur vom Datenbank-Trigger aufgerufen (geheimer Header), schickt neue Bewerbungen an Discord.
Deno.serve(async (req: Request) => {
  const url = Deno.env.get('SUPABASE_URL')!, key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const cfg = await fetch(`${url}/rest/v1/app_config?key=eq.webhook_secret&select=value`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    .then((r) => r.json()).catch(() => []);
  const secret = cfg?.[0]?.value;
  if (!secret || req.headers.get('x-webhook-secret') !== secret) return new Response('forbidden', { status: 403 });
  const hook = Deno.env.get('DISCORD_WEBHOOK_URL');
  if (!hook) return new Response('no webhook configured', { status: 200 });
  const b = await req.json().catch(() => null);
  if (!b) return new Response('bad request', { status: 400 });
  const clean = (v: unknown) => String(v ?? '').replace(/[`*_~|>@]/g, '\\$&').slice(0, 40);
  const r = await fetch(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [{
        title: 'Neue Whitelist-Bewerbung',
        color: 0xffcb05,
        fields: [
          { name: 'Minecraft', value: clean(b.minecraft_name), inline: true },
          { name: 'Discord', value: clean(b.discord_name), inline: true },
          { name: 'Bewerbungs-ID', value: String(Number(b.id) || '-'), inline: true },
        ],
      }],
    }),
  });
  return new Response(r.ok ? 'ok' : 'discord error', { status: r.ok ? 200 : 502 });
});
