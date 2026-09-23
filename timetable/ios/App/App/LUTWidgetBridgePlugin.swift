import Foundation
import Capacitor
import WidgetKit

/**
 * iOS 小组件桥接插件（单向）：web 写完 Preferences（UserDefaults.standard）后
 * 调 lutWidget.refresh() —— 本插件把 payload 复制进 App Group suite 供
 * WidgetKit 扩展读取，并触发 reloadAllTimelines 立即重绘。
 *
 * 契约与 Android 完全一致：key widget_payload_v1 / widget_tasks_payload_v1，
 * JS 名 "lutWidget"，方法 "refresh"。App Group 缺失（侧载重签未授权）时
 * 静默降级——resolve 照常返回，小组件显示自己的引导空态。
 */
@objc(LUTWidgetBridgePlugin)
public class LUTWidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LUTWidgetBridgePlugin"
    public let jsName = "lutWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "refresh", returnType: CAPPluginReturnPromise)
    ]

    private static let groupID = "group.dev.lut.timetable"
    private static let keys = ["widget_payload_v1", "widget_tasks_payload_v1"]

    @objc func refresh(_ call: CAPPluginCall) {
        let suite = UserDefaults(suiteName: Self.groupID)
        var copied = 0
        if let suite = suite {
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
