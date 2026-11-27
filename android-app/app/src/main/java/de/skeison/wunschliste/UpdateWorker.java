package de.skeison.wunschliste;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Sieht im Hintergrund nach einer neuen App-Version und installiert sie (siehe Updater.autoUpdate). */
public class UpdateWorker extends Worker {
    public UpdateWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            Updater.autoUpdate(getApplicationContext());
        } catch (Exception ignored) {
            // naechster Lauf versucht es erneut
        }
        return Result.success();
    }
}
