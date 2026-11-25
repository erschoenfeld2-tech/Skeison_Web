-- Launcher-Reiter: ein eigener Reiter kann statt eines einzelnen Spiels einen ganzen Launcher zeigen
-- (Epic Games, Battle.net, EA App, Ubisoft Connect, GOG, Xbox …) mit den Spielen, die man dort hat.
-- launcher: true = Launcher-Reiter (platform ist dann der Launcher, name die Ueberschrift)
-- games: [{ n: Name, a: Steam-appid (nur fuer das Cover, optional), h: Stunden (optional), i: Bild-Link (optional) }]
-- hours des Reiters = Summe der Spielzeiten (setzt die Seite beim Speichern), damit Statistik und Ausstellung mitzaehlen.
-- Abwaertskompatibel: neue Spalten mit Standardwert; gp_view und gp_games liefern sie zusaetzlich aus.

alter table public.gp_custom_games add column games jsonb not null default '[]'
  check (jsonb_typeof(games) = 'array' and jsonb_array_length(games) <= 300 and octet_length(games::text) <= 60000);
alter table public.gp_custom_games add column launcher boolean not null default false;

-- gp_view und gp_games: nur die neuen Felder ergaenzen, der Rest der Funktionen bleibt wie er ist
do $$
declare f oid; d text;
begin
  select p.oid into f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'gp_view';
  d := pg_get_functiondef(f);
  if position('''games'', g.games' in d) = 0 then
    d := replace(d, '''hours'', g.hours, ''stats'', g.stats', '''hours'', g.hours, ''games'', g.games, ''launcher'', g.launcher, ''stats'', g.stats');
    execute d;
  end if;
  select p.oid into f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'gp_games';
  d := pg_get_functiondef(f);
  if position('''games'', c.games' in d) = 0 then
    d := replace(d, 'jsonb_build_object(''name'', c.name, ''appid'', c.appid, ''hours'', c.hours)',
      'jsonb_build_object(''name'', c.name, ''appid'', c.appid, ''hours'', c.hours, ''platform'', c.platform, ''games'', c.games, ''launcher'', c.launcher)');
    execute d;
  end if;
end $$;
