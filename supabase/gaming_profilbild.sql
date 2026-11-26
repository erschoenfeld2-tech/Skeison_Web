-- Eigenes Profilbild fuer den Skeison Account (Gaming-Profil; die Wunschliste zeigt weiter das Emoji)
-- Bild liegt im oeffentlichen Storage-Bucket "avatars" unter <user-id>/<datei>; jeder schreibt nur in seinen Ordner.
-- wl_profiles.avatar_url zeigt darauf (nur Links in diesen Bucket). Das Emoji (avatar) bleibt als Ersatz bestehen.
-- Abwaertskompatibel: neue Spalte, neuer Bucket; die gp_*-Funktionen liefern avatar_url zusaetzlich aus.

alter table public.wl_profiles add column avatar_url text
  check (avatar_url ~ '^https://pumdupjmmvimlxqvuymg\.supabase\.co/storage/v1/object/public/avatars/[0-9a-f-]{36}/[A-Za-z0-9._-]+$' and char_length(avatar_url) <= 300);
grant select (avatar_url), update (avatar_url) on public.wl_profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 524288, array['image/webp', 'image/jpeg', 'image/png'])
  on conflict (id) do nothing;
create policy "Profilbilder: eigener Ordner hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Profilbilder: eigener Ordner aendern" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Profilbilder: eigener Ordner loeschen" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Profilbilder: eigener Ordner lesen" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Gaming-Funktionen: neben dem Emoji auch das Bild ausliefern (nur dieses Feld ergaenzen, Rest unveraendert)
do $$
declare r record; d text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('gp_games', 'gp_known_list', 'gp_people', 'gp_preview', 'gp_showcase', 'gp_view', 'gp_visible_profiles')
  loop
    d := pg_get_functiondef(r.oid);
    if position('''avatar_url''' in d) = 0 then
      execute replace(d, '''avatar'', w.avatar,', '''avatar'', w.avatar, ''avatar_url'', w.avatar_url,');
    end if;
  end loop;
end $$;
