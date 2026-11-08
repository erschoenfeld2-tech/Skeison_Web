-- Wunschliste: Freundschaft per Link oder QR-Code (ohne den #CODE kennen zu muessen).
-- Zustand der Supabase-Datenbank (Projekt "skeison-whitelist"); zur Dokumentation, bereits angewendet. Setzt wunschliste_fixes.sql voraus.
-- Ablauf: Jeder kann einen persoenlichen Einladungslink erzeugen, erneuern (der alte gilt dann nicht mehr) oder abschalten.
-- Wer ihn oeffnet, sieht ohne Anmeldung nur Name und Avatar (wl_friend_link_preview). Angemeldet bestaetigt man die
-- Freundschaft mit einem Klick (wl_friend_link_redeem); nur das Oeffnen des Links befreundet niemanden.
-- Wer vom Link-Besitzer entfernt wurde, kommt ueber den Link nicht wieder hinein (wl_unfriended).

create table public.wl_friend_links (
  owner uuid primary key references public.wl_profiles on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
alter table public.wl_friend_links enable row level security;
revoke all on public.wl_friend_links from anon, authenticated;
grant select on public.wl_friend_links to authenticated;
create policy "Einladungslinks: nur eigener" on public.wl_friend_links for select to authenticated using (owner = (select auth.uid()));

-- Eigenen Link anlegen (oder den bestehenden zurueckgeben); p_reset erzeugt einen neuen, der alte wird ungueltig
create function public.wl_friend_link_enable(p_reset boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); t text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_reset then delete from public.wl_friend_links where owner = me; end if;
  insert into public.wl_friend_links (owner) values (me) on conflict (owner) do nothing;
  select token into t from public.wl_friend_links where owner = me;
  return t;
end $$;

create function public.wl_friend_link_disable() returns void language sql security definer set search_path = '' as $$
  delete from public.wl_friend_links where owner = auth.uid();
$$;

-- Vorschau (auch ohne Anmeldung): nur Name, Avatar, Farbe, Design; angemeldet zusaetzlich der Stand der Verbindung
create function public.wl_friend_link_preview(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'avatar', p.avatar, 'color', p.color, 'theme', p.theme,
    'status', case
      when auth.uid() is null then null
      when auth.uid() = p.id then 'self'
      when private.wl_are_friends(p.id, auth.uid()) and private.wl_is_friend_level(p.id, auth.uid())
        and private.wl_is_friend_level(auth.uid(), p.id) then 'friends'
      when private.wl_are_friends(p.id, auth.uid()) then 'known'
      else 'none' end)
  from public.wl_friend_links k join public.wl_profiles p on p.id = k.owner
  where k.token = p_token;
$$;

-- Einloesen (angemeldet, nach Klick): Freundschaft herstellen bzw. offene Anfrage annehmen und beide Seiten auf
-- Stufe Freund setzen (wer den Link weitergibt, laedt zur Freundschaft ein); liefert die ID des Link-Besitzers
create function public.wl_friend_link_redeem(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); o uuid; f public.wl_friendships;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select owner into o from public.wl_friend_links where token = p_token;
  if o is null then raise exception 'no_access'; end if;
  if o = me then return o; end if;
  if exists (select 1 from public.wl_unfriended u where u.owner = o and u.person = me) then raise exception 'no_access'; end if;
  -- Ich entscheide mich bewusst fuer diese Person: eine eigene fruehere Sperre faellt weg
  delete from public.wl_unfriended where owner = me and person = o;
  select * into f from public.wl_friendships
    where (requester = me and addressee = o) or (requester = o and addressee = me);
  if not found then
    insert into public.wl_friendships (requester, addressee, status) values (o, me, 'accepted');
  elsif f.status = 'pending' then
    update public.wl_friendships set status = 'accepted' where requester = f.requester and addressee = f.addressee;
  end if;
  delete from public.wl_trust where (owner = o and person = me) or (owner = me and person = o);
  return o;
end $$;

revoke all on function public.wl_friend_link_enable(boolean), public.wl_friend_link_disable(), public.wl_friend_link_preview(text),
  public.wl_friend_link_redeem(text) from public, anon;
grant execute on function public.wl_friend_link_enable(boolean), public.wl_friend_link_disable(), public.wl_friend_link_redeem(text) to authenticated;
grant execute on function public.wl_friend_link_preview(text) to anon, authenticated;
