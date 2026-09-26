package dev.lut.timetable

import android.annotation.SuppressLint
import android.app.job.JobParameters
import android.app.job.JobService
import android.appwidget.AppWidgetManager
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import java.net.HttpURLConnection
import java.net.URL

/**
 * 后台刷新：在隐藏 WebView 里跑 App 自己的 `?bg=1` 入口。
 *
 * 为什么是 WebView：同步逻辑（ICS 解析、跨源合并、模板清洗、审计）全在 TS 里，
 * 后台必须跑**同一份代码**。Android 上唯一现成的 JS 引擎就是 WebView，所以这里
 * 给它搭一个没有 UI 的宿主，用 WebViewAssetLoader 把 `assets/public` 挂在
 * `https://appassets.androidplatform.net` 下（ES module 在 file:// 会被 CORS 拦，
 * 必须走 https origin）。
 *
 * 后台没有 Capacitor 插件，也没有 localStorage/Preferences 的 JS API，所以宿主
 * 注入三件事（`window.lutBg`）：原生 HTTP（无 CORS）、读写 CapacitorStorage、
 * 让小组件重画。契约见 src/lib/bgHost.ts。
 */
@SuppressLint("SetJavaScriptEnabled")
class BackgroundSyncJobService : JobService() {

    private val main = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    private var params: JobParameters? = null
    private var finished = false
    private var timeout: Runnable? = null

    private fun prefs() = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)

    override fun onStartJob(jobParams: JobParameters?): Boolean {
        params = jobParams
        finished = false
        return try {
            startWebView()
            // 看门狗：WebView 卡住（网络黑洞、JS 死循环）必须自己收尾，
            // 否则 JobScheduler 会一直占着这个任务槽。
            val t = Runnable {
                Log.w(TAG, "timeout after ${TIMEOUT_MS}ms")
                finish(false, "timeout")
            }
            timeout = t
            main.postDelayed(t, TIMEOUT_MS)
            true
        } catch (e: Exception) {
            Log.e(TAG, "cannot start webview: ${e.javaClass.simpleName}")
            finish(false, "webview")
            false
        }
    }

    override fun onStopJob(jobParams: JobParameters?): Boolean {
        // 系统要收回（切网、Doze…）：清干净，并让下一次周期继续（return true）
        finish(false, "stopped")
        return true
    }

    private fun startWebView() {
        val wv = WebView(this)
        webView = wv
        with(wv.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_NO_CACHE
            // 只加载我们自己的 assets：不开放 file://，也不允许 JS 开新窗口
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
        }
        wv.addJavascriptInterface(BgBridge(), "lutBg")

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        wv.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            /** 后台页面没有任何导航需求：非 assets 的跳转一律拒绝。 */
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !isOwnAssetUrl(request.url)

            private fun isOwnAssetUrl(uri: Uri): Boolean =
                uri.host == "appassets.androidplatform.net" && uri.path?.startsWith("/assets/") == true
        }

        wv.loadUrl("$ASSET_ORIGIN/assets/public/index.html?bg=1")
        Log.i(TAG, "started")
    }

    private fun finish(ok: Boolean, note: String?) {
        if (finished) return
        finished = true
        timeout?.let { main.removeCallbacks(it) }
        timeout = null
        try {
            webView?.stopLoading()
            webView?.destroy()
        } catch (_: Exception) {
            // destroy 失败无所谓：进程退出时会被回收
        }
        webView = null
        Log.i(TAG, "done ok=$ok note=${note ?: ""}")
        jobFinished(params, false)
    }

    /**
     * 注入给页面 JS 的宿主（契约：src/lib/bgHost.ts）。
     * 方法必须是同步返回的 —— @JavascriptInterface 没有 Promise，
     * JS 侧的包装会把它包成 Promise。
     */
    private inner class BgBridge {

        @JavascriptInterface
        fun prefGet(key: String): String? = try {
            prefs().getString(key, null)
        } catch (_: Exception) {
            null
        }

        /** 写进 @capacitor/preferences 的同一份存储（group = CapacitorStorage）。 */
        @JavascriptInterface
        fun prefSet(key: String, value: String) {
            try {
                prefs().edit().putString(key, value).apply()
            } catch (e: Exception) {
                Log.w(TAG, "prefSet failed: ${e.javaClass.simpleName}")
            }
        }

        /** 原生 HTTP：后台没有 CORS，也不需要 Capacitor 的 CapacitorHttp 插件。 */
        @JavascriptInterface
        fun fetchText(url: String, accept: String): String? = try {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 10_000
                readTimeout = 20_000
                setRequestProperty("Accept", accept)
                setRequestProperty("User-Agent", "LUT-Timetable-BackgroundSync")
            }
            try {
                if (conn.responseCode >= 400) {
                    Log.w(TAG, "fetch ${conn.responseCode}")
                    null
                } else {
                    conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
                }
            } finally {
                conn.disconnect()
            }
        } catch (e: Exception) {
            Log.w(TAG, "fetch failed: ${e.javaClass.simpleName}")
            null
        }

        /** 小组件重画走已有的渲染器：后台刷新出来的载荷立刻可见。 */
        @JavascriptInterface
        fun refreshWidgets() {
            Log.i(TAG, "refreshWidgets")
            main.post {
                try {
                    BaseWidgetProvider.renderAll(this@BackgroundSyncJobService, AppWidgetManager.getInstance(this@BackgroundSyncJobService))
                } catch (e: Exception) {
                    Log.w(TAG, "refreshWidgets failed: ${e.javaClass.simpleName}")
                }
            }
        }

        @JavascriptInterface
        fun done(json: String) {
            main.post { finish(!json.contains("\"ok\":false"), json) }
        }
    }

    private companion object {
        const val TAG = "LUTBgSync"
        const val ASSET_ORIGIN = "https://appassets.androidplatform.net"
        const val TIMEOUT_MS = 90_000L
    }
}
