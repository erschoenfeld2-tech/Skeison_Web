-- Gaming-Profile fuer alle Skeison Accounts (gleiche Anmeldung, Freunde und Gruppen wie die Wunschliste).
-- Zustand der Supabase-Datenbank (Projekt "skeison-whitelist"); zur Dokumentation, bereits angewendet.
-- Jeder pflegt sein Profil selbst (Konten, Valorant-Skins/Bundles, Minecraft-Skins und Lieblingsserver, Steam-Lieblingsspiele)
-- und gibt es frei wie eine Wunschliste: privat, alle Freunde (Stufe friend), ausgewaehlte Personen/Gruppen oder per Link.
-- Live-Daten (Rang, Spielzeiten, Serverstatus) schreibt nur die Edge Function gp-sync in gp_cache.

create table public.gp_profiles (
  id uuid primary key default auth.uid() references public.wl_profiles on delete cascade,
  visibility text not null default 'friends' check (visibility in ('private','friends','custom')),
  tagline text not null default '' check (char_length(tagline) <= 120),
  val_agent text check (val_agent ~ '^[0-9a-f-]{36}$'),
  pioneer text not null default 'void' check (pioneer ~ '^[a-z0-9-]{1,32}$'),
  mc_server text not null default '' check (char_length(mc_server) <= 100),
  mc_active_skin uuid,
  updated_at timestamptz not null default now()
);

-- Verknuepfte Konten, eins je Art
create table public.gp_accounts (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.wl_profiles on delete cascade,
  kind text not null check (kind in ('valorant','steam','minecraft','discord','epic','xbox','playstation','nintendo',
                                     'battlenet','ea','ubisoft','lol','twitch','youtube','tiktok')),
  handle text not null check (char_length(btrim(handle)) between 1 and 100),
  extra jsonb not null default '{}' check (jsonb_typeof(extra) = 'object' and octet_length(extra::text) <= 1000),
  in_sidebar boolean not null default true,   -- im Profil zeigen (Leiste rechts) und beim Vergleich "Zusammen spielen" mitzaehlen
  sort int not null default 0,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner, kind)
);

-- Valorant: ausgewaehlte Skins und Bundles (UUIDs von valorant-api.com)
create table public.gp_val_items (
  owner uuid not null default auth.uid() references public.wl_profiles on delete cascade,
  kind text not null check (kind in ('skin','bundle')),
  item text not null check (item ~ '^[0-9a-f-]{36}$'),
  primary key (owner, kind, item)
);

-- Steam: Lieblingsspiele in eigener Reihenfolge
create table public.gp_steam_favs (
  owner uuid not null default auth.uid() references public.wl_profiles on delete cascade,
  appid int not null check (appid > 0),
  name text not null check (char_length(name) between 1 and 120),
  sort int not null default 0,
  primary key (owner, appid)
);

-- Minecraft: hochgeladene Skins als PNG (data-URL, klein genug fuer die Tabelle; RLS schuetzt sie mit)
create table public.gp_mc_skins (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.wl_profiles on delete cascade,
  name text not null default 'Skin' check (char_length(btrim(name)) between 1 and 30),
  model text not null default 'classic' check (model in ('classic','slim')),
  png text not null check (png ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' and octet_length(png) <= 24000),
  created_at timestamptz not null default now()
);
create index gp_mc_skins_owner on public.gp_mc_skins (owner);

-- Freigaben wie bei Listen
create table public.gp_share_people (
  owner uuid not null references public.wl_profiles on delete cascade,
  person uuid not null references public.wl_profiles on delete cascade,
  primary key (owner, person)
);
create index gp_share_people_person on public.gp_share_people (person);
create table public.gp_share_groups (
  owner uuid not null references public.wl_profiles on delete cascade,
  group_id uuid not null references public.wl_groups on delete cascade,
  primary key (owner, group_id)
);
create table public.gp_share_links (
  owner uuid primary key references public.wl_profiles on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

-- Live-Daten je Profil und Art (valorant, steam, minecraft, mcserver, discord); nur gp-sync schreibt (Service-Role)
create table public.gp_cache (
  owner uuid not null references public.wl_profiles on delete cascade,
  kind text not null,
  data jsonb,
  error text,
  fetched_at timestamptz,   -- letzter erfolgreicher Abruf (Stand der Daten)
  forced_at timestamptz,    -- letzte vom Besitzer erzwungene Aktualisierung
  tried_at timestamptz,     -- letzter Versuch (auch fehlgeschlagen); bremst Wiederholungen
  primary key (owner, kind)
);

-- Wer darf ein Gaming-Profil sehen? Wie private.wl_can_view fuer Listen.
create function private.gp_can_view(p_owner uuid, p_uid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select p_uid is not null and (p_owner = p_uid or exists (
    select 1 from public.gp_profiles g
    where g.id = p_owner and g.visibility <> 'private' and private.wl_are_friends(p_owner, p_uid) and (
      (g.visibility = 'friends' and private.wl_is_friend_level(p_owner, p_uid))
      or exists (select 1 from public.gp_share_people s where s.owner = p_owner and s.person = p_uid)
      or exists (select 1 from public.gp_share_groups s join public.wl_group_members m on m.group_id = s.group_id
                 where s.owner = p_owner and m.member = p_uid))));
$$;

alter table public.gp_profiles enable row level security;
alter table public.gp_accounts enable row level security;
alter table public.gp_val_items enable row level security;
alter table public.gp_steam_favs enable row level security;
alter table public.gp_mc_skins enable row level security;
alter table public.gp_share_people enable row level security;
alter table public.gp_share_groups enable row level security;
alter table public.gp_share_links enable row level security;
alter table public.gp_cache enable row level security;

revoke all on public.gp_profiles, public.gp_accounts, public.gp_val_items, public.gp_steam_favs, public.gp_mc_skins,
  public.gp_share_people, public.gp_share_groups, public.gp_share_links, public.gp_cache from anon, authenticated;
grant select, insert, update on public.gp_profiles to authenticated;
grant select, insert, update, delete on public.gp_accounts, public.gp_val_items, public.gp_steam_favs, public.gp_mc_skins to authenticated;
grant select on public.gp_share_people, public.gp_share_groups, public.gp_share_links, public.gp_cache to authenticated;

create policy "Gaming-Profil: sichtbar fuer Freigegebene" on public.gp_profiles for select to authenticated
  using (private.gp_can_view(id, (select auth.uid())));
create policy "Gaming-Profil: nur eigenes anlegen" on public.gp_profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "Gaming-Profil: nur eigenes aendern" on public.gp_profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "Konten: sichtbar fuer Freigegebene" on public.gp_accounts for select to authenticated
  using (private.gp_can_view(owner, (select auth.uid())));
create policy "Konten: nur eigene anlegen" on public.gp_accounts for insert to authenticated with check (owner = (select auth.uid()));
create policy "Konten: nur eigene aendern" on public.gp_accounts for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "Konten: nur eigene loeschen" on public.gp_accounts for delete to authenticated using (owner = (select auth.uid()));

create policy "Valorant-Auswahl: sichtbar fuer Freigegebene" on public.gp_val_items for select to authenticated
  using (private.gp_can_view(owner, (select auth.uid())));
-- Obergrenzen zaehlt eine eigene Funktion (eine Unterabfrage auf dieselbe Tabelle in der Regel waere eine Endlosschleife)
create function private.gp_count(p_kind text, p_owner uuid) returns int language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'val' then (select count(*)::int from public.gp_val_items where owner = p_owner)
    when 'steam' then (select count(*)::int from public.gp_steam_favs where owner = p_owner)
    when 'mc' then (select count(*)::int from public.gp_mc_skins where owner = p_owner)
  end;
$$;
revoke all on function private.gp_count(text, uuid) from public, anon;
grant execute on function private.gp_count(text, uuid) to authenticated;

create policy "Valorant-Auswahl: nur eigene anlegen (max. 3000)" on public.gp_val_items for insert to authenticated
  with check (owner = (select auth.uid()) and private.gp_count('val', (select auth.uid())) < 3000);
create policy "Valorant-Auswahl: nur eigene loeschen" on public.gp_val_items for delete to authenticated using (owner = (select auth.uid()));

create policy "Steam-Favoriten: sichtbar fuer Freigegebene" on public.gp_steam_favs for select to authenticated
  using (private.gp_can_view(owner, (select auth.uid())));
create policy "Steam-Favoriten: nur eigene anlegen (max. 24)" on public.gp_steam_favs for insert to authenticated
  with check (owner = (select auth.uid()) and private.gp_count('steam', (select auth.uid())) < 24);
create policy "Steam-Favoriten: nur eigene aendern" on public.gp_steam_favs for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "Steam-Favoriten: nur eigene loeschen" on public.gp_steam_favs for delete to authenticated using (owner = (select auth.uid()));

create policy "MC-Skins: sichtbar fuer Freigegebene" on public.gp_mc_skins for select to authenticated
  using (private.gp_can_view(owner, (select auth.uid())));
create policy "MC-Skins: nur eigene anlegen (max. 12)" on public.gp_mc_skins for insert to authenticated
  with check (owner = (select auth.uid()) and private.gp_count('mc', (select auth.uid())) < 12);
create policy "MC-Skins: nur eigene aendern" on public.gp_mc_skins for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "MC-Skins: nur eigene loeschen" on public.gp_mc_skins for delete to authenticated using (owner = (select auth.uid()));

create policy "Freigaben Personen: nur eigene" on public.gp_share_people for select to authenticated using (owner = (select auth.uid()));
create policy "Freigaben Gruppen: nur eigene" on public.gp_share_groups for select to authenticated using (owner = (select auth.uid()));
create policy "Freigabe-Link: nur eigener" on public.gp_share_links for select to authenticated using (owner = (select auth.uid()));
create policy "Live-Daten: sichtbar fuer Freigegebene" on public.gp_cache for select to authenticated
  using (private.gp_can_view(owner, (select auth.uid())));

-- Alles zu einem Profil in einem Aufruf (nur wenn ich es sehen darf); ohne eigenes Profil liefert "profile" null
create function public.gp_profile(p_owner uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if not private.gp_can_view(p_owner, me) then raise exception 'no_access'; end if;
  return (select jsonb_build_object(
    'mine', p_owner = me,
    'owner', jsonb_build_object('id', w.id, 'name', w.name, 'avatar', w.avatar, 'color', w.color),
    'profile', (select to_jsonb(g) from public.gp_profiles g where g.id = p_owner),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'handle', a.handle, 'extra', a.extra,
        'in_sidebar', a.in_sidebar, 'sort', a.sort, 'checked_at', a.checked_at) order by a.sort, a.created_at)
      from public.gp_accounts a where a.owner = p_owner), '[]'::jsonb),
    'val_items', coalesce((select jsonb_agg(jsonb_build_object('kind', v.kind, 'item', v.item))
      from public.gp_val_items v where v.owner = p_owner), '[]'::jsonb),
    'steam_favs', coalesce((select jsonb_agg(jsonb_build_object('appid', f.appid, 'name', f.name) order by f.sort, f.appid)
      from public.gp_steam_favs f where f.owner = p_owner), '[]'::jsonb),
    'mc_skins', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'model', s.model, 'png', s.png)
        order by s.created_at) from public.gp_mc_skins s where s.owner = p_owner), '[]'::jsonb),
    'cache', coalesce((select jsonb_object_agg(c.kind, jsonb_build_object('data', c.data, 'error', c.error, 'fetched_at', c.fetched_at))
      from public.gp_cache c where c.owner = p_owner), '{}'::jsonb))
    from public.wl_profiles w where w.id = p_owner);
end $$;

-- Profile, die ich sehen darf (fuer die Auswahl oben), ich selbst zuerst
create function public.gp_visible_profiles() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'me' desc, x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object('id', w.id, 'name', w.name, 'avatar', w.avatar, 'color', w.color,
      'tagline', coalesce(g.tagline, ''), 'me', w.id = auth.uid(), 'has_profile', g.id is not null) as x
    from public.wl_profiles w left join public.gp_profiles g on g.id = w.id
    where w.id = auth.uid() or (g.id is not null and private.gp_can_view(w.id, auth.uid()))
  ) t;
$$;

-- Zusammen spielen: Spiele aller Profile, die ich sehen darf (und meine eigenen), zum Vergleichen.
-- Je Profil: Konten-Arten (nur angezeigte), Steam-Lieblingsspiele und die Steam-Bibliothek aus den Live-Daten.
create function public.gp_games() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'me' desc, x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object('id', w.id, 'name', w.name, 'avatar', w.avatar, 'color', w.color, 'me', w.id = auth.uid(),
      'kinds', coalesce((select jsonb_agg(a.kind order by a.sort) from public.gp_accounts a where a.owner = w.id and a.in_sidebar), '[]'::jsonb),
      'favs', coalesce((select jsonb_agg(jsonb_build_object('appid', f.appid, 'name', f.name) order by f.sort) from public.gp_steam_favs f where f.owner = w.id), '[]'::jsonb),
      'library', coalesce((select c.data->'library' from public.gp_cache c where c.owner = w.id and c.kind = 'steam'), '[]'::jsonb),
      'steam_at', (select c.fetched_at from public.gp_cache c where c.owner = w.id and c.kind = 'steam'),
      'has_steam', exists (select 1 from public.gp_accounts a where a.owner = w.id and a.kind = 'steam')) as x
    from public.wl_profiles w left join public.gp_profiles g on g.id = w.id
    where auth.uid() is not null and (w.id = auth.uid() or (g.id is not null and private.gp_can_view(w.id, auth.uid())))
  ) t;
$$;

-- Sichtbarkeit und Freigaben setzen (legt das Profil bei Bedarf an); p_people null = Personen unveraendert lassen
create function public.gp_set_shares(p_visibility text, p_groups uuid[], p_people uuid[]) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_visibility not in ('private','friends','custom') then raise exception 'bad_visibility'; end if;
  insert into public.gp_profiles (id, visibility) values (me, p_visibility)
    on conflict (id) do update set visibility = excluded.visibility, updated_at = now();
  delete from public.gp_share_groups where owner = me;
  insert into public.gp_share_groups (owner, group_id)
    select me, g.id from public.wl_groups g where g.owner = me and g.id = any(coalesce(p_groups, '{}'));
  if p_people is not null then
    delete from public.gp_share_people where owner = me;
    insert into public.gp_share_people (owner, person)
      select me, x from unnest(p_people) as x where private.wl_are_friends(me, x) on conflict do nothing;
  end if;
end $$;

-- Valorant-Auswahl und Steam-Favoriten in einem Schritt ersetzen
create function public.gp_set_val_items(p_skins text[], p_bundles text[]) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if coalesce(array_length(p_skins, 1), 0) + coalesce(array_length(p_bundles, 1), 0) > 3000 then raise exception 'too_many'; end if;
  delete from public.gp_val_items where owner = me;
  insert into public.gp_val_items (owner, kind, item)
    select me, 'skin', lower(x) from unnest(coalesce(p_skins, '{}')) x where x ~* '^[0-9a-f-]{36}$'
    union select me, 'bundle', lower(x) from unnest(coalesce(p_bundles, '{}')) x where x ~* '^[0-9a-f-]{36}$'
    on conflict do nothing;
end $$;

create function public.gp_set_steam_favs(p_items jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 24 then raise exception 'too_many'; end if;
  delete from public.gp_steam_favs where owner = me;
  insert into public.gp_steam_favs (owner, appid, name, sort)
    select me, (e->>'appid')::int, left(btrim(e->>'name'), 120), (n - 1)::int
    from jsonb_array_elements(p_items) with ordinality as t(e, n)
    where (e->>'appid') ~ '^[0-9]{1,9}$' and char_length(btrim(coalesce(e->>'name', ''))) > 0
    on conflict do nothing;
end $$;

-- Teilen per Link / QR wie bei Listen
create function public.gp_share_enable(p_reset boolean default false) returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); t text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  insert into public.gp_profiles (id, visibility) values (me, 'custom') on conflict (id) do nothing;
  update public.gp_profiles set visibility = 'custom', updated_at = now() where id = me and visibility = 'private';
  if p_reset then delete from public.gp_share_links where owner = me; end if;
  insert into public.gp_share_links (owner) values (me) on conflict (owner) do nothing;
  select token into t from public.gp_share_links where owner = me;
  return t;
end $$;

create function public.gp_share_disable() returns void language sql security definer set search_path = '' as $$
  delete from public.gp_share_links where owner = auth.uid();
$$;

-- Vorschau ohne Anmeldung: nur Name, Avatar, Spruch und welche Konten verknuepft sind
create function public.gp_preview(p_token text) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'owner', jsonb_build_object('name', w.name, 'avatar', w.avatar, 'color', w.color),
    'tagline', g.tagline,
    'kinds', coalesce((select jsonb_agg(a.kind order by a.sort, a.created_at) from public.gp_accounts a where a.owner = g.id), '[]'::jsonb),
    'skins', (select count(*) from public.gp_val_items v where v.owner = g.id and v.kind = 'skin'),
    'mc_skins', (select count(*) from public.gp_mc_skins s where s.owner = g.id),
    'favs', (select count(*) from public.gp_steam_favs f where f.owner = g.id))
  from public.gp_share_links s
  join public.gp_profiles g on g.id = s.owner
  join public.wl_profiles w on w.id = g.id
  where s.token = p_token and g.visibility <> 'private';
$$;

-- Link einloesen (angemeldet): verbinden wie wl_redeem und das Profil fuer mich freigeben; liefert die Besitzer-ID
create function public.gp_redeem(p_token text) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  o uuid; vis text; f public.wl_friendships;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select g.id, g.visibility into o, vis from public.gp_share_links s join public.gp_profiles g on g.id = s.owner where s.token = p_token;
  if o is null or vis = 'private' then raise exception 'no_access'; end if;
  if o = me then return o; end if;
  select * into f from public.wl_friendships
    where (requester = me and addressee = o) or (requester = o and addressee = me);
  if (not found or f.status = 'pending')
     and exists (select 1 from public.wl_unfriended u where u.owner = o and u.person = me) then
    raise exception 'no_access';
  end if;
  if f.requester is null then
    insert into public.wl_friendships (requester, addressee, status) values (o, me, 'accepted');
    insert into public.wl_trust (owner, person, level) values (o, me, 'known'), (me, o, 'known')
      on conflict (owner, person) do update set level = 'known';
  elsif f.status = 'pending' then
    update public.wl_friendships set status = 'accepted' where requester = f.requester and addressee = f.addressee;
    if f.requester = me then
      insert into public.wl_trust (owner, person, level) values (o, me, 'known')
        on conflict (owner, person) do update set level = 'known';
    end if;
  end if;
  insert into public.gp_share_people (owner, person) values (o, me) on conflict do nothing;
  return o;
end $$;

revoke all on function public.gp_profile(uuid), public.gp_visible_profiles(), public.gp_games(), public.gp_set_shares(text, uuid[], uuid[]),
  public.gp_set_val_items(text[], text[]), public.gp_set_steam_favs(jsonb), public.gp_share_enable(boolean),
  public.gp_share_disable(), public.gp_preview(text), public.gp_redeem(text), private.gp_can_view(uuid, uuid) from public, anon;
grant execute on function public.gp_profile(uuid), public.gp_visible_profiles(), public.gp_games(), public.gp_set_shares(text, uuid[], uuid[]),
  public.gp_set_val_items(text[], text[]), public.gp_set_steam_favs(jsonb), public.gp_share_enable(boolean),
  public.gp_share_disable(), public.gp_redeem(text) to authenticated;
grant execute on function public.gp_preview(text) to anon, authenticated;
-- die RLS-Regeln rufen gp_can_view als angemeldeter Nutzer auf (wie private.wl_can_view)
grant execute on function private.gp_can_view(uuid, uuid) to authenticated;
