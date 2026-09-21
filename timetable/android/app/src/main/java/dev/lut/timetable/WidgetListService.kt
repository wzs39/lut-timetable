package dev.lut.timetable

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/**
 * Daftar scrollable untuk ketiga varian widget (ListView + RemoteViewsService —
 * mekanisme koleksi resmi Android). Sebelumnya tiap widget merender maxRows
 * baris ke TextView statis dan memotong sisanya jadi "+N more"; sekarang
 * SEMUA sesi/tugas tersedia via scroll, "+N more" dihapus.
 *
 * Sumber data tetap pref "CapacitorStorage" (widget_payload_v1 /
 * widget_tasks_payload_v1) — web tetap satu pemilik data; service ini hanya
 * membaca, tidak pernah menghitung. onDataSetChanged membaca ulang pref:
 * refresh jembatan (pushWidgetData → renderAll) tinggal notifyAppWidgetViewDataChanged.
 */
class WidgetListService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        if (intent.getStringExtra(EXTRA_KIND) == KIND_TASKS) TasksFactory(applicationContext)
        else LessonsFactory(applicationContext)

    companion object {
        const val EXTRA_KIND = "kind"
        const val KIND_TASKS = "tasks"
        const val KIND_LESSONS = "lessons"
        /** Pref payload tugas (diutak-atik juga WidgetToggleReceiver). */
        const val TASKS_PAYLOAD_KEY = "widget_tasks_payload_v1"
        /** Extra fill-in per baris tugas: id + status target. */
        const val EXTRA_TASK_ID = "taskId"
        const val EXTRA_TASK_DONE = "completed"
        /** Extra fill-in per baris pelajaran: courseid Moodle (0 = tak dipetakan). */
        const val EXTRA_MOODLE_ID = "moodleId"

        /**
         * Fill-in intent checkbox: hanya extras — templatenya dipasang provider
         * (PendingIntent.getBroadcast). Dipanggil sebelum setOnClickFillInIntent.
         */
        fun checkboxExtras(taskId: String, completed: Boolean): Intent =
            Intent().putExtra(EXTRA_TASK_ID, taskId).putExtra(EXTRA_TASK_DONE, completed)

        /** Fill-in baris pelajaran: courseid Moodle (0/absen = buka app biasa). */
        fun lessonExtras(mid: Long): Intent =
            if (mid > 0) Intent().putExtra(EXTRA_MOODLE_ID, mid) else Intent()

        /** Intent untuk setRemoteAdapter (authority unik per widget agar tidak di-cache silang). */
        fun adapterIntent(ctx: Context, kind: String, widgetId: Int): Intent =
            Intent(ctx, WidgetListService::class.java)
                .putExtra(EXTRA_KIND, kind)
                .putExtra(AppWidgetManagerCompat.EXTRA_WIDGET_ID, widgetId)
                .setData(Uri.parse("lutwidget://$kind/$widgetId"))

    }
}

/** Alias kecil agar tidak mengimpor AppWidgetManager di sini saja. */
internal object AppWidgetManagerCompat {
    const val EXTRA_WIDGET_ID = "appWidgetId"
}

/** Palet tema-sadar (values = terang, values-night = gelap) — dibaca per-bind. */
internal object WidgetPalette {
    fun body(ctx: Context) = ctx.getColor(R.color.widget_text_body)
    fun muted(ctx: Context) = ctx.getColor(R.color.widget_text_muted)
    fun late(ctx: Context) = ctx.getColor(R.color.widget_late)
    fun soon(ctx: Context) = ctx.getColor(R.color.widget_soon)
    fun now(ctx: Context) = ctx.getColor(R.color.widget_now)
}

/** Pembaca payload bersama: pref → daftar baris model. */
internal object WidgetRows {
    data class LessonRow(
        val s: String,
        val e: String,
        val name: String,
        val title: String,
        val room: String,
        val sms: Long,
        val ems: Long,
        /** courseid Moodle dari tabel identitas (0 = tak dipetakan). */
        val mid: Long,
    )

    data class TaskRow(
        val id: String,
        val title: String,
        val course: String,
        val due: String,
        val dms: Long,
        val late: Boolean,
        val soon: Boolean,
    )

    fun lessons(ctx: Context): List<LessonRow> {
        val prefs = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val raw = prefs.getString("widget_payload_v1", null) ?: return emptyList()
        return try {
            val arr = org.json.JSONObject(raw).optJSONArray("items") ?: return emptyList()
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                LessonRow(
                    s = o.optString("s"),
                    e = o.optString("e"),
                    name = o.optString("name"),
                    title = o.optString("title"),
                    room = o.optString("room"),
                    sms = o.optLong("sms", 0),
                    ems = o.optLong("ems", 0),
                    mid = o.optLong("mid", 0),
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun tasks(ctx: Context): List<TaskRow> {
        val prefs = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val raw = prefs.getString("widget_tasks_payload_v1", null) ?: return emptyList()
        return try {
            val arr = org.json.JSONObject(raw).optJSONArray("items") ?: return emptyList()
            val nowMs = System.currentTimeMillis()
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val dms = o.optLong("dms", 0)
                val late = o.optBoolean("late") || dms in 1 until nowMs
                val soon = !late && (dms - nowMs) in 1 until 24 * 3600 * 1000L
                TaskRow(
                    id = o.optString("id"),
                    title = o.optString("t"),
                    course = o.optString("c"),
                    due = o.optString("d"),
                    dms = dms,
                    late = late,
                    soon = soon,
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }
}

private const val GONE = android.view.View.GONE
private const val VISIBLE = android.view.View.VISIBLE

/** Factory pelajaran hari ini — dipakai 3×2 & 4×2 (4×2 satu kolom penuh). */
internal class LessonsFactory(private val appCtx: Context) : RemoteViewsService.RemoteViewsFactory {
    private var rows: List<WidgetRows.LessonRow> = emptyList()

    override fun onCreate() {}

    override fun onDataSetChanged() {
        rows = WidgetRows.lessons(appCtx)
    }

    override fun onDestroy() {}

    override fun getCount(): Int = rows.size

    override fun getViewAt(position: Int): RemoteViews {
        val c = appCtx
        val views = RemoteViews(c.packageName, R.layout.widget_row)
        val r = rows.getOrNull(position)
        if (r == null) {
            views.setTextViewText(R.id.row_line1, "")
            views.setTextViewText(R.id.row_line2, "")
            views.setViewVisibility(R.id.row_tag, GONE)
            return views
        }
        val now = System.currentTimeMillis()
        val live = r.sms > 0 && now in r.sms until r.ems
        views.setTextViewText(
            R.id.row_line1,
            buildString {
                append(r.s)
                if (r.e.isNotEmpty()) append('–').append(r.e)
                append("  ").append(r.name)
            },
        )
        views.setTextColor(R.id.row_line1, WidgetPalette.body(c))
        views.setTextViewText(
            R.id.row_line2,
            buildString {
                if (r.title.isNotEmpty() && !r.title.equals(r.name, ignoreCase = true)) {
                    append(r.title)
                    if (r.room.isNotEmpty()) append("  ·  ")
                }
                append(r.room)
            },
        )
        views.setTextColor(R.id.row_line2, WidgetPalette.muted(c))
        if (live) {
            views.setTextViewText(R.id.row_tag, "► NOW")
            views.setTextColor(R.id.row_tag, WidgetPalette.now(c))
            views.setViewVisibility(R.id.row_tag, VISIBLE)
        } else {
            views.setViewVisibility(R.id.row_tag, GONE)
        }
        views.setViewVisibility(R.id.row_check, GONE)
        // Tap baris pelajaran: bawa courseid Moodle bila ada — template
        // broadcast (lessonTemplate) membukanya di browser.
        views.setOnClickFillInIntent(R.id.row_root, WidgetListService.lessonExtras(r.mid))
        return views
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = false
}

/** Factory tugas — deadline terdekat dulu, tag OVERDUE/SOON. */
internal class TasksFactory(private val appCtx: Context) : RemoteViewsService.RemoteViewsFactory {
    private var rows: List<WidgetRows.TaskRow> = emptyList()

    override fun onCreate() {}

    override fun onDataSetChanged() {
        rows = WidgetRows.tasks(appCtx)
    }

    override fun onDestroy() {}

    override fun getCount(): Int = rows.size

    override fun getViewAt(position: Int): RemoteViews {
        val c = appCtx
        val views = RemoteViews(c.packageName, R.layout.widget_row)
        val r = rows.getOrNull(position)
        if (r == null) {
            views.setTextViewText(R.id.row_line1, "")
            views.setTextViewText(R.id.row_line2, "")
            views.setViewVisibility(R.id.row_tag, GONE)
            return views
        }
        views.setTextViewText(
            R.id.row_line1,
            buildString {
                if (r.due.isNotEmpty()) append(r.due).append("  ")
                append(r.title)
            },
        )
        views.setTextColor(R.id.row_line1, WidgetPalette.body(c))
        views.setTextViewText(R.id.row_line2, r.course)
        views.setTextColor(R.id.row_line2, WidgetPalette.muted(c))
        when {
            r.late -> {
                views.setTextViewText(R.id.row_tag, "OVERDUE")
                views.setTextColor(R.id.row_tag, WidgetPalette.late(c))
                views.setViewVisibility(R.id.row_tag, VISIBLE)
            }
            r.soon -> {
                views.setTextViewText(R.id.row_tag, "SOON")
                views.setTextColor(R.id.row_tag, WidgetPalette.soon(c))
                views.setViewVisibility(R.id.row_tag, VISIBLE)
            }
            else -> views.setViewVisibility(R.id.row_tag, GONE)
        }
        // Checkbox: visibel + fill-in intent toggle (template broadcast dipasang
        // provider). Payload lama tanpa id → kotak disembunyikan, baris tetap tap.
        if (r.id.isEmpty()) {
            views.setViewVisibility(R.id.row_check, GONE)
        } else {
            views.setViewVisibility(R.id.row_check, VISIBLE)
            views.setImageViewResource(R.id.row_check, R.drawable.widget_check_off)
            views.setOnClickFillInIntent(R.id.row_check, WidgetListService.checkboxExtras(r.id, true))
        }
        views.setOnClickFillInIntent(R.id.row_root, android.content.Intent())
        return views
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = false
}
