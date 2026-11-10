-- Wunschliste: Listen ausblenden ("nicht mehr ankuendigen"), pro Konto statt nur pro Geraet.
-- Ausgeblendete Listen erscheinen nicht mehr unter "Aktuelle Listen", "Bald anstehend" und in den Erinnerungen der App,
-- bleiben aber ganz normal ueber "Meine Listen", "Listen deiner Freunde" und das Freundesprofil erreichbar.
-- Zustand der Supabase-Datenbank (Projekt "skeison-whitelist"); zur Dokumentation, bereits angewendet.

create table public.wl_hidden_lists (
  user_id uuid not null default auth.uid() references public.wl_profiles on delete cascade,
  list_id uuid not null references public.wl_lists on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, list_id)
);
alter table public.wl_hidden_lists enable row level security;
revoke all on public.wl_hidden_lists from anon, authenticated;
grant select, insert, delete on public.wl_hidden_lists to authenticated;
create policy "Ausgeblendete Listen: nur eigene lesen" on public.wl_hidden_lists for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Ausgeblendete Listen: nur sichtbare Listen ausblenden" on public.wl_hidden_lists for insert to authenticated
  with check (user_id = (select auth.uid()) and private.wl_can_view(list_id, (select auth.uid())));
create policy "Ausgeblendete Listen: nur eigene wieder einblenden" on public.wl_hidden_lists for delete to authenticated
  using (user_id = (select auth.uid()));
