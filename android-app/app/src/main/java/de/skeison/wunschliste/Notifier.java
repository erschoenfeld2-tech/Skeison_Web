package de.skeison.wunschliste;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.time.temporal.IsoFields;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * Erinnerungen der Wunschliste. Die Webseite schickt bei jedem Oeffnen eine Zusammenfassung (Anlaesse mit ihren Listen
 * und offenen Geschenken, siehe syncNotifications in site/wunschliste/app.js). Daraus entstehen hier, auch bei
 * geschlossener App, die Benachrichtigungen:
 *  - Anlass: 7 Tage vorher, am Vortag und am Tag selbst; alle Listen desselben Datums in EINER Nachricht
 *  - Zu besorgen: 14 und 3 Tage vorher, solange reservierte Geschenke noch nicht gekauft sind
 *  - Geschenke ohne Datum: hoechstens einmal pro Woche
 * Nachts (21 bis 8 Uhr) wird nichts gezeigt. Jede Stufe erscheint nur einmal.
 */
final class Notifier {
    static final String CH_EVENTS = "anlaesse", CH_BUY = "besorgen";
    private static final String PREFS = "erinnerungen", K_SNAP = "snapshot", K_SENT = "sent", K_USER = "user";

    private Notifier() { }

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static void saveSnapshot(Context c, JSONObject snap) {
        SharedPreferences p = prefs(c);
        SharedPreferences.Editor e = p.edit().putString(K_SNAP, snap.toString());
        String user = snap.optString("user");
        if (!user.equals(p.getString(K_USER, ""))) e.putString(K_USER, user).remove(K_SENT);   // anderes Konto: neu anfangen
        e.apply();
    }

    static void clear(Context c) {
        prefs(c).edit().clear().apply();
        NotificationManagerCompat.from(c).cancelAll();
    }

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel ev = new NotificationChannel(CH_EVENTS, "Anlässe", NotificationManager.IMPORTANCE_DEFAULT);
        ev.setDescription("Erinnerungen, wenn Listen deiner Freunde bald ihren Anlass haben (z. B. Weihnachten oder ein Geburtstag)");
        NotificationChannel buy = new NotificationChannel(CH_BUY, "Zu besorgen", NotificationManager.IMPORTANCE_DEFAULT);
        buy.setDescription("Erinnerungen an reservierte Geschenke, die du noch kaufen musst");
        nm.createNotificationChannel(ev);
        nm.createNotificationChannel(buy);
    }

    /** Regelmaessige Pruefung (alle 3 Stunden) und auf Wunsch eine baldige, z. B. nach neuen Daten. */
    static void schedule(Context c, boolean soon) {
        WorkManager wm = WorkManager.getInstance(c);
        wm.enqueueUniquePeriodicWork("erinnerungen", ExistingPeriodicWorkPolicy.KEEP,
                new PeriodicWorkRequest.Builder(ReminderWorker.class, 3, TimeUnit.HOURS).build());
        if (soon) {
            wm.enqueueUniqueWork("erinnerungen-jetzt", ExistingWorkPolicy.REPLACE,
                    new OneTimeWorkRequest.Builder(ReminderWorker.class)
                            .setInitialDelay(BuildConfig.DEBUG ? 5 : 60, TimeUnit.SECONDS).build());
        }
    }

    static void run(Context c) {
        SharedPreferences p = prefs(c);
        String raw = p.getString(K_SNAP, null);
        if (raw == null) return;
        int hour = LocalTime.now().getHour();
        if (!BuildConfig.DEBUG && (hour < 8 || hour >= 21)) return;
        NotificationManagerCompat nm = NotificationManagerCompat.from(c);
        if (!nm.areNotificationsEnabled()) return;
        ensureChannels(c);

        JSONObject snap;
        try { snap = new JSONObject(raw); } catch (Exception e) { return; }
        LocalDate today = LocalDate.now();
        Set<String> sent = new HashSet<>(p.getStringSet(K_SENT, new HashSet<>()));
        JSONArray groups = snap.optJSONArray("groups");
        for (int i = 0; groups != null && i < groups.length(); i++) {
            JSONObject g = groups.optJSONObject(i);
            if (g == null) continue;
            LocalDate date;
            try { date = LocalDate.parse(g.optString("date")); } catch (Exception e) { continue; }
            long d = ChronoUnit.DAYS.between(today, date);
            if (d < 0) continue;
            JSONArray lists = g.optJSONArray("lists");
            int open = g.optInt("open");
            boolean posted = false;
            int evTier = d == 0 ? 0 : d == 1 ? 1 : d <= 7 ? 7 : -1;
            if (evTier >= 0 && lists != null && lists.length() > 0) {
                String key = "evt:" + date + ":" + evTier;
                if (!sent.contains(key) && postEvent(c, nm, g, d)) { sent.add(key); posted = true; }
            }
            int buyTier = d <= 3 ? 3 : d <= 14 ? 14 : -1;
            if (open > 0 && buyTier >= 0) {
                String key = "buy:" + date + ":" + buyTier;
                // Wurde gerade an den Anlass erinnert, stehen die offenen Geschenke schon darin
                if (!sent.contains(key) && (posted || postBuy(c, nm, g, d))) sent.add(key);
            }
        }
        int undated = snap.optInt("undated");
        String week = "buy:none:" + today.get(IsoFields.WEEK_BASED_YEAR) + "-" + today.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR);
        if (undated > 0 && !sent.contains(week) && postUndated(c, nm, undated)) sent.add(week);

        // Alte Eintraege entfernen
        Set<String> keep = new HashSet<>();
        for (String k : sent) {
            String[] parts = k.split(":");
            if (parts.length < 3) continue;
            if ("none".equals(parts[1])) { if (k.equals(week)) keep.add(k); continue; }
            try { if (!LocalDate.parse(parts[1]).isBefore(today.minusDays(1))) keep.add(k); } catch (Exception ignored) { }
        }
        p.edit().putStringSet(K_SENT, keep).apply();
    }

    // ------------------------------------------------------------------ Nachrichten

    private static String when(long d) { return d == 0 ? "heute" : d == 1 ? "morgen" : "in " + d + " Tagen"; }
    private static String gifts(int n) { return n == 1 ? "1 Geschenk" : n + " Geschenke"; }

    private static boolean postEvent(Context c, NotificationManagerCompat nm, JSONObject g, long d) {
        String name = g.optString("name"), emoji = g.optString("emoji", "🎁");
        JSONArray lists = g.optJSONArray("lists");
        int open = g.optInt("open");
        String title = emoji + " " + (d == 0 ? "Heute: " + name : name + " " + (d == 1 ? "ist morgen" : "in " + d + " Tagen"));
        List<String> owners = new ArrayList<>();
        NotificationCompat.InboxStyle style = new NotificationCompat.InboxStyle().setBigContentTitle(title);
        for (int i = 0; i < lists.length(); i++) {
            JSONObject l = lists.optJSONObject(i);
            if (l == null) continue;
            String owner = l.optString("owner");
            if (!owner.isEmpty() && !owners.contains(owner)) owners.add(owner);
            if (i < 6) style.addLine(l.optString("emoji", "🎁") + "  " + (owner.isEmpty() ? "" : owner + " · ") + l.optString("title"));
        }
        if (lists.length() > 6) style.addLine("… und " + (lists.length() - 6) + " weitere");
        String text = lists.length() == 1 ? "Liste von " + String.join(", ", owners) + " ansehen"
                : lists.length() + " Listen: " + String.join(", ", owners);
        if (open > 0) style.setSummaryText("🛒 Noch " + gifts(open) + " zu besorgen");
        return post(c, nm, CH_EVENTS, ("evt" + g.optString("date")).hashCode(), g, title, text, style,
                MainActivity.HOME + "?seite=anlass&id=" + g.optString("date"));
    }

    private static boolean postBuy(Context c, NotificationManagerCompat nm, JSONObject g, long d) {
        int open = g.optInt("open");
        String name = g.optString("name");
        String title = "🛒 Noch " + gifts(open) + " für " + name + " besorgen";
        JSONArray list = g.optJSONArray("gifts");
        NotificationCompat.InboxStyle style = new NotificationCompat.InboxStyle().setBigContentTitle(title);
        List<String> names = new ArrayList<>();
        for (int i = 0; list != null && i < list.length(); i++) {
            JSONObject it = list.optJSONObject(i);
            if (it == null) continue;
            names.add(it.optString("title"));
            style.addLine("• " + it.optString("title") + (it.optString("owner").isEmpty() ? "" : " · für " + it.optString("owner")));
        }
        style.setSummaryText(name + " ist " + when(d));
        String text = name + " ist " + when(d) + ": " + String.join(", ", names);
        return post(c, nm, CH_BUY, ("buy" + g.optString("date")).hashCode(), g, title, text, style, MainActivity.HOME + "?seite=geschenke");
    }

    private static boolean postUndated(Context c, NotificationManagerCompat nm, int n) {
        String title = "🛒 Noch " + gifts(n) + " zu besorgen";
        String text = "Ohne festen Termin. Schau in deine Einkaufsliste, damit nichts liegen bleibt.";
        return post(c, nm, CH_BUY, "buy-none".hashCode(), null, title, text, new NotificationCompat.BigTextStyle().bigText(text),
                MainActivity.HOME + "?seite=geschenke");
    }

    private static boolean post(Context c, NotificationManagerCompat nm, String channel, int id, JSONObject g, String title, String text,
                                NotificationCompat.Style style, String url) {
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(url), c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        int color = 0xFFFFCB05;
        try { if (g != null) color = Color.parseColor(g.optString("color", "#ffcb05")); } catch (Exception ignored) { }
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channel)
                .setSmallIcon(R.drawable.ic_stat_wunsch)
                .setColor(color)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(style)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try {
            nm.notify(id, b.build());
            return true;
        } catch (SecurityException e) {
            return false;   // Benachrichtigungen nicht erlaubt
        }
    }
}
