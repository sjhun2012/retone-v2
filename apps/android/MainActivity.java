package com.retone.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.TextView;
import androidx.browser.customtabs.CustomTabsCallback;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsServiceConnection;
import androidx.browser.customtabs.CustomTabsSession;
import androidx.browser.trusted.TrustedWebActivityIntent;
import androidx.browser.trusted.TrustedWebActivityIntentBuilder;

/** Uses the browser engine so uploads, microphone, camera and site accounts stay intact. */
public final class MainActivity extends Activity {
    private static final Uri HOME = Uri.parse("https://retone-v2-mygr.onrender.com/?source=android");
    private final Handler handler = new Handler(Looper.getMainLooper());
    private CustomTabsServiceConnection connection;
    private boolean bound;
    private boolean launched;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView loading = new TextView(this);
        loading.setText("Re:tone\n연결하고 있습니다…"); loading.setTextSize(24);
        loading.setTextColor(Color.rgb(48,50,46)); loading.setGravity(17);
        loading.setBackgroundColor(Color.rgb(247,240,229)); setContentView(loading);
        String provider = CustomTabsClient.getPackageName(this, null);
        if (provider == null) { fallback(); return; }
        connection = new CustomTabsServiceConnection() {
            @Override public void onCustomTabsServiceConnected(ComponentName name, CustomTabsClient client) {
                if (isFinishing() || launched) return;
                try {
                    client.warmup(0L);
                    CustomTabsSession session = client.newSession(new CustomTabsCallback());
                    if (session == null) { fallback(); return; }
                    TrustedWebActivityIntent activity = new TrustedWebActivityIntentBuilder(HOME)
                        .setToolbarColor(Color.rgb(247,240,229))
                        .setNavigationBarColor(Color.rgb(247,240,229))
                        .build(session);
                    // Launch as this installed app's task; the browser verifies digitalassetlinks.json.
                    startActivity(activity.getIntent()); launched = true; finish();
                } catch (RuntimeException error) { fallback(); }
            }
            @Override public void onServiceDisconnected(ComponentName name) { if (!launched && !isFinishing()) fallback(); }
        };
        try { bound = CustomTabsClient.bindCustomTabsService(this, provider, connection); }
        catch (RuntimeException ignored) { bound = false; }
        if (!bound) fallback();
        else handler.postDelayed(new Runnable() { @Override public void run() { if (!launched && !isFinishing()) fallback(); } }, 8000);
    }
    private void fallback() {
        if (launched || isFinishing()) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, HOME)); launched = true; finish(); }
        catch (android.content.ActivityNotFoundException error) {
            new AlertDialog.Builder(this).setTitle("Re:tone").setMessage("Chrome 등 최신 브라우저를 설치한 뒤 다시 실행해 주세요.")
                .setPositiveButton("닫기", new DialogInterface.OnClickListener() { @Override public void onClick(DialogInterface dialog, int which) { finish(); } }).setCancelable(false).show();
        }
    }
    @Override public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (bound && connection != null) { try { unbindService(connection); } catch (IllegalArgumentException ignored) {} }
        super.onDestroy();
    }
}
