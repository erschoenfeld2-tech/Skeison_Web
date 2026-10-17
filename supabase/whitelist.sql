-- Whitelist-Bewerbungen: oeffentlich nur Einfuegen, Lesen nur mit Admin-Zugang.
create table public.whitelist_applications (
  id bigint generated always as identity primary key,
  minecraft_name text not null check (minecraft_name ~ '^[A-Za-z0-9_]{3,16}$'),
  discord_name text not null check (char_length(discord_name) between 2 and 32),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
create unique index whitelist_pending_name on public.whitelist_applications (lower(minecraft_name)) where status = 'pending';
alter table public.whitelist_applications enable row level security;
create policy "anon darf bewerben" on public.whitelist_applications
  for insert to anon with check (status = 'pending');
-- Keine select/update/delete-Policy fuer anon: Lesen nur ueber service_role bzw. Dashboard.
