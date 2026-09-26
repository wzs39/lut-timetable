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

    /**
     * 深链 view 的唯一解读者：小组件/快捷方式写入的 tt_view extra 优先，
     * 没有 extra 时看 intent action（长按图标快捷方式用自定义 action，
     * 见 res/xml/shortcuts.xml）。返回 null = 这次启动不带导航意图。
     */
    private static String navViewOf(Intent i) {
        if (i == null) return null;
        String view = i.getStringExtra("tt_view");
        if (view != null) return view;
        String action = i.getAction();
        if (action == null) return null;
        switch (action) {
            case "dev.lut.timetable.OPEN_TODAY":
                return "today";
            case "dev.lut.timetable.OPEN_WEEK":
                return "week";
            case "dev.lut.timetable.OPEN_ASSIGN":
                return "assign";
            default:
                return null;
        }
    }

    private void saveWidgetNav(Intent i) {
        String view = navViewOf(i);
        if (view == null) return;
        getSharedPreferences("CapacitorStorage", MODE_PRIVATE)
                .edit().putString("widget_nav_v1", view).apply();
    }

    private void pushWidgetNavToWeb() {
        final String view = navViewOf(getIntent());
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
