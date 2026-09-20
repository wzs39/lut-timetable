package dev.lut.timetable;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Local (in-app) plugins must be registered before super.onCreate --
        // the bridge reads capacitor.plugins.json (npm plugins only) at init.
        registerPlugin(WidgetBridgePlugin.class);
        // Widget tap saat app MATI: simpan view ke pref (CapacitorStorage) --
        // web boot membaca widget_nav_v1 SEBELUM render pertama lalu menghapusnya.
        saveWidgetNav(getIntent());
        super.onCreate(savedInstanceState);
        pushWidgetNavToWeb();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // Widget tap saat app SUDAH BERJALAN (launchMode singleTask): pref
        // tetap ditulis (jaga-jaga web belum siap), lalu nav langsung lewat
        // jembatan window.__widgetNav (dipasang web saat mount).
        saveWidgetNav(intent);
        pushWidgetNavToWeb();
    }

    private void saveWidgetNav(Intent i) {
        if (i == null || !i.hasExtra("tt_view")) return;
        String view = i.getStringExtra("tt_view");
        if (view == null) return;
        getSharedPreferences("CapacitorStorage", MODE_PRIVATE)
                .edit().putString("widget_nav_v1", view).apply();
    }

    private void pushWidgetNavToWeb() {
        Intent i = getIntent();
        if (i == null || !i.hasExtra("tt_view")) return;
        final String view = i.getStringExtra("tt_view");
        if (view == null) return;
        try {
            final WebView wv = bridge != null ? bridge.getWebView() : null;
            if (wv == null) return;
            wv.post(new Runnable() {
                @Override
                public void run() {
                    // Web belum siap -> window.__widgetNav undefined, no-op;
                    // boot tetap konsumsi pref. Quote() bebas injeksi JS.
                    wv.evaluateJavascript(
                            "window.__widgetNav&&window.__widgetNav(" + JSONObject.quote(view) + ")",
                            null);
                }
            });
        } catch (Exception ignored) {
            // bridge belum terinisialisasi -- pref sudah cukup untuk boot.
        }
    }
}
