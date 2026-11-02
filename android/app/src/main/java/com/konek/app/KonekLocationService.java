package com.konek.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Foreground service that keeps reporting the user's location and battery
 * while the app is backgrounded or swiped away.
 *
 * Android requires an ongoing notification for this; the notification text is
 * "Updating your location" so the user always knows tracking is active.
 */
public class KonekLocationService extends Service {

    private static final String TAG = "KonekLocationService";
    private static final String CHANNEL_ID = "konek_location";
    private static final int NOTIFICATION_ID = 4201;

    private static volatile boolean running = false;

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private ExecutorService executor;
    private PowerManager.WakeLock wakeLock;

    private String apiUrl;
    private String token;
    private long intervalMs = 10000L;

    public static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        executor = Executors.newSingleThreadExecutor();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences(
                KonekBackgroundTrackerPlugin.PREFS,
                Context.MODE_PRIVATE
        );

        if (intent == null && !prefs.getBoolean(KonekBackgroundTrackerPlugin.KEY_ENABLED, false)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null) {
            apiUrl = intent.getStringExtra(KonekBackgroundTrackerPlugin.KEY_API_URL);
            token = intent.getStringExtra(KonekBackgroundTrackerPlugin.KEY_TOKEN);
            intervalMs = intent.getIntExtra(KonekBackgroundTrackerPlugin.KEY_INTERVAL, 10000);
        }
        if (apiUrl == null) {
            apiUrl = prefs.getString(KonekBackgroundTrackerPlugin.KEY_API_URL, null);
        }
        if (token == null) {
            token = prefs.getString(KonekBackgroundTrackerPlugin.KEY_TOKEN, null);
        }
        if (intervalMs <= 0) {
            intervalMs = prefs.getInt(KonekBackgroundTrackerPlugin.KEY_INTERVAL, 10000);
        }
        intervalMs = Math.max(5000L, intervalMs);

        if (apiUrl == null || token == null) {
            Log.w(TAG, "Missing API configuration, stopping service");
            stopSelf();
            return START_NOT_STICKY;
        }

        startForegroundCompat();
        acquireWakeLock();
        startLocationUpdates();
        running = true;

        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (fusedClient != null && locationCallback != null) {
            try {
                fusedClient.removeLocationUpdates(locationCallback);
            } catch (Exception error) {
                Log.w(TAG, "Could not remove location updates", error);
            }
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (executor != null) {
            executor.shutdown();
        }
        stopForeground(true);
        super.onDestroy();
    }

    private void startForegroundCompat() {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void startLocationUpdates() {
        if (fusedClient == null) {
            fusedClient = LocationServices.getFusedLocationProviderClient(this);
        }
        if (locationCallback == null) {
            locationCallback = new LocationCallback() {
                @Override
                public void onLocationResult(@NonNull LocationResult result) {
                    Location location = result.getLastLocation();
                    if (location != null) {
                        uploadLocation(location);
                    }
                }
            };
        }

        LocationRequest request = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY,
                intervalMs
        )
                .setMinUpdateIntervalMillis(Math.max(1000L, intervalMs / 2))
                .setMinUpdateDistanceMeters(0f)
                .build();

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
        } catch (SecurityException error) {
            Log.e(TAG, "Location permission missing", error);
            stopSelf();
        }
    }

    private void uploadLocation(Location location) {
        final String url = apiUrl;
        final String authToken = token;
        final double latitude = location.getLatitude();
        final double longitude = location.getLongitude();
        final float accuracy = location.getAccuracy();
        final double altitude = location.getAltitude();
        final float speed = location.getSpeed();
        final float heading = location.getBearing();

        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("latitude", latitude);
                body.put("longitude", longitude);
                if (accuracy > 0) {
                    body.put("accuracy", accuracy);
                }
                body.put("altitude", altitude);
                body.put("speed", speed);
                body.put("heading", heading);

                BatteryInfo battery = readBattery();
                if (battery.level != null) {
                    body.put("battery_level", battery.level);
                }
                if (battery.charging != null) {
                    body.put("is_charging", battery.charging);
                }

                HttpURLConnection connection = (HttpURLConnection) new URL(
                        url + "/api_update_location.php"
                ).openConnection();
                try {
                    connection.setRequestMethod("POST");
                    connection.setConnectTimeout(15000);
                    connection.setReadTimeout(15000);
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json");
                    connection.setRequestProperty("Authorization", "Bearer " + authToken);

                    byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
                    connection.setFixedLengthStreamingMode(payload.length);
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(payload);
                    }

                    int responseCode = connection.getResponseCode();
                    if (responseCode < 200 || responseCode >= 300) {
                        Log.w(TAG, "Location upload failed with HTTP " + responseCode);
                    }
                } finally {
                    connection.disconnect();
                }
            } catch (Exception error) {
                Log.w(TAG, "Location upload failed", error);
            }
        });
    }

    private BatteryInfo readBattery() {
        Integer level = null;
        Boolean charging = null;
        Intent status = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (status != null) {
            int rawLevel = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            if (rawLevel >= 0 && scale > 0) {
                level = Math.round(rawLevel * 100f / scale);
            }
            int batteryStatus = status.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            if (batteryStatus != -1) {
                charging = batteryStatus == BatteryManager.BATTERY_STATUS_CHARGING
                        || batteryStatus == BatteryManager.BATTERY_STATUS_FULL;
            }
        }
        return new BatteryInfo(level, charging);
    }

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "Konek::LocationTracking"
            );
            wakeLock.setReferenceCounted(false);
        }
        if (!wakeLock.isHeld()) {
            wakeLock.acquire();
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Location updates",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Shown while Konek is sharing your location");
        channel.setShowBadge(false);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Updating your location")
                .setContentText("Konek is sharing your location with your squad")
                .setSmallIcon(R.drawable.ic_stat_konek)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .build();
    }

    private static final class BatteryInfo {
        final Integer level;
        final Boolean charging;

        BatteryInfo(Integer level, Boolean charging) {
            this.level = level;
            this.charging = charging;
        }
    }
}
