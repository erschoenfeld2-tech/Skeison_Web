-- 3D-Druck, Ergaenzung zu druck3d.sql: p3d_status meldet zusaetzlich, welcher Server-PC zuletzt aktiv war
-- (info.server, z. B. HW_01/HW_02) und welcher Weg die Modelle erzeugt (info.generator: claude oder meshy).
-- Der Worker prueft damit beim Start, ob noch ein anderer Server-PC laeuft (Umzug HW_01 -> HW_02).
-- Abwaertskompatibel: nur zusaetzliche Felder.
create or replace function public.p3d_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'online', coalesce(w.last_seen > now() - interval '3 minutes', false),
    'demo', coalesce((w.info->>'demo')::boolean, false),
    'needs_code', w.access_code <> '',
    'limit_per_day', w.per_ip,
    'queue', (select count(*) from private.p3d_jobs j where j.state in ('queued','running')),
    'server', w.info->>'server',
    'generator', w.info->>'generator')
  from private.p3d_worker w where w.id = 1;
$$;
