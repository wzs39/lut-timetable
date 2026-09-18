package dev.lut.timetable

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Widget layar utama: pelajaran hari ini + jumlah minggu.
 *
 * Sumber data: SharedPreferences "CapacitorStorage" (ditulis oleh web
 * melalui @capacitor/preferences, key widget_payload_v1). Widget tidak
 * pernah menghitung sendiri — web adalah satu pemilik data.
 */
class TodayWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        for (id in appWidgetIds) {
            appWidgetManager.updateAppWidget(id, render(context))
        }
    }

    override fun onEnabled(context: Context) {
        // Widget baru dipasang — minta web menyegarkan payload saat app
        // dibuka berikutnya; untuk sekarang render apa yang tersimpan.
    }

    companion object {
        fun render(context: Context): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_today)

            val open = PendingIntent.getActivity(
                context, 0,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_root, open)

            val payload = readPayload(context)
            if (payload == null) {
                views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_empty_title))
                views.setTextViewText(R.id.widget_items, context.getString(R.string.widget_empty_body))
                return views
            }

            views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_title))
            val items = payload.optJSONArray("items")
            val sb = StringBuilder()
            if (items != null && items.length() > 0) {
                for (i in 0 until minOf(items.length(), 4)) {
                    val o = items.optJSONObject(i) ?: continue
                    sb.append(o.optString("s")).append(' ')
                        .append(o.optString("name"))
                        .append('\n')
                        .append(o.optString("room"))
                        .append(if (i < items.length() - 1) "\n\n" else "")
                }
            } else {
                sb.append(context.getString(R.string.widget_no_lessons))
            }
            views.setTextViewText(R.id.widget_items, sb.toString())
            views.setTextViewText(
                R.id.widget_meta,
                context.getString(R.string.widget_week_count, payload.optInt("weekCount")),
            )
            return views
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
