# LUT Timetable · 开发手册（Playbook）

从 v0.1 到 v0.3.0 全程验证过的经验。开始任何任务前先读这里，避免重交学费。

## 1. 项目地图

- **架构**：单页 React + TS（`timetable/src`）为唯一 UI 源；Electron（Windows）与 Capacitor（Android）只是壳。逻辑全部放 `src/lib`（纯函数、可测），壳只做桥。
- **关键目录**：`src/lib/*` 数据域与纯函数 · `src/hooks/useMoodleData.tsx` 同步编排中枢 · `src/components/moodle/*` Moodle 页分段 · `android/app/src/main/java/dev/lut/timetable/` 小组件（Kotlin，TodayWidgetProvider）· `.github/workflows/native-build.yml` 发布链。
- **数据一致性契约**：Moodle courseid ↔ SISU 课程码 ↔ 显示名 统一查 `src/lib/courseIdentity.ts` 身份表，禁止在域内自造启发式匹配。
- **同步域**：五个 Moodle 域（grades/notifications/submissions/contents/timeline）走 `src/lib/moodleSync.ts` 的声明式注册表（TTL 缓存 + 在途去重 + 失败回退缓存）。加新域 = 注册一条，不复制模式。
- **双源任务**：ICS 日历任务与 action 时间线任务按 eventId 去重合并（`moodle.ts`），action 接管后 ICS 不复活。

## 2. 铁律（每条都交过学费）

1. **纯函数下沉**：能写成 `(input) => output` 的逻辑（分桶、匹配、合并、权重）放 `lib/` + 配 vitest 测试。React 组件只管渲染。修 bug 先问"这段逻辑能不能脱离 DOM 测"。
2. **先探真服务器再写解析**：Moodle WS 字段名以实际响应为准，别信文档或记忆。已翻车：`statuses`≠`statuslist`（completion）、`get_calendar_events.instance` 是模块实例 id 而真 cmid 在 `get_calendar_event_by_id`、`limitnum` 上限 50（传 100 静默失败）。
3. **一门 API 一次作业**：ws 参数格式（`events[eventids][0]=…`、`cmid`+`completed` 而非 `completionstate`）先用真实 token curl 验证，确认返回结构再动代码。
4. **UI 改动必须装机截图实证**，不能只靠 tsc 绿。WebView 有应用级缓存：改完必须 `npm run build && npx cap copy android`（有时要 `cap sync`），并确认 `install -r` 真的成功（签名冲突会静默失败——debug/release APK 混装时**卸载重装**）。
5. **测试环境是 node**（部分文件标注 jsdom）：不要依赖 `document`，HTML 实体解码要纯函数表（`lib/html.ts` 模式）。
6. **XML 注释里禁止 `--`**（Kotlin/Android res 会炸编译）；`install -r` 输出必须 grep `Success`。
7. **后台任务并行化的正确拆法**：网络抓取 `Promise.allSettled` 并行，**应用/落盘保序串行**（两个域都写任务列表时，并行 `onTasks` 会互相覆盖）。真依赖（如身份表 anchor）保持先行。在途去重 map（如 `syncDomain` 的 `inFlight`）的注册要先于任何可能的清理执行：回调可能同步抛错，`finally` 会抢在 `set` 前删除——用 microtask（`Promise.resolve().then`）启动回调体。
8. **凭据/token 不落盘、不进 git**；测试完清理种子数据。
9. **布局自查三查**（flex 遮挡类 bug 的统一预防）：① 行内展开面板（`display:contents`/`basis-full`/`order-last`）所在的 flex 行必须配 `flex-wrap`，否则面板和行内容抢宽度互相挤压；② flex 子项上的 `truncate` 必须配 `min-w-0`（flex 子项最小宽度默认是内容宽，截断静默失效、顶飞兄弟按钮）；③ 被截断的文本一律带 `title` 保留完整信息。

## 3. 常用工作流

### 门禁（每次改动收尾必跑）
```bash
cd timetable && npx tsc -b --pretty false && npx vitest run && npx oxlint
```
改了 web 资产后要在模拟器验证：`npm run build && npx cap copy android` → gradle 装机 → CDP 实测。

### Android 端到端（效率优先：CDP 驱动，不手点）
- JDK: `C:/Users/qwe/AppData/Local/Temp/jdk21-extract/…`（若失效，先 `ls` 找）；ADB: `E:/Android/platform-tools/adb.exe`。
- 装机：`gradle assembleDebug` → `adb install -r`（**grep Success**）→ 冷启动。
- CDP：`adb forward tcp:93xx localabstract:webview_devtools_remote_<PID>` —— **socket 名含 PID，应用重启后要按新 PID 重建转发**；部分 WebView 禁用 `/json` 列表端点时用已知端口直连 ws。
- 注入/读取状态：写 `.freebuff/*.js` 片段用 `ws-eval.cjs` 执行（改 localStorage 后 reload 生效）。
- 截图：`adb exec-out screencap -p > xx.png`，**用 read_files 看图**，别猜。

### 发布链（版本由 CI 计算，永远 tag-aware，别手 bump tag）
1. 本地门禁全绿 → `git checkout -b feat/<题>` → 分批提交（每批一个清晰 commit，仓库风格：祈使句 + 原因）。
2. push → 开 PR → 合并 → push 触发的构建自动发 **patch**（如 v0.3.1）。
3. 要发 minor/major：合并后 `gh workflow run native-build.yml -f publish=true -f minor=true`（workflow 里也支持 major 入参）。
4. 验证 release 资产五件套：`LUT Timetable Setup.exe`、`.msi`、`latest.yml`、`app-release.apk`、`apk-metadata.json`；用 aapt 确认 APK `versionName`。
5. 应用内更新验证：旧版客户端启动 → 更新横幅 → 下载 APK → 安装 → `adb shell dumpsys package | grep versionName`。

### 真实数据验证
模拟器/Windows 客户端互拷 token 与缓存是合法捷径（同一账号）。用 Windows 客户端（CDP 9223/9224）或模拟器（CDP 转发）执行 `fetch` 打真 Moodle WS 验证字段与 URL——**跳转 URL 类改动必须真的打开一次页面**。

## 4. 已知坑位速查

| 坑 | 症状 | 解法 |
|---|---|---|
| CapacitorHttp 非 2xx 返回 HTML 错误页 | Android 报 "invalid JSON" | 网络层容忍非 JSON 响应，按失败处理并回退缓存 |
| WebView 资产缓存 | 改了代码模拟器没变化 | `cap copy` 后确认 `lastUpdateTime`；必要时卸载重装 |
| `install -r` 签名冲突 | 静默失败，旧 APK 还在跑 | 卸载重装；装完 grep `Success` |
| CDP socket 失效 | 转发后 curl 空 | 应用重启 PID 变了，按新 PID 重建转发 |
| CDP eval 响应截断（约 3000 字符） | dump localStorage 大值时 JSON 解析失败 | 只取小键（<1.5KB）或分键 dump，别整库导出 |
| adb 多设备 | install/shell 报 more than one device | 一律带 `-s <serial>`（如 `emulator-18080`） |
| `pm clear` 清掉登录态 | 模拟器变全新装，Moodle 数据全没 | 从 Windows 客户端 dump `tt_moodle_source_v1`/`tt_grades_source_v1` 重注（只取小键，见截断行） |
| Moodle `limitnum>50` | 请求静默空返回 | 永远 ≤50，需要更多就分页 |
| gradle `JAVA_HOME` 错 / daemon 缓存失效 | 报 "Cannot find a Java installation (languageVersion=21)"——即使 JDK 目录明明存在（【修正】旧条目只说确认目录，不够） | ① 确认 JDK 21 目录在（`Temp/jdk21-extract`，本机另有 JDK 25 但 toolchain 钉死 21）；② `gradlew --stop` 清 daemon 缓存后重建 |
| Windows 截图截到别的窗口 | 图与代码对不上 | 用模拟器截图，或先把目标窗口带到前台 |
| electron-builder 产物名含版本 | 引用旧文件名失败 | 用 `latest.yml` 解析实际文件名 |
| 坏 URL 已写入用户设备 | 跳转报错页持续存在 | 自愈式修复：同步时检测并升级 URL，靠下一次同步修正而非迁移脚本 |

## 5. 高效原则（接下任务的姿势）

- **进度可见**：多步任务先 `write_todos`，每完成一项更新——中断恢复时靠它续命。
- **经验回写**（本文件的维护规则）：每次任务收尾把新经验/坑位写回本文件对应小节；与已有条目冲突时**修正旧条目**而不是并列保留互相矛盾的两条，修正处标注【修正】+ 依据；过时条目直接删除。用户偏好类经验（如验证方式）以最新一次明确表态为准。
- **本地实测优先**（【修正】用户先说用 preview，后因 preview 无登录态、无真实数据、注入成本高而改口「还是用本地的吧，别用preview了，速度要快，效率要高」——以最新为准）：直接用模拟器/已装应用 + CDP 驱动验证并截图，不为验证另起 dev server。
- **一次到位的验证**：改跳转就真点一次链接；改同步就真触发一次同步看落盘数据；改小组件就截三个尺寸的图。
- **修复要带测试**：每个 bug 修复配一条锁定契约的测试，防止回归（现 344+ 条测试是这么攒出来的）。
- **收尾三件事**：门禁跑全 → 种子/临时数据清理 → 改动批次说明（哪些文件、什么行为、是否需要发版）——外加经验回写（见上）。

## 6. 当前状态（2026-09 梳理）

- 已发布 v0.3.0（双平台，应用内更新链路验证通过）。
- 工作树未提交批次：小组件全套（resize/主题/毛玻璃/溢出）、课程板块遮挡修复、作业 URL 自愈升级、对号状态修复 + 自主标记、backgroundRefresh 并行化、syncDomain 在途去重、flex 行遮挡排查修复（SyncProtection ×2 `min-w-0`）、本文件 → 攒够一批走 v0.3.1。
- iOS：曾有 App Store 计划，未启动（需要 macOS + 开发者账号，CI 是 Windows runner）。
