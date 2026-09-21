package dev.lut.timetable

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast

/**
 * Penerima toggle checkbox di widget tugas (RemoteViews tidak bisa input langsung —
 * pakai pola broadcast goresan: PendingIntent.getBroadcast template di provider +
 * fill-in intent per baris dari factory).
 *
 * Alur saat pengguna mencentang di widget:
 *  1. Tulis operasi ke pref "widget_task_ops_v1" (id + completed, append) —
 *     WEB yang satu-satunya pemilik data asli (localStorage) akan mengonsumsi
 *     antrean ini saat app dibuka/di-resume, lalu memutar updateTask + reverse-sync
 *     server Moodle (aktivitas) lewat jalur yang sama dengan UI dalam app.
 *  2. Balik status `completed` di payload pref (optimis) supaya widget langsung
 *     mencerminkan centang tanpa membuka app.
 *  3. Gambar ulang SEMUA widget (renderAll + notifyAppWidgetViewDataChanged) —
 *     baris yang dicentang hilang dari daftar (payload hanya memuat tugas terbuka).
 *
 * Kolaps data: operasi di-append dengan cap (simpan maksimal MAX_OPS terakhir);
 * payload yang dibalik idempoten (toggle ke state yang sama = no-op).
 */
class WidgetToggleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val appCtx = context.applicationContext ?: return
        if (intent.action == ACTION_OPEN_LESSON) {
            // Tap baris pelajaran: bila payload membawa courseid Moodle (tabel
            // identitas) langsung buka course page di browser — tanpa app.
            // Tanpa courseid: fallback buka app ke view hari ini.
            val mid = intent.getLongExtra(EXTRA_MOODLE_ID, 0L)
            if (mid > 0) {
                appCtx.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse("https://moodle.lut.fi/course/view.php?id=$mid"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } else {
                appCtx.startActivity(
                    Intent(appCtx, MainActivity::class.java)
                        .putExtra("tt_view", "today")
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
            return
        }
        if (intent.action != ACTION_TOGGLE) return
        val id = intent.getStringExtra(EXTRA_ID)
        if (id == null) {
            // Tanpa taskId = tap baris biasa: buka app langsung ke halaman tugas
            // (menggantikan template getActivity lama — satu template broadcast
            // melayani dua aksi sekaligus; tap widget memberi jendela allowlist
            // sesaat sehingga startActivity di sini diizinkan).
            appCtx.startActivity(
                Intent(appCtx, MainActivity::class.java)
                    .putExtra("tt_view", "assign")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return
        }
        val completed = intent.getBooleanExtra(EXTRA_COMPLETED, true)

        // 1) Antrean operasi untuk web (cap agar pref tak tumbuh tanpa batas).
        runCatching {
            val prefs = appCtx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
            val cur = org.json.JSONArray(prefs.getString(OPS_KEY, "[]") ?: "[]")
            val op = org.json.JSONObject().put("id", id).put("completed", completed)
            while (cur.length() >= MAX_OPS) cur.remove(0)
            cur.put(op)
            prefs.edit().putString(OPS_KEY, cur.toString()).apply()
        }

        // 2) Optimis: balik completed di payload pref lalu gambar ulang —
        //    antrean dibaca web nanti; app tidak perlu dibuka.
        runCatching {
            val prefs = appCtx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
            val raw = prefs.getString(WidgetListService.TASKS_PAYLOAD_KEY, null)
            if (raw != null) {
                val obj = org.json.JSONObject(raw)
                val arr = obj.optJSONArray("items")
                if (arr != null) {
                    var i = 0
                    while (i < arr.length()) {
                        val o = arr.optJSONObject(i)
                        if (o != null && id == o.optString("id")) arr.remove(i) else i++
                    }
                    obj.put("openCount", obj.optInt("openCount", 0) - if (completed) 1 else 0)
                    prefs.edit().putString(WidgetListService.TASKS_PAYLOAD_KEY, obj.toString()).apply()
                }
            }
        }
        BaseWidgetProvider.renderAll(appCtx, android.appwidget.AppWidgetManager.getInstance(appCtx))

        // Umpan balik kecil sekali (broadcast bisa terpicu cepat berkali-kali).
        Toast.makeText(appCtx, appCtx.getString(R.string.widget_toggle_done), Toast.LENGTH_SHORT).show()
    }

    companion object {
        const val ACTION_TOGGLE = "dev.lut.timetable.WIDGET_TOGGLE_TASK"
        /** Tap baris pelajaran (widget hari ini): buka Moodle course page / app. */
        const val ACTION_OPEN_LESSON = "dev.lut.timetable.WIDGET_OPEN_LESSON"
        const val EXTRA_ID = "taskId"
        const val EXTRA_MOODLE_ID = "moodleId"
        const val EXTRA_COMPLETED = "completed"
        const val OPS_KEY = "widget_task_ops_v1"
        private const val MAX_OPS = 50

        /**
         * Template broadcast untuk setPendingIntentTemplate di TasksWidgetProvider.
         * MUTABLE wajib: fill-in extras per baris (taskId/completed) diabaikan
         * sistem bila PendingIntent IMMUTABLE (API 31+) — tanpa itu receiver
         * tak pernah tahu baris mana yang dicentang. Basis intent tetap eksplisit
         * ke receiver sendiri, jadi tidak bisa dibajak komponen lain.
         */
        fun toggleTemplate(context: Context): android.app.PendingIntent =
            android.app.PendingIntent.getBroadcast(
                context, 3001,
                Intent(context, WidgetToggleReceiver::class.java).setAction(ACTION_TOGGLE),
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_MUTABLE,
            )

        /**
         * Template tap baris daftar pelajaran (widget hari ini) — receiver
         * yang sama dengan checkbox (satu receiver, dua action). MUTABLE
         * wajib: fill-in extra moodleId per baris diabaikan sistem bila
         * IMMUTABLE (API 31+). moodleId dibaca getLongExtra — fill-in
         * memakai putExtra(Long).
         */
        fun lessonTemplate(context: Context): android.app.PendingIntent =
            android.app.PendingIntent.getBroadcast(
                context, 3002,
                Intent(context, WidgetToggleReceiver::class.java).setAction(ACTION_OPEN_LESSON),
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_MUTABLE,
            )
    }
}
