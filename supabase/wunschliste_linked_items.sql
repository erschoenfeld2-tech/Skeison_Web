-- Wunschliste: verknuepfte Wuensche ueber mehrere Listen.
-- Derselbe Wunsch kann auf mehreren eigenen Listen stehen (z. B. "Geburtstag" und "Weihnachten"). Sind die Kopien
-- verknuepft (gleiche link_id), zaehlen sie beim Reservieren als EIN Wunsch: Wer ihn auf einer Liste reserviert,
-- sperrt ihn auf allen. So wird nichts doppelt geschenkt. Ohne link_id verhaelt sich alles wie bisher.
-- Abwaertskompatibel: die bisherige Seite funktioniert damit unveraendert weiter.
-- Zustand der Supabase-Datenbank (Projekt "skeison-whitelist"); zur Dokumentation, noch NICHT angewendet.

-- 1) Verknuepfung: Wuensche mit derselben link_id UND demselben Listen-Besitzer gehoeren zusammen.
--    Der Besitzer-Vergleich steckt in private.wl_linked, damit niemand seinen Wunsch an fremde haengen kann.
alter table public.wl_items add column link_id uuid;
create index wl_items_link on public.wl_items (link_id) where link_id is not null;

-- Alle Wuensche, die mit p_item verknuepft sind (einschliesslich p_item selbst)
create function private.wl_linked(p_item uuid) returns setof uuid language sql stable security definer set search_path = '' as $$
  select i2.id
  from public.wl_items i
  join public.wl_lists l on l.id = i.list_id
  join public.wl_items i2 on i2.id = i.id or (i.link_id is not null and i2.link_id = i.link_id)
  join public.wl_lists l2 on l2.id = i2.list_id and l2.owner = l.owner
  where i.id = p_item;
$$;
revoke all on function private.wl_linked(uuid) from public, anon, authenticated;

-- 2) Reservieren: Die Menge wird ueber alle verknuepften Wuensche gezaehlt. Wer schon ueber eine andere Liste
--    reserviert hat, aendert seine bestehende Reservierung (es gibt pro Person und Verknuepfung nur eine).
create or replace function public.wl_reserve(p_item uuid, p_qty int default 1) returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  it record; taken int; ids uuid[]; mine uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  -- Den Wunsch und alle verknuepften Kopien sperren, immer in derselben Reihenfolge: so gehen zwei gleichzeitige
  -- Reservierungen (auch auf verschiedenen Listen) nie beide durch und blockieren sich nicht gegenseitig
  perform 1 from public.wl_items i where i.id in (select private.wl_linked(p_item)) order by i.id for update;
  select i.id, i.list_id, i.quantity, i.group_gift, i.received, i.link_id, l.owner into it
    from public.wl_items i join public.wl_lists l on l.id = i.list_id where i.id = p_item;
  if not found or not private.wl_can_view(it.list_id, me) then raise exception 'no_access'; end if;
  if it.owner = me then raise exception 'own_item'; end if;
  select array_agg(x) into ids from private.wl_linked(p_item) x;
  if exists (select 1 from public.wl_items i where i.id = any(ids) and i.received) then raise exception 'received'; end if;
  if it.group_gift then p_qty := 1; end if;
  if p_qty < 1 or p_qty > it.quantity then raise exception 'bad_quantity'; end if;
  if not it.group_gift then
    select coalesce(sum(quantity), 0) into taken from public.wl_reservations where item_id = any(ids) and user_id <> me;
    if taken + p_qty > it.quantity then raise exception 'already_reserved'; end if;
  end if;
  select r.item_id into mine from public.wl_reservations r where r.item_id = any(ids) and r.user_id = me
    order by (r.item_id = p_item) desc limit 1;
  if mine is not null then
    update public.wl_reservations set quantity = p_qty where item_id = mine and user_id = me;
    delete from public.wl_reservations where item_id = any(ids) and item_id <> mine and user_id = me;
  else
    insert into public.wl_reservations (item_id, user_id, quantity) values (p_item, me, p_qty);
  end if;
end $$;

-- Freigeben und "gekauft" wirken auf die Reservierung der ganzen Verknuepfung
create or replace function public.wl_unreserve(p_item uuid) returns void language sql security definer set search_path = '' as $$
  delete from public.wl_reservations where user_id = auth.uid() and (item_id = p_item or item_id in (select private.wl_linked(p_item)));
$$;
create or replace function public.wl_set_purchased(p_item uuid, p_purchased boolean) returns void language sql security definer set search_path = '' as $$
  update public.wl_reservations set purchased = p_purchased
    where user_id = auth.uid() and (item_id = p_item or item_id in (select private.wl_linked(p_item)));
$$;

-- 3) Reservierungen einer Liste fuer Schenkende: zeigt auch Reservierungen, die ueber eine andere Liste auf einen
--    verknuepften Wunsch gemacht wurden ("linked"). Der Besitzer bekommt weiterhin nichts zurueck.
drop function public.wl_list_reservations(uuid);
create function public.wl_list_reservations(p_list uuid)
returns table (item_id uuid, user_id uuid, name text, quantity smallint, purchased boolean, mine boolean, linked boolean)
language sql stable security definer set search_path = '' as $$
  select i.id, r.user_id, p.name, r.quantity, r.purchased, r.user_id = auth.uid(), r.item_id <> i.id
  from public.wl_items i
  join public.wl_lists l on l.id = i.list_id
  join public.wl_items i2 on i2.id = i.id or (i.link_id is not null and i2.link_id = i.link_id)
  join public.wl_lists l2 on l2.id = i2.list_id and l2.owner = l.owner
  join public.wl_reservations r on r.item_id = i2.id
  join public.wl_profiles p on p.id = r.user_id
  where i.list_id = p_list and l.owner <> auth.uid() and private.wl_can_view(p_list, auth.uid());
$$;
revoke all on function public.wl_list_reservations(uuid) from public, anon;
grant execute on function public.wl_list_reservations(uuid) to authenticated;

-- 4) "Erhalten" gilt fuer alle verknuepften Wuensche (es ist ja dasselbe Geschenk)
create function private.wl_on_item_received() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.wl_items i set received = new.received
    from public.wl_lists l, public.wl_lists mine
    where i.link_id = new.link_id and i.id <> new.id and i.received is distinct from new.received
      and l.id = i.list_id and mine.id = new.list_id and l.owner = mine.owner;
  return null;
end $$;
revoke all on function private.wl_on_item_received() from public, anon, authenticated;
create trigger wl_on_item_received after update of received on public.wl_items for each row
  when (new.link_id is not null and new.received is distinct from old.received) execute function private.wl_on_item_received();

-- 5) Wird ein verknuepfter Wunsch geloescht (auch mit der ganzen Liste), wandern seine Reservierungen auf eine
--    verbleibende Kopie. Sonst waere der Wunsch dort wieder "frei", obwohl ihn schon jemand besorgt.
--    Erst wenn die letzte Kopie verschwindet, gilt wie bisher der Hinweis in "Meine Geschenke" (nur fuer Gekauftes).
create function private.wl_move_reservations(p_from uuid, p_to uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  -- hat dieselbe Person auf beiden Kopien reserviert (Altbestand), bleibt die auf der verbleibenden Kopie
  delete from public.wl_reservations r where r.item_id = p_from
    and exists (select 1 from public.wl_reservations k where k.item_id = p_to and k.user_id = r.user_id);
  update public.wl_reservations set item_id = p_to where item_id = p_from;
end $$;
revoke all on function private.wl_move_reservations(uuid, uuid) from public, anon, authenticated;

create or replace function private.wl_on_item_delete() returns trigger language plpgsql security definer set search_path = '' as $$
declare keep uuid;
begin
  if old.link_id is not null then
    -- (wird die ganze Liste geloescht, ist sie hier schon weg; dann hat wl_on_list_delete bereits umgehaengt)
    select i.id into keep from public.wl_items i
      join public.wl_lists l on l.id = i.list_id
      join public.wl_lists mine on mine.id = old.list_id and mine.owner = l.owner
      where i.link_id = old.link_id and i.id <> old.id
      order by i.created_at, i.id limit 1;
    if keep is not null then
      perform private.wl_move_reservations(old.id, keep);
      return old;
    end if;
  end if;
  if old.received then return old; end if;
  insert into public.wl_orphan_gifts (user_id, title, list_title, owner_name, price, currency, quantity)
    select r.user_id, old.title, coalesce(l.title, ''), coalesce(p.name, ''), old.price, old.currency, r.quantity
    from public.wl_reservations r
    left join public.wl_lists l on l.id = old.list_id
    left join public.wl_profiles p on p.id = l.owner
    where r.item_id = old.id and r.purchased;
  return old;
end $$;

-- Ganze Liste geloescht: Reservierungen ihrer verknuepften Wuensche vorher auf Kopien in anderen Listen umhaengen
create function private.wl_on_list_delete() returns trigger language plpgsql security definer set search_path = '' as $$
declare it record; keep uuid;
begin
  for it in select i.id, i.link_id from public.wl_items i where i.list_id = old.id and i.link_id is not null
      and exists (select 1 from public.wl_reservations r where r.item_id = i.id) loop
    select i.id into keep from public.wl_items i join public.wl_lists l on l.id = i.list_id
      where i.link_id = it.link_id and l.owner = old.owner and l.id <> old.id
      order by i.created_at, i.id limit 1;
    if keep is not null then perform private.wl_move_reservations(it.id, keep); end if;
  end loop;
  return old;
end $$;
revoke all on function private.wl_on_list_delete() from public, anon, authenticated;
create trigger wl_on_list_delete before delete on public.wl_lists for each row execute function private.wl_on_list_delete();

-- 6) Kopieren in andere eigene Listen in einem Schritt (alle Kopien oder keine). Mit p_link = true werden die Kopien
--    mit dem Original verknuepft; steht derselbe Wunsch (gleiche Verknuepfung) schon auf einer Zielliste, wird er
--    dort nicht noch einmal angelegt. Liefert die Zahl der neu angelegten Wuensche.
create function public.wl_copy_item(p_item uuid, p_lists uuid[], p_link boolean default true) returns integer
language plpgsql security definer set search_path = '' as $$
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
  insert into public.wl_items (list_id, title, url, image_url, price, currency, note, category, priority, quantity, group_gift, received, link_id)
    select l.id, src.title, src.url, src.image_url, src.price, src.currency, src.note, src.category, src.priority, src.quantity, src.group_gift,
      case when p_link then src.received else false end, case when p_link then lid end
    from public.wl_lists l
    where l.owner = me and l.id = any(coalesce(p_lists, '{}')) and l.id <> src.list_id
      and not (p_link and exists (select 1 from public.wl_items x where x.list_id = l.id and x.link_id = lid));
  get diagnostics n = row_count;
  return n;
end $$;

-- 7) Zwei eigene Wuensche nachtraeglich verknuepfen (z. B. frueher kopierte) bzw. eine Verknuepfung loesen.
--    Beim Verknuepfen verschmelzen bestehende Verknuepfungen beider Seiten; beim Loesen bleiben Reservierungen
--    auf dem Wunsch, auf dem sie gemacht wurden.
create function public.wl_link_items(p_a uuid, p_b uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); a public.wl_items; b public.wl_items; lid uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_a = p_b then raise exception 'no_access'; end if;
  select * into a from public.wl_items where id = p_a;
  if not found or not private.wl_owns_list(a.list_id) then raise exception 'no_access'; end if;
  select * into b from public.wl_items where id = p_b;
  if not found or not private.wl_owns_list(b.list_id) then raise exception 'no_access'; end if;
  lid := coalesce(a.link_id, b.link_id, gen_random_uuid());
  update public.wl_items i set link_id = lid from public.wl_lists l
    where l.id = i.list_id and l.owner = me and i.link_id is distinct from lid
      and (i.id in (p_a, p_b) or i.link_id in (a.link_id, b.link_id));
  -- ist einer davon schon erhalten, gilt das fuer alle
  if exists (select 1 from public.wl_items i join public.wl_lists l on l.id = i.list_id where l.owner = me and i.link_id = lid and i.received) then
    update public.wl_items i set received = true from public.wl_lists l where l.id = i.list_id and l.owner = me and i.link_id = lid and not i.received;
  end if;
  return lid;
end $$;

create function public.wl_unlink_item(p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); it public.wl_items; rest integer;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select * into it from public.wl_items where id = p_item;
  if not found or not private.wl_owns_list(it.list_id) then raise exception 'no_access'; end if;
  if it.link_id is null then return; end if;
  update public.wl_items set link_id = null where id = p_item;
  -- bleibt nur ein einzelner Wunsch uebrig, ist auch dessen Verknuepfung gegenstandslos
  select count(*) into rest from public.wl_items i join public.wl_lists l on l.id = i.list_id where l.owner = me and i.link_id = it.link_id;
  if rest = 1 then
    update public.wl_items i set link_id = null from public.wl_lists l where l.id = i.list_id and l.owner = me and i.link_id = it.link_id;
  end if;
end $$;

revoke all on function public.wl_copy_item(uuid, uuid[], boolean), public.wl_link_items(uuid, uuid), public.wl_unlink_item(uuid) from public, anon;
grant execute on function public.wl_copy_item(uuid, uuid[], boolean), public.wl_link_items(uuid, uuid), public.wl_unlink_item(uuid) to authenticated;
