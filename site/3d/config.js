// Verbindung der Seite zum 3D-Druck (Einrichtung in 3d-server/SERVER-SETUP.md).
// api "supabase": Auftraege gehen ueber Supabase (supabase/druck3d.sql) an den Server-PC (3d-server/worker.py).
// Der Schluessel ist der oeffentliche (publishable) wie bei der Wunschliste; er darf nur die p3d_-Funktionen aufrufen.
// Lokal ueberschreibt 3d-server/app.py diese Datei mit api "" (gleicher Server wie die Seite).
window.SKEISON_3D = {
  api: "supabase",
  url: "https://pumdupjmmvimlxqvuymg.supabase.co",
  key: "sb_publishable_VcunJmqIHajV3s2gfUMWSQ_MlIpmkas",
};
