-- Rabatte beim Kopieren mitnehmen (nach wunschliste_deals.sql)
-- Kopierte Wuensche (einzeln, ganze Liste klonen, Inhalt uebernehmen) behalten den zuletzt geprueften Shop-Preis
-- (price_now, price_checked_at); sonst stand der Rabatt erst nach der naechsten Preispruefung wieder da.

create or replace function public.wl_copy_item(p_item uuid, p_lists uuid[], p_link boolean default true)
returns integer language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); src public.wl_items; lid uuid; n integer := 0;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select i.* into src from public.wl_items i where i.id = p_item for update;
  if not found or not private.wl_owns_list(src.list_id) then raise exception 'no_access'; end if;
  lid := src.link_id;
  if p_link and lid is null then
    lid := gen_random_uuid();
    update public.wl_items set link_id = lid where id = p_item;
  end if;
  insert into public.wl_items (list_id, title, url, image_url, price, currency, note, category, priority, quantity, group_gift, received, link_id, price_now, price_checked_at)
    select l.id, src.title, src.url, src.image_url, src.price, src.currency, src.note, src.category, src.priority, src.quantity, src.group_gift,
      case when p_link then src.received else false end, case when p_link then lid end, src.price_now, src.price_checked_at
    from public.wl_lists l
    where l.owner = me and l.id = any(coalesce(p_lists, '{}')) and l.id <> src.list_id
      and not (p_link and exists (select 1 from public.wl_items x where x.list_id = l.id and x.link_id = lid));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function private.wl_copy_items(p_from uuid, p_to uuid, p_link boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); own boolean; n integer := 0;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_from = p_to then raise exception 'same_list'; end if;
  if not exists (select 1 from public.wl_lists l where l.id = p_to and l.owner = me) then raise exception 'no_access'; end if;
  select l.owner = me into own from public.wl_lists l where l.id = p_from;
  if own is null or not (own or private.wl_can_view(p_from, me)) then raise exception 'no_access'; end if;
  if (select count(*) from public.wl_items i where i.list_id in (p_from, p_to)) > 500 then raise exception 'too_many'; end if;
  if own and p_link then
    update public.wl_items set link_id = gen_random_uuid() where list_id = p_from and link_id is null;
    insert into public.wl_items (list_id, title, url, image_url, price, currency, note, category, priority, quantity, group_gift, received, link_id, created_at, price_now, price_checked_at)
      select p_to, s.title, s.url, s.image_url, s.price, s.currency, s.note, s.category, s.priority, s.quantity, s.group_gift, s.received, s.link_id,
        now() + (row_number() over (order by s.created_at, s.id)) * interval '1 microsecond', s.price_now, s.price_checked_at
      from public.wl_items s
      where s.list_id = p_from and not exists (select 1 from public.wl_items x where x.list_id = p_to and x.link_id = s.link_id);
  else
    insert into public.wl_items (list_id, title, url, image_url, price, currency, note, category, priority, quantity, group_gift, created_at, price_now, price_checked_at)
      select p_to, s.title, s.url, s.image_url, s.price, s.currency, case when own then s.note else '' end, s.category,
        case when own then s.priority else 2 end, s.quantity, s.group_gift,
        now() + (row_number() over (order by s.created_at, s.id)) * interval '1 microsecond', s.price_now, s.price_checked_at
      from public.wl_items s where s.list_id = p_from;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
