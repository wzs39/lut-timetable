import Foundation
import Capacitor
import WidgetKit

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
        CAPPluginMethod(name: "refresh", returnType: CAPPluginReturnPromise)
    ]

    private static let keys = ["widget_payload_v1", "widget_tasks_payload_v1"]
    private static let fallbackGroup = "group.dev.lut.timetable"

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

    @objc func refresh(_ call: CAPPluginCall) {
        var copied = 0
        // 逐候选组尝试：解析出的组 + 字面名（两端任一命中即共享成功）。
        var candidates = [Self.resolveGroup(), Self.fallbackGroup].compactMap { $0 }
        // 去重保持顺序。
        var seen = Set<String>()
        candidates = candidates.filter { seen.insert($0).inserted }
        for group in candidates {
            guard let suite = UserDefaults(suiteName: group) else { continue }
            for key in Self.keys {
                if let raw = UserDefaults.standard.string(forKey: key) {
                    suite.set(raw, forKey: key)
                    copied += 1
                }
            }
            suite.synchronize()
        }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve(["copied": copied])
    }
}
