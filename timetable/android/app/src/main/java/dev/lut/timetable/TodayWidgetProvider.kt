package dev.lut.timetable

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
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

        data class ResolvedDay(
            val date: String,
            val items: JSONArray,
            val weekCount: Int,
            val nextStartMs: Long,
            val staleFrom: String?,
        )

        private fun JSONObject.strOrEmpty(key: String): String =
            if (isNull(key)) "" else optString(key, "")

        fun todayIsoDate(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

        fun formatDateFi(iso: String): String {
            val parts = iso.split("-")
            return if (parts.size == 3) "${parts[2]}.${parts[1]}." else iso
        }

        /** Resolve today's lessons bucket across midnight rollovers using lookahead `days` map. */
        fun resolveDay(payload: JSONObject, todayStr: String = todayIsoDate()): ResolvedDay {
            val topWeekCount = payload.optInt("weekCount", 0)
            val days = payload.optJSONObject("days")
            val bucket = days?.optJSONObject(todayStr)
            if (bucket != null) {
                val nextMs = if (bucket.has("nextStartMs") && !bucket.isNull("nextStartMs")) {
                    bucket.optLong("nextStartMs", 0L)
                } else 0L
                return ResolvedDay(
                    date = todayStr,
                    items = bucket.optJSONArray("items") ?: JSONArray(),
                    weekCount = bucket.optInt("weekCount", topWeekCount),
                    nextStartMs = nextMs,
                    staleFrom = null,
                )
            }
            val payloadDate = payload.strOrEmpty("date")
            if (payloadDate == todayStr || payloadDate.isEmpty()) {
                val nextMs = if (payload.has("nextStartMs") && !payload.isNull("nextStartMs")) {
                    payload.optLong("nextStartMs", 0L)
                } else 0L
                return ResolvedDay(
                    date = if (payloadDate.isNotEmpty()) payloadDate else todayStr,
                    items = payload.optJSONArray("items") ?: JSONArray(),
                    weekCount = topWeekCount,
                    nextStartMs = nextMs,
                    staleFrom = null,
                )
            }
            return ResolvedDay(
                date = todayStr,
                items = JSONArray(),
                weekCount = 0,
                nextStartMs = 0L,
                staleFrom = formatDateFi(payloadDate),
            )
        }

        fun render(context: Context, layoutRes: Int, widgetId: Int, opts: Bundle? = null, keyguard: Boolean = false): RemoteViews {
            val views = RemoteViews(context.packageName, layoutRes)
            val isWide = layoutRes == R.layout.widget_today_wide
            if (keyguard) {
                // Kartu gelap opaque: teks tetap terbaca di wallpaper layar
                // kunci warna apa pun (palet tema terang/transparan tidak).
                views.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_bg_keyguard)
            }

            val openToday = PendingIntent.getActivity(
                context, 1000,
                Intent(context, MainActivity::class.java).putExtra("tt_view", "today"),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_root, openToday)
            views.setOnClickPendingIntent(R.id.widget_title, openToday)
            views.setOnClickPendingIntent(R.id.widget_refresh, WidgetToggleReceiver.refreshTemplate(context))

            val payload = readPayload(context)
            if (payload == null) {
                views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_empty_title))
                views.setViewVisibility(R.id.widget_list, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_empty, android.view.View.VISIBLE)
                views.setTextViewText(R.id.widget_empty, context.getString(R.string.widget_empty_body))
                views.setTextViewText(R.id.widget_meta, context.getString(R.string.widget_tap_refresh))
                if (isWide) renderPomodoroBanner(context, views, keyguard, openToday)
                if (keyguard) applyKeyguardText(views)
                return views
            }

            val resolved = resolveDay(payload)
            val dateStr = formatDateFi(resolved.date)
            views.setTextViewText(
                R.id.widget_title,
                "${context.getString(R.string.widget_title)}  $dateStr",
            )

            // Daftar SCROLLABLE: ListView + WidgetListService (koleksi resmi
            // Android). Semua sesi tersedia via scroll — "+N more" dihapus.
            val count = resolved.items.length()
            views.setRemoteAdapter(R.id.widget_list, WidgetListService.adapterIntent(context, WidgetListService.KIND_LESSONS, widgetId))
            views.setPendingIntentTemplate(R.id.widget_list, WidgetToggleReceiver.lessonTemplate(context))
            if (count == 0) {
                views.setViewVisibility(R.id.widget_list, android.view.View.GONE)
                views.setViewVisibility(R.id.widget_empty, android.view.View.VISIBLE)
                views.setTextViewText(
                    R.id.widget_empty,
                    if (resolved.staleFrom != null) context.getString(R.string.widget_stale_lessons, resolved.staleFrom)
                    else context.getString(R.string.widget_no_lessons),
                )
            } else {
                views.setViewVisibility(R.id.widget_list, android.view.View.VISIBLE)
                views.setViewVisibility(R.id.widget_empty, android.view.View.GONE)
            }

            if (resolved.staleFrom != null) {
                views.setTextViewText(R.id.widget_meta, context.getString(R.string.widget_tap_refresh))
            } else {
                val countdown = countdownText(context, resolved.nextStartMs, System.currentTimeMillis())
                val meta = context.getString(R.string.widget_week_count, resolved.weekCount)
                views.setTextViewText(R.id.widget_meta, if (countdown != null) "$countdown  ·  $meta" else meta)
            }

            if (isWide) renderPomodoroBanner(context, views, keyguard, openToday)
            if (keyguard) applyKeyguardText(views)
            return views
        }

        private fun renderPomodoroBanner(
            context: Context,
            views: RemoteViews,
            keyguard: Boolean,
            openToday: PendingIntent,
        ) {
            val pomo = readPomodoroPayload(context)
            if (pomo == null || !pomo.optBoolean("active", false)) {
                views.setViewVisibility(R.id.widget_focus, android.view.View.GONE)
                return
            }
            val nowMs = System.currentTimeMillis()
            val running = pomo.optBoolean("running", false)
            val endsAt = pomo.optLong("endsAt", 0L)
            val pausedMs = pomo.optLong("pausedRemainingMs", 0L)
            val remainMs = if (running) endsAt - nowMs else pausedMs
            if (remainMs <= 0L) {
                views.setViewVisibility(R.id.widget_focus, android.view.View.GONE)
                return
            }
            val mins = ((remainMs + 59_999L) / 60_000L).coerceAtLeast(1L)
            val phase = pomo.strOrEmpty("phase").ifEmpty { "focus" }
            val baseText = when {
                !running -> context.getString(R.string.widget_focus_paused, mins)
                phase == "focus" -> context.getString(R.string.widget_focus_running, mins)
                else -> context.getString(R.string.widget_focus_break, mins)
            }
            val course = pomo.strOrEmpty("courseCode")
            val label = pomo.strOrEmpty("label")
            val suffix = when {
                course.isNotEmpty() -> course
                label.isNotEmpty() -> label
                else -> ""
            }
            val bannerText = if (suffix.isNotEmpty()) "$baseText  ·  $suffix" else baseText
            val color = when {
                !running -> if (keyguard) Color.parseColor("#FBBF24") else context.getColor(R.color.widget_soon)
                phase == "focus" -> if (keyguard) Color.parseColor("#6EE7B7") else context.getColor(R.color.widget_now)
                else -> if (keyguard) Color.parseColor("#D4D4D8") else context.getColor(R.color.widget_text_title)
            }
            views.setTextViewText(R.id.widget_focus, bannerText)
            views.setTextColor(R.id.widget_focus, color)
            views.setViewVisibility(R.id.widget_focus, android.view.View.VISIBLE)
            views.setOnClickPendingIntent(R.id.widget_focus, openToday)
        }

        /** Keyguard: teks putih kontras tinggi menimpa warna statis layout. */
        private fun applyKeyguardText(views: RemoteViews) {
            views.setTextColor(R.id.widget_title, Color.parseColor("#F4F5F7"))
            views.setTextColor(R.id.widget_refresh, Color.parseColor("#B8BCC4"))
            views.setTextColor(R.id.widget_empty, Color.parseColor("#D9DBE0"))
            views.setTextColor(R.id.widget_meta, Color.parseColor("#B8BCC4"))
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

        private fun readPomodoroPayload(context: Context): JSONObject? {
            return try {
                val prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                val raw = prefs.getString("widget_pomodoro_v1", null) ?: return null
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
