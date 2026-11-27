package de.skeison.wunschliste;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Rueckmeldungen zum Update in der App (siehe Updater):
 * - Android braucht eine Bestaetigung: ist die App offen, gleich die Rueckfrage "Aktualisieren?" oeffnen;
 *   im Hintergrund (automatisches Update) stattdessen eine Benachrichtigung "Update bereit, tippen zum Installieren".
 * - Installation abgelehnt oder fehlgeschlagen: kurzer Hinweis (nur bei offener App).
 * - Die neue Version ist installiert (die App wurde dabei beendet): Meldung "tippen zum Oeffnen", ausser bei einem
 *   stillen automatischen Update, das niemand bemerkt haben muss.
 */
public class UpdateReceiver extends BroadcastReceiver {

    private static final int ID_UPDATED = 9001, ID_CONFIRM = 9002;

    @Override
    public void onReceive(Context c, Intent intent) {
        String action = intent.getAction();
        SharedPreferences p = c.getSharedPreferences(Updater.PREFS, Context.MODE_PRIVATE);
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Updater.cleanUp(c);
            NotificationManagerCompat.from(c).cancel(ID_CONFIRM);
            boolean auto = p.getBoolean(Updater.K_AUTO, false);
            p.edit().remove(Updater.K_AUTO).apply();
            if (!auto) notifyUpdated(c);
            // Erinnerungen und Update-Pruefung laufen nach dem Update weiter (WorkManager behaelt sie), sicherheitshalber neu planen
            try { Notifier.schedule(c, false); Updater.schedule(c, false); } catch (Exception ignored) { }
            return;
        }
        if (!Updater.ACTION_STATUS.equals(action)) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        boolean quiet = p.getBoolean(Updater.K_AUTO, false) && !Updater.inForeground;
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class) : intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm == null) return;
            if (Updater.inForeground) {
                try { c.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) { }
            } else notifyConfirm(c, confirm);
        } else if (status == PackageInstaller.STATUS_SUCCESS) {
            Updater.cleanUp(c);
        } else if (!quiet && status == PackageInstaller.STATUS_FAILURE_ABORTED) {
            Toast.makeText(c, "Update abgebrochen. Die App bleibt, wie sie ist.", Toast.LENGTH_LONG).show();
        } else if (!quiet) {
            Toast.makeText(c, "Update konnte nicht installiert werden. Bitte später noch einmal versuchen.", Toast.LENGTH_LONG).show();
        }
    }

    private static boolean mayNotify(Context c) {
        return !(Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED);
    }

    /** Automatisches Update braucht einmal eine Bestaetigung: Benachrichtigung, die die Rueckfrage von Android oeffnet. */
    private static void notifyConfirm(Context c, Intent confirm) {
        try {
            if (!mayNotify(c)) return;
            Notifier.ensureChannels(c);
            PendingIntent pi = PendingIntent.getActivity(c, ID_CONFIRM, confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            String text = "Tippen und „Aktualisieren“ bestätigen. Danach kommen Updates von selbst. Deine Wünsche und Listen bleiben erhalten.";
            NotificationManagerCompat.from(c).notify(ID_CONFIRM, new NotificationCompat.Builder(c, Notifier.CH_UPDATE)
                    .setSmallIcon(R.drawable.ic_stat_wunsch)
                    .setContentTitle("Update für die Wunschliste bereit")
                    .setContentText(text)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                    .setAutoCancel(true)
                    .setContentIntent(pi)
                    .build());
        } catch (Exception ignored) { }
    }

    private static void notifyUpdated(Context c) {
        try {
            if (!mayNotify(c)) return;
            Notifier.ensureChannels(c);
            Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(c, ID_UPDATED, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            NotificationManagerCompat.from(c).notify(ID_UPDATED, new NotificationCompat.Builder(c, Notifier.CH_UPDATE)
                    .setSmallIcon(R.drawable.ic_stat_wunsch)
                    .setContentTitle("Wunschliste ist aktualisiert")
                    .setContentText("Tippen, um die App wieder zu öffnen.")
                    .setAutoCancel(true)
                    .setContentIntent(pi)
                    .build());
        } catch (Exception ignored) { }
    }
}
