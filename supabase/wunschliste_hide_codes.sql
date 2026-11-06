-- Wunschliste: Freundescodes (#CODE) nur noch fuer sich selbst lesbar, damit man Leute nicht einfach weitergeben kann.
-- Zustand der Supabase-Datenbank (Projekt "skeison-whitelist"); zur Dokumentation.
-- WICHTIG: erst einspielen, wenn die neue Seite (ohne select=* auf wl_profiles) live ist, sonst laedt die alte Seite nicht.
-- Die eigene Nummer liefert public.wl_my_code(), Admins sehen Codes weiter ueber wl_admin_users.

revoke select on public.wl_profiles from authenticated;
grant select (id, name, avatar, color, theme, discoverable, must_change_password, created_at) on public.wl_profiles to authenticated;
