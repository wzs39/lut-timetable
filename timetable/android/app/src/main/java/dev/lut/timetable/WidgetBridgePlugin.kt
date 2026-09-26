package dev.lut.timetable

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Environment
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * Jembatan refresh widget: web memanggil refresh() setelah payload ditulis,
 * SEMUA varian widget langsung digambar ulang — tidak menunggu
 * updatePeriodMillis (30 mnt).
 */
@CapacitorPlugin(name = "lutWidget")
class WidgetBridgePlugin : Plugin() {

    @PluginMethod
    fun refresh(call: PluginCall) {
        val manager = AppWidgetManager.getInstance(context)
        BaseWidgetProvider.renderAll(context, manager)
        val count = listOf(
            TodayWidgetProvider::class.java,
            WideWidgetProvider::class.java,
            TasksWidgetProvider::class.java,
        ).sumOf { cls -> manager.getAppWidgetIds(ComponentName(context, cls)).size }
        call.resolve(JSObject().put("updated", count))
    }

    /**
     * 开/关后台周期刷新（契约：src/lib/backgroundSchedule.ts）。
     * 调度只发生在原生，JS 不持有周期状态——所以 status 也由这里回答。
     */
    @PluginMethod
    fun scheduleBackgroundSync(call: PluginCall) {
        val minutes = call.getInt("minutes") ?: 360
        val scheduled = BackgroundSyncScheduler.schedule(context, minutes)
        call.resolve(JSObject().put("scheduled", scheduled).put("intervalMinutes", minutes))
    }

    @PluginMethod
    fun cancelBackgroundSync(call: PluginCall) {
        BackgroundSyncScheduler.cancel(context, "disabled by autoSync")
        call.resolve(JSObject().put("scheduled", false))
    }

    /** 诊断用：设置页/诊断报告能看到后台任务到底有没有排上。 */
    @PluginMethod
    fun backgroundStatus(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("scheduled", BackgroundSyncScheduler.isScheduled(context))
                .put("jobId", BackgroundSyncScheduler.JOB_ID),
        )
    }

    /**
     * Buang APK unduhan lama di Downloads/ (versi sebelumnya yang sudah
     * terpasang). Dipanggil web tepat sebelum memulai unduhan APK baru —
     * APK lama makan storage percuma. Hapus file apk yang usianya > 1 hari
     * (jangan sentuh unduhan yang baru selesai dan belum dipasang).
     * HANYA file APK — data pengguna (localStorage/backup JSON) tidak disentuh:
     * localStorage tinggal di /data/data (dipertahankan saat update karena
     * package sama), backup JSON di Documents tidak pernah disentuh.
     */
    @PluginMethod
    fun cleanOldApks(call: PluginCall) {
        var removed = 0
        var scanned = 0
        var err: String? = null
        try {
            // Scoped storage (API 29+): File API ke Downloads terlihat tapi
            // delete() diam-diam gagal (kembalikan false) tanpa izin.
            // Jalur yang selalu boleh: hapus APK yang KITA unduh sendiri lewat
            // app-specific cache (getExternalFilesDir) — dan untuk public
            // Downloads pakai ContentResolver delete berdasarkan query
            // MediaStore (pemilik file = app ini bila diunduh via DownloadManager
            // milik WebView… pemiliknya sebenarnya adalah Download Provider).
            // MediaStore delete oleh non-pemilik akan memunculkan dialog
            // konfirmasi sistem — bukan alur senyap; jadi kita coba
            // direct delete dulu (fail-safe), lalu MediaStore (berdialog bila perlu).
            val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            val cutoff = System.currentTimeMillis() - 24 * 3600 * 1000L
            val names = downloads?.listFiles() ?: emptyArray()
            scanned = names.size
            for (f in names) {
                val n = f.name.lowercase()
                if (f.isFile && n.endsWith(".apk") && f.lastModified() < cutoff) {
                    if (f.delete()) removed++
                }
            }
            if (removed == 0) {
                // Fallback DownloadManager: file diunduh lewat DownloadManager
                // WebView → milik com.android.providers.downloads. Entri yang
                // STATUS_SUCCESSFUL + URL kita (github releases) boleh dihapus
                // lewat DownloadManager.remove() — API publik, tanpa dialog.
                try {
                    val dm = context.getSystemService(android.app.DownloadManager::class.java)
                    val q = android.app.DownloadManager.Query().setFilterByStatus(android.app.DownloadManager.STATUS_SUCCESSFUL)
                    dm?.query(q)?.use { c ->
                        val idIdx = c.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_ID)
                        val uriIdx = c.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_LOCAL_URI)
                        val titleIdx = c.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_TITLE)
                        while (c.moveToNext()) {
                            scanned++
                            val local = c.getString(uriIdx) ?: continue
                            val title = c.getString(titleIdx) ?: ""
                            // Hanya unduhan kita: APK dari repo release kita.
                            if (local.lowercase().endsWith(".apk") && (title.contains("LUT") || local.contains("lut-timetable"))) {
                                removed += dm.remove(c.getLong(idIdx))
                                try { File(local.removePrefix("file://")).delete() } catch (_: Exception) {}
                            }
                        }
                    }
                } catch (e: Exception) {
                    err = e.javaClass.simpleName
                }
            }
        } catch (e: Exception) {
            err = e.javaClass.simpleName
        }
        call.resolve(JSObject().put("removed", removed).put("scanned", scanned).put("err", err ?: ""))
    }
}
