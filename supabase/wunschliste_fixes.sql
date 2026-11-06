-- Wunschliste: Korrekturen zu Teilen, Stufen, Vorschlaegen und Profil (nach dem Review).
-- Zustand der Supabase-Datenbank (Projekt "skeison-whitelist"); zur Dokumentation.
-- Alle Aenderungen sind abwaertskompatibel: die bisherige Seite funktioniert damit unveraendert weiter.

-- 1) Wer eine bestaetigte Freundschaft beendet, sperrt die andere Person fuer seine Freigabe-Links.
--    Die Sperre faellt weg, sobald der Besitzer die Person selbst wieder hinzufuegt oder ihre Anfrage annimmt.
create table public.wl_unfriended (
  owner uuid not null references public.wl_profiles on delete cascade,
  person uuid not null references public.wl_profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner, person),
  check (owner <> person)
);
alter table public.wl_unfriended enable row level security;
revoke all on public.wl_unfriended from anon, authenticated;

-- Ablehnen, zurueckziehen oder entfernen; raeumt zusaetzlich offene Vorschlaege beider Seiten auf
-- (der Listen-Besitzer koennte den Absender sonst nicht mehr anzeigen) und merkt sich beendete Freundschaften
create or replace function public.wl_remove_friend(p_other uuid) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); was_friend boolean;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  was_friend := private.wl_are_friends(me, p_other);
  delete from public.wl_friendships where (requester = me and addressee = p_other) or (requester = p_other and addressee = me);
  delete from public.wl_group_members m using public.wl_groups g where m.group_id = g.id
    and ((g.owner = me and m.member = p_other) or (g.owner = p_other and m.member = me));
  delete from public.wl_list_people p using public.wl_lists l where p.list_id = l.id
    and ((l.owner = me and p.person = p_other) or (l.owner = p_other and p.person = me));
  delete from public.wl_contacts where (owner = me and friend = p_other) or (owner = p_other and friend = me);
  delete from public.wl_trust where (owner = me and person = p_other) or (owner = p_other and person = me);
  delete from public.wl_suggestions s using public.wl_lists l where s.list_id = l.id
    and ((l.owner = me and s.author = p_other) or (l.owner = p_other and s.author = me));
  if was_friend then
    insert into public.wl_unfriended (owner, person) values (me, p_other) on conflict do nothing;
  end if;
end $$;

-- Freunde hinzufuegen ueber "Name#CODE"; hebt eine eigene Link-Sperre fuer diese Person auf
create or replace function public.wl_add_friend(p_handle text) returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  h text := btrim(p_handle);
  n text; c text; other uuid; f public.wl_friendships;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if position('#' in h) = 0 then return 'invalid'; end if;
  n := btrim(regexp_replace(h, '#[^#]*$', '')); c := upper(btrim(substring(h from '#([^#]*)$')));
  select id into other from public.wl_profiles where code = c and lower(name) = lower(n);
  if other is null then return 'not_found'; end if;
  if other = me then return 'self'; end if;
  delete from public.wl_unfriended where owner = me and person = other;
  select * into f from public.wl_friendships
    where (requester = me and addressee = other) or (requester = other and addressee = me);
  if found then
    if f.status = 'accepted' then return 'already_friends'; end if;
    if f.requester = me then return 'already_requested'; end if;
    update public.wl_friendships set status = 'accepted' where requester = other and addressee = me;
    return 'accepted';
  end if;
  insert into public.wl_friendships (requester, addressee) values (me, other);
  return 'requested';
end $$;

create or replace function public.wl_accept_friend(p_other uuid) returns void language sql security definer set search_path = '' as $$
  delete from public.wl_unfriended where owner = auth.uid() and person = p_other;
  update public.wl_friendships set status = 'accepted' where requester = p_other and addressee = auth.uid();
$$;

-- 2) Link einloesen: Gesperrte (vom Besitzer entfernte) Personen kommen nicht wieder hinein.
--    Eine offene Anfrage des Besitzers wird eine echte Freundschaft (keine Herabstufung auf Bekannt);
--    hatte nur der Gast angefragt, ist er fuer den Besitzer zunaechst Bekannt, sieht den Besitzer selbst aber als Freund.
create or replace function public.wl_redeem(p_token text) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  l public.wl_lists; f public.wl_friendships;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select li.* into l from public.wl_share_links s join public.wl_lists li on li.id = s.list_id where s.token = p_token;
  if not found or l.visibility = 'private' or l.archived then raise exception 'no_access'; end if;
  if l.owner = me then return l.id; end if;
  select * into f from public.wl_friendships
    where (requester = me and addressee = l.owner) or (requester = l.owner and addressee = me);
  if (not found or f.status = 'pending')
     and exists (select 1 from public.wl_unfriended u where u.owner = l.owner and u.person = me) then
    raise exception 'no_access';
  end if;
  if f.requester is null then
    insert into public.wl_friendships (requester, addressee, status) values (l.owner, me, 'accepted');
    insert into public.wl_trust (owner, person, level) values (l.owner, me, 'known'), (me, l.owner, 'known')
      on conflict (owner, person) do update set level = 'known';
  elsif f.status = 'pending' then
    update public.wl_friendships set status = 'accepted' where requester = f.requester and addressee = f.addressee;
    if f.requester = me then
      insert into public.wl_trust (owner, person, level) values (l.owner, me, 'known')
        on conflict (owner, person) do update set level = 'known';
    end if;
  end if;
  insert into public.wl_list_people (list_id, person) values (l.id, me) on conflict do nothing;
  return l.id;
end $$;

-- 3) Gruppenfreigaben gelten nur bei "Ausgewaehlte"; liegengebliebene Eintraege anderer Listen entfernen
--    (Personen bleiben, damit per Link freigeschaltete Gaeste ihren Zugriff behalten)
delete from public.wl_list_groups g using public.wl_lists l where g.list_id = l.id and l.visibility <> 'custom';

-- 4) Profil in einem Schritt speichern (Profil, Persoenliches und Groessen gemeinsam oder gar nicht)
create function public.wl_save_profile(p_name text, p_avatar text, p_color text, p_theme text, p_bio text, p_birthday date,
  p_likes text, p_dislikes text, p_sizes jsonb)
returns public.wl_profiles language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); sz jsonb := coalesce(p_sizes, '[]'::jsonb); out public.wl_profiles;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(sz) <> 'array' or jsonb_array_length(sz) > 12 then raise exception 'too_many_sizes'; end if;
  update public.wl_profiles set name = btrim(p_name), avatar = p_avatar, color = p_color, theme = p_theme
    where id = me returning * into out;
  if not found then raise exception 'no_profile'; end if;
  insert into public.wl_profile_private (id, bio, birthday, likes, dislikes)
    values (me, coalesce(p_bio, ''), p_birthday, coalesce(p_likes, ''), coalesce(p_dislikes, ''))
    on conflict (id) do update set bio = excluded.bio, birthday = excluded.birthday, likes = excluded.likes, dislikes = excluded.dislikes;
  delete from public.wl_profile_sizes where profile = me;
  insert into public.wl_profile_sizes (profile, label, value, sort)
    select me, btrim(e->>'label'), btrim(e->>'value'), (o - 1)::smallint
    from jsonb_array_elements(sz) with ordinality as t(e, o);
  return out;
end $$;

revoke all on function public.wl_save_profile(text, text, text, text, text, date, text, text, jsonb) from public, anon;
grant execute on function public.wl_save_profile(text, text, text, text, text, date, text, text, jsonb) to authenticated;
