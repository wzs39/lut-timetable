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
            render(context, layoutRes(), manager.getAppWidgetOptions(id), isKeyguard(manager, id)),
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
                        render(context, provider.layoutRes(), manager.getAppWidgetOptions(id), isKeyguard(manager, id)),
                    )
                }
            }
            // Widget tugas: mesin render sendiri (payload & layout berbeda).
            val cnT = android.content.ComponentName(context, TasksWidgetProvider::class.java)
            for (id in manager.getAppWidgetIds(cnT)) {
                manager.updateAppWidget(
                    id,
                    TasksWidgetProvider.render(context, manager.getAppWidgetOptions(id), isKeyguard(manager, id)),
                )
            }
        }

        fun render(context: Context, layoutRes: Int, opts: Bundle? = null, keyguard: Boolean = false): RemoteViews {
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
                views.setTextViewText(R.id.widget_items, context.getString(R.string.widget_empty_body))
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

            val items = payload.optJSONArray("items")
            // Satu sesi = satu entri, TANPA penggabungan: sesi paralel
            // "pilih salah satu" (beda jam, mata kuliah sama) tetap tampil
            // semua — persis seperti daftar hari ini di aplikasi. Sesi yang
            // sedang berlangsung ditandai ►NOW. Warna dari @color/widget_*
            // (tema-sadar: values = terang, values-night = gelap) — HTML
            // font butuh hex literal, jadi resolve dulu ke string.
            // Keyguard menimpa dengan kontras tinggi fix.
            fun hex(c: Int) = String.format("#%06X", 0xFFFFFF and context.getColor(c))
            val nowColor = if (keyguard) "#6EE7B7" else hex(R.color.widget_now)
            val mutedColor = if (keyguard) "#B8BCC4" else hex(R.color.widget_text_muted)
            val bodyColor = if (keyguard) "#F4F5F7" else hex(R.color.widget_text_body)
            if (keyguard) {
                views.setTextColor(R.id.widget_title, android.graphics.Color.parseColor("#F4F5F7"))
                views.setTextColor(R.id.widget_items, android.graphics.Color.parseColor("#D9DBE0"))
                views.setTextColor(R.id.widget_meta, android.graphics.Color.parseColor("#B8BCC4"))
            }
            val nowMs = System.currentTimeMillis()
            val dual = layoutRes == R.layout.widget_today_wide
            val maxRows = capacityFor(layoutRes, opts)
            val perColumn = if (dual) (maxRows + 1) / 2 else maxRows
            var shown = 0
            val left = StringBuilder()
            val right = StringBuilder()
            if (items != null) {
                for (i in 0 until minOf(items.length(), maxRows)) {
                    val o = items.optJSONObject(i) ?: continue
                    val sb = if (dual && i >= perColumn) right else left
                    val s = o.optString("s")
                    val e = o.optString("e")
                    val name = o.optString("name")
                    val title = o.optString("title")
                    val room = o.optString("room")
                    val sms = o.optLong("sms", 0)
                    val ems = o.optLong("ems", 0)
                    val live = sms in 1 until ems && nowMs in sms until ems
                    // Baris 1: <b>06:00–08:00  BM20A9200</b> <font NOW>
                    sb.append("<b><font color=\"").append(bodyColor).append("\">")
                    sb.append(s)
                    if (e.isNotEmpty()) sb.append('\u2013').append(e)
                    sb.append("&nbsp;&nbsp;").append(name).append("</font></b>")
                    if (live) sb.append("  <font color=\"").append(nowColor).append("\">\u25ba NOW</font>")
                    sb.append("<br>")
                    // Baris 2: nama kursus penuh — bila beda dari kode.
                    if (title.isNotEmpty() && !title.equals(name, ignoreCase = true)) {
                        sb.append("&nbsp;&nbsp;&nbsp;<font color=\"").append(bodyColor).append("\">")
                            .append(title)
                            .append("</font><br>")
                    }
                    // Baris 3: ruangan, paling redup.
                    sb.append("&nbsp;&nbsp;&nbsp;<font color=\"").append(mutedColor).append("\">")
                        .append(room)
                        .append("</font><br>")
                    shown++
                }
            }
            if (left.isEmpty()) {
                left.append(context.getString(R.string.widget_no_lessons))
            } else if (shown < itemsLength(items)) {
                val more = itemsLength(items) - shown
                val target = if (dual && right.isEmpty()) right else left
                target.append("<br><font color=\"").append(mutedColor).append("\">+")
                    .append(more)
                    .append(" more</font>")
            }
            // RemoteViews: HTML string otomatis diparse bila set lewat
            // setTextViewText(int, CharSequence) yang spannable — pakai
            // HtmlCompat agar <b>/<font> benar-benar jadi span.
            views.setTextViewText(
                R.id.widget_items,
                android.text.Html.fromHtml(left.toString().trimEnd('\n').removeSuffix("<br>"), android.text.Html.FROM_HTML_MODE_LEGACY),
            )
            if (dual) {
                views.setTextViewText(
                    R.id.widget_items2,
                    android.text.Html.fromHtml(right.toString().trimEnd('\n').removeSuffix("<br>"), android.text.Html.FROM_HTML_MODE_LEGACY),
                )
            }

            // Baris bawah: hitung mundur kelas berikutnya + jumlah minggu.
            val nextStart = if (payload.has("nextStartMs")) payload.optLong("nextStartMs", 0) else 0
            val countdown = countdownText(context, nextStart, System.currentTimeMillis())
            val meta = context.getString(R.string.widget_week_count, payload.optInt("weekCount"))
            views.setTextViewText(R.id.widget_meta, if (countdown != null) "$countdown  ·  $meta" else meta)
            return views
        }

        /** "In 1 h 05 m" / "Now!" — null bila tidak ada kelas berikutnya. */
        /** items.length() aman untuk nullable array. */
        private fun itemsLength(items: org.json.JSONArray?): Int = items?.length() ?: 0

        /**
         * Kapasitas sesi mengikuti tinggi widget NYATA (dp dari launcher):
         * perbesar → kapasitas naik, perkecil → turun. Kalibrasi 128dp:
         * launcher Pixel (API 36) melaporkan minHeight ~= 128dp untuk
         * targetCellHeight 2 pada ukuran default — harus menghasilkan
         * kapasitas dasar (6 sesi 4×2, 4 sesi 3×2) agar tidak ada baris
         * yang terpotong di bawah tepi.
         */
        private fun capacityFor(layoutRes: Int, opts: Bundle?): Int {
            val base = if (layoutRes == R.layout.widget_today_wide) 6 else 4
            val hDp = opts?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) ?: 0
            if (hDp <= 0) return base
            val cap = Math.round(base * hDp / 128.0).toInt()
            return cap.coerceIn(1, if (layoutRes == R.layout.widget_today_wide) 14 else 12)
        }

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
