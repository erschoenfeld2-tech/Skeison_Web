-- Rabatte und Aktionstage (Black Week, Black Friday, Cyber Monday …)
-- An Aktionstagen prueft die Edge Function wl-price-check alle Produktlinks neu. Der eingetragene Preis (price) bleibt
-- unveraendert; der gefundene Preis steht daneben in price_now. Ist er niedriger, zeigt die Seite den alten Preis
-- durchgestrichen und den aktuellen daneben. Danach bekommt jeder eine Nachricht (wl_notices), wie viele Wuensche
-- auf den Listen seiner Freunde und Bekannten reduziert sind und bis zu wie viel er sparen kann.
-- Abwaertskompatibel: nur neue Spalten, Tabellen und Funktionen.

create extension if not exists pg_cron;

-- Aktueller Preis aus dem Shop (letzte Pruefung)
alter table public.wl_items add column price_now numeric(10,2) check (price_now >= 0);
alter table public.wl_items add column price_checked_at timestamptz;

-- Neuer Link: der alte Shop-Preis gilt nicht mehr
create function private.wl_items_price_reset() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.url is distinct from old.url then new.price_now := null; new.price_checked_at := null; end if;
  return new;
end $$;
create trigger wl_items_price_reset before update of url on public.wl_items
  for each row execute function private.wl_items_price_reset();

-- Gilt der Shop-Preis als Rabatt? Hoechstens 4 Tage alt, mindestens 5 % und hoechstens 85 % guenstiger
-- (noch billiger ist fast immer ein Lesefehler, z. B. Zubehoer oder Monatsrate)
create function private.wl_is_deal(p_price numeric, p_now numeric, p_at timestamptz) returns boolean
language sql immutable set search_path = '' as $$
  select p_price > 0 and p_now is not null and p_at is not null and p_at > now() - interval '4 days'
    and p_now <= p_price * 0.95 and p_now >= p_price * 0.15;
$$;

-- Aktionstage: an diesen Tagen werden die Preise geprueft und (falls notify) alle benachrichtigt
create table public.wl_sale_days (
  day date primary key,
  title text not null check (char_length(title) between 1 and 60),
  emoji text not null default '🏷️',
  notify boolean not null default true
);
alter table public.wl_sale_days enable row level security;
create policy "Aktionstage: fuer alle lesbar" on public.wl_sale_days for select to authenticated using (true);
grant select on public.wl_sale_days to authenticated;
insert into public.wl_sale_days (day, title, emoji, notify) values
  ('2026-11-25', 'Black-Week-Halbzeit', '🖤', true),
  ('2026-11-27', 'Black Friday', '🛍️', true),
  ('2026-11-30', 'Cyber Monday', '💻', true),
  ('2026-12-01', 'Nach der Cyber Week', '🏷️', false);   -- nur pruefen: abgelaufene Rabatte verschwinden wieder

-- Nachrichten an einzelne Nutzer (eine je Aktionstag)
create table public.wl_notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.wl_profiles on delete cascade,
  tag text not null,
  kind text not null default 'deals',
  title text not null,
  body text not null default '',
  href text not null default './',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, tag)
);
alter table public.wl_notices enable row level security;
create policy "Nachrichten: nur eigene" on public.wl_notices for select to authenticated using (user_id = (select auth.uid()));
grant select on public.wl_notices to authenticated;

create function public.wl_notice_read(p_id uuid) returns void language sql security definer set search_path = '' as $$
  update public.wl_notices set read_at = coalesce(read_at, now()) where id = p_id and user_id = auth.uid();
$$;
revoke all on function public.wl_notice_read(uuid) from public, anon;
grant execute on function public.wl_notice_read(uuid) to authenticated;

-- Reduzierte Wuensche, die p_uid auf fremden Listen sieht und noch kaufen kann (nicht erhalten, nicht voll reserviert).
-- Verknuepfte Kopien zaehlen einmal.
create function private.wl_deal_items(p_uid uuid)
returns table (item_id uuid, list_id uuid, list_title text, list_emoji text, owner_id uuid, owner_name text, title text, url text,
  image_url text, price numeric, price_now numeric, currency text, pct integer, open_qty integer)
language sql stable security definer set search_path = '' as $$
  with taken as (
    select coalesce(i.link_id, i.id) k, sum(r.quantity)::int q
    from public.wl_reservations r join public.wl_items i on i.id = r.item_id group by 1
  ), d as (
    select distinct on (coalesce(i.link_id, i.id)) i.id, i.list_id, l.title lt, l.emoji le, l.owner, p.name, i.title, i.url, i.image_url,
      i.price, i.price_now, i.currency, i.group_gift, i.quantity, coalesce(t.q, 0) tq
    from public.wl_items i
    join public.wl_lists l on l.id = i.list_id
    join public.wl_profiles p on p.id = l.owner
    left join taken t on t.k = coalesce(i.link_id, i.id)
    where l.owner <> p_uid and not l.archived and not i.received
      and private.wl_is_deal(i.price, i.price_now, i.price_checked_at)
      and private.wl_can_view(l.id, p_uid)
      and not exists (select 1 from public.wl_hidden_lists h where h.list_id = l.id and h.user_id = p_uid)
    order by coalesce(i.link_id, i.id), i.created_at
  )
  select d.id, d.list_id, d.lt, d.le, d.owner, d.name, d.title, d.url, d.image_url, d.price, d.price_now, d.currency,
    round((1 - d.price_now / d.price) * 100)::int,
    case when d.group_gift then 1 else d.quantity - d.tq end
  from d where d.group_gift or d.tq < d.quantity;
$$;

-- Fuer die Seite "Angebote": alles, was der Angemeldete gerade guenstiger bekommt
create function public.wl_friend_deals()
returns table (item_id uuid, list_id uuid, list_title text, list_emoji text, owner_id uuid, owner_name text, title text, url text,
  image_url text, price numeric, price_now numeric, currency text, pct integer, open_qty integer)
language sql stable security definer set search_path = '' as $$
  select * from private.wl_deal_items(auth.uid()) order by pct desc, price - price_now desc;
$$;
revoke all on function public.wl_friend_deals() from public, anon;
grant execute on function public.wl_friend_deals() to authenticated;

-- Betrag deutsch formatiert: 1234.5 -> "1.234,50 €"
create function private.wl_eur(v numeric) returns text language sql immutable set search_path = '' as $$
  select replace(replace(replace(to_char(round(v, 2), 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.') || ' €';
$$;

-- Nachrichten fuer einen Aktionstag anlegen (eine je Nutzer, nur wenn es etwas zu sparen gibt)
create function private.wl_deal_notify(p_day date) returns integer language plpgsql security definer set search_path = '' as $$
declare s record; u record; n integer := 0; cnt integer; save numeric; people integer; top jsonb; v_tag text; v_body text;
begin
  select * into s from public.wl_sale_days where day = p_day and notify;
  if not found then return 0; end if;
  v_tag := 'deals-' || p_day;
  for u in select id from public.wl_profiles loop
    select count(*), coalesce(sum((d.price - d.price_now) * greatest(d.open_qty, 1)) filter (where d.currency = 'EUR'), 0), count(distinct d.owner_id)
      into cnt, save, people from private.wl_deal_items(u.id) d;
    continue when cnt = 0;
    select coalesce(jsonb_agg(x), '[]'::jsonb) into top from (
      select jsonb_build_object('title', d.title, 'owner', d.owner_name, 'pct', d.pct, 'list', d.list_id, 'price', d.price, 'now', d.price_now, 'currency', d.currency) x
      from private.wl_deal_items(u.id) d order by d.pct desc limit 3) t;
    v_body := 'Auf den Listen deiner Freunde und Bekannten ' || case when cnt = 1 then 'ist gerade 1 Wunsch' else 'sind gerade ' || cnt || ' Wünsche' end
      || ' reduziert' || case when save > 0 then '. Du kannst bis zu ' || private.wl_eur(save) || ' sparen.' else '.' end;
    insert into public.wl_notices as w (user_id, tag, kind, title, body, href, data)
      values (u.id, v_tag, 'deals', s.emoji || ' ' || s.title, v_body, './?seite=angebote',
        jsonb_build_object('count', cnt, 'save', round(save, 2), 'people', people, 'day', p_day, 'top', top))
      on conflict (user_id, tag) do update set body = excluded.body, data = excluded.data, title = excluded.title;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Warteschlange und Ergebnisse fuer wl-price-check (nur mit dem Service-Schluessel)
create function public.wl_price_queue(p_limit integer default 40)
returns table (url text, currency text, price numeric) language sql stable security definer set search_path = '' as $$
  select i.url, min(i.currency), min(i.price) from public.wl_items i join public.wl_lists l on l.id = i.list_id
  where i.url is not null and i.price is not null and not i.received and not l.archived
  group by i.url
  having max(coalesce(i.price_checked_at, '-infinity')) < now() - interval '6 hours'
  order by max(coalesce(i.price_checked_at, '-infinity')) limit p_limit;
$$;
create function public.wl_price_store(p_rows jsonb) returns integer language sql security definer set search_path = '' as $$
  with r as (select x->>'url' url, nullif(x->>'price', '')::numeric price, x->>'currency' cur from jsonb_array_elements(p_rows) x),
  u as (
    update public.wl_items i set price_now = case when r.price is not null and r.cur = i.currency then round(r.price, 2) end, price_checked_at = now()
    from r where i.url = r.url returning 1)
  select count(*)::int from u;
$$;
revoke all on function public.wl_price_queue(integer) from public, anon, authenticated;
revoke all on function public.wl_price_store(jsonb) from public, anon, authenticated;
grant execute on function public.wl_price_queue(integer) to service_role;
grant execute on function public.wl_price_store(jsonb) to service_role;

-- Geheimnis fuer den Aufruf aus pg_cron (wie webhook_secret)
insert into public.app_config values ('price_check_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (key) do nothing;

-- Startet einen Pruef-Durchgang (die Function arbeitet im Hintergrund, hoechstens ~100 s je Aufruf)
create function private.wl_price_run() returns bigint language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://pumdupjmmvimlxqvuymg.supabase.co/functions/v1/wl-price-check',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-webhook-secret', (select value from public.app_config where key = 'price_check_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 10000);
$$;
-- Nur an Aktionstagen (deutsches Datum)
create function private.wl_sale_tick(p_notify boolean) returns void language plpgsql security definer set search_path = '' as $$
declare d date := (now() at time zone 'Europe/Berlin')::date;
begin
  if not exists (select 1 from public.wl_sale_days where day = d) then return; end if;
  if p_notify then perform private.wl_deal_notify(d); else perform private.wl_price_run(); end if;
end $$;

-- Zeitplan (UTC): 6:00 bis 7:55 Uhr deutscher Zeit alle 5 Minuten pruefen (je Durchgang ~40 Links), um 8:00 Uhr benachrichtigen
select cron.schedule('wl-price-check', '*/5 5-6 * * *', $$select private.wl_sale_tick(false)$$);
select cron.schedule('wl-deal-notify', '0 7 * * *', $$select private.wl_sale_tick(true)$$);
