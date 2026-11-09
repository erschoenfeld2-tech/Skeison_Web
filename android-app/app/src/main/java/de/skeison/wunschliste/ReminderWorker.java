package de.skeison.wunschliste;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Prueft im Hintergrund, ob eine Erinnerung faellig ist (siehe Notifier). */
public class ReminderWorker extends Worker {
    public ReminderWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            Notifier.run(getApplicationContext());
        } catch (Exception ignored) {
            // naechster Lauf versucht es erneut
        }
        return Result.success();
    }
}
