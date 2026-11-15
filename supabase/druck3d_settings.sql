-- 3D-Druck, Ergaenzung zu druck3d.sql und druck3d_server.sql: Druckeinstellungen wie im Slicer (Duese, Schichthoehe,
-- Material, Druckbett, Passungsspiel, Ueberhang, Ausrichtung, Detailgrad ...). Die Seite schickt sie als p_settings,
-- der Worker prueft und begrenzt sie selbst (3d-server/print_settings.py). Hier nur Form und Groesse.
-- Abwaertskompatibel: p_settings hat einen Standardwert, die bisherige Seite ruft ohne ihn auf.
alter table private.p3d_jobs add column if not exists settings jsonb not null default '{}'
  check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 2048);

drop function if exists public.p3d_create_job(text, real, boolean, boolean, jsonb, text);
create function public.p3d_create_job(
  p_description text, p_size_mm real, p_size_user boolean, p_flat_base boolean,
  p_images jsonb default '[]', p_code text default '', p_settings jsonb default '{}') returns uuid
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
  p_settings := coalesce(p_settings, '{}');
  if jsonb_typeof(p_images) <> 'array' then raise exception 'Fotos fehlerhaft.'; end if;
  if jsonb_typeof(p_settings) <> 'object' or pg_column_size(p_settings) > 2048 then
    raise exception 'Druckeinstellungen fehlerhaft.';
  end if;
  if p_description = '' and jsonb_array_length(p_images) = 0 then
    raise exception 'Bitte eine Beschreibung eingeben oder ein Foto hochladen.';
  end if;
  if jsonb_array_length(p_images) > 4 then raise exception 'Maximal 4 Fotos.'; end if;
  if char_length(p_description) > 2000 then raise exception 'Die Beschreibung ist zu lang (max. 2000 Zeichen).'; end if;

  ip_h := encode(extensions.digest(w.salt || ip, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtext('p3d_create_job'));
  if (select count(*) from private.p3d_jobs where created_at > now() - interval '24 hours') >= w.per_day then
    raise exception 'Für heute sind alle Modelle vergeben. Bitte morgen nochmal versuchen.';
  end if;
  if (select count(*) from private.p3d_jobs where ip_hash = ip_h and created_at > now() - interval '24 hours') >= w.per_ip then
    raise exception 'Tageslimit erreicht (% Modelle pro Tag).', w.per_ip;
  end if;

  insert into private.p3d_jobs (ip_hash, description, size_mm, size_user, flat_base, image_count, settings)
  values (ip_h, p_description, greatest(10, least(300, coalesce(p_size_mm, 80))), coalesce(p_size_user, false),
          coalesce(p_flat_base, true), jsonb_array_length(p_images), p_settings)
  returning id into jid;
  for img in select * from jsonb_array_elements(p_images) loop
    insert into private.p3d_images (job_id, n, mime, data) values (jid, n, img->>'mime', img->>'data');
    n := n + 1;
  end loop;
  return jid;
end $$;

revoke all on function public.p3d_create_job(text, real, boolean, boolean, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.p3d_create_job(text, real, boolean, boolean, jsonb, text, jsonb) to anon, authenticated;
