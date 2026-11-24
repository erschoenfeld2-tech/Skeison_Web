-- Gaming-Profile: Spotify als verknuepfbares Konto (nach gaming_ausbau.sql eingespielt).
-- Zustand der Supabase-Datenbank (Projekt "skeison-whitelist"); zur Dokumentation, bereits angewendet.
-- Nur die erlaubten Arten in gp_accounts.kind werden erweitert, alte Seiten sind nicht betroffen.
alter table public.gp_accounts drop constraint if exists gp_accounts_kind_check;
alter table public.gp_accounts add constraint gp_accounts_kind_check check (kind ~ ('^(valorant|steam|minecraft|discord|epic|xbox|playstation|nintendo|battlenet|ea|ubisoft|lol|twitch|youtube|tiktok'
  || '|instagram|hoyoverse|roblox|gog|rockstar|x|reddit|kick|snapchat|spotify)(-[2-5])?$'));
