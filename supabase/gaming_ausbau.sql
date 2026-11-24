-- Gaming-Profile, Ausbau (nach gaming.sql eingespielt): mehrere Konten je Anbieter, weitere Konten (Instagram, HoYoverse ...),
-- eigene Reiter fuer Spiele aus Launchern mit Statistiken und Errungenschaften, Reihenfolge der Reiter, oeffentliches Profil
-- mit Ausstellung, Gaming-Bekannte (ohne Freundschaft in der Wunschliste) und Kreise, Sichtbarkeit je Konto und Bereich.
-- Zustand der Supabase-Datenbank (Projekt "skeison-whitelist"); zur Dokumentation, bereits angewendet.
-- Abwaertskompatibel: alte Seiten nutzen weiter gp_profile/gp_visible_profiles/gp_games in derselben Form.
--
-- Stufen, wer etwas sieht (private.gp_tier): me (Besitzer) > friend (darf das Freundes-Profil sehen, wie bisher gp_can_view)
-- > known (Gaming-Bekannte aus gp_known oder in der Wunschliste verbunden) > public (beide haben ein oeffentliches Profil).
-- Jedes Konto, jeder eigene Reiter und jeder Bereich hat ein Publikum (private.gp_aud):
--   public  alle mit oeffentlichem Profil, Bekannte und Freunde
--   known   Bekannte und Freunde
--   friends nur wer das Freundes-Profil sehen darf (Standard, wie bisher)
--   circle:<id>  nur Mitglieder dieses Kreises (Freunde oder Bekannte)
--   me      nur ich
-- Im oeffentlichen Profil werden Spielernamen gekuerzt (Sk•••#•••), ausser man schaltet sie je Konto frei, und Live-Daten
-- verlieren Namen, Links und IDs. Der Wert der Konten ist ein eigener Bereich (Standard: friends).

-- ---------------------------------------------------------------- Konten: mehrere je Anbieter, neue Anbieter, Publikum
-- Zweitkonten heissen <art>-2 bis <art>-5; so bleibt unique (owner, kind) und die alte Seite speichert weiter wie gewohnt.
alter table public.gp_accounts drop constraint if exists gp_accounts_kind_check;
alter table public.gp_accounts add constraint gp_accounts_kind_check check (kind ~ ('^(valorant|steam|minecraft|discord|epic|xbox|playstation|nintendo|battlenet|ea|ubisoft|lol|twitch|youtube|tiktok'
  || '|instagram|hoyoverse|roblox|gog|rockstar|x|reddit|kick|snapchat)(-[2-5])?$'));
alter table public.gp_accounts add column audience text not null default 'friends'
  check (audience ~ '^(public|known|friends|me|circle:[0-9a-f-]{36})$');
alter table public.gp_accounts add column public_full boolean not null default false;   -- im oeffentlichen Profil ungekuerzt zeigen

-- ---------------------------------------------------------------- Profil: Aufbau und Publikum der Bereiche
-- layout: { tabs: ['val','steam','mc','stats','team','c:<id>' ...] Reihenfolge, hidden: [...], stats: [Kacheln], hero: <appid> }
-- audience: { val, steam, mc, stats, value } je ein Publikum wie oben (fehlt einer: friends)
alter table public.gp_profiles add column layout jsonb not null default '{}'
  check (jsonb_typeof(layout) = 'object' and octet_length(layout::text) <= 4000);
alter table public.gp_profiles add column audience jsonb not null default '{}'
  check (jsonb_typeof(audience) = 'object' and octet_length(audience::text) <= 1000);

-- ---------------------------------------------------------------- Oeffentliches Profil
create table public.gp_public (
  owner uuid primary key references public.wl_profiles on delete cascade,
  enabled boolean not null default false,
  tagline text not null default '' check (char_length(tagline) <= 120),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- Eigene Reiter: Spiele aus Launchern, eigene Zahlen
-- stats: [{ l: Bezeichnung, v: Wert }], achievements: [{ n: Name, d: Beschreibung, done: bool, at: 'YYYY-MM-DD' }]
-- appid: Steam-Spiel; dann kommen Spielzeit und Errungenschaften live von Steam (gp-sync, Cache "ach:<appid>")
create table public.gp_custom_games (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.wl_profiles on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  platform text not null default '' check (char_length(platform) <= 30),
  image text not null default '' check (image = '' or (image ~ '^https://' and char_length(image) <= 300)),
  appid int check (appid > 0),
  hours numeric(9,1) check (hours >= 0 and hours < 1000000),
  stats jsonb not null default '[]' check (jsonb_typeof(stats) = 'array' and jsonb_array_length(stats) <= 24 and octet_length(stats::text) <= 4000),
  achievements jsonb not null default '[]' check (jsonb_typeof(achievements) = 'array' and jsonb_array_length(achievements) <= 150 and octet_length(achievements::text) <= 24000),
  audience text not null default 'friends' check (audience ~ '^(public|known|friends|me|circle:[0-9a-f-]{36})$'),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index gp_custom_games_owner on public.gp_custom_games (owner);

-- ---------------------------------------------------------------- Gaming-Bekannte (keine Freundschaft in der Wunschliste)
create table public.gp_known (
  requester uuid not null references public.wl_profiles on delete cascade,
  addressee uuid not null references public.wl_profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
create index gp_known_addressee on public.gp_known (addressee);

-- Kreise: eigene Gruppen fuer das Gaming-Profil, Mitglieder sind Freunde oder Bekannte
create table public.gp_circles (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.wl_profiles on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 30),
  emoji text not null default '👥' check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now()
);
create index gp_circles_owner on public.gp_circles (owner);
create table public.gp_circle_members (
  circle uuid not null references public.gp_circles on delete cascade,
  member uuid not null references public.wl_profiles on delete cascade,
  primary key (circle, member)
);
create index gp_circle_members_member on public.gp_circle_members (member);

-- ---------------------------------------------------------------- Stufen und Publikum
create function private.gp_known_ok(a uuid, b uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.gp_known k where k.status = 'accepted'
    and ((k.requester = a and k.addressee = b) or (k.requester = b and k.addressee = a)));
$$;

create function private.gp_tier(p_owner uuid, p_viewer uuid) returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_viewer is null or p_owner is null then null
    when p_owner = p_viewer then 'me'
    when private.gp_can_view(p_owner, p_viewer) then 'friend'
    when private.wl_are_friends(p_owner, p_viewer) or private.gp_known_ok(p_owner, p_viewer) then 'known'
    when exists (select 1 from public.gp_public a where a.owner = p_owner and a.enabled)
     and exists (select 1 from public.gp_public b where b.owner = p_viewer and b.enabled) then 'public'
  end;
$$;

-- p_viewer null (Vorschau "Ansehen als"): Kreise zaehlen dann nicht
create function private.gp_aud(p_owner uuid, p_viewer uuid, p_tier text, p_aud text) returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_tier = 'me' then true
    when p_tier is null or p_aud is null then false
    when p_aud = 'public' then p_tier in ('public','known','friend')
    when p_aud = 'known' then p_tier in ('known','friend')
    when p_aud = 'friends' then p_tier = 'friend'
    when p_aud like 'circle:%' then p_tier in ('known','friend') and exists (
      select 1 from public.gp_circles c join public.gp_circle_members m on m.circle = c.id
      where c.owner = p_owner and c.id::text = substr(p_aud, 8) and m.member = p_viewer)
    else false end;
$$;

-- Spielernamen fuers oeffentliche Profil kuerzen: "Skeison#EUW" -> "Sk•••#•••"
create function private.gp_mask(p text) returns text language sql immutable set search_path = '' as $$
  select case when coalesce(p, '') = '' then '' else
    left(regexp_replace(split_part(p, '#', 1), '^(@|discord\.gg/|SW-|channel/)', ''), 2) || '•••'
      || case when position('#' in p) > 0 then '#•••' else '' end end;
$$;

-- Live-Daten fuer andere: ohne internen Schluessel, ohne Wert (wenn nicht freigegeben), oeffentlich ohne Namen/Links/IDs
create function private.gp_clean(p_data jsonb, p_tier text, p_value boolean, p_full boolean) returns jsonb language sql immutable set search_path = '' as $$
  select case when p_data is null then null else
    (case when p_value then p_data else p_data - 'value' end)
      - (case when p_tier = 'public' and not p_full
           then array['_key','name','tag','riotId','url','card','steamId','avatar','uuid','code','profileurl']
           else array['_key'] end)
  end;
$$;

-- Obergrenzen (wie gp_count in gaming.sql, ergaenzt um eigene Reiter und Kreise)
create or replace function private.gp_count(p_kind text, p_owner uuid) returns int language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'val' then (select count(*)::int from public.gp_val_items where owner = p_owner)
    when 'steam' then (select count(*)::int from public.gp_steam_favs where owner = p_owner)
    when 'mc' then (select count(*)::int from public.gp_mc_skins where owner = p_owner)
    when 'custom' then (select count(*)::int from public.gp_custom_games where owner = p_owner)
    when 'circle' then (select count(*)::int from public.gp_circles where owner = p_owner)
  end;
$$;

-- ---------------------------------------------------------------- Rechte
alter table public.gp_public enable row level security;
alter table public.gp_custom_games enable row level security;
alter table public.gp_known enable row level security;
alter table public.gp_circles enable row level security;
alter table public.gp_circle_members enable row level security;
revoke all on public.gp_public, public.gp_custom_games, public.gp_known, public.gp_circles, public.gp_circle_members from anon, authenticated;
grant select on public.gp_public, public.gp_known, public.gp_circle_members to authenticated;
grant select, insert, update, delete on public.gp_custom_games, public.gp_circles to authenticated;

create policy "Oeffentliches Profil: nur eigenes" on public.gp_public for select to authenticated using (owner = (select auth.uid()));
create policy "Eigene Reiter: nur eigene lesen" on public.gp_custom_games for select to authenticated using (owner = (select auth.uid()));
create policy "Eigene Reiter: nur eigene anlegen (max. 30)" on public.gp_custom_games for insert to authenticated
  with check (owner = (select auth.uid()) and private.gp_count('custom', (select auth.uid())) < 30);
create policy "Eigene Reiter: nur eigene aendern" on public.gp_custom_games for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "Eigene Reiter: nur eigene loeschen" on public.gp_custom_games for delete to authenticated using (owner = (select auth.uid()));
create policy "Bekannte: nur eigene" on public.gp_known for select to authenticated
  using (requester = (select auth.uid()) or addressee = (select auth.uid()));
create policy "Kreise: nur eigene lesen" on public.gp_circles for select to authenticated using (owner = (select auth.uid()));
create policy "Kreise: nur eigene anlegen (max. 20)" on public.gp_circles for insert to authenticated
  with check (owner = (select auth.uid()) and private.gp_count('circle', (select auth.uid())) < 20);
create policy "Kreise: nur eigene aendern" on public.gp_circles for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "Kreise: nur eigene loeschen" on public.gp_circles for delete to authenticated using (owner = (select auth.uid()));
create policy "Kreis-Mitglieder: nur eigene Kreise" on public.gp_circle_members for select to authenticated
  using (exists (select 1 from public.gp_circles c where c.id = circle and c.owner = (select auth.uid())));

-- Konten und Live-Daten liest jeder nur noch selbst direkt; andere bekommen sie gefiltert ueber gp_view/gp_profile
drop policy "Konten: sichtbar fuer Freigegebene" on public.gp_accounts;
create policy "Konten: nur eigene lesen" on public.gp_accounts for select to authenticated using (owner = (select auth.uid()));
drop policy "Live-Daten: sichtbar fuer Freigegebene" on public.gp_cache;
create policy "Live-Daten: nur eigene lesen" on public.gp_cache for select to authenticated using (owner = (select auth.uid()));

-- ---------------------------------------------------------------- Ein Profil so, wie ich es sehen darf
-- p_as (nur Besitzer): 'friend' | 'known' | 'public' zeigt das eigene Profil so, wie es diese Stufe sieht.
create function public.gp_view(p_owner uuid, p_as text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); t text; v uuid; mine boolean; preview boolean := false;
  pr public.gp_profiles; pub public.gp_public; aud jsonb; sec jsonb; rel text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  t := private.gp_tier(p_owner, me);
  if t is null then raise exception 'no_access'; end if;
  v := me;
  if t = 'me' and p_as in ('friend','known','public') then t := p_as; v := null; preview := true; end if;
  mine := t = 'me';
  select * into pr from public.gp_profiles where id = p_owner;
  select * into pub from public.gp_public where owner = p_owner;
  aud := coalesce(pr.audience, '{}'::jsonb);
  sec := jsonb_build_object(
    'val', private.gp_aud(p_owner, v, t, coalesce(aud->>'val', 'friends')),
    'steam', private.gp_aud(p_owner, v, t, coalesce(aud->>'steam', 'friends')),
    'mc', private.gp_aud(p_owner, v, t, coalesce(aud->>'mc', 'friends')),
    'stats', private.gp_aud(p_owner, v, t, coalesce(aud->>'stats', 'friends')),
    'value', private.gp_aud(p_owner, v, t, coalesce(aud->>'value', 'friends')));
  if not mine and not preview then
    select case when k.status = 'accepted' then 'known' when k.requester = me then 'sent' else 'received' end into rel
      from public.gp_known k where (k.requester = me and k.addressee = p_owner) or (k.requester = p_owner and k.addressee = me);
  end if;
  return (select jsonb_build_object(
    'mine', mine, 'tier', t, 'preview', preview, 'sections', sec, 'relation', coalesce(rel, 'none'),
    'owner', jsonb_build_object('id', w.id, 'name', w.name, 'avatar', w.avatar, 'color', w.color),
    'profile', case when pr.id is null then null else jsonb_build_object(
        'tagline', case when t = 'public' then coalesce(pub.tagline, '') else pr.tagline end,
        'val_agent', case when (sec->>'val')::boolean then pr.val_agent end,
        'pioneer', pr.pioneer,
        'mc_server', case when (sec->>'mc')::boolean then pr.mc_server else '' end,
        'mc_active_skin', pr.mc_active_skin, 'layout', pr.layout)
      || case when mine then jsonb_build_object('id', pr.id, 'visibility', pr.visibility, 'audience', pr.audience, 'tagline_friends', pr.tagline) else '{}'::jsonb end end,
    'public', case when mine then jsonb_build_object('enabled', coalesce(pub.enabled, false), 'tagline', coalesce(pub.tagline, '')) end,
    'accounts', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', a.kind,
        'handle', case when t = 'public' and not a.public_full then private.gp_mask(a.handle) else a.handle end,
        'masked', t = 'public' and not a.public_full,
        'extra', a.extra, 'in_sidebar', a.in_sidebar, 'sort', a.sort, 'checked_at', a.checked_at)
        || case when mine then jsonb_build_object('id', a.id, 'audience', a.audience, 'public_full', a.public_full) else '{}'::jsonb end
        order by a.sort, a.created_at)
      from public.gp_accounts a where a.owner = p_owner and (mine or (a.in_sidebar and private.gp_aud(p_owner, v, t, a.audience)))), '[]'::jsonb),
    'val_items', case when (sec->>'val')::boolean then coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'item', x.item))
      from public.gp_val_items x where x.owner = p_owner), '[]'::jsonb) else '[]'::jsonb end,
    'steam_favs', case when (sec->>'steam')::boolean then coalesce((select jsonb_agg(jsonb_build_object('appid', f.appid, 'name', f.name) order by f.sort, f.appid)
      from public.gp_steam_favs f where f.owner = p_owner), '[]'::jsonb) else '[]'::jsonb end,
    'mc_skins', case when (sec->>'mc')::boolean then coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'model', s.model, 'png', s.png) order by s.created_at)
      from public.gp_mc_skins s where s.owner = p_owner), '[]'::jsonb) else '[]'::jsonb end,
    'custom', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'platform', g.platform, 'image', g.image, 'appid', g.appid,
        'hours', g.hours, 'stats', g.stats, 'achievements', g.achievements, 'sort', g.sort) || case when mine then jsonb_build_object('audience', g.audience) else '{}'::jsonb end
        order by g.sort, g.created_at)
      from public.gp_custom_games g where g.owner = p_owner and private.gp_aud(p_owner, v, t, g.audience)), '[]'::jsonb),
    'cache', coalesce((select jsonb_object_agg(c.kind, jsonb_build_object(
        'data', case when mine then c.data - '_key' else private.gp_clean(c.data, t, (sec->>'value')::boolean,
          coalesce((select a.public_full from public.gp_accounts a where a.owner = p_owner and a.kind = c.kind), true)) end,
        'error', c.error, 'fetched_at', c.fetched_at))
      from public.gp_cache c where c.owner = p_owner and (mine or (
        case
          when c.kind = 'mcserver' then (sec->>'mc')::boolean
          when c.kind like 'ach:%' then exists (select 1 from public.gp_custom_games g where g.owner = p_owner and g.appid::text = substr(c.kind, 5)
            and private.gp_aud(p_owner, v, t, g.audience))
          else exists (select 1 from public.gp_accounts a where a.owner = p_owner and a.kind = c.kind and a.in_sidebar and private.gp_aud(p_owner, v, t, a.audience))
            and case split_part(c.kind, '-', 1) when 'valorant' then (sec->>'val')::boolean when 'steam' then (sec->>'steam')::boolean
              when 'minecraft' then (sec->>'mc')::boolean else true end
        end))), '{}'::jsonb))
    from public.wl_profiles w where w.id = p_owner);
end $$;

-- Altes gp_profile (alte Seite, bis zum Merge): nur Besitzer und Freundes-Stufe, gleiche Form wie bisher, aber gefiltert
create or replace function public.gp_profile(p_owner uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if coalesce(private.gp_tier(p_owner, me), '') not in ('me', 'friend') then raise exception 'no_access'; end if;
  return public.gp_view(p_owner, null);
end $$;

-- Profile zur Auswahl oben: ich, Freundes-Profile und Bekannte (oeffentliche stehen in der Ausstellung)
create function public.gp_people() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'me' desc, (x->>'tier' = 'friend') desc, x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object('id', w.id, 'name', w.name, 'avatar', w.avatar, 'color', w.color, 'tagline', case when w.id = auth.uid() then coalesce(g.tagline, '') else '' end,
      'me', w.id = auth.uid(), 'has_profile', g.id is not null, 'tier', private.gp_tier(w.id, auth.uid())) as x
    from public.wl_profiles w left join public.gp_profiles g on g.id = w.id
    where auth.uid() is not null and (w.id = auth.uid() or (g.id is not null and private.gp_tier(w.id, auth.uid()) in ('friend', 'known')))
  ) t;
$$;

-- Ausstellung: alle oeffentlichen Profile; sehen darf sie nur, wer selbst ein oeffentliches Profil hat
create function public.gp_showcase() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.gp_public where owner = me and enabled) then raise exception 'no_public'; end if;
  return coalesce((select jsonb_agg(x order by x->>'me' desc, (x->>'hours')::numeric desc nulls last, x->>'name') from (
    select jsonb_build_object('id', w.id, 'name', w.name, 'avatar', w.avatar, 'color', w.color, 'tagline', p.tagline, 'me', w.id = me,
      'tier', private.gp_tier(w.id, me),
      'kinds', coalesce((select jsonb_agg(distinct split_part(a.kind, '-', 1)) from public.gp_accounts a
        where a.owner = w.id and a.in_sidebar and a.audience = 'public'), '[]'::jsonb),
      'games', case when coalesce(g.audience->>'steam', 'friends') = 'public' then coalesce((select jsonb_agg(jsonb_build_object('appid', f.appid, 'name', f.name) order by f.sort)
        from (select * from public.gp_steam_favs f2 where f2.owner = w.id order by f2.sort limit 4) f), '[]'::jsonb) else '[]'::jsonb end,
      'custom', coalesce((select jsonb_agg(c.name order by c.sort) from (select * from public.gp_custom_games c2 where c2.owner = w.id and c2.audience = 'public' order by c2.sort limit 4) c), '[]'::jsonb),
      'hours', case when coalesce(g.audience->>'stats', 'friends') = 'public' then
        coalesce((select sum((c.data->>'totalHours')::numeric) from public.gp_cache c join public.gp_accounts a on a.owner = c.owner and a.kind = c.kind
          where c.owner = w.id and split_part(c.kind, '-', 1) = 'steam' and a.audience = 'public' and a.in_sidebar and coalesce(g.audience->>'steam', 'friends') = 'public'), 0)
        + coalesce((select sum(c.hours) from public.gp_custom_games c where c.owner = w.id and c.audience = 'public' and c.appid is null), 0) end) as x
    from public.gp_public p join public.wl_profiles w on w.id = p.owner left join public.gp_profiles g on g.id = p.owner
    where p.enabled) t), '[]'::jsonb);
end $$;

create function public.gp_set_public(p_enabled boolean, p_tagline text) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  insert into public.gp_profiles (id) values (me) on conflict (id) do nothing;
  insert into public.gp_public (owner, enabled, tagline) values (me, coalesce(p_enabled, false), left(btrim(coalesce(p_tagline, '')), 120))
    on conflict (owner) do update set enabled = excluded.enabled, tagline = excluded.tagline, updated_at = now();
end $$;

-- ---------------------------------------------------------------- Bekannte
-- Anfrage nur an jemanden, dessen oeffentliches Profil ich sehen darf (oder mit dem ich schon verbunden bin);
-- hat der andere mich schon angefragt, gilt es als angenommen. Hoechstens 30 offene Anfragen.
create function public.gp_known_request(p_user uuid) returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_user is null or p_user = me or private.gp_tier(p_user, me) is null then raise exception 'no_access'; end if;
  if private.gp_known_ok(me, p_user) then return 'known'; end if;
  if exists (select 1 from public.gp_known where requester = p_user and addressee = me) then
    update public.gp_known set status = 'accepted' where requester = p_user and addressee = me;
    return 'known';
  end if;
  if (select count(*) from public.gp_known where requester = me and status = 'pending') >= 30 then raise exception 'too_many'; end if;
  insert into public.gp_known (requester, addressee) values (me, p_user) on conflict do nothing;
  return 'sent';
end $$;

create function public.gp_known_answer(p_user uuid, p_accept boolean) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_accept then update public.gp_known set status = 'accepted' where requester = p_user and addressee = me;
  else delete from public.gp_known where requester = p_user and addressee = me and status = 'pending'; end if;
end $$;

-- Bekanntschaft (oder Anfrage) beenden; beide fliegen aus den Kreisen des anderen
create function public.gp_known_remove(p_user uuid) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  delete from public.gp_known where (requester = me and addressee = p_user) or (requester = p_user and addressee = me);
  if not private.wl_are_friends(me, p_user) then
    delete from public.gp_circle_members m using public.gp_circles c where m.circle = c.id
      and ((c.owner = me and m.member = p_user) or (c.owner = p_user and m.member = me));
  end if;
end $$;

-- Bekannte und offene Anfragen mit Namen (fuer den Editor)
create function public.gp_known_list() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'avatar', w.avatar, 'color', w.color,
      'state', case when k.status = 'accepted' then 'known' when k.requester = auth.uid() then 'sent' else 'received' end,
      'friend', private.wl_are_friends(auth.uid(), w.id)) order by k.status, w.name), '[]'::jsonb)
  from public.gp_known k join public.wl_profiles w on w.id = case when k.requester = auth.uid() then k.addressee else k.requester end
  where auth.uid() in (k.requester, k.addressee);
$$;

-- Kreis anlegen/aendern samt Mitgliedern (nur Freunde oder Bekannte); liefert die ID
create function public.gp_set_circle(p_id uuid, p_name text, p_emoji text, p_members uuid[]) returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); cid uuid := p_id;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if cid is null then
    if private.gp_count('circle', me) >= 20 then raise exception 'too_many'; end if;
    insert into public.gp_circles (owner, name, emoji) values (me, btrim(p_name), coalesce(nullif(btrim(p_emoji), ''), '👥')) returning id into cid;
  else
    update public.gp_circles set name = btrim(p_name), emoji = coalesce(nullif(btrim(p_emoji), ''), '👥') where id = cid and owner = me;
    if not found then raise exception 'no_access'; end if;
  end if;
  delete from public.gp_circle_members where circle = cid;
  insert into public.gp_circle_members (circle, member)
    select cid, x from unnest(coalesce(p_members, '{}')) as x
    where x <> me and (private.wl_are_friends(me, x) or private.gp_known_ok(me, x)) on conflict do nothing;
  return cid;
end $$;

-- ---------------------------------------------------------------- Zusammen spielen: jetzt mit eigenen Spielen und Publikum
create or replace function public.gp_games() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'me' desc, x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object('id', w.id, 'name', w.name, 'avatar', w.avatar, 'color', w.color, 'me', w.id = auth.uid(),
      'kinds', coalesce((select jsonb_agg(a.kind order by a.sort) from public.gp_accounts a where a.owner = w.id and a.in_sidebar
        and private.gp_aud(w.id, auth.uid(), private.gp_tier(w.id, auth.uid()), a.audience)), '[]'::jsonb),
      'favs', case when private.gp_aud(w.id, auth.uid(), private.gp_tier(w.id, auth.uid()), coalesce(g.audience->>'steam', 'friends')) then
        coalesce((select jsonb_agg(jsonb_build_object('appid', f.appid, 'name', f.name) order by f.sort) from public.gp_steam_favs f where f.owner = w.id), '[]'::jsonb) else '[]'::jsonb end,
      'library', case when private.gp_aud(w.id, auth.uid(), private.gp_tier(w.id, auth.uid()), coalesce(g.audience->>'steam', 'friends')) then
        coalesce((select c.data->'library' from public.gp_cache c where c.owner = w.id and c.kind = 'steam'), '[]'::jsonb) else '[]'::jsonb end,
      'custom', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'appid', c.appid, 'hours', c.hours) order by c.sort) from public.gp_custom_games c
        where c.owner = w.id and private.gp_aud(w.id, auth.uid(), private.gp_tier(w.id, auth.uid()), c.audience)), '[]'::jsonb),
      'steam_at', (select c.fetched_at from public.gp_cache c where c.owner = w.id and c.kind = 'steam'),
      'has_steam', exists (select 1 from public.gp_accounts a where a.owner = w.id and a.kind = 'steam')) as x
    from public.wl_profiles w left join public.gp_profiles g on g.id = w.id
    where auth.uid() is not null and (w.id = auth.uid() or (g.id is not null and private.gp_can_view(w.id, auth.uid())))
  ) t;
$$;

-- Link-Vorschau ohne Anmeldung: nur Konten, die nicht privat oder auf einen Kreis beschraenkt sind
create or replace function public.gp_preview(p_token text) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'owner', jsonb_build_object('name', w.name, 'avatar', w.avatar, 'color', w.color),
    'tagline', g.tagline,
    'kinds', coalesce((select jsonb_agg(a.kind order by a.sort, a.created_at) from public.gp_accounts a
      where a.owner = g.id and a.in_sidebar and a.audience in ('public','known','friends')), '[]'::jsonb),
    'skins', (select count(*) from public.gp_val_items v where v.owner = g.id and v.kind = 'skin'),
    'mc_skins', (select count(*) from public.gp_mc_skins s where s.owner = g.id),
    'favs', (select count(*) from public.gp_steam_favs f where f.owner = g.id))
  from public.gp_share_links s
  join public.gp_profiles g on g.id = s.owner
  join public.wl_profiles w on w.id = g.id
  where s.token = p_token and g.visibility <> 'private';
$$;

revoke all on function public.gp_view(uuid, text), public.gp_people(), public.gp_showcase(), public.gp_set_public(boolean, text),
  public.gp_known_request(uuid), public.gp_known_answer(uuid, boolean), public.gp_known_remove(uuid), public.gp_known_list(),
  public.gp_set_circle(uuid, text, text, uuid[]), private.gp_tier(uuid, uuid), private.gp_aud(uuid, uuid, text, text),
  private.gp_known_ok(uuid, uuid), private.gp_mask(text), private.gp_clean(jsonb, text, boolean, boolean) from public, anon;
grant execute on function public.gp_view(uuid, text), public.gp_people(), public.gp_showcase(), public.gp_set_public(boolean, text),
  public.gp_known_request(uuid), public.gp_known_answer(uuid, boolean), public.gp_known_remove(uuid), public.gp_known_list(),
  public.gp_set_circle(uuid, text, text, uuid[]) to authenticated;
