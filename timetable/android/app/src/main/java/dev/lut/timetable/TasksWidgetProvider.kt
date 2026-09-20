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
 * deadline dulu (maks 8, "+N more" bila lebih). Sumber data: pref
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
        manager.updateAppWidget(id, render(context, opts, BaseWidgetProvider.isKeyguard(manager, id)))
    }

    companion object {
        fun render(context: Context, opts: Bundle? = null, keyguard: Boolean = false): RemoteViews {
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
                views.setTextViewText(R.id.widget_items, context.getString(R.string.widget_empty_body))
                if (keyguard) applyKeyguardText(views)
                return views
            }

            views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_tasks_title))

            // Palet tema-sadar (values = terang, values-night = gelap);
            // keyguard menimpa dengan kontras tinggi fix.
            fun hex(c: Int) = String.format("#%06X", 0xFFFFFF and context.getColor(c))
            val bodyColor = if (keyguard) "#F4F5F7" else hex(R.color.widget_text_body)
            val mutedColor = if (keyguard) "#B8BCC4" else hex(R.color.widget_text_muted)
            val lateColor = if (keyguard) "#FCA5A5" else hex(R.color.widget_late)
            val soonColor = if (keyguard) "#FCD34D" else hex(R.color.widget_soon)
            val nowMs = System.currentTimeMillis()

            val items = payload.optJSONArray("items")
            val sb = StringBuilder()
            val maxRows = capacityFor(opts)
            var shown = 0
            if (items != null) {
                for (i in 0 until minOf(items.length(), maxRows)) {
                    val o = items.optJSONObject(i) ?: continue
                    val due = o.optString("d")
                    val title = o.optString("t")
                    val course = o.optString("c")
                    val dms = o.optLong("dms", 0)
                    val late = o.optBoolean("late") || (dms in 1 until nowMs)
                    // Deadline <= 24 jam & belum lewat: tag SOON kuning.
                    val soon = !late && dms - nowMs in 1 until 24 * 3600 * 1000L
                    sb.append("<b><font color=\"").append(bodyColor).append("\">")
                    if (due.isNotEmpty()) sb.append(due).append("&nbsp;&nbsp;")
                    sb.append(title).append("</font></b>")
                    if (late) {
                        sb.append("  <font color=\"").append(lateColor).append("\">")
                            .append(context.getString(R.string.widget_late)).append("</font>")
                    } else if (soon) {
                        sb.append("  <font color=\"").append(soonColor).append("\">")
                            .append(context.getString(R.string.widget_soon)).append("</font>")
                    }
                    sb.append("<br>")
                    if (course.isNotEmpty()) {
                        sb.append("&nbsp;&nbsp;&nbsp;<font color=\"").append(mutedColor).append("\">")
                            .append(course).append("</font><br>")
                    }
                    shown++
                }
            }
            if (sb.isEmpty()) {
                sb.append("<font color=\"").append(mutedColor).append("\">")
                    .append(context.getString(R.string.widget_no_tasks)).append("</font>")
                views.setViewVisibility(R.id.widget_meta, android.view.View.GONE)
            } else {
                val openCount = payload.optInt("openCount", shown)
                if (openCount > shown) {
                    sb.append("<br><font color=\"").append(mutedColor).append("\">+")
                        .append(openCount - shown).append(" more</font>")
                }
                // Baris meta: jumlah tugas terbuka — info nyata, bukan penghias.
                views.setViewVisibility(R.id.widget_meta, android.view.View.VISIBLE)
                views.setTextViewText(
                    R.id.widget_meta,
                    context.getString(R.string.widget_open_tasks, openCount),
                )
            }
            views.setTextViewText(
                R.id.widget_items,
                android.text.Html.fromHtml(
                    sb.toString().trimEnd('\n').removeSuffix("<br>"),
                    android.text.Html.FROM_HTML_MODE_LEGACY,
                ),
            )
            if (keyguard) applyKeyguardText(views)
            return views
        }

        /** Keyguard: teks putih kontras tinggi menimpa warna statis layout. */
        private fun applyKeyguardText(views: RemoteViews) {
            views.setTextColor(R.id.widget_title, Color.parseColor("#F4F5F7"))
            views.setTextColor(R.id.widget_items, Color.parseColor("#D9DBE0"))
            views.setTextColor(R.id.widget_meta, Color.parseColor("#B8BCC4"))
        }

        /** Kapasitas baris mengikuti tinggi nyata (kalibrasi sama dgn widget hari ini). */
        private fun capacityFor(opts: Bundle?): Int {
            val hDp = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) ?: 0
            if (hDp <= 0) return 4
            return Math.round(4 * hDp / 128.0).toInt().coerceIn(1, 12)
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
