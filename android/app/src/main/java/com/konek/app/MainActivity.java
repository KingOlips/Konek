package com.konek.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Registered before the bridge is created so the JS side can call it
        // as soon as the app boots.
        registerPlugin(KonekBackgroundTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
