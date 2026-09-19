package dev.lut.timetable

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Jembatan refresh widget: web memanggil refresh() setelah payload ditulis,
 * SEMUA varian widget langsung digambar ulang — tidak menunggu
 * updatePeriodMillis (30 mnt).
 */
@CapacitorPlugin(name = "WidgetBridge")
class WidgetBridgePlugin : Plugin() {

    @PluginMethod
    fun refresh(call: PluginCall) {
        val manager = AppWidgetManager.getInstance(context)
        BaseWidgetProvider.renderAll(context, manager)
        val count = listOf(
            TodayWidgetProvider::class.java,
            WideWidgetProvider::class.java,
        ).sumOf { cls -> manager.getAppWidgetIds(ComponentName(context, cls)).size }
        call.resolve(JSObject().put("updated", count))
    }
}
