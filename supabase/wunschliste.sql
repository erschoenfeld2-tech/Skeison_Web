-- Wunschliste: Profile, Freunde, private Kennzeichnungen, Gruppen, Listen, Wuensche, Reservierungen.
-- Zustand der Supabase-Datenbank (Projekt "skeison-whitelist"); zur Dokumentation, bereits angewendet.
-- Passwoerter verwaltet Supabase Auth (nur als Hash in auth.users, nie im Repo).
-- Grundsatz: Jeder sieht nur sich selbst und bestaetigte Freunde. Freundschaften und Reservierungen
-- aendern sich nur ueber die Funktionen unten; der Listen-Besitzer sieht Reservierungen nie (Ueberraschung).

create schema if not exists private;
revoke all on schema private from anon, authenticated;

-- Profil mit Anzeigename und automatisch vergebenem Code (Name#CODE)
create table public.wl_profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 24),
  code text not null unique check (code ~ '^[A-Z0-9]{5}$'),
  avatar text not null default '🎁' check (char_length(avatar) between 1 and 16),
  color text not null default '#ffcb05' check (color ~ '^#[0-9a-fA-F]{6}$'),
  theme text not null default 'polarlicht' check (theme in ('polarlicht','geschenkpapier','pixel','kaufhaus','magazin')),
  bio text not null default '' check (char_length(bio) <= 160),
  birthday date,
  sizes text not null default '' check (char_length(sizes) <= 200),
  likes text not null default '' check (char_length(likes) <= 200),
  dislikes text not null default '' check (char_length(dislikes) <= 200),
  -- vom Admin gesetzt, wenn ein Einmal-Passwort vergeben wurde; nur die Edge Function wl-account setzt es zurueck
  must_change_password boolean not null default false,
  created_at timestamptz not null default now()
);

-- Admins (werden von Hand eingetragen, siehe README)
create table public.wl_admins (user_id uuid primary key references public.wl_profiles on delete cascade);
create function private.wl_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wl_admins where user_id = auth.uid());
$$;

create function private.wl_new_code() returns text language plpgsql volatile set search_path = '' as $$
declare
  abc constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..5 loop c := c || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from public.wl_profiles where code = c);
  end loop;
  return c;
end $$;

create function private.wl_on_signup() returns trigger language plpgsql security definer set search_path = '' as $$
declare n text := left(btrim(coalesce(new.raw_user_meta_data->>'name', '')), 24);
begin
  if char_length(n) < 2 then n := 'Wunschkind'; end if;
  insert into public.wl_profiles (id, name, code) values (new.id, n, private.wl_new_code());
  return new;
end $$;
create trigger wl_on_signup after insert on auth.users for each row execute function private.wl_on_signup();

-- Freundschaften: requester fragt an, addressee nimmt an
create table public.wl_friendships (
  requester uuid not null references public.wl_profiles on delete cascade,
  addressee uuid not null references public.wl_profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
create unique index wl_friendships_pair on public.wl_friendships (least(requester, addressee), greatest(requester, addressee));
create index wl_friendships_addressee on public.wl_friendships (addressee);

create function private.wl_are_friends(a uuid, b uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wl_friendships f where f.status = 'accepted'
    and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a)));
$$;

-- Private Kennzeichnung von Freunden (Verwandtschaft, Tags, Notiz); nur fuer den Besitzer sichtbar
create table public.wl_contacts (
  owner uuid not null default auth.uid() references public.wl_profiles on delete cascade,
  friend uuid not null references public.wl_profiles on delete cascade,
  relation text not null default '' check (char_length(relation) <= 40),
  tags text[] not null default '{}' check (cardinality(tags) <= 12),
  note text not null default '' check (char_length(note) <= 300),
  primary key (owner, friend)
);

-- Eigene Gruppen (nur fuer den Besitzer sichtbar; Mitglieder wissen nichts davon)
create table public.wl_groups (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.wl_profiles on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  emoji text not null default '👪' check (char_length(emoji) between 1 and 16),
  color text not null default '#5b85ff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);
create index wl_groups_owner on public.wl_groups (owner);
create table public.wl_group_members (
  group_id uuid not null references public.wl_groups on delete cascade,
  member uuid not null references public.wl_profiles on delete cascade,
  primary key (group_id, member)
);
create index wl_group_members_member on public.wl_group_members (member);

-- Listen mit eigenem Design und Sichtbarkeit: privat, alle Freunde oder ausgewaehlte Gruppen/Personen
create table public.wl_lists (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.wl_profiles on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 500),
  emoji text not null default '🎁' check (char_length(emoji) between 1 and 16),
  theme text not null default 'polarlicht' check (theme in ('polarlicht','geschenkpapier','pixel','kaufhaus','magazin')),
  occasion text not null default '' check (char_length(occasion) <= 40),
  event_date date,
  visibility text not null default 'private' check (visibility in ('private','friends','custom')),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index wl_lists_owner on public.wl_lists (owner);
create table public.wl_list_groups (
  list_id uuid not null references public.wl_lists on delete cascade,
  group_id uuid not null references public.wl_groups on delete cascade,
  primary key (list_id, group_id)
);
create index wl_list_groups_group on public.wl_list_groups (group_id);
create table public.wl_list_people (
  list_id uuid not null references public.wl_lists on delete cascade,
  person uuid not null references public.wl_profiles on delete cascade,
  primary key (list_id, person)
);
create index wl_list_people_person on public.wl_list_people (person);

create function private.wl_can_view(p_list uuid, p_uid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.wl_lists l
    where l.id = p_list and (
      l.owner = p_uid
      or (l.visibility <> 'private' and private.wl_are_friends(l.owner, p_uid) and (
        l.visibility = 'friends'
        or exists (select 1 from public.wl_list_people p where p.list_id = l.id and p.person = p_uid)
        or exists (select 1 from public.wl_list_groups g join public.wl_group_members m on m.group_id = g.group_id
                   where g.list_id = l.id and m.member = p_uid)))));
$$;
create function private.wl_owns_list(p_list uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wl_lists l where l.id = p_list and l.owner = auth.uid());
$$;
create function private.wl_owns_group(p_group uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wl_groups g where g.id = p_group and g.owner = auth.uid());
$$;

-- Wuensche: Produktlink, Vorschaubild, Einsatzzweck und Preis
create table public.wl_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.wl_lists on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  url text check (url ~ '^https?://' and char_length(url) <= 2000),
  image_url text check (image_url ~ '^https://' and char_length(image_url) <= 2000),
  price numeric(10,2) check (price >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  note text not null default '' check (char_length(note) <= 400),
  priority smallint not null default 2 check (priority between 1 and 3),
  quantity smallint not null default 1 check (quantity between 1 and 99),
  group_gift boolean not null default false,
  received boolean not null default false,
  created_at timestamptz not null default now()
);
create index wl_items_list on public.wl_items (list_id);

-- Reservierungen: nur ueber wl_reserve / wl_unreserve / wl_set_purchased
create table public.wl_reservations (
  item_id uuid not null references public.wl_items on delete cascade,
  user_id uuid not null references public.wl_profiles on delete cascade,
  quantity smallint not null default 1 check (quantity between 1 and 99),
  purchased boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
create index wl_reservations_user on public.wl_reservations (user_id);

-- Zugriffsrechte
alter table public.wl_profiles enable row level security;
alter table public.wl_friendships enable row level security;
alter table public.wl_contacts enable row level security;
alter table public.wl_groups enable row level security;
alter table public.wl_group_members enable row level security;
alter table public.wl_lists enable row level security;
alter table public.wl_list_groups enable row level security;
alter table public.wl_list_people enable row level security;
alter table public.wl_items enable row level security;
alter table public.wl_reservations enable row level security;
alter table public.wl_admins enable row level security;
revoke all on public.wl_profiles, public.wl_friendships, public.wl_contacts, public.wl_groups, public.wl_group_members,
  public.wl_lists, public.wl_list_groups, public.wl_list_people, public.wl_items, public.wl_reservations, public.wl_admins from anon, authenticated;

grant select on public.wl_profiles, public.wl_friendships, public.wl_reservations, public.wl_admins to authenticated;
grant update (name, avatar, color, theme, bio, birthday, sizes, likes, dislikes) on public.wl_profiles to authenticated;
grant select, insert, update, delete on public.wl_contacts, public.wl_groups, public.wl_group_members,
  public.wl_lists, public.wl_list_groups, public.wl_list_people, public.wl_items to authenticated;

create policy "Profil: sich selbst, Freunde und offene Anfragen" on public.wl_profiles for select to authenticated using (
  id = (select auth.uid()) or exists (select 1 from public.wl_friendships f
    where (f.requester = (select auth.uid()) and f.addressee = id) or (f.addressee = (select auth.uid()) and f.requester = id)));
create policy "Profil: nur eigenes bearbeiten" on public.wl_profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "Freundschaften: eigene" on public.wl_friendships for select to authenticated
  using ((select auth.uid()) in (requester, addressee));

create policy "Kennzeichnungen: nur eigene" on public.wl_contacts for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()) and private.wl_are_friends(owner, friend));

create policy "Gruppen: nur eigene" on public.wl_groups for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "Gruppenmitglieder: nur eigene Gruppen, nur Freunde" on public.wl_group_members for all to authenticated
  using (private.wl_owns_group(group_id)) with check (private.wl_owns_group(group_id) and private.wl_are_friends((select auth.uid()), member));

create policy "Listen: sichtbar laut Freigabe" on public.wl_lists for select to authenticated
  using (owner = (select auth.uid()) or private.wl_can_view(id, (select auth.uid())));
create policy "Listen: nur eigene anlegen" on public.wl_lists for insert to authenticated with check (owner = (select auth.uid()));
create policy "Listen: nur eigene aendern" on public.wl_lists for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "Listen: nur eigene loeschen" on public.wl_lists for delete to authenticated using (owner = (select auth.uid()));

create policy "Listenfreigabe Gruppen: nur Besitzer" on public.wl_list_groups for all to authenticated
  using (private.wl_owns_list(list_id)) with check (private.wl_owns_list(list_id) and private.wl_owns_group(group_id));
create policy "Listenfreigabe Personen: nur Besitzer" on public.wl_list_people for all to authenticated
  using (private.wl_owns_list(list_id)) with check (private.wl_owns_list(list_id) and private.wl_are_friends((select auth.uid()), person));

create policy "Wuensche: sichtbar mit der Liste" on public.wl_items for select to authenticated
  using (private.wl_can_view(list_id, (select auth.uid())));
create policy "Wuensche: nur Besitzer anlegen" on public.wl_items for insert to authenticated with check (private.wl_owns_list(list_id));
create policy "Wuensche: nur Besitzer aendern" on public.wl_items for update to authenticated
  using (private.wl_owns_list(list_id)) with check (private.wl_owns_list(list_id));
create policy "Wuensche: nur Besitzer loeschen" on public.wl_items for delete to authenticated using (private.wl_owns_list(list_id));

create policy "Reservierungen: nur eigene" on public.wl_reservations for select to authenticated using (user_id = (select auth.uid()));
create policy "Admins: nur der eigene Eintrag" on public.wl_admins for select to authenticated using (user_id = (select auth.uid()));

-- Freunde hinzufuegen ueber "Name#CODE"; nimmt eine Gegenanfrage automatisch an
create function public.wl_add_friend(p_handle text) returns text language plpgsql security definer set search_path = '' as $$
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

create function public.wl_accept_friend(p_other uuid) returns void language sql security definer set search_path = '' as $$
  update public.wl_friendships set status = 'accepted' where requester = p_other and addressee = auth.uid();
$$;

-- Ablehnen, zurueckziehen oder entfernen; raeumt Gruppen, Freigaben und Kennzeichnungen beider Seiten auf
create function public.wl_remove_friend(p_other uuid) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  delete from public.wl_friendships where (requester = me and addressee = p_other) or (requester = p_other and addressee = me);
  delete from public.wl_group_members m using public.wl_groups g where m.group_id = g.id
    and ((g.owner = me and m.member = p_other) or (g.owner = p_other and m.member = me));
  delete from public.wl_list_people p using public.wl_lists l where p.list_id = l.id
    and ((l.owner = me and p.person = p_other) or (l.owner = p_other and p.person = me));
  delete from public.wl_contacts where (owner = me and friend = p_other) or (owner = p_other and friend = me);
end $$;

-- Reservieren: Menge darf die gewuenschte Anzahl nicht ueberschreiten (ausser bei Gruppengeschenken)
create function public.wl_reserve(p_item uuid, p_qty int default 1) returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  it record; taken int;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select i.id, i.list_id, i.quantity, i.group_gift, i.received, l.owner into it
    from public.wl_items i join public.wl_lists l on l.id = i.list_id where i.id = p_item for update of i;
  if not found or not private.wl_can_view(it.list_id, me) then raise exception 'no_access'; end if;
  if it.owner = me then raise exception 'own_item'; end if;
  if it.received then raise exception 'received'; end if;
  if it.group_gift then p_qty := 1; end if;
  if p_qty < 1 or p_qty > it.quantity then raise exception 'bad_quantity'; end if;
  if not it.group_gift then
    select coalesce(sum(quantity), 0) into taken from public.wl_reservations where item_id = p_item and user_id <> me;
    if taken + p_qty > it.quantity then raise exception 'already_reserved'; end if;
  end if;
  insert into public.wl_reservations (item_id, user_id, quantity) values (p_item, me, p_qty)
    on conflict (item_id, user_id) do update set quantity = excluded.quantity;
end $$;

create function public.wl_unreserve(p_item uuid) returns void language sql security definer set search_path = '' as $$
  delete from public.wl_reservations where item_id = p_item and user_id = auth.uid();
$$;

create function public.wl_set_purchased(p_item uuid, p_purchased boolean) returns void language sql security definer set search_path = '' as $$
  update public.wl_reservations set purchased = p_purchased where item_id = p_item and user_id = auth.uid();
$$;

-- Reservierungen einer Liste fuer Schenkende (mit Namen); der Besitzer bekommt nichts zurueck
create function public.wl_list_reservations(p_list uuid)
returns table (item_id uuid, user_id uuid, name text, quantity smallint, purchased boolean, mine boolean)
language sql stable security definer set search_path = '' as $$
  select r.item_id, r.user_id, p.name, r.quantity, r.purchased, r.user_id = auth.uid()
  from public.wl_reservations r
  join public.wl_items i on i.id = r.item_id
  join public.wl_lists l on l.id = i.list_id
  join public.wl_profiles p on p.id = r.user_id
  where i.list_id = p_list and l.owner <> auth.uid() and private.wl_can_view(p_list, auth.uid());
$$;

-- Eigene Reservierungen als Geschenke-Einkaufsliste
create function public.wl_my_reservations()
returns table (item_id uuid, title text, url text, image_url text, price numeric, currency text, note text, quantity smallint,
  purchased boolean, group_gift boolean, received boolean, list_id uuid, list_title text, list_emoji text, event_date date,
  owner_id uuid, owner_name text, owner_avatar text, owner_color text)
language sql stable security definer set search_path = '' as $$
  select i.id, i.title, i.url, i.image_url, i.price, i.currency, i.note, r.quantity, r.purchased, i.group_gift, i.received,
    l.id, l.title, l.emoji, l.event_date, p.id, p.name, p.avatar, p.color
  from public.wl_reservations r
  join public.wl_items i on i.id = r.item_id
  join public.wl_lists l on l.id = i.list_id
  join public.wl_profiles p on p.id = l.owner
  where r.user_id = auth.uid()
  order by l.event_date nulls last, l.title, i.title;
$$;

-- Admin-Uebersicht aller Konten mit Kennzahlen
create function public.wl_admin_users()
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, name text, code text, avatar text, color text,
  must_change_password boolean, is_admin boolean, lists bigint, items bigint, reservations bigint, friends bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.wl_is_admin() then raise exception 'not_admin'; end if;
  return query
  select u.id, u.email::text, u.created_at, u.last_sign_in_at, p.name, p.code, p.avatar, p.color, p.must_change_password,
    exists (select 1 from public.wl_admins a where a.user_id = u.id),
    (select count(*) from public.wl_lists l where l.owner = u.id),
    (select count(*) from public.wl_items i join public.wl_lists l on l.id = i.list_id where l.owner = u.id),
    (select count(*) from public.wl_reservations r where r.user_id = u.id),
    (select count(*) from public.wl_friendships f where f.status = 'accepted' and u.id in (f.requester, f.addressee))
  from auth.users u join public.wl_profiles p on p.id = u.id
  order by u.created_at desc;
end $$;

revoke all on function public.wl_add_friend(text), public.wl_accept_friend(uuid), public.wl_remove_friend(uuid),
  public.wl_reserve(uuid, int), public.wl_unreserve(uuid), public.wl_set_purchased(uuid, boolean),
  public.wl_list_reservations(uuid), public.wl_my_reservations(), public.wl_admin_users() from public, anon;
grant execute on function public.wl_add_friend(text), public.wl_accept_friend(uuid), public.wl_remove_friend(uuid),
  public.wl_reserve(uuid, int), public.wl_unreserve(uuid), public.wl_set_purchased(uuid, boolean),
  public.wl_list_reservations(uuid), public.wl_my_reservations(), public.wl_admin_users() to authenticated;
revoke all on function private.wl_new_code(), private.wl_on_signup(), private.wl_is_admin(), private.wl_are_friends(uuid, uuid),
  private.wl_can_view(uuid, uuid), private.wl_owns_list(uuid), private.wl_owns_group(uuid) from public, anon;
-- Angemeldete brauchen das Schema nur fuer die Hilfsfunktionen in den Richtlinien, nicht fuer Tabellen
revoke all on all tables in schema private from anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.wl_are_friends(uuid, uuid), private.wl_can_view(uuid, uuid),
  private.wl_owns_list(uuid), private.wl_owns_group(uuid) to authenticated;
