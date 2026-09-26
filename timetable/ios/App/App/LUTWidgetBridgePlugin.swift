import Foundation
import Capacitor
import WidgetKit
import BackgroundTasks
import WebKit

/**
 * iOS 小组件桥接插件（单向）：web 写完 Preferences（UserDefaults.standard）后
 * 调 lutWidget.refresh() —— 本插件把 payload 复制进 App Group suite 供
 * WidgetKit 扩展读取，并触发 reloadAllTimelines 立即重绘。
 *
 * 契约与 Android 完全一致：key widget_payload_v1 / widget_tasks_payload_v1，
 * JS 名 "lutWidget"，方法 "refresh"。
 *
 * App Group 名**运行时从代码签名 entitlements 解析**：免费 Apple ID 侧载重签
 * 时 group 名会被加 TeamID 前缀，硬编码名在侧载环境必失配。与 widget 读取侧
 * 使用同一解析逻辑；解析不到时回退字面名（开发签名直装场景）。
 * App Group 完全缺失时静默降级——resolve 照常返回，小组件显示引导空态。
 */
@objc(LUTWidgetBridgePlugin)
public class LUTWidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LUTWidgetBridgePlugin"
    public let jsName = "lutWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "refresh", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleBackgroundSync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelBackgroundSync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "backgroundStatus", returnType: CAPPluginReturnPromise)
    ]

    static let keys = ["widget_payload_v1", "widget_tasks_payload_v1"]
    private static let fallbackGroup = "group.dev.lut.timetable"

    /**
     * @capacitor/preferences 在 iOS 上写的是 UserDefaults.standard 里**带
     * "CapacitorStorage." 前缀**的键（见插件源码 Preferences.swift），而小组件读的
     * 是 App Group suite 里的裸键——镜像时必须按前缀取值。
     * 只读裸键等于什么都没复制：iOS 小组件会一直显示空态。
     */
    static let prefPrefix = "CapacitorStorage."

    static func payloadValue(for key: String) -> String? {
        UserDefaults.standard.string(forKey: prefPrefix + key)
            ?? UserDefaults.standard.string(forKey: key)
    }

    // SecTask API 不在 iOS SDK 公开头里稳定暴露，用 @_silgen_name 直接绑定。
    @_silgen_name("SecTaskCreateFromSelf")
    private static func secTaskCreateFromSelf(_ allocator: CFAllocator?) -> CFTypeRef?
    @_silgen_name("SecTaskCopyValueForEntitlement")
    private static func secTaskCopyValueForEntitlement(_ task: CFTypeRef, _ entitlement: CFString, _ error: UnsafeMutablePointer<CFError?>?) -> CFTypeRef?

    /// 与 widget 侧相同的解析：entitlements 里含 "dev.lut.timetable" 的组优先。
    private static func resolveGroup() -> String? {
        if let task = secTaskCreateFromSelf(nil),
           let raw = secTaskCopyValueForEntitlement(task, "com.apple.security.application-groups" as CFString, nil),
           let groups = raw as? [String], !groups.isEmpty {
            return groups.first(where: { $0.contains("dev.lut.timetable") }) ?? groups.first
        }
        return fallbackGroup
    }

    /**
     * 把 payload 镜像进 App Group suite 并触发重绘；返回复制的键数。
     * 前台（refresh 插件方法）与后台（BackgroundSyncRunner 跑完 pass）共用这一份：
     * 载荷只有一个写入出口，才不会出现「前台写的能显示、后台写的不能」。
     */
    @discardableResult
    static func mirrorPayloadToWidget() -> Int {
        var copied = 0
        // 逐个候选组尝试：解析出的组 + 字面名（两端任一命中即共享成功）。
        var candidates = [resolveGroup(), fallbackGroup].compactMap { $0 }
        // 去重保持顺序。
        var seen = Set<String>()
        candidates = candidates.filter { seen.insert($0).inserted }
        for group in candidates {
            guard let suite = UserDefaults(suiteName: group) else { continue }
            for key in keys {
                if let raw = payloadValue(for: key) {
                    suite.set(raw, forKey: key)
                    copied += 1
                }
            }
            suite.synchronize()
        }
        WidgetCenter.shared.reloadAllTimelines()
        return copied
    }

    @objc func refresh(_ call: CAPPluginCall) {
        call.resolve(["copied": Self.mirrorPayloadToWidget()])
    }

    /** 开/关后台周期刷新（契约：src/lib/backgroundSchedule.ts）。 */
    @objc func scheduleBackgroundSync(_ call: CAPPluginCall) {
        let minutes = call.getInt("minutes") ?? 360
        let scheduled = BackgroundSyncRunner.schedule(afterMinutes: minutes)
        call.resolve(["scheduled": scheduled, "intervalMinutes": minutes])
    }

    @objc func cancelBackgroundSync(_ call: CAPPluginCall) {
        BackgroundSyncRunner.cancel()
        call.resolve(["scheduled": false])
    }

    @objc func backgroundStatus(_ call: CAPPluginCall) {
        BackgroundSyncRunner.pending { scheduled in
            call.resolve(["scheduled": scheduled, "taskId": BackgroundSyncRunner.taskId])
        }
    }
}

/**
 * iOS 后台刷新：BGAppRefreshTask + 隐藏 WKWebView 跑 App 自己的 `?bg=1` 入口。
 *
 * 与 Android 的 BackgroundSyncJobService 完全对称：同一个 web bundle、同一个
 * 后台 pass（src/lib/backgroundSync.ts）、同一份载荷键。system 给的执行窗口只有
 * ~30 秒，所以有硬超时（25s），到点就收尾并 setTaskCompleted(success: false)。
 *
 * 后台没有 Capacitor bridge，宿主得自己提供四件事（契约 src/lib/bgHost.ts）：
 * Preferences 读写（带 CapacitorStorage. 前缀）、原生 HTTP（无 CORS）、
 * 小组件镜像+重绘、done 回报。JS 侧用 postMessage 请求 + evaluateJavaScript 应答。
 */
final class BackgroundSyncRunner: NSObject, WKScriptMessageHandler {
    static let taskId = "dev.lut.timetable.bgsync"
    private static let timeoutSeconds: TimeInterval = 25
    /** 调度意图（Preferences，由 JS 写入）：进后台时用它决定要不要续期。 */
    static let schedulePrefKey = "bg_schedule_v1"

    private static var current: BackgroundSyncRunner?

    private var webView: WKWebView?
    private var finished = false
    private var onFinish: ((Bool) -> Void)?

    // MARK: - scheduling

    /** 必须在启动完成前调用（BGTaskScheduler 的硬性要求）。 */
    static func register() {
        if #available(iOS 13.0, *) {
            BGTaskScheduler.shared.register(forTaskWithIdentifier: taskId, using: nil) { task in
                guard let refresh = task as? BGAppRefreshTask else {
                    task.setTaskCompleted(success: false)
                    return
                }
                run(refresh)
            }
        }
    }

    @discardableResult
    static func schedule(afterMinutes minutes: Int) -> Bool {
        if #available(iOS 13.0, *) {
            // 同 id 只能有一个待处理请求：先取消再提交，避免重复排队。
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: taskId)
            let request = BGAppRefreshTaskRequest(identifier: taskId)
            request.earliestBeginDate = Date(timeIntervalSinceNow: TimeInterval(max(minutes, 15)) * 60)
            do {
                try BGTaskScheduler.shared.submit(request)
                return true
            } catch {
                // 模拟器/未授权的环境会在这里失败——后台刷新没开，不影响前台。
                NSLog("LUTBgSync schedule failed: %@", String(describing: error))
                return false
            }
        }
        return false
    }

    static func cancel() {
        if #available(iOS 13.0, *) {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: taskId)
        }
    }

    static func pending(completion: @escaping (Bool) -> Void) {
        if #available(iOS 13.0, *) {
            BGTaskScheduler.shared.getPendingTaskRequests { requests in
                completion(requests.contains { $0.identifier == taskId })
            }
        } else {
            completion(false)
        }
    }

    /** 进后台时续期：iOS 的请求只生效一次，不续就会断链。 */
    static func rescheduleIfEnabled() {
        guard let raw = LUTWidgetBridgePlugin.payloadValue(for: schedulePrefKey), let minutes = Int(raw) else { return }
        schedule(afterMinutes: minutes)
    }

    // MARK: - run

    private static func run(_ task: BGAppRefreshTask) {
        // Apple 的规矩：处理当前请求时就把下一次排上。
        rescheduleIfEnabled()
        let runner = BackgroundSyncRunner()
        current = runner
        runner.onFinish = { ok in
            task.setTaskCompleted(success: ok)
            current = nil
        }
        task.expirationHandler = { runner.abort() }
        runner.start()
    }

    private func start() {
        let controller = WKUserContentController()
        controller.add(self, name: "lutBg")
        // file:// 不能带 query：用注入的标记告诉页面「这是后台那一趟」。
        controller.addUserScript(WKUserScript(
            source: "window.__LUT_BG__ = true",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        let config = WKWebViewConfiguration()
        config.userContentController = controller
        let webView = WKWebView(frame: .zero, configuration: config)
        self.webView = webView

        guard let url = Self.entryUrl() else {
            finish(ok: false)
            return
        }
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.timeoutSeconds) { [weak self] in
            self?.finish(ok: false)
        }
    }

    /** bundle 里的 web 产物（与前台 WebView 同一份 bundle）。 */
    private static func entryUrl() -> URL? {
        Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "public")
    }

    /// 系统要收回（时间用完/低电量）：立刻收尾，不留半截状态。
    func abort() {
        finish(ok: false)
    }

    private func finish(ok: Bool) {
        if finished { return }
        finished = true
        // 后台跑出来的载荷也要镜像进 App Group（JS 侧通常已经调过 refreshWidgets，
        // 这里是兜底：两个入口都对小组件负责）。
        if ok { LUTWidgetBridgePlugin.mirrorPayloadToWidget() }
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "lutBg")
        webView?.stopLoading()
        webView = nil
        NSLog("LUTBgSync done ok=%d", ok ? 1 : 0)
        let done = onFinish
        onFinish = nil
        done?(ok)
    }

    // MARK: - host bridge (契约: src/lib/bgHost.ts)

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else { return }
        switch op {
        case "prefGet":
            reply(id: body["id"], value: Self.prefValue(key: body["key"] as? String))
        case "prefSet":
            if let key = body["key"] as? String, let value = body["value"] as? String {
                UserDefaults.standard.set(value, forKey: LUTWidgetBridgePlugin.prefPrefix + key)
            }
            // 即使没写也要应答：JS 侧的 promise 等着这个 id。
            reply(id: body["id"], value: nil)
        case "refreshWidgets":
            LUTWidgetBridgePlugin.mirrorPayloadToWidget()
            reply(id: body["id"], value: nil)
        case "fetchText":
            fetch(id: body["id"], url: body["url"] as? String, accept: body["accept"] as? String)
        case "done":
            finish(ok: (body["ok"] as? Bool) ?? false)
        default:
            break
        }
    }

    private static func prefValue(key: String?) -> String? {
        guard let key = key else { return nil }
        return UserDefaults.standard.string(forKey: LUTWidgetBridgePlugin.prefPrefix + key)
    }

    /// 原生 HTTP：后台没有 CORS 限制，也不需要 CapacitorHttp 插件。
    private func fetch(id: Any?, url: String?, accept: String?) {
        guard let urlString = url, let url = URL(string: urlString) else {
            reply(id: id, value: nil)
            return
        }
        var request = URLRequest(url: url)
        request.setValue(accept ?? "text/calendar", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 20
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let text = (status < 400 && status != 0) ? data.flatMap { String(data: $0, encoding: .utf8) } : nil
            DispatchQueue.main.async { self?.reply(id: id, value: text) }
        }.resume()
    }

    /// 回话：JS 侧 `window.__lutBgResolve(id, json)`（见 src/lib/bgHost.ts）。
    private func reply(id: Any?, value: String?) {
        guard let id = id, let webView = webView else { return }
        var literal = "null"
        if let value = value,
           let data = try? JSONSerialization.data(withJSONObject: [value]),
           let array = String(data: data, encoding: .utf8) {
            // ["..."] -> "..."（借 JSONSerialization 做转义，比自己拼引号安全）
            literal = String(array.dropFirst().dropLast())
        }
        webView.evaluateJavaScript("window.__lutBgResolve(\(id), \(literal))") { _, _ in }
    }
}
