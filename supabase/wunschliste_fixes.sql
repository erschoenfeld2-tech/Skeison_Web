-- Wunschliste: Korrekturen zu Teilen, Stufen, Vorschlaegen und Profil (nach dem Review).
-- Zustand der Supabase-Datenbank (Projekt "skeison-whitelist"); zur Dokumentation, bereits angewendet.
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
  -- Offene (noch nicht gekaufte) Reservierungen beider Seiten freigeben, damit andere den Wunsch wieder reservieren koennen.
  -- Schon Gekauftes bleibt: das Geschenk gibt es ja bereits.
  delete from public.wl_reservations r using public.wl_items i, public.wl_lists l where r.item_id = i.id and i.list_id = l.id
    and not r.purchased and ((l.owner = me and r.user_id = p_other) or (l.owner = p_other and r.user_id = me));
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
-- "discoverable": Freunde meiner Freunde duerfen mich auf deren Profil sehen und mir eine Anfrage schicken
alter table public.wl_profiles add column discoverable boolean not null default true;

create function public.wl_save_profile(p_name text, p_avatar text, p_color text, p_theme text, p_bio text, p_birthday date,
  p_likes text, p_dislikes text, p_sizes jsonb, p_discoverable boolean default true)
returns public.wl_profiles language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); sz jsonb := coalesce(p_sizes, '[]'::jsonb); out public.wl_profiles;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(sz) <> 'array' or jsonb_array_length(sz) > 12 then raise exception 'too_many_sizes'; end if;
  if position('#' in coalesce(p_name, '')) > 0 then raise exception 'name'; end if;
  update public.wl_profiles set name = btrim(p_name), avatar = p_avatar, color = p_color, theme = p_theme,
    discoverable = coalesce(p_discoverable, true)
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

revoke all on function public.wl_save_profile(text, text, text, text, text, date, text, text, jsonb, boolean) from public, anon;
grant execute on function public.wl_save_profile(text, text, text, text, text, date, text, text, jsonb, boolean) to authenticated;

-- 5) Freigaben und Gruppenmitglieder in einem Schritt setzen (vorher: erst alles loeschen, dann neu einfuegen,
--    bei einem Fehler dazwischen waren alle Freigaben weg). Ungueltige Eintraege werden still uebersprungen.
--    p_people = null laesst die einzeln Freigeschalteten unveraendert (z. B. Gaeste per Link bei "Alle Freunde").
create function public.wl_set_list_shares(p_list uuid, p_groups uuid[], p_people uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if not private.wl_owns_list(p_list) then raise exception 'no_access'; end if;
  delete from public.wl_list_groups where list_id = p_list;
  insert into public.wl_list_groups (list_id, group_id)
    select p_list, g.id from public.wl_groups g where g.owner = me and g.id = any(coalesce(p_groups, '{}'));
  if p_people is not null then
    delete from public.wl_list_people where list_id = p_list;
    insert into public.wl_list_people (list_id, person)
      select p_list, x from unnest(p_people) as x where private.wl_are_friends(me, x) on conflict do nothing;
  end if;
end $$;

create function public.wl_set_group_members(p_group uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if not private.wl_owns_group(p_group) then raise exception 'no_access'; end if;
  delete from public.wl_group_members where group_id = p_group;
  insert into public.wl_group_members (group_id, member)
    select p_group, x from unnest(coalesce(p_members, '{}')) as x where private.wl_are_friends(me, x) on conflict do nothing;
end $$;

revoke all on function public.wl_set_list_shares(uuid, uuid[], uuid[]), public.wl_set_group_members(uuid, uuid[]) from public, anon;
grant execute on function public.wl_set_list_shares(uuid, uuid[], uuid[]), public.wl_set_group_members(uuid, uuid[]) to authenticated;

-- 6) Obergrenze fuer Registrierungen pro Stunde (nur fuer die Edge Function wl-signup mit Service-Schluessel);
--    anders als die IP-Bremse laesst sie sich nicht ueber gefaelschte Header umgehen
create function public.wl_recent_signups() returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from auth.users where created_at > now() - interval '1 hour';
$$;
revoke all on function public.wl_recent_signups() from public, anon, authenticated;
grant execute on function public.wl_recent_signups() to service_role;

-- 7) Wird ein Wunsch geloescht (auch mit der ganzen Liste), den jemand schon gekauft hat, bekommt der Schenkende
--    einen Hinweis in "Meine Geschenke" statt dass das Geschenk spurlos verschwindet. Der Besitzer erfaehrt nichts.
create table public.wl_orphan_gifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.wl_profiles on delete cascade,
  title text not null,
  list_title text not null default '',
  owner_name text not null default '',
  price numeric(10,2),
  currency text not null default 'EUR',
  quantity smallint not null default 1,
  deleted_at timestamptz not null default now()
);
create index wl_orphan_gifts_user on public.wl_orphan_gifts (user_id);
alter table public.wl_orphan_gifts enable row level security;
revoke all on public.wl_orphan_gifts from anon, authenticated;
grant select, delete on public.wl_orphan_gifts to authenticated;
create policy "Geloeschte Geschenke: nur eigene" on public.wl_orphan_gifts for select to authenticated using (user_id = (select auth.uid()));
create policy "Geloeschte Geschenke: nur eigene entfernen" on public.wl_orphan_gifts for delete to authenticated using (user_id = (select auth.uid()));

create function private.wl_on_item_delete() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.received then return old; end if;
  insert into public.wl_orphan_gifts (user_id, title, list_title, owner_name, price, currency, quantity)
    select r.user_id, old.title, coalesce(l.title, ''), coalesce(p.name, ''), old.price, old.currency, r.quantity
    from public.wl_reservations r
    left join public.wl_lists l on l.id = old.list_id
    left join public.wl_profiles p on p.id = l.owner
    where r.item_id = old.id and r.purchased;
  return old;
end $$;
create trigger wl_on_item_delete before delete on public.wl_items for each row execute function private.wl_on_item_delete();

-- 8) Codes bleiben privat; die eigene Nummer gibt es ueber diese Funktion (siehe wunschliste_hide_codes.sql)
create function public.wl_my_code() returns text language sql stable security definer set search_path = '' as $$
  select code from public.wl_profiles where id = auth.uid();
$$;

-- 9) Freunde von Freunden: Auf dem Profil eines Freundes (Stufe Freund) sieht man dessen Freunde, die das erlauben
--    (discoverable), ohne Code, und kann ihnen direkt eine Anfrage schicken
create function public.wl_friends_of(p_via uuid)
returns table (id uuid, name text, avatar text, color text, status text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_via = me or not private.wl_is_friend_level(p_via, me) then raise exception 'no_access'; end if;
  return query
  select p.id, p.name, p.avatar, p.color,
    case when f.status = 'accepted' then 'friends' when f.requester = me then 'requested' when f.requester is not null then 'incoming' else 'none' end
  from public.wl_friendships v
  join public.wl_profiles p on p.id = case when v.requester = p_via then v.addressee else v.requester end
  left join public.wl_friendships f on (f.requester = me and f.addressee = p.id) or (f.requester = p.id and f.addressee = me)
  where v.status = 'accepted' and p_via in (v.requester, v.addressee) and p.id <> me and p.discoverable
    and private.wl_is_friend_level(p_via, p.id)
    and not exists (select 1 from public.wl_unfriended u where u.owner = p.id and u.person = me)
  order by p.name;
end $$;

create function public.wl_request_via(p_via uuid, p_other uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); f public.wl_friendships;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_other = me then return 'self'; end if;
  if p_via = me or not private.wl_is_friend_level(p_via, me) or not private.wl_is_friend_level(p_via, p_other)
     or not exists (select 1 from public.wl_profiles where id = p_other and discoverable)
     or exists (select 1 from public.wl_unfriended u where u.owner = p_other and u.person = me) then
    raise exception 'no_access';
  end if;
  delete from public.wl_unfriended where owner = me and person = p_other;
  select * into f from public.wl_friendships
    where (requester = me and addressee = p_other) or (requester = p_other and addressee = me);
  if found then
    if f.status = 'accepted' then return 'already_friends'; end if;
    if f.requester = me then return 'already_requested'; end if;
    update public.wl_friendships set status = 'accepted' where requester = p_other and addressee = me;
    return 'accepted';
  end if;
  insert into public.wl_friendships (requester, addressee) values (me, p_other);
  return 'requested';
end $$;

revoke all on function public.wl_my_code(), public.wl_friends_of(uuid), public.wl_request_via(uuid, uuid) from public, anon;
grant execute on function public.wl_my_code(), public.wl_friends_of(uuid), public.wl_request_via(uuid, uuid) to authenticated;
