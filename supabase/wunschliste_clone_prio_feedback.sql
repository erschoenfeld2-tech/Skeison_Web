-- Wunschliste: ganze Listen klonen bzw. den Inhalt einer Liste kopieren, Gliederung nach Wichtigkeit, Feedback.
-- Abwaertskompatibel: die bisherige Seite funktioniert damit unveraendert weiter (nur neue Spalte, Tabelle und Funktionen).
-- Zustand der Supabase-Datenbank (Projekt "skeison-whitelist"); zur Dokumentation, am 11.11.2026 angewendet
-- (Migration wunschliste_clone_prio_feedback).

-- 1) Gliederung nach Wichtigkeit: Der Besitzer kann pro Liste einschalten, dass die Wuensche in Abschnitten
--    "Herzenswuensche / Wuensche ich mir / Waere nett" erscheinen (fuer alle, die die Liste sehen).
alter table public.wl_lists add column prio_sections boolean not null default false;

-- 2) Inhalt einer Liste vollstaendig in eine andere eigene Liste kopieren (alle Wuensche oder keiner).
--    Quelle ist eine eigene Liste oder eine, die man sehen darf (Liste eines Freundes).
--    Eigene Quelle: mit p_link = true werden die Kopien mit dem Original verknuepft (zaehlen beim Reservieren als ein
--    Wunsch); was auf der Zielliste schon verknuepft steht, wird nicht noch einmal angelegt.
--    Fremde Quelle: nie verknuepft, ohne die Notiz "Wofuer", ohne "Erhalten", Wichtigkeit normal (wie beim einzelnen Uebernehmen).
--    Reservierungen werden nie mitkopiert. Liefert die Zahl der neu angelegten Wuensche.
create function private.wl_copy_items(p_from uuid, p_to uuid, p_link boolean) returns integer
language plpgsql security definer set search_path = '' as $$
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
    insert into public.wl_items (list_id, title, url, image_url, price, currency, note, category, priority, quantity, group_gift, received, link_id, created_at)
      select p_to, s.title, s.url, s.image_url, s.price, s.currency, s.note, s.category, s.priority, s.quantity, s.group_gift, s.received, s.link_id,
        now() + (row_number() over (order by s.created_at, s.id)) * interval '1 microsecond'
      from public.wl_items s
      where s.list_id = p_from and not exists (select 1 from public.wl_items x where x.list_id = p_to and x.link_id = s.link_id);
  else
    insert into public.wl_items (list_id, title, url, image_url, price, currency, note, category, priority, quantity, group_gift, created_at)
      select p_to, s.title, s.url, s.image_url, s.price, s.currency, case when own then s.note else '' end, s.category,
        case when own then s.priority else 2 end, s.quantity, s.group_gift,
        now() + (row_number() over (order by s.created_at, s.id)) * interval '1 microsecond'
      from public.wl_items s where s.list_id = p_from;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.wl_copy_items(uuid, uuid, boolean) from public, anon, authenticated;

create function public.wl_copy_list_items(p_from uuid, p_to uuid, p_link boolean default true) returns integer
language sql security definer set search_path = '' as $$
  select private.wl_copy_items(p_from, p_to, p_link);
$$;
revoke all on function public.wl_copy_list_items(uuid, uuid, boolean) from public, anon;
grant execute on function public.wl_copy_list_items(uuid, uuid, boolean) to authenticated;

-- 3) Ganze Liste klonen: neue eigene Liste mit Design, Anlass, Datum und Beschreibung der Vorlage und allen Wuenschen.
--    p_share = true uebernimmt bei einer eigenen Vorlage auch die Freigabe (Sichtbarkeit, Gruppen, Personen);
--    sonst (und bei fremden Vorlagen immer) ist der Klon privat. Liefert die neue Liste.
create function public.wl_clone_list(p_list uuid, p_title text default null, p_link boolean default true, p_share boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); src public.wl_lists; own boolean; new_id uuid; t text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select l.* into src from public.wl_lists l where l.id = p_list;
  if not found then raise exception 'no_access'; end if;
  own := src.owner = me;
  if not (own or private.wl_can_view(p_list, me)) then raise exception 'no_access'; end if;
  if (select count(*) from public.wl_lists l where l.owner = me) >= 200 then raise exception 'too_many'; end if;
  t := left(coalesce(nullif(btrim(p_title), ''), src.title || ' (Kopie)'), 60);
  insert into public.wl_lists (owner, title, description, emoji, theme, occasion, event_date, visibility, prio_sections)
    values (me, t, case when own then src.description else '' end, src.emoji, src.theme, src.occasion, src.event_date,
      case when own and p_share then src.visibility else 'private' end, src.prio_sections)
    returning id into new_id;
  if own and p_share then
    insert into public.wl_list_groups (list_id, group_id) select new_id, g.group_id from public.wl_list_groups g where g.list_id = p_list;
    insert into public.wl_list_people (list_id, person) select new_id, p.person from public.wl_list_people p where p.list_id = p_list;
  end if;
  perform private.wl_copy_items(p_list, new_id, p_link);
  return new_id;
end $$;
revoke all on function public.wl_clone_list(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.wl_clone_list(uuid, text, boolean, boolean) to authenticated;

-- 4) Feedback: Verbesserungsvorschlaege, Fehler und Lob aus der Wunschliste (Seite ./?seite=feedback).
--    Geschrieben wird nur ueber wl_send_feedback (Bremse: hoechstens 10 in 24 Stunden). Jeder sieht nur das eigene
--    Feedback samt Status und Antwort; Admins sehen alles und setzen Status/Antwort ueber wl_feedback_update.
--    Bleibt bestehen, wenn das Konto geloescht wird (user_id wird dann leer, der Name bleibt als Text).
create table public.wl_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.wl_profiles on delete set null,
  user_name text not null default '',
  kind text not null default 'idee' check (kind in ('idee', 'fehler', 'lob', 'sonstiges')),
  message text not null check (char_length(btrim(message)) between 5 and 2000),
  page text not null default '' check (char_length(page) <= 80),
  device text not null default '' check (char_length(device) <= 300),
  status text not null default 'neu' check (status in ('neu', 'geplant', 'erledigt', 'abgelehnt')),
  reply text not null default '' check (char_length(reply) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index wl_feedback_user on public.wl_feedback (user_id);
create index wl_feedback_open on public.wl_feedback (created_at desc) where status = 'neu';
alter table public.wl_feedback enable row level security;
revoke all on public.wl_feedback from anon, authenticated;
grant select, delete on public.wl_feedback to authenticated;
create policy "Feedback: eigenes lesen, Admins alles" on public.wl_feedback for select to authenticated
  using (user_id = (select auth.uid()) or (select private.wl_is_admin()));
create policy "Feedback: eigenes loeschen, Admins alles" on public.wl_feedback for delete to authenticated
  using (user_id = (select auth.uid()) or (select private.wl_is_admin()));

create function public.wl_send_feedback(p_kind text, p_message text, p_page text default '', p_device text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); new_id uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if char_length(btrim(coalesce(p_message, ''))) < 5 then raise exception 'too_short'; end if;
  if (select count(*) from public.wl_feedback f where f.user_id = me and f.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'rate_limited';
  end if;
  insert into public.wl_feedback (user_id, user_name, kind, message, page, device)
    select me, p.name, case when p_kind in ('idee', 'fehler', 'lob', 'sonstiges') then p_kind else 'sonstiges' end,
      left(btrim(p_message), 2000), left(coalesce(p_page, ''), 80), left(coalesce(p_device, ''), 300)
    from public.wl_profiles p where p.id = me
    returning id into new_id;
  if new_id is null then raise exception 'no_profile'; end if;
  return new_id;
end $$;
revoke all on function public.wl_send_feedback(text, text, text, text) from public, anon;
grant execute on function public.wl_send_feedback(text, text, text, text) to authenticated;

create function public.wl_feedback_update(p_id uuid, p_status text, p_reply text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.wl_is_admin() then raise exception 'not_admin'; end if;
  update public.wl_feedback set status = p_status, reply = coalesce(left(p_reply, 1000), reply), updated_at = now() where id = p_id;
  if not found then raise exception 'not_found'; end if;
end $$;
revoke all on function public.wl_feedback_update(uuid, text, text) from public, anon;
grant execute on function public.wl_feedback_update(uuid, text, text) to authenticated;

-- 5) Vorschau einer per Link geteilten Liste (ohne Anmeldung): liefert zusaetzlich prio_sections, damit auch die
--    Vorschau nach Wichtigkeit gegliedert erscheint (Migration wunschliste_preview_prio_sections).
create or replace function public.wl_preview(p_token text) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'list', jsonb_build_object('title', l.title, 'description', l.description, 'emoji', l.emoji, 'theme', l.theme,
      'occasion', l.occasion, 'event_date', l.event_date, 'prio_sections', l.prio_sections),
    'owner', jsonb_build_object('name', p.name, 'avatar', p.avatar, 'color', p.color),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'url', i.url, 'image_url', i.image_url,
        'price', i.price, 'currency', i.currency, 'note', i.note, 'priority', i.priority, 'quantity', i.quantity,
        'group_gift', i.group_gift, 'received', i.received, 'category', i.category) order by i.priority desc, i.created_at) from public.wl_items i where i.list_id = l.id), '[]'::jsonb))
  from public.wl_share_links s
  join public.wl_lists l on l.id = s.list_id
  join public.wl_profiles p on p.id = l.owner
  where s.token = p_token and l.visibility <> 'private' and not l.archived;
$$;
