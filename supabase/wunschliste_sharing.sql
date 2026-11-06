-- Wunschliste: Teilen per Link / QR-Code, Stufen "Bekannt" und "Freund", Vorschau ohne Anmeldung.
-- Zustand der Supabase-Datenbank (Projekt "skeison-whitelist"); zur Dokumentation, bereits angewendet.
-- Ablauf: Der Besitzer erzeugt fuer eine Liste einen Freigabe-Link. Wer ihn oeffnet, sieht ohne Anmeldung nur eine
-- Vorschau (wl_preview). Nach der Anmeldung loest wl_redeem eine Bekanntschaft aus: Beide sind "Bekannte" (bestaetigte
-- Verbindung mit Stufe known) und der Gast darf genau diese Liste sehen und reservieren. Die Stufe "friend" ist ein
-- Status pro Richtung (wl_trust): Wer "Alle Freunde" sieht, entscheidet jeder Listen-Besitzer selbst. Spaeter lassen sich
-- an die Stufen weitere Rechte haengen.

create table public.wl_trust (
  owner uuid not null references public.wl_profiles on delete cascade,
  person uuid not null references public.wl_profiles on delete cascade,
  level text not null default 'friend' check (level in ('known','friend')),
  primary key (owner, person),
  check (owner <> person)
);
-- Ohne Eintrag gilt "friend" (so verhalten sich alle bisherigen Freundschaften unveraendert)

create table public.wl_share_links (
  list_id uuid primary key references public.wl_lists on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

alter table public.wl_trust enable row level security;
alter table public.wl_share_links enable row level security;
revoke all on public.wl_trust, public.wl_share_links from anon, authenticated;
grant select on public.wl_trust, public.wl_share_links to authenticated;
create policy "Stufen: nur eigene" on public.wl_trust for select to authenticated using (owner = (select auth.uid()));
create policy "Freigabe-Links: nur Besitzer" on public.wl_share_links for select to authenticated using (private.wl_owns_list(list_id));

-- "Alle Freunde" gilt nur fuer die Stufe friend; Einzel- und Gruppenfreigaben gelten fuer jede bestaetigte Verbindung
create or replace function private.wl_can_view(p_list uuid, p_uid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.wl_lists l
    where l.id = p_list and (
      l.owner = p_uid
      or (l.visibility <> 'private' and private.wl_are_friends(l.owner, p_uid) and (
        (l.visibility = 'friends' and coalesce((select t.level from public.wl_trust t where t.owner = l.owner and t.person = p_uid), 'friend') = 'friend')
        or exists (select 1 from public.wl_list_people p where p.list_id = l.id and p.person = p_uid)
        or exists (select 1 from public.wl_list_groups g join public.wl_group_members m on m.group_id = g.group_id
                   where g.list_id = l.id and m.member = p_uid)))));
$$;

-- Link anlegen (oder den bestehenden zurueckgeben); eine private Liste wird dabei auf "Ausgewaehlte" gestellt
create function public.wl_share_enable(p_list uuid) returns text language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  if not private.wl_owns_list(p_list) then raise exception 'no_access'; end if;
  insert into public.wl_share_links (list_id) values (p_list) on conflict (list_id) do nothing;
  update public.wl_lists set visibility = 'custom' where id = p_list and visibility = 'private';
  select token into t from public.wl_share_links where list_id = p_list;
  return t;
end $$;

create function public.wl_share_disable(p_list uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.wl_owns_list(p_list) then raise exception 'no_access'; end if;
  delete from public.wl_share_links where list_id = p_list;
end $$;

-- Vorschau ohne Anmeldung: nur Liste, Besitzer-Anzeige und Wuensche; keine Reservierungen, kein Code, keine Profildaten
create function public.wl_preview(p_token text) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'list', jsonb_build_object('title', l.title, 'description', l.description, 'emoji', l.emoji, 'theme', l.theme,
      'occasion', l.occasion, 'event_date', l.event_date),
    'owner', jsonb_build_object('name', p.name, 'avatar', p.avatar, 'color', p.color),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'url', i.url, 'image_url', i.image_url,
        'price', i.price, 'currency', i.currency, 'note', i.note, 'priority', i.priority, 'quantity', i.quantity,
        'group_gift', i.group_gift, 'received', i.received) order by i.priority desc, i.created_at) from public.wl_items i where i.list_id = l.id), '[]'::jsonb))
  from public.wl_share_links s
  join public.wl_lists l on l.id = s.list_id
  join public.wl_profiles p on p.id = l.owner
  where s.token = p_token and l.visibility <> 'private' and not l.archived;
$$;

-- Link einloesen (angemeldet): Bekanntschaft herstellen und die Liste freigeben; liefert die Listen-ID
create function public.wl_redeem(p_token text) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  l public.wl_lists; f public.wl_friendships; fresh boolean := false;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select li.* into l from public.wl_share_links s join public.wl_lists li on li.id = s.list_id where s.token = p_token;
  if not found or l.visibility = 'private' or l.archived then raise exception 'no_access'; end if;
  if l.owner = me then return l.id; end if;
  select * into f from public.wl_friendships
    where (requester = me and addressee = l.owner) or (requester = l.owner and addressee = me);
  if not found then
    insert into public.wl_friendships (requester, addressee, status) values (l.owner, me, 'accepted'); fresh := true;
  elsif f.status = 'pending' then
    update public.wl_friendships set status = 'accepted' where requester = f.requester and addressee = f.addressee; fresh := true;
  end if;
  if fresh then
    insert into public.wl_trust (owner, person, level) values (l.owner, me, 'known'), (me, l.owner, 'known')
      on conflict (owner, person) do update set level = 'known';
  end if;
  insert into public.wl_list_people (list_id, person) values (l.id, me) on conflict do nothing;
  return l.id;
end $$;

-- Stufe, die ich einer verbundenen Person gebe (Bekannt <-> Freund); wirkt nur auf meine eigenen Listen
create function public.wl_set_level(p_other uuid, p_level text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_level not in ('known','friend') then raise exception 'bad_level'; end if;
  if not private.wl_are_friends(auth.uid(), p_other) then raise exception 'no_access'; end if;
  insert into public.wl_trust (owner, person, level) values (auth.uid(), p_other, p_level)
    on conflict (owner, person) do update set level = excluded.level;
end $$;

create or replace function public.wl_remove_friend(p_other uuid) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  delete from public.wl_friendships where (requester = me and addressee = p_other) or (requester = p_other and addressee = me);
  delete from public.wl_group_members m using public.wl_groups g where m.group_id = g.id
    and ((g.owner = me and m.member = p_other) or (g.owner = p_other and m.member = me));
  delete from public.wl_list_people p using public.wl_lists l where p.list_id = l.id
    and ((l.owner = me and p.person = p_other) or (l.owner = p_other and p.person = me));
  delete from public.wl_contacts where (owner = me and friend = p_other) or (owner = p_other and friend = me);
  delete from public.wl_trust where (owner = me and person = p_other) or (owner = p_other and person = me);
end $$;

revoke all on function public.wl_share_enable(uuid), public.wl_share_disable(uuid), public.wl_preview(text),
  public.wl_redeem(text), public.wl_set_level(uuid, text) from public, anon;
grant execute on function public.wl_share_enable(uuid), public.wl_share_disable(uuid), public.wl_redeem(text), public.wl_set_level(uuid, text) to authenticated;
grant execute on function public.wl_preview(text) to anon, authenticated;
