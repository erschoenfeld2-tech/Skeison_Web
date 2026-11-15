-- 3D-Druck, Ergaenzung zu druck3d_server.sql: p3d_status meldet zusaetzlich 'host', eine Kurzkennung des Rechners,
-- auf dem der Worker laeuft (Hash des Computernamens, kein Klartext; kommt aus info.host des Lebenszeichens).
-- Der Worker erkennt damit beim Start und im Betrieb einen zweiten Rechner auch dann, wenn beide denselben SERVER_NAME
-- haben (z. B. ein auf HW_02 stehengebliebenes SERVER_NAME=HW_01 aus der Vorlage).
-- Abwaertskompatibel: nur ein zusaetzliches Feld. Ohne diese Datei laeuft alles wie bisher, nur die Rechner-Pruefung fehlt.
-- Zustand: NOCH NICHT angewendet (im Supabase-SQL-Editor ausfuehren, wenn der neue Worker laeuft).
create or replace function public.p3d_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'online', coalesce(w.last_seen > now() - interval '3 minutes', false),
    'demo', coalesce((w.info->>'demo')::boolean, false),
    'needs_code', w.access_code <> '',
    'limit_per_day', w.per_ip,
    'queue', (select count(*) from private.p3d_jobs j where j.state in ('queued','running')),
    'server', w.info->>'server',
    'host', w.info->>'host',
    'generator', w.info->>'generator')
  from private.p3d_worker w where w.id = 1;
$$;
