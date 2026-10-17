-- Zustand der Supabase-Datenbank (Projekt "skeison-whitelist"); zur Dokumentation, bereits angewendet.
-- Oeffentlich ist nur INSERT erlaubt. Lesen/Aendern nur mit service_role (Dashboard, Admin-Skript).
create extension if not exists pg_net with schema extensions;

create table public.whitelist_applications (
  id bigint generated always as identity primary key,
  minecraft_name text not null check (minecraft_name ~ '^[A-Za-z0-9_]{3,16}$'),
  discord_name text not null check (char_length(discord_name) between 2 and 32),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
create unique index whitelist_pending_name on public.whitelist_applications (lower(minecraft_name)) where status = 'pending';
alter table public.whitelist_applications enable row level security;
create policy "anon darf bewerben" on public.whitelist_applications for insert to anon with check (status = 'pending');

-- Geheimnis zwischen Trigger und Edge Function (Wert wird in der Datenbank erzeugt, nicht im Repo).
create table public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
insert into public.app_config values ('webhook_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

create schema if not exists private;
revoke all on schema private from anon, authenticated;
create function private.notify_application() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://pumdupjmmvimlxqvuymg.supabase.co/functions/v1/notify-application',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-webhook-secret', (select value from public.app_config where key = 'webhook_secret')),
    body := jsonb_build_object('minecraft_name', new.minecraft_name, 'discord_name', new.discord_name, 'id', new.id));
  return new;
exception when others then
  return new;
end $$;
revoke all on function private.notify_application() from public, anon, authenticated;
create trigger whitelist_notify after insert on public.whitelist_applications for each row execute function private.notify_application();
