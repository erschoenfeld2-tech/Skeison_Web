-- Wunschliste: Profil nach Stufen trennen (Groessen fuer Bekannte, Persoenliches nur fuer Freunde),
-- Vorschlaege von Freunden fuer fremde Listen, Kategorien fuer Wuensche.
-- Zustand der Supabase-Datenbank (Projekt "skeison-whitelist"); zur Dokumentation, bereits angewendet.

-- Stufe "Freund" aus Sicht des Profil-Besitzers (ohne Eintrag in wl_trust gilt friend)
create function private.wl_is_friend_level(p_owner uuid, p_viewer uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.wl_are_friends(p_owner, p_viewer)
    and coalesce((select t.level from public.wl_trust t where t.owner = p_owner and t.person = p_viewer), 'friend') = 'friend';
$$;

-- Persoenliches: nur fuer den Besitzer und seine Freunde (nicht fuer Bekannte)
create table public.wl_profile_private (
  id uuid primary key references public.wl_profiles on delete cascade,
  bio text not null default '' check (char_length(bio) <= 160),
  birthday date,
  likes text not null default '' check (char_length(likes) <= 200),
  dislikes text not null default '' check (char_length(dislikes) <= 200)
);
insert into public.wl_profile_private (id, bio, birthday, likes, dislikes) select id, bio, birthday, likes, dislikes from public.wl_profiles;

-- Groessen als eigene Felder (z. B. "Schuhe" = "43"): fuer jede bestaetigte Verbindung sichtbar, auch Bekannte
create table public.wl_profile_sizes (
  id uuid primary key default gen_random_uuid(),
  profile uuid not null default auth.uid() references public.wl_profiles on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 24),
  value text not null check (char_length(btrim(value)) between 1 and 40),
  sort smallint not null default 0,
  created_at timestamptz not null default now()
);
create index wl_profile_sizes_profile on public.wl_profile_sizes (profile);
insert into public.wl_profile_sizes (profile, label, value, sort)
  select id, case when position(' ' in btrim(part)) > 0 then left(split_part(btrim(part), ' ', 1), 24) else 'Größe' end,
         left(case when position(' ' in btrim(part)) > 0 then btrim(substr(btrim(part), position(' ' in btrim(part)) + 1)) else btrim(part) end, 40), n
  from (select p.id, s.part, (row_number() over (partition by p.id))::smallint as n
        from public.wl_profiles p, regexp_split_to_table(p.sizes, ',') as s(part) where btrim(p.sizes) <> '') x
  where btrim(part) <> '' and n <= 12;

alter table public.wl_profiles drop column bio, drop column birthday, drop column sizes, drop column likes, drop column dislikes;

alter table public.wl_profile_private enable row level security;
alter table public.wl_profile_sizes enable row level security;
revoke all on public.wl_profile_private, public.wl_profile_sizes from anon, authenticated;
grant select, insert, update on public.wl_profile_private to authenticated;
grant select, insert, update, delete on public.wl_profile_sizes to authenticated;
create policy "Persoenliches: ich und meine Freunde" on public.wl_profile_private for select to authenticated
  using (id = (select auth.uid()) or private.wl_is_friend_level(id, (select auth.uid())));
create policy "Persoenliches: nur eigenes anlegen" on public.wl_profile_private for insert to authenticated with check (id = (select auth.uid()));
create policy "Persoenliches: nur eigenes aendern" on public.wl_profile_private for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Groessen: ich und alle Verbundenen" on public.wl_profile_sizes for select to authenticated
  using (profile = (select auth.uid()) or private.wl_are_friends(profile, (select auth.uid())));
create policy "Groessen: nur eigene anlegen (max. 12)" on public.wl_profile_sizes for insert to authenticated
  with check (profile = (select auth.uid()) and (select count(*) from public.wl_profile_sizes s where s.profile = (select auth.uid())) < 12);
create policy "Groessen: nur eigene aendern" on public.wl_profile_sizes for update to authenticated
  using (profile = (select auth.uid())) with check (profile = (select auth.uid()));
create policy "Groessen: nur eigene loeschen" on public.wl_profile_sizes for delete to authenticated using (profile = (select auth.uid()));

create or replace function private.wl_on_signup() returns trigger language plpgsql security definer set search_path = '' as $$
declare n text := left(btrim(coalesce(new.raw_user_meta_data->>'name', '')), 24);
begin
  if char_length(n) < 2 then n := 'Wunschkind'; end if;
  insert into public.wl_profiles (id, name, code) values (new.id, n, private.wl_new_code());
  insert into public.wl_profile_private (id) values (new.id);
  return new;
end $$;

-- Kategorien fuer Wuensche
alter table public.wl_items add column category text not null default '' check (char_length(category) <= 30);

-- Vorschlaege: Freunde schlagen Wuensche vor, nur der Listen-Besitzer sieht sie, bis er sie uebernimmt oder verwirft
create table public.wl_suggestions (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.wl_lists on delete cascade,
  author uuid not null references public.wl_profiles on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  url text check (url ~ '^https?://' and char_length(url) <= 2000),
  image_url text check (image_url ~ '^https://' and char_length(image_url) <= 2000),
  price numeric(10,2) check (price >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  note text not null default '' check (char_length(note) <= 400),
  category text not null default '' check (char_length(category) <= 30),
  created_at timestamptz not null default now()
);
create index wl_suggestions_list on public.wl_suggestions (list_id);
alter table public.wl_suggestions enable row level security;
revoke all on public.wl_suggestions from anon, authenticated;
grant select on public.wl_suggestions to authenticated;
create policy "Vorschlaege: nur der Listen-Besitzer" on public.wl_suggestions for select to authenticated using (private.wl_owns_list(list_id));

create function public.wl_suggest(p_list uuid, p_title text, p_url text, p_image text, p_price numeric, p_currency text, p_note text, p_category text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); o uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select owner into o from public.wl_lists where id = p_list;
  if o is null or o = me or not private.wl_can_view(p_list, me) then raise exception 'no_access'; end if;
  if not private.wl_is_friend_level(o, me) then raise exception 'not_friend'; end if;
  if (select count(*) from public.wl_suggestions where list_id = p_list and author = me) >= 10 then raise exception 'too_many'; end if;
  insert into public.wl_suggestions (list_id, author, title, url, image_url, price, currency, note, category)
    values (p_list, me, btrim(p_title), nullif(p_url, ''), nullif(p_image, ''), p_price, coalesce(nullif(p_currency, ''), 'EUR'), coalesce(p_note, ''), coalesce(p_category, ''));
end $$;

create function public.wl_suggestion_accept(p_id uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.wl_suggestions; new_id uuid;
begin
  select * into s from public.wl_suggestions where id = p_id;
  if not found or not private.wl_owns_list(s.list_id) then raise exception 'no_access'; end if;
  insert into public.wl_items (list_id, title, url, image_url, price, currency, note, category)
    values (s.list_id, s.title, s.url, s.image_url, s.price, s.currency, s.note, s.category) returning id into new_id;
  delete from public.wl_suggestions where id = p_id;
  return new_id;
end $$;

create function public.wl_suggestion_dismiss(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.wl_suggestions s where s.id = p_id and private.wl_owns_list(s.list_id);
end $$;

create or replace function public.wl_preview(p_token text) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'list', jsonb_build_object('title', l.title, 'description', l.description, 'emoji', l.emoji, 'theme', l.theme,
      'occasion', l.occasion, 'event_date', l.event_date),
    'owner', jsonb_build_object('name', p.name, 'avatar', p.avatar, 'color', p.color),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'url', i.url, 'image_url', i.image_url,
        'price', i.price, 'currency', i.currency, 'note', i.note, 'priority', i.priority, 'quantity', i.quantity,
        'group_gift', i.group_gift, 'received', i.received, 'category', i.category) order by i.priority desc, i.created_at) from public.wl_items i where i.list_id = l.id), '[]'::jsonb))
  from public.wl_share_links s
  join public.wl_lists l on l.id = s.list_id
  join public.wl_profiles p on p.id = l.owner
  where s.token = p_token and l.visibility <> 'private' and not l.archived;
$$;

revoke all on function public.wl_suggest(uuid, text, text, text, numeric, text, text, text), public.wl_suggestion_accept(uuid),
  public.wl_suggestion_dismiss(uuid) from public, anon;
grant execute on function public.wl_suggest(uuid, text, text, text, numeric, text, text, text), public.wl_suggestion_accept(uuid),
  public.wl_suggestion_dismiss(uuid) to authenticated;
revoke all on function private.wl_is_friend_level(uuid, uuid) from public, anon;
grant execute on function private.wl_is_friend_level(uuid, uuid) to authenticated;

-- Darf ich fuer diese Liste Vorschlaege machen? (nur Freunde des Besitzers)
create function public.wl_can_suggest(p_list uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wl_lists l where l.id = p_list and l.owner <> auth.uid()
    and private.wl_can_view(p_list, auth.uid()) and private.wl_is_friend_level(l.owner, auth.uid()));
$$;
revoke all on function public.wl_can_suggest(uuid) from public, anon;
grant execute on function public.wl_can_suggest(uuid) to authenticated;
