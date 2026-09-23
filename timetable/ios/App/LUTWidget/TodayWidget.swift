import WidgetKit
import SwiftUI
import UIKit

// MARK: - 载荷（与 web 端 widgetData.ts 的 widget_payload_v1 同契约）
// 注意：不能标 private——internal 的 Entry/视图成员引用它会被 Swift 访问级别检查拒绝。
struct WidgetLesson: Decodable {
    let s: String      // hh:mm 开始（展示）
    let e: String      // hh:mm 结束
    let name: String   // 课程码，无码时为标题
    let title: String
    let room: String
    let sms: Double    // epoch ms 开始
    let ems: Double    // epoch ms 结束
}

struct WidgetPayload: Decodable {
    struct Next: Decodable { let name: String; let room: String; let at: String }
    let updatedAt: Double
    let date: String       // yyyy-MM-dd（本地日）
    let items: [WidgetLesson]
    let weekCount: Int
    let next: Next?
}

struct TodayEntry: TimelineEntry {
    let date: Date
    let payload: WidgetPayload?
    /// 该时刻正在进行的课（仅 payload 当天有效）
    let current: WidgetLesson?
    /// 严格「尚未开始」的第一节（锁屏/圆环用它）
    let next: WidgetLesson?
}

private let groupID = "group.dev.lut.timetable"
private let payloadKey = "widget_payload_v1"

/// 读共享数据：App Group 主通道。读不到（重签未授 App Groups）→ nil，
/// 小组件显示引导空态，不崩溃。
private func loadPayload() -> WidgetPayload? {
    guard let suite = UserDefaults(suiteName: groupID),
          let raw = suite.string(forKey: payloadKey) else { return nil }
    return try? JSONDecoder().decode(WidgetPayload.self, from: Data(raw.utf8))
}

private func localDay(_ d: Date) -> String {
    let c = Calendar.current
    return String(format: "%04d-%02d-%02d", c.component(.year, from: d),
                  c.component(.month, from: d), c.component(.day, from: d))
}

/// 给定时间点投影出 current/next（只在 payload 描述的当天有效）。
private func project(_ p: WidgetPayload, at date: Date) -> (WidgetLesson?, WidgetLesson?) {
    guard p.date == localDay(date) else { return (nil, nil) }
    let ms = date.timeIntervalSince1970 * 1000
    let cur = p.items.first { ms >= $0.sms && ms < $0.ems }
    let next = p.items.first { $0.sms > ms }
    return (cur, next)
}

// MARK: - TimelineProvider

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: Date(), payload: nil, current: nil, next: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(makeEntry(Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let payload = loadPayload()
        var entries = [makeEntry(Date(), payload: payload)]
        // 每个课程开始/结束边界各放一个 entry：NOW 高亮随时间自动跳到下一节。
        if let p = payload, p.date == localDay(Date()) {
            let now = Date()
            let boundaries = p.items.flatMap { [$0.sms, $0.ems] }
                .map { Date(timeIntervalSince1970: $0 / 1000) }
                .filter { $0 > now }
                .sorted()
                .prefix(12)
            entries += boundaries.map { makeEntry($0, payload: payload) }
        }
        // 跨天后到午夜重取（payload 由应用侧推送刷新）。
        let midnight = Calendar.current.startOfDay(for: Calendar.current.date(byAdding: .day, value: 1, to: Date())!)
        completion(Timeline(entries: entries, policy: .after(midnight)))
    }

    private func makeEntry(_ date: Date, payload: WidgetPayload? = nil) -> TodayEntry {
        let p = payload ?? loadPayload()
        let (cur, next) = p.map { project($0, at: date) } ?? (nil, nil)
        return TodayEntry(date: date, payload: p, current: cur, next: next)
    }
}

// MARK: - 视图

private struct LessonRow: View {
    let item: WidgetLesson
    let isNow: Bool

    var body: some View {
        HStack(spacing: 6) {
            Text(item.s)
                .font(.caption2.monospacedDigit())
                .foregroundColor(isNow ? .accentColor : .secondary)
                .frame(width: 38, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.name)
                    .font(.caption.weight(isNow ? .semibold : .regular))
                    .foregroundColor(isNow ? .accentColor : .primary)
                    .lineLimit(1)
                Text(item.room)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if isNow {
                Text("NOW")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(.accentColor)
            } else {
                Text(item.e)
                    .font(.caption2.monospacedDigit())
                    .foregroundColor(.secondary)
            }
        }
    }
}

private struct EmptyState: View {
    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "calendar.badge.exclamationmark")
                .font(.title3)
                .foregroundColor(.secondary)
            Text("暂无数据")
                .font(.caption)
                .foregroundColor(.secondary)
            Text("打开应用同步课程")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
    }
}

struct TodayWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    var entry: TodayEntry

    var body: some View {
        Group {
            if #available(iOS 17.0, *) {
                content.containerBackground(for: .widget) { Color(uiColor: .systemBackground) }
            } else {
                content.padding(12)
            }
        }
        .widgetURL(URL(string: "dev.lut.timetable://"))
    }

    @ViewBuilder
    private var content: some View {
        switch family {
        case .systemSmall: small
        case .systemMedium: medium
        case .systemLarge: large
        default:
            // accessory 族是 iOS 16+ 的可用性注解枚举，直接 case 会编译报错；
            // 用 default + @available 子视图隔离。
            if #available(iOS 16.0, *) {
                accessories
            } else {
                small
            }
        }
    }

    @available(iOS 16.0, *)
    @ViewBuilder
    private var accessories: some View {
        switch family {
        case .accessoryInline: inline
        case .accessoryRectangular: rectangular
        case .accessoryCircular: circular
        default: small
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let cur = entry.current {
                HStack {
                    Text("进行中")
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(.accentColor)
                    Spacer()
                    Text("\(cur.s)–\(cur.e)")
                        .font(.caption2.monospacedDigit())
                        .foregroundColor(.secondary)
                }
                Text(cur.name)
                    .font(.footnote.weight(.semibold))
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                Text(cur.room)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if let p = entry.payload {
                    Text("本周 \(p.weekCount) 节")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            } else if let next = entry.next {
                HStack {
                    Text("下一节")
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(.accentColor)
                    Spacer()
                    Text(next.s)
                        .font(.caption2.monospacedDigit())
                        .foregroundColor(.secondary)
                }
                Text(next.name)
                    .font(.footnote.weight(.semibold))
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                Text(next.room)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if let p = entry.payload {
                    Text("本周 \(p.weekCount) 节")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            } else if entry.payload != nil {
                VStack(spacing: 3) {
                    Text("今天没课 🎉")
                        .font(.footnote.weight(.medium))
                    if let p = entry.payload {
                        Text("本周 \(p.weekCount) 节")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                }
            } else {
                EmptyState()
            }
        }
    }

    private var medium: some View {
        VStack(alignment: .leading, spacing: 5) {
            if let p = entry.payload, !p.items.isEmpty {
                ForEach(Array(p.items.prefix(4).enumerated()), id: \.offset) { _, item in
                    LessonRow(item: item, isNow: item.sms == entry.current?.sms)
                }
                if p.items.count > 4 {
                    Text("+\(p.items.count - 4) 更多")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            } else if entry.payload != nil {
                Text("今天没课 🎉")
                    .font(.footnote)
                Spacer()
            } else {
                EmptyState()
            }
        }
    }

    private var large: some View {
        VStack(alignment: .leading, spacing: 5) {
            if let p = entry.payload, !p.items.isEmpty {
                HStack {
                    Text("今日课程")
                        .font(.footnote.weight(.semibold))
                    Spacer()
                    Text("本周 \(p.weekCount) 节")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                .padding(.bottom, 2)
                ForEach(Array(p.items.prefix(8).enumerated()), id: \.offset) { _, item in
                    LessonRow(item: item, isNow: item.sms == entry.current?.sms)
                }
                if p.items.count > 8 {
                    Text("+\(p.items.count - 8) 更多")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                Spacer(minLength: 0)
            } else if entry.payload != nil {
                Text("今天没课 🎉")
                    .font(.footnote)
                Spacer()
            } else {
                EmptyState()
            }
        }
    }

    @ViewBuilder
    private var inline: some View {
        if let next = entry.next {
            Text("\(next.s) \(next.name)")
        } else if entry.current != nil {
            Text("上课中")
        } else {
            Text("今天没课")
        }
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let next = entry.next {
                Text("下一节 \(next.s)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                Text(next.name)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Text(next.room)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            } else {
                Text(entry.current != nil ? "上课中" : "今天没课")
                    .font(.caption)
            }
        }
    }

    private var circular: some View {
        VStack(spacing: 0) {
            if let next = entry.next {
                Text(next.s)
                    .font(.caption.weight(.bold).monospacedDigit())
                Text(next.room)
                    .font(.system(size: 8))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            } else {
                Text("无课")
                    .font(.caption2)
            }
        }
    }
}

// MARK: - 小组件声明

@main
struct LUTTimetableWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TodayLessons", provider: TodayProvider()) { entry in
            TodayWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("今日课表")
        .description("显示今天的课程、进行中的课和下一节。")
        .supportedFamilies(families())
    }

    private func families() -> [WidgetFamily] {
        // accessory 族 iOS 16+（锁屏/灵动岛）；system 族全版本。
        if #available(iOSApplicationExtension 16.0, *) {
            return [.systemSmall, .systemMedium, .systemLarge, .accessoryInline, .accessoryRectangular, .accessoryCircular]
        }
        return [.systemSmall, .systemMedium, .systemLarge]
    }
}
