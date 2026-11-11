package de.skeison.wunschliste;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Update der App direkt in der App: Die neue Version wird im Hintergrund geladen (Fortschritt im Dialog) und ueber
 * den Installer von Android eingespielt. Niemand muss dafuer in den Browser, eine Datei suchen oder oeffnen.
 * - Beim ersten Mal fragt Android einmal, ob diese App Updates installieren darf (ein Schalter), danach genuegt
 *   ein Tipp auf "Aktualisieren". Ab Android 12 laufen spaetere Updates ohne weitere Rueckfrage durch, weil die App
 *   sich dann selbst als Quelle eingetragen hat (USER_ACTION_NOT_REQUIRED).
 * - Android installiert nur, was mit demselben Schluessel signiert ist; zusaetzlich wird vorab geprueft, dass die
 *   Datei wirklich eine neuere Version dieser App ist.
 * - Klappt etwas nicht (kein Netz, kein Platz, abgelehnt), bleibt der bisherige Weg: Download im Browser.
 */
final class Updater {

    static final String ACTION_STATUS = "de.skeison.wunschliste.UPDATE_STATUS";
    private static boolean running;

    private Updater() { }

    /** Hinweis auf die neue Version mit einem einzigen grossen Knopf. */
    static void offer(Activity a, int latest, String fallbackUrl) {
        if (a.isFinishing() || a.isDestroyed() || running) return;
        new AlertDialog.Builder(a)
                .setTitle("Update für die Wunschliste")
                .setMessage("Es gibt eine neue Version der App (1." + latest + ").\n\n"
                        + "Tippe auf „Jetzt aktualisieren“. Die App lädt das Update selbst und startet danach neu. "
                        + "Deine Wünsche und Listen bleiben erhalten.")
                .setPositiveButton("Jetzt aktualisieren", (d, w) -> start(a, fallbackUrl))
                .setNegativeButton("Später", null)
                .show();
    }

    private static void start(Activity a, String fallbackUrl) {
        if (running) return;
        running = true;
        final Handler ui = new Handler(Looper.getMainLooper());
        int pad = Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 24, a.getResources().getDisplayMetrics()));
        LinearLayout box = new LinearLayout(a);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad / 2, pad, pad / 2);
        final TextView text = new TextView(a);
        text.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        text.setText("Update wird geladen …");
        final ProgressBar bar = new ProgressBar(a, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setIndeterminate(true);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = pad / 2;
        box.addView(text);
        box.addView(bar, lp);
        box.setGravity(Gravity.CENTER_VERTICAL);
        final AlertDialog dlg = new AlertDialog.Builder(a).setTitle("Wunschliste wird aktualisiert").setView(box).setCancelable(false).show();

        new Thread(() -> {
            String error = null;
            try {
                File dir = new File(a.getCacheDir(), "update");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                File apk = new File(dir, "Wunschliste.apk");
                download(fallbackUrl, apk, (done, total) -> ui.post(() -> {
                    if (total > 0) {
                        bar.setIndeterminate(false);
                        bar.setProgress((int) (done * 100 / total));
                        text.setText("Update wird geladen … " + (done * 100 / total) + " %");
                    }
                }));
                PackageInfo pi = a.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
                if (pi == null || !a.getPackageName().equals(pi.packageName)) throw new IllegalStateException("Datei passt nicht zur App");
                long code = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
                if (code <= BuildConfig.VERSION_CODE) throw new IllegalStateException("keine neuere Version");
                ui.post(() -> { bar.setIndeterminate(true); text.setText("Fast fertig. Bestätige gleich „Aktualisieren“, falls Android nachfragt."); });
                install(a, apk);
            } catch (Exception e) {
                error = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            }
            final String err = error;
            ui.post(() -> {
                running = false;
                if (err == null) {
                    // Android uebernimmt: entweder kommt die Rueckfrage "Aktualisieren?" oder die App startet von selbst neu
                    ui.postDelayed(() -> { try { dlg.dismiss(); } catch (Exception ignored) { } }, 20000);
                    return;
                }
                try { dlg.dismiss(); } catch (Exception ignored) { }
                if (a.isFinishing() || a.isDestroyed()) return;
                new AlertDialog.Builder(a)
                        .setTitle("Das hat nicht geklappt")
                        .setMessage("Das Update konnte nicht geladen werden. Prüfe deine Internetverbindung und versuche es später noch einmal.\n\n"
                                + "Die App funktioniert wie gewohnt weiter.")
                        .setPositiveButton("OK", null)
                        .setNeutralButton("Im Browser laden", (d, w) -> {
                            try { a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(fallbackUrl))); } catch (Exception ignored) { }
                        })
                        .show();
            });
        }).start();
    }

    interface Progress { void at(long done, long total); }

    private static void download(String url, File to, Progress p) throws Exception {
        HttpURLConnection c = null;
        try {
            // GitHub leitet auf den Dateispeicher weiter; Weiterleitungen (nur https) werden von Hand verfolgt
            for (int hop = 0; ; hop++) {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                c.setInstanceFollowRedirects(false);
                c.setRequestProperty("User-Agent", "SkeisonWunschlisteApp");
                int code = c.getResponseCode();
                if (code >= 300 && code < 400 && hop < 5) {
                    String next = c.getHeaderField("Location");
                    c.disconnect();
                    if (next == null || !next.startsWith("https://")) throw new IllegalStateException("Weiterleitung abgelehnt");
                    url = next;
                    continue;
                }
                if (code != 200) throw new IllegalStateException("Server antwortet " + code);
                break;
            }
            long total = c.getContentLength(), done = 0, lastShown = 0;
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(to)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    done += n;
                    if (done - lastShown > 200_000) { lastShown = done; p.at(done, total); }
                }
            }
            if (done < 100_000 || (total > 0 && done != total)) throw new IllegalStateException("Download unvollständig");
            p.at(done, done);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static void install(Context c, File apk) throws Exception {
        PackageInstaller installer = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(c.getPackageName());
        params.setSize(apk.length());
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("Wunschliste.apk", 0, apk.length())) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                session.fsync(out);
            }
            Intent status = new Intent(c, UpdateReceiver.class).setAction(ACTION_STATUS);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            session.commit(PendingIntent.getBroadcast(c, id, status, flags).getIntentSender());
        }
    }

    /** Reste eines frueheren Updates entfernen (die geladene Datei wird nach der Installation nicht mehr gebraucht). */
    static void cleanUp(Context c) {
        File[] files = new File(c.getCacheDir(), "update").listFiles();
        if (files != null) for (File f : files) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }
}
