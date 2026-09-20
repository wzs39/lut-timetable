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
2. **先探真服务器再写解析**：Moodle WS 字段名以实际响应为准，别信文档或记忆。已翻车：`statuses`≠`statuslist`（completion）、`get_calendar_events.instance` 是模块实例 id 而真 cmid 在 `get_calendar_event_by_id`、`limitnum` 上限 50（传 100 静默失败）、**`mod_assign_get_submissions`/`get_grades` 是教师视角 API——LUT 学生 token 返回 "No access rights"，学生自己的提交状态要从 `gradereport_user_get_grade_items` 的 gradeitems 拿（带 cmid + `gradedatesubmitted/graded`）**。
3. **一门 API 一次作业**：ws 参数格式（`events[eventids][0]=…`、`cmid`+`completed` 而非 `completionstate`）先用真实 token curl 验证，确认返回结构再动代码。
4. **UI 改动必须装机截图实证**，不能只靠 tsc 绿。WebView 有应用级缓存：改完必须 `npm run build && npx cap copy android`（有时要 `cap sync`），并确认 `install -r` 真的成功（签名冲突会静默失败——debug/release APK 混装时**卸载重装**）。【修正】只跑 gradle 不带 cap copy/sync 时，APK 烙进的是 assets 里的旧 bundle——症状是"改的代码没生效、旧 bug 复现"，别往逻辑上查
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
- docs-only 提交也走 push → 自动发版：推任何 main 提交前先想"这次要不要发版"；纯文档改动想避免发版就攒到下一次功能提交一起推，或推完立刻 `gh run cancel`
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
| 组件测试没包 MoodleProvider | TaskRow/今日页/作业页测试全组红 "must be used inside MoodleProvider" | jsdom 渲染时包 `MoodleProvider`（真实 App 在 App.tsx 的 AppInner 外层已包） |
| 同名函数不同义（如 ics/courses 各有一份 extractCourseCode：一个剥分组号一个保留） | 按"重复"合并后颜色分桶/去重/匹配行为悄悄改变 | 合并前先 diff 正则与返回值语义；刻意分歧保留两份并在注释里互相指向 |
| CI gate/脚本用 npx 但放在 npm ci 之前 | 本地全绿、fresh runner 上 ENOENT/vitest 不存在 | 任何 npx 步骤必须排在依赖安装之后；本地暴露不了，首次 push CI 才炸 |
| 测试 fixture 手写 UTC 日期字面量 | UTC+8 本地绿、UTC CI runner 红（差一天） | key/断言从同一 Date 推导（toISOString().slice(0,10)），并发 PR 前 `TZ=UTC npx vitest run` 复跑一遍 |
| WebView 资产缓存 | 改了代码模拟器没变化 | `cap copy` 后确认 `lastUpdateTime`；必要时卸载重装 |
| `install -r` 签名冲突 | 静默失败，旧 APK 还在跑 | 卸载重装；装完 grep `Success` |
| 本地通知 `smallIcon` 缺省回退自适应启动器图标 | MIUI 等厂商 ROM 展开/点击通知时 RemoteServiceException 杀进程（"点通知就退出"），AOSP 模拟器复现不了 | 必须专用纯白线条透明底图标（`ic_stat_lesson`，全密度 drawable-*）；模拟器验证通过不代表厂商 ROM 通过 |
| 移动端抽屉面板高度塌缩 | 抽屉内容比屏短时下方露一截黑（桌面端 flex 拉伸正常，移动端容器非 flex） | `aside` 面板加 `h-full`；验证用 Playwright 量 `aside.height === innerHeight`，别靠目测截图 |
| Playwright `page.click` 超时但元素存在 | viewport 393 下 `.click()` 挂起（无障碍命中检查被画布/转换干扰） | 改 `evaluate(() => btn.click())` 直接触发；React 受控 input 用原生 setter + `dispatchEvent('input')` |
| CDP socket 失效 | 转发后 curl 空 | 应用重启 PID 变了，按新 PID 重建转发 |
| 同一徽标/格式多处手写副本（quizBadge 文本 vs 图标、formatDue 三份 toLocaleString） | 两页同信息不同样式，改一处漏一处 | 新文案/格式先问"哪里还渲染同一数据"，共享组件 + lib 函数单一来源（TaskBadges.ModBadge、date.formatDateTime）；i18n 死键随手删 |
| 组件测试契约（assignmentsView/gradesSection） | mock MoodleData 要全 24 字段（as unknown as 兜底）；taskMatchKey 的 due 键是 UTC（本地日期会差一天）；`course()` 无参调用需默认参数 `= {}`，否则 TS2554 在运行时绿 tsc 红 | vi.fn 带实现签名；fixture 键用 toISOString().slice(0,10) 推导而非手写；helper 函数参数一律给默认值 |
| preview reload 清掉 window 上的测试变量 | stub 里引用 `window.__x` 种子值，reload 后变 undefined，误判功能没生效 | stub 的种子值内联到闭包里（每次 evaluate 重新定义），别跨 reload 引用 |
| 测试计数与实际文件数对不上（如 376 vs "379"） | 怀疑 include 模式漏子目录（components/ 15 条） | vitest include `src/**/*.test.ts(x)` 的 `**` 本就跨目录段——先 `vitest list` 数真实收集数，别按目录分片跑再手加；两轮不同会话的计数差异多半是中途加删了用例，不是模式问题。已由 `npm run test:consistent`（CI android job 首步）锁定：vitest list 收集数 ≠ run 执行数即 fail |
| preview 截图不可用（"produced no frames"）+ 窄视口 | 想看视觉效果时截图报错；preview 视口 <768px 走移动端分支，桌面分支（如周视图 7 列）验证不到 | 截图失败别死磕——DOM 断言（class/style/文本/计数）足够实证样式生效；要验桌面分支就声明视口宽度的独立浏览器会话 |
| CDP eval 响应截断（约 3000 字符） | dump localStorage 大值时 JSON 解析失败 | 只取小键（<1.5KB）或分键 dump，别整库导出 |
| adb 多设备 | install/shell 报 more than one device | 一律带 `-s <serial>`（如 `emulator-18080`） |
| `pm clear` 清掉登录态 | 模拟器变全新装，Moodle 数据全没 | 从 Windows 客户端 dump `tt_moodle_source_v1`/`tt_grades_source_v1` 重注（只取小键，见截断行） |
| Moodle `limitnum>50` | 请求静默空返回 | 永远 ≤50，需要更多就分页 |
| gradle `JAVA_HOME` 错 / daemon 缓存失效 | 报 "Cannot find a Java installation (languageVersion=21)"——即使 JDK 目录明明存在（【修正】旧条目只说确认目录，不够） | ① 确认 JDK 21 目录在（`Temp/jdk21-extract`，本机另有 JDK 25 但 toolchain 钉死 21）；② `gradlew --stop` 清 daemon 缓存后重建 |
| Windows 截图截到别的窗口 | 图与代码对不上 | 用模拟器截图，或先把目标窗口带到前台 |
| electron-builder 产物名含版本 | 引用旧文件名失败 | 用 `latest.yml` 解析实际文件名 |
| 坏 URL 已写入用户设备 | 跳转报错页持续存在 | 自愈式修复：同步时检测并升级 URL，靠下一次同步修正而非迁移脚本 |
| 成绩 API 字段误判（【修正】gradeCalc 旧注释「LUT 不暴露权重」是错的——weightraw 一直在，旧结论来自过时检查） | 加权分算不出、退化为简单平均 | `gradereport_user_get_grade_items` 字段图景：`weightraw`=权重占比（**相对父分类**，顶层项即占课程；嵌套叶子可能为 null，权重在父 category 行上）；`weightformatted`/`percentageformatted`/`rangeformatted` 是现成显示串；`itemtype:'category'` 行是 subtotal 垃圾行必须滤掉；`itemtype:'course'` 行 = 官方总评（未评项计 0），headline 优先用它，无官方值时算 Σ w·pct（未评项计 0，即 "Contribution to course total" 列），两者都无才退简单平均/显示 "—" |
| normalizeCourseCode ≠ 代码提取（它只清洗纯代码：trim/去后缀/大写） | 身份表全行 code=null，idForCode 永远空，所有直链静默失效 | 从任意文本提取代码用 courses.ts 的 `extractCourseCode`（COURSE_CODE_RE）；join 两侧要用提取而非清洗。环引用 courses↔courseIdentity 因函数声明提升而运行时安全 |
| enrol 缓存命中路径早退 | 修好匹配后旧客户端仍 24h 内身份表无 code | 身份表写入挪进缓存命中分支（本地写入便宜，lessons 可能刚加载） |
| CDP/preview 探针抓错元素（`.animate-modal-in` 会命中今日页横幅） | 误判「modal 没渲染链接」 | lesson-detail 是 `div.fixed.inset-0.z-50` 遮罩层；探针先验 tag/text 再下结论 |
| 【修正】「成绩优先级链下沉」完成后的现状：parse 层零打分逻辑（只提取字段 + 一行调 `getFinalCourseGrade`），链条唯一实现地点 gradeCalc.ts——旧条目「两处硬编码」已不存在，别再按旧地图找 | — | 改链条只改 `getFinalCourseGrade`（official→running→simple→null；override 时跳过 official）；`average` 字段=同一函数的输出，排序/课程页展示与 headline 永不打架 |
| React 受控 input 用 evaluate 直填抛 Illegal invocation | CDP 驱动 what-if 失败 | ① 用 `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, v)` + dispatch input 事件；② 点击展开后组件重渲染，旧 DOM 引用全失效——每步重新 query；③ 断言跨 JSX 文本节点（如 `+3.6`）时查父行 textContent 而非 getByText |
| 大块内容（300+ 行）用 shell heredoc 写文件 | 静默截断在文件中段，无报错——本次 CSS 断在 rosepine 块中间 | 大内容一律 write_file（独立文件）+ `@import` 接线；heredoc 只用于 <100 行；追加后必查 `wc -l` + `tail` 完整性 |
| 主题预设机制（本次建立） | — | 模式（system/dark/light）与配色预设正交：`data-theme` × `data-preset` 两属性组合；token 唯一清单在 index.css，预设只做变量覆盖（`theme-presets.css`，每预设暗/亮两套）；lib/theme.ts 单一所有者；main.tsx 渲染前 applyTheme+applyPreset 防闪 |
| assignFilter 导航语义（已修，2026-09）：App 层用 `null` 表示无预置（侧栏/深链/今日页/课程详情都置 null），只有 Moodle 时间线/成绩卡跳转带具体 filter；AssignmentsView 收 null → 'all' | 修复前默认 'overdue' 且导航不重置：侧栏进作业页列表空（chips 计数却全量），任务行不渲染 | E2E 驱动作业页不再需要先点 chip；排查类似「列表空但计数非零」先查 initialFilter/key 重建链 |
| 树↔任务双向同步（已建立）：正向树→任务 `applyCompletionToTasks`，反向任务→树 `pushTaskCompletion`（markActivityCompletion + updateCachedCompletion） | 只做单向会漂移：树勾了任务没归档，或反之 | 联接键 cmid 提取统一走 submissions.ts 的 `taskCmidOf`（别复制正则）；反向推送 fire-and-forget——服务器失败静默，缓存不改写，树下次同步自愈；缓存改写只在服务器确认成功后做 |
| Moodle 任务 ID 前缀有两种 | 只匹配 'moodle:' 会漏掉时间线任务（'moodle-act:<eventid>'），同步/归档悄悄少一半 | 判定同步来源任务用 `/^moodle(-act)?:/`；手动任务才是无前缀 |
| 课程色饱和度是「设计过」的核心参数（2026-09 调优） | 色板饱和度 78–96% + 22% 填充在灰阶 chrome 上显霓虹贴纸感 | 色板饱和度降到 62–76%、暗色填充 0.17/亮色 0.12；改动只碰 colors.ts PALETTE + index.css 的 `--cc-*` 两个 owner，预设不覆盖 `--cc-*` 所以全局一致 |

## 5. 高效原则（接下任务的姿势）

- **进度可见**：多步任务先 `write_todos`，每完成一项更新——中断恢复时靠它续命。
- **经验回写**（本文件的维护规则）：每次任务收尾把新经验/坑位写回本文件对应小节；与已有条目冲突时**修正旧条目**而不是并列保留互相矛盾的两条，修正处标注【修正】+ 依据；过时条目直接删除。用户偏好类经验（如验证方式）以最新一次明确表态为准。
- **本地实测优先**（【修正】用户先说用 preview，后因 preview 无登录态、无真实数据、注入成本高而改口「还是用本地的吧，别用preview了，速度要快，效率要高」——以最新为准）：直接用模拟器/已装应用 + CDP 驱动验证并截图，不为验证另起 dev server。
- **一次到位的验证**：改跳转就真点一次链接；改同步就真触发一次同步看落盘数据；改小组件就截三个尺寸的图。
- **修复要带测试**：每个 bug 修复配一条锁定契约的测试，防止回归（现 344+ 条测试是这么攒出来的）。
- **收尾三件事**：门禁跑全 → 种子/临时数据清理 → 改动批次说明（哪些文件、什么行为、是否需要发版）——外加经验回写（见上）。

## 6. 当前状态（2026-09 梳理）

- 已发布 v0.3.0（双平台，应用内更新链路验证通过）。
- 工作树未提交批次：小组件全套（resize/主题/毛玻璃/溢出）、课程板块遮挡修复、作业 URL 自愈升级、对号状态修复 + 自主标记、backgroundRefresh 并行化、syncDomain 在途去重、flex 行遮挡排查修复（SyncProtection ×2 `min-w-0`）、任务卡模块类型图标、成绩加权总分（官方总评优先 + 分项贡献列 + category 垃圾行过滤）、本文件 → 攒够一批走 v0.3.2。
- iOS：曾有 App Store 计划，未启动（需要 macOS + 开发者账号，CI 是 Windows runner）。
