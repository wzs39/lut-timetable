package dev.lut.timetable

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.RemoteViews
import org.json.JSONObject
import java.util.Locale

/**
 * Widget layar utama: pelajaran hari ini + hitung mundur kelas berikutnya.
 *
 * Satu mesin render untuk dua varian layout (3×2 kolom tunggal, 4×2 dua
 * kolom) — subclass hanya memilih layout. Sumber data: SharedPreferences
 * "CapacitorStorage" (ditulis web via @capacitor/preferences, key
 * widget_payload_v1). Widget tidak pernah menghitung sendiri — web adalah
 * satu pemilik data.
 */
abstract class BaseWidgetProvider : AppWidgetProvider() {

    /** Varian memilih layout: kolom tunggal (3×2) atau dua kolom (4×2). */
    protected abstract fun layoutRes(): Int

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        for (id in appWidgetIds) {
            renderAndApply(context, appWidgetManager, id)
        }
    }

    private fun renderAndApply(context: Context, manager: AppWidgetManager, id: Int) {
        manager.updateAppWidget(
            id,
            render(context, layoutRes(), id, manager.getAppWidgetOptions(id), isKeyguard(manager, id)),
        )
    }

    /**
     * Resize: launcher melaporkan ukuran baru lewat options — render ulang
     * agar kapasitas mengikuti tinggi nyata (perbesar → lebih banyak sesi,
     * perkecil → "+N more" bertambah). Tanpa ini, teks tetap lama sampai
     * siklus update berikutnya.
     */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: Bundle,
    ) {
        renderAndApply(context, appWidgetManager, appWidgetId)
    }

    companion object {
        /**
         * True bila widget dirender oleh host layar kunci / negatif satu
         * (Android 16+ lock screen, beberapa launcher glance): kategori
         * KEYGUARD dilaporkan lewat options — kontras tinggi wajib karena
         * wallpaper di belakangnya tak terkendali.
         */
        fun isKeyguard(manager: AppWidgetManager, id: Int): Boolean =
            manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_HOST_CATEGORY) ==
                android.appwidget.AppWidgetProviderInfo.WIDGET_CATEGORY_KEYGUARD

        /** Render + terapkan untuk SEMUA widget varian — dipakai WidgetBridgePlugin. */
        fun renderAll(context: Context, manager: AppWidgetManager) {
            for (provider in listOf(TodayWidgetProvider(), WideWidgetProvider())) {
                val cn = android.content.ComponentName(context, provider.javaClass)
                for (id in manager.getAppWidgetIds(cn)) {
                    manager.updateAppWidget(
                        id,
                        render(context, provider.layoutRes(), id, manager.getAppWidgetOptions(id), isKeyguard(manager, id)),
                    )
                    // ListView 数据重读（onDataSetChanged 回 pref）— pushWidgetData 后即时可见。
                    manager.notifyAppWidgetViewDataChanged(id, R.id.widget_list)
                }
            }
            // Widget tugas: mesin render sendiri (payload & layout berbeda).
            val cnT = android.content.ComponentName(context, TasksWidgetProvider::class.java)
            for (id in manager.getAppWidgetIds(cnT)) {
                manager.updateAppWidget(
                    id,
                    TasksWidgetProvider.render(context, id, manager.getAppWidgetOptions(id), isKeyguard(manager, id)),
                )
                manager.notifyAppWidgetViewDataChanged(id, R.id.widget_list)
            }
        }

        fun render(context: Context, layoutRes: Int, widgetId: Int, opts: Bundle? = null, keyguard: Boolean = false): RemoteViews {
            val views = RemoteViews(context.packageName, layoutRes)
            if (keyguard) {
                // Kartu gelap opaque: teks tetap terbaca di wallpaper layar
                // kunci warna apa pun (palet tema terang/transparan tidak).
                views.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_bg_keyguard)
            }

            val open = PendingIntent.getActivity(
                context, 0,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_root, open)
            // Interaksi: header membuka halaman TUGAS (request code beda agar
            // PendingIntent tidak bentrok dengan root). Root tetap ke today.
            val openTasks = PendingIntent.getActivity(
                context, 1001,
                Intent(context, MainActivity::class.java).putExtra("tt_view", "assign"),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_title, openTasks)

            val payload = readPayload(context)
            if (payload == null) {
                views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_empty_title))
                views.setViewVisibility(R.id.widget_list, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_empty, android.view.View.VISIBLE)
                views.setTextViewText(R.id.widget_empty, context.getString(R.string.widget_empty_body))
                return views
            }

            // Judul + tanggal (dd.MM. — format Finlandia, tanpa pustaka).
            val date = payload.optString("date") // yyyy-mm-dd
            val parts = date.split("-")
            val dateStr = if (parts.size == 3) "${parts[2]}.${parts[1]}." else ""
            views.setTextViewText(
                R.id.widget_title,
                "${context.getString(R.string.widget_title)}  $dateStr",
            )

            // Daftar SCROLLABLE: ListView + WidgetListService (koleksi resmi
            // Android). Semua sesi tersedia via scroll — "+N more" dihapus.
            // onDataSetChanged membaca ulang pref, jadi renderAll cukup
            // memicu notify; data validasi tetap satu pemilik (web).
            val items = payload.optJSONArray("items")
            val count = items?.length() ?: 0
            views.setRemoteAdapter(R.id.widget_list, WidgetListService.adapterIntent(context, WidgetListService.KIND_LESSONS, widgetId))
            // Klik baris list → broadcast (satu template, dua aksi): baris
            // ber-courseid membuka Moodle course page di browser, sisanya
            // fallback buka app. (Template getActivity lama diganti: fill-in
            // extras hanya bekerja lewat broadcast MUTABLE.)
            views.setPendingIntentTemplate(R.id.widget_list, WidgetToggleReceiver.lessonTemplate(context))
            if (count == 0) {
                views.setViewVisibility(R.id.widget_list, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_empty, android.view.View.VISIBLE)
                views.setTextViewText(R.id.widget_empty, context.getString(R.string.widget_no_lessons))
            } else {
                views.setViewVisibility(R.id.widget_list, android.view.View.VISIBLE)
                views.setViewVisibility(R.id.widget_empty, android.view.View.GONE)
            }
            // Baris bawah: hitung mundur kelas berikutnya + jumlah minggu.
            val nextStart = if (payload.has("nextStartMs")) payload.optLong("nextStartMs", 0) else 0
            val countdown = countdownText(context, nextStart, System.currentTimeMillis())
            val meta = context.getString(R.string.widget_week_count, payload.optInt("weekCount"))
            views.setTextViewText(R.id.widget_meta, if (countdown != null) "$countdown  ·  $meta" else meta)
            return views
        }

        /** "In 1 h 05 m" / "Now!" — null bila tidak ada kelas berikutnya. */

        private fun countdownText(context: Context, startMs: Long, nowMs: Long): String? {
            if (startMs <= 0) return null
            val diff = startMs - nowMs
            if (diff <= 0) return context.getString(R.string.widget_now)
            val totalMin = diff / 60000
            val h = totalMin / 60
            val m = totalMin % 60
            return when {
                h > 0 -> String.format(Locale.US, context.getString(R.string.widget_in_hm), h, m)
                m > 0 -> String.format(Locale.US, context.getString(R.string.widget_in_m), m)
                else -> context.getString(R.string.widget_now)
            }
        }

        private fun readPayload(context: Context): JSONObject? {
            return try {
                val prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                val raw = prefs.getString("widget_payload_v1", null) ?: return null
                JSONObject(raw)
            } catch (_: Exception) {
                null
            }
        }
    }
}

/** Varian 3×2 (kolom tunggal) — daftar hari ini, tanpa penggabungan. */
class TodayWidgetProvider : BaseWidgetProvider() {
    override fun layoutRes(): Int = R.layout.widget_today
}

/** Varian 4×2 — dua kolom (maks 6 sesi) + countdown. */
class WideWidgetProvider : BaseWidgetProvider() {
    override fun layoutRes(): Int = R.layout.widget_today_wide
}
