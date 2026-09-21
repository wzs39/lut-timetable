package dev.lut.timetable

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Widget tugas: daftar tugas Moodle yang belum selesai, paling dekat
 * deadline dulu (TANPA batas jumlah — ListView scrollable). Sumber data: pref
 * "widget_tasks_payload_v1" (ditulis web via lib/widgetData.ts — web tetap
 * satu pemilik data, widget tidak pernah membaca localStorage langsung).
 *
 * Interaksi: tap di mana pun membuka app langsung ke halaman tugas
 * (deep-link tt_view=assign, ditangani MainActivity).
 *
 * Lock screen / glance: host layar kunci (Android 16+, kategori KEYGUARD)
 * dilaporkan lewat OPTION_APPWIDGET_HOST_CATEGORY — render memakai palet
 * kontras tinggi fix (kartu gelap opaque + teks putih) karena wallpaper
 * layar kunci bisa warna apa pun; palet tema normal terlalu berisiko.
 */
class TasksWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) renderAndApply(context, manager, id)
    }

    /** Resize: render ulang agar kapasitas mengikuti tinggi nyata. */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        id: Int,
        opts: Bundle,
    ) {
        renderAndApply(context, manager, id)
    }

    private fun renderAndApply(context: Context, manager: AppWidgetManager, id: Int) {
        val opts = manager.getAppWidgetOptions(id)
        manager.updateAppWidget(id, render(context, id, opts, BaseWidgetProvider.isKeyguard(manager, id)))
    }

    companion object {
        fun render(context: Context, widgetId: Int, opts: Bundle? = null, keyguard: Boolean = false): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_tasks)
            if (keyguard) {
                views.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_bg_keyguard)
            }

            val openTasks = PendingIntent.getActivity(
                context, 1001,
                Intent(context, MainActivity::class.java).putExtra("tt_view", "assign"),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_root, openTasks)

            val payload = readPayload(context)
            if (payload == null) {
                views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_empty_title))
                views.setViewVisibility(R.id.widget_list, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_empty, android.view.View.VISIBLE)
                views.setTextViewText(R.id.widget_empty, context.getString(R.string.widget_empty_body))
                if (keyguard) applyKeyguardText(views)
                return views
            }

            views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_tasks_title))

            // Daftar SCROLLABLE: ListView + WidgetListService (kind=tasks).
            // Semua tugas terbuka tersedia via scroll — "+N more" dihapus.
            // Template broadcast: checkbox per baris (fill-in taskId/completed)
            // mengantre toggle untuk web; tap baris lain tetap membuka app.
            val items = payload.optJSONArray("items")
            val count = items?.length() ?: 0
            views.setRemoteAdapter(R.id.widget_list, WidgetListService.adapterIntent(context, WidgetListService.KIND_TASKS, widgetId))
            views.setPendingIntentTemplate(R.id.widget_list, WidgetToggleReceiver.toggleTemplate(context))
            if (count == 0) {
                views.setViewVisibility(R.id.widget_list, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_empty, android.view.View.VISIBLE)
                views.setTextViewText(R.id.widget_empty, context.getString(R.string.widget_no_tasks))
                views.setViewVisibility(R.id.widget_meta, android.view.View.GONE)
            } else {
                views.setViewVisibility(R.id.widget_list, android.view.View.VISIBLE)
                views.setViewVisibility(R.id.widget_empty, android.view.View.GONE)
                // Meta: jumlah tugas terbuka (info nyata).
                views.setViewVisibility(R.id.widget_meta, android.view.View.VISIBLE)
                views.setTextViewText(
                    R.id.widget_meta,
                    context.getString(R.string.widget_open_tasks, payload.optInt("openCount", count)),
                )
            }
            if (keyguard) applyKeyguardText(views)
            return views
        }

        /** Keyguard: teks putih kontras tinggi menimpa warna statis layout. */
        private fun applyKeyguardText(views: RemoteViews) {
            views.setTextColor(R.id.widget_title, Color.parseColor("#F4F5F7"))
            views.setTextColor(R.id.widget_empty, Color.parseColor("#D9DBE0"))
            views.setTextColor(R.id.widget_meta, Color.parseColor("#B8BCC4"))
        }

        private fun readPayload(context: Context): JSONObject? {
            return try {
                val prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                val raw = prefs.getString("widget_tasks_payload_v1", null) ?: return null
                JSONObject(raw)
            } catch (_: Exception) {
                null
            }
        }
    }
}
