-- 3D-Druck (site/3d/, 3d-server/): Supabase als Briefkasten zwischen Webseite und Server-PC.
-- Die Seite legt Auftraege ueber p3d_create_job ab, der Server-PC holt sie mit dem service_role-Key ab
-- (p3d_claim), meldet den Fortschritt (p3d_update) und legt die fertigen Dateien in den privaten Bucket "p3d".
-- Die Seite liest nur ueber p3d_status/p3d_get_job; die Tabellen liegen im Schema private.
-- Der Server-PC ist von aussen nicht erreichbar, er baut nur Verbindungen nach aussen auf.

create table private.p3d_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ip_hash text not null default '',
  description text not null default '' check (char_length(description) <= 2000),
  size_mm real not null default 80 check (size_mm between 10 and 300),
  size_user boolean not null default false,
  flat_base boolean not null default true,
  image_count int not null default 0 check (image_count between 0 and 4),
  state text not null default 'queued' check (state in ('queued','running','done','error')),
  stage text not null default 'queued' check (stage in ('queued','analyse','generate','blender','upload','done')),
  progress int not null default 0 check (progress between 0 and 100),
  message text not null default 'In der Warteschlange' check (char_length(message) <= 300),
  name text not null default 'modell' check (name ~ '^[a-z0-9-]{1,40}$'),
  hint text not null default '' check (char_length(hint) <= 500),
  result jsonb,
  files jsonb   -- {"stl": "<signierte URL>", "3mf": "<signierte URL>"}
);
create index p3d_jobs_state on private.p3d_jobs (state, created_at);
create index p3d_jobs_ip on private.p3d_jobs (ip_hash, created_at);

-- Fotos (vom Browser verkleinert, Base64 ohne data:-Praefix); werden geloescht, sobald der Auftrag fertig ist
create table private.p3d_images (
  job_id uuid not null references private.p3d_jobs on delete cascade,
  n int not null check (n between 0 and 3),
  mime text not null check (mime in ('image/jpeg','image/png','image/webp')),
  data text not null check (char_length(data) <= 2800000),
  primary key (job_id, n)
);

-- Eine Zeile: Lebenszeichen und Einstellungen des Server-PCs (kommen aus seiner .env, siehe p3d_heartbeat)
create table private.p3d_worker (
  id int primary key default 1 check (id = 1),
  last_seen timestamptz,
  info jsonb not null default '{}',
  per_ip int not null default 10,
  per_day int not null default 40,
  access_code text not null default '',
  salt text not null default replace(gen_random_uuid()::text, '-', '')
);
insert into private.p3d_worker (id) values (1);

alter table private.p3d_jobs enable row level security;
alter table private.p3d_images enable row level security;
alter table private.p3d_worker enable row level security;
revoke all on private.p3d_jobs, private.p3d_images, private.p3d_worker from public, anon, authenticated;

-- Privater Bucket fuer die fertigen STL/3MF; Download nur ueber signierte URLs, die der Server-PC erzeugt
insert into storage.buckets (id, name, public, file_size_limit) values ('p3d', 'p3d', false, 52428800)
on conflict (id) do nothing;

/* ---------- Fuer die Webseite (anon) ---------- */

create function public.p3d_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'online', coalesce(w.last_seen > now() - interval '3 minutes', false),
    'demo', coalesce((w.info->>'demo')::boolean, false),
    'needs_code', w.access_code <> '',
    'limit_per_day', w.per_ip,
    'queue', (select count(*) from private.p3d_jobs j where j.state in ('queued','running')))
  from private.p3d_worker w where w.id = 1;
$$;

create function public.p3d_create_job(
  p_description text, p_size_mm real, p_size_user boolean, p_flat_base boolean,
  p_images jsonb default '[]', p_code text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  w private.p3d_worker;
  h jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}');
  ip text := coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', split_part(h->>'x-forwarded-for', ',', 1), '');
  ip_h text;
  jid uuid;
  img jsonb;
  n int := 0;
begin
  select * into w from private.p3d_worker where id = 1;
  if w.last_seen is null or w.last_seen < now() - interval '3 minutes' then
    raise exception 'Der 3D-Server ist gerade offline. Bitte später nochmal versuchen.';
  end if;
  if w.access_code <> '' and coalesce(p_code, '') <> w.access_code then
    raise exception 'Zugangscode fehlt oder ist falsch.';
  end if;
  p_description := btrim(coalesce(p_description, ''));
  p_images := coalesce(p_images, '[]');
  if jsonb_typeof(p_images) <> 'array' then raise exception 'Fotos fehlerhaft.'; end if;
  if p_description = '' and jsonb_array_length(p_images) = 0 then
    raise exception 'Bitte eine Beschreibung eingeben oder ein Foto hochladen.';
  end if;
  if jsonb_array_length(p_images) > 4 then raise exception 'Maximal 4 Fotos.'; end if;
  if char_length(p_description) > 2000 then raise exception 'Die Beschreibung ist zu lang (max. 2000 Zeichen).'; end if;

  -- Tageslimits (IP nur als Hash gespeichert)
  ip_h := encode(extensions.digest(w.salt || ip, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtext('p3d_create_job'));
  if (select count(*) from private.p3d_jobs where created_at > now() - interval '24 hours') >= w.per_day then
    raise exception 'Für heute sind alle Modelle vergeben. Bitte morgen nochmal versuchen.';
  end if;
  if (select count(*) from private.p3d_jobs where ip_hash = ip_h and created_at > now() - interval '24 hours') >= w.per_ip then
    raise exception 'Tageslimit erreicht (% Modelle pro Tag).', w.per_ip;
  end if;

  insert into private.p3d_jobs (ip_hash, description, size_mm, size_user, flat_base, image_count)
  values (ip_h, p_description, greatest(10, least(300, coalesce(p_size_mm, 80))), coalesce(p_size_user, false),
          coalesce(p_flat_base, true), jsonb_array_length(p_images))
  returning id into jid;
  for img in select * from jsonb_array_elements(p_images) loop
    insert into private.p3d_images (job_id, n, mime, data) values (jid, n, img->>'mime', img->>'data');
    n := n + 1;
  end loop;
  return jid;
end $$;

create function public.p3d_get_job(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', j.id, 'state', j.state, 'stage', j.stage, 'progress', j.progress, 'message', j.message,
    'name', j.name, 'hint', j.hint, 'result', j.result, 'files', j.files,
    'position', case when j.state = 'queued' then
      (select count(*) from private.p3d_jobs q where q.state in ('queued','running') and q.created_at < j.created_at) end)
  from private.p3d_jobs j where j.id = p_id;
$$;

/* ---------- Fuer den Server-PC (service_role) ---------- */

-- Lebenszeichen alle 60 s; uebernimmt dabei die Einstellungen aus der .env des Server-PCs
create function public.p3d_heartbeat(p_info jsonb, p_per_ip int, p_per_day int, p_code text) returns void
language sql security definer set search_path = '' as $$
  update private.p3d_worker set last_seen = now(), info = coalesce(p_info, '{}'),
    per_ip = greatest(0, p_per_ip), per_day = greatest(0, p_per_day), access_code = coalesce(p_code, '')
  where id = 1;
$$;

-- Naechsten Auftrag holen (samt Fotos) und auf running setzen
create function public.p3d_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j private.p3d_jobs;
begin
  select * into j from private.p3d_jobs where state = 'queued' order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  update private.p3d_jobs set state = 'running', message = 'Wird gestartet', updated_at = now() where id = j.id;
  return to_jsonb(j) - 'ip_hash' || jsonb_build_object('images',
    coalesce((select jsonb_agg(jsonb_build_object('mime', i.mime, 'data', i.data) order by i.n)
              from private.p3d_images i where i.job_id = j.id), '[]'));
end $$;

-- Fortschritt/Ergebnis melden; nur bekannte Felder. Fertige Auftraege verlieren ihre Fotos.
create function public.p3d_update(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update private.p3d_jobs set
    state = coalesce(p->>'state', state), stage = coalesce(p->>'stage', stage),
    progress = coalesce((p->>'progress')::int, progress), message = coalesce(left(p->>'message', 300), message),
    name = coalesce(p->>'name', name), hint = coalesce(left(p->>'hint', 500), hint),
    size_mm = coalesce((p->>'size_mm')::real, size_mm),
    result = coalesce(p->'result', result), files = coalesce(p->'files', files), updated_at = now()
  where id = p_id;
  if p->>'state' in ('done', 'error') then delete from private.p3d_images where job_id = p_id; end if;
end $$;

-- Nach einem Neustart des Server-PCs: haengengebliebene Auftraege als Fehler beenden (nicht neu starten, das kostet Meshy-Guthaben)
create function public.p3d_reset_running() returns int
language plpgsql security definer set search_path = '' as $$
declare c int;
begin
  update private.p3d_jobs set state = 'error', message = 'Der 3D-Server wurde neu gestartet. Bitte nochmal versuchen.', updated_at = now()
  where state = 'running';
  get diagnostics c = row_count;
  delete from private.p3d_images i using private.p3d_jobs j where i.job_id = j.id and j.state = 'error';
  return c;
end $$;

-- Alte Auftraege loeschen; gibt die IDs zurueck, damit der Server-PC die Dateien im Bucket entfernt
create function public.p3d_cleanup(p_hours real) returns setof uuid
language sql security definer set search_path = '' as $$
  delete from private.p3d_jobs where created_at < now() - make_interval(secs => p_hours * 3600) returning id;
$$;

revoke all on function public.p3d_status(), public.p3d_create_job(text, real, boolean, boolean, jsonb, text),
  public.p3d_get_job(uuid), public.p3d_heartbeat(jsonb, int, int, text), public.p3d_claim(),
  public.p3d_update(uuid, jsonb), public.p3d_reset_running(), public.p3d_cleanup(real) from public, anon, authenticated;
grant execute on function public.p3d_status(), public.p3d_create_job(text, real, boolean, boolean, jsonb, text),
  public.p3d_get_job(uuid) to anon, authenticated;
grant execute on function public.p3d_heartbeat(jsonb, int, int, text), public.p3d_claim(), public.p3d_update(uuid, jsonb),
  public.p3d_reset_running(), public.p3d_cleanup(real) to service_role;
