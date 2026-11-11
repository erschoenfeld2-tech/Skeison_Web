package de.skeison.wunschliste;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Rueckmeldungen zum Update in der App (siehe Updater):
 * - Android braucht eine Bestaetigung: die Rueckfrage "Aktualisieren?" oeffnen.
 * - Installation abgelehnt oder fehlgeschlagen: kurzer Hinweis.
 * - Die neue Version ist installiert (die App wurde dabei beendet): Meldung "tippen zum Oeffnen".
 */
public class UpdateReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context c, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Updater.cleanUp(c);
            notifyUpdated(c);
            return;
        }
        if (!Updater.ACTION_STATUS.equals(action)) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class) : intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                try { c.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) { }
            }
        } else if (status == PackageInstaller.STATUS_SUCCESS) {
            Updater.cleanUp(c);
        } else if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
            Toast.makeText(c, "Update abgebrochen. Die App bleibt, wie sie ist.", Toast.LENGTH_LONG).show();
        } else {
            Toast.makeText(c, "Update konnte nicht installiert werden. Bitte später noch einmal versuchen.", Toast.LENGTH_LONG).show();
        }
    }

    private static void notifyUpdated(Context c) {
        try {
            if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return;
            Notifier.ensureChannels(c);
            Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(c, 9001, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            NotificationManagerCompat.from(c).notify(9001, new NotificationCompat.Builder(c, Notifier.CH_EVENTS)
                    .setSmallIcon(R.drawable.ic_stat_wunsch)
                    .setContentTitle("Wunschliste ist aktualisiert")
                    .setContentText("Tippen, um die App wieder zu öffnen.")
                    .setAutoCancel(true)
                    .setContentIntent(pi)
                    .build());
        } catch (Exception ignored) { }
    }
}
