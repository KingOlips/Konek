package com.konek.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Starts and stops the Android foreground location service.
 *
 * The service keeps uploading location + battery to the PHP API even when the
 * WebView is backgrounded or the task is swiped away, and shows the ongoing
 * "Updating your location" notification required by Android.
 */
@CapacitorPlugin(name = "KonekBackgroundTracker")
public class KonekBackgroundTrackerPlugin extends Plugin {

    static final String PREFS = "konek_background_tracker";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_API_URL = "api_url";
    static final String KEY_TOKEN = "token";
    static final String KEY_INTERVAL = "interval_ms";

    private static final int NOTIFICATION_PERMISSION_REQUEST = 4202;

    @PluginMethod
    public void start(PluginCall call) {
        String apiUrl = call.getString("apiUrl");
        String token = call.getString("token");
        int intervalMs = call.getInt("intervalMs", 10000);

        if (apiUrl == null || apiUrl.isEmpty() || token == null || token.isEmpty()) {
            call.reject("apiUrl and token are required");
            return;
        }

        Context context = getContext();
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            call.reject("Location permission is not granted", "LOCATION_PERMISSION_DENIED");
            return;
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit()
                .putBoolean(KEY_ENABLED, true)
                .putString(KEY_API_URL, apiUrl)
                .putString(KEY_TOKEN, token)
                .putInt(KEY_INTERVAL, Math.max(5000, intervalMs))
                .apply();

        Intent intent = new Intent(context, KonekLocationService.class);
        intent.putExtra(KEY_API_URL, apiUrl);
        intent.putExtra(KEY_TOKEN, token);
        intent.putExtra(KEY_INTERVAL, Math.max(5000, intervalMs));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }

        // Android 13+ needs POST_NOTIFICATIONS for the ongoing notification.
        requestNotificationPermissionIfNeeded();

        JSObject result = new JSObject();
        result.put("running", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_ENABLED, false)
                .apply();
        context.stopService(new Intent(context, KonekLocationService.class));

        JSObject result = new JSObject();
        result.put("running", false);
        call.resolve(result);
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", KonekLocationService.isRunning());
        call.resolve(result);
    }

    /** Opens the system app details page so the user can allow background location. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open settings", error);
        }
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 33) {
            return;
        }
        Context context = getContext();
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            return;
        }
        activity.runOnUiThread(() ->
                ActivityCompat.requestPermissions(
                        activity,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        NOTIFICATION_PERMISSION_REQUEST
                )
        );
    }
}
