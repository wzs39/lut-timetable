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
| jsdom 没有 `Element.scrollIntoView` | 整个组件测试文件红（"scrollIntoView is not a function"），所有用例连带挂 | 组件里先 `if (el && typeof el.scrollIntoView === 'function')` 再调；真实浏览器始终有 |
| 手势测试的 touch 目标选了「有课卡片」 | 滑到空课日后目标消失，`getByText` 抛错，后续用例连带失败 | touch 事件会冒泡 → helper 派发在**常驻**元素上（移动端日期 tab 行 `.flex.gap-1.px-3`），别选随状态变化的节点 |
| 测试 fixture 写死具体日期 | 那天过去后无改动也变红（CI 自己挂） | fixture 从 `Date.now()` 推导偏移（`at(2*HOUR)`），别写字面量；已修 date.test.ts 的 findCourseTarget |
| 破坏性操作只改数组本体 | 删课/隐藏写下的 tombstone、清掉的 override、新增 hidden key 不同步回滚——「撤销」看起来生效，下次同步课程又消失/用户编辑丢失 | 删除路径统一产出快照（`lib/undo.ts`：pickSlots/restoreSlots + tombstone/override/hidden 三件套），`useTimetable` 负责生产与消费，App 只挂 toast；复原幂等（已存在的 id 跳过） |

## 5. 高效原则（接下任务的姿势）

- **进度可见**：多步任务先 `write_todos`，每完成一项更新——中断恢复时靠它续命。
- **经验回写**（本文件的维护规则）：每次任务收尾把新经验/坑位写回本文件对应小节；与已有条目冲突时**修正旧条目**而不是并列保留互相矛盾的两条，修正处标注【修正】+ 依据；过时条目直接删除。用户偏好类经验（如验证方式）以最新一次明确表态为准。
- **本地实测优先**（【修正】用户先说用 preview，后因 preview 无登录态、无真实数据、注入成本高而改口「还是用本地的吧，别用preview了，速度要快，效率要高」——以最新为准）：直接用模拟器/已装应用 + CDP 驱动验证并截图，不为验证另起 dev server。
- **一次到位的验证**：改跳转就真点一次链接；改同步就真触发一次同步看落盘数据；改小组件就截三个尺寸的图。
- **修复要带测试**：每个 bug 修复配一条锁定契约的测试，防止回归（现 344+ 条测试是这么攒出来的）。
- **收尾三件事**：门禁跑全 → 种子/临时数据清理 → 改动批次说明（哪些文件、什么行为、是否需要发版）——外加经验回写（见上）。

## 2026-09-26 · 降使用成本一揽子（滑动 / 命令面板 / 撤销 / 快捷方式 / 首次引导）

- **手势判定必须是纯函数**：`lib/swipe.ts` 的 `swipeIntent(dayIndex, dx, dy)` 同时承担阈值与防误触（`|dx| ≥ 48` 且 `|dx| ≥ |dy| × 1.4`），纵向滚动因此永不触发。跨周不在组件里做——返回 `{day, weekDelta}`，由 App 的 `onShiftWeek` 改 `weekStart`。
- **翻周后「落在哪一天」要用 ref 覆盖**：WeekGrid 的 `[weekStart]` effect 默认「本周取今天、其它周取周一」，会把滑动手势的目标日冲掉（周一往前滑想吃上周日）→ 手势先写 `pendingDayRef.current`，effect 消费后清空。
- **面板里的课程候选要带 code + title 两字段**：无代码的手动课（侧栏可建）按代码前缀匹配会静默无反应 → `action: {code:'', title}`，App 回退到 `date.findLessonByTitle`（trim + 大小写不敏感 + 与 findCourseTarget 同口径的「最早未来一节/否则最后一节」）。跳转尾部抽成 `jumpToLesson(target)`，`jumpToCourse(code)` 与面板共用。
- **命令面板 = 数据层 + 派发层**：`lib/palette.ts` 只产出 `{label, sub, keywords, action}` 候选并做分组打分（分组顺序固定 views→actions→courses→tasks，组内按得分；无查询时课程/作业各截断 6 条且**不套总数上限**，否则末尾分组被挤掉）；App 的 `runPaletteAction` 是唯一 dispatch。测试用真实 i18n 构建候选，断言按钮回调的 action 对象。
- **快捷键不能抢输入**：统一用 `typing = INPUT/TEXTAREA/isContentEditable` 让路，`ctrl/meta/alt` 一律不接管（除了自己的 Ctrl+K）；弹层打开时数字/方向键让给弹层。
- **作业页撤销用「数组变短」通用判据**：`onChange` 包装成 `applyTasks`，变短即快照并挂撤销条——不必给每个删除按钮单独接线（手动任务删除、清空等路径自动覆盖）。
- **Android 静态快捷方式不要赌 `<extra>`**：官方静态快捷方式示例只列 `intent`/`categories`/`capability-binding`，`<extra>` 支持情况文档未列明 → 改用自定义 action（`dev.lut.timetable.OPEN_TODAY/WEEK/ASSIGN`，`targetPackage`+`targetClass` 显式启动），MainActivity 里把 action 与小组件的 `tt_view` extra 合并成一个 `navViewOf(Intent)` 读取器；manifest 同时声明这三个 action 的 intent-filter（便于 adb 验证与可读性）。验证：`adb shell am start -a dev.lut.timetable.OPEN_ASSIGN -n dev.lut.timetable/.MainActivity`；装机后 `unzip -l app-debug.apk | grep res/xml/shortcuts` + 合并 manifest grep 三个 action（本轮已做，真机长按图标待确认）。
- **添加来源后立刻 sync**：auto-sync 的 `startedRef` 只在挂载时跑一次，引导中途加源时 due 列表为空——用户加完课表要等 15 分钟才看到课。`addSourceNow`（App）加源即 `tt.sync(src)`，Settings 与首次引导共用；URL 解析唯一所有者是 `store.sourceFromUrl`（Settings 原本内联的解析已删除）。
- **首次引导有「重开」入口**：只靠 「无来源+无课程+未看过」 自动弹出会让老用户永远看不到 → 菜单 + 命令面板都挂 `obReplay`。
- 门禁：`npx tsc -b --force` / `npx vitest run`（455 通过）/ `npm run test:consistent`（collected=executed=455）/ `npx oxlint`（0 error）/ `npm run build` / `cap sync android` + `gradle assembleDebug`（BUILD SUCCESSFUL）。

## 6. 当前状态（2026-09 梳理）

- 已发布 v0.3.0（双平台，应用内更新链路验证通过）。
- 工作树未提交批次：小组件全套（resize/主题/毛玻璃/溢出）、课程板块遮挡修复、作业 URL 自愈升级、对号状态修复 + 自主标记、backgroundRefresh 并行化、syncDomain 在途去重、flex 行遮挡排查修复（SyncProtection ×2 `min-w-0`）、任务卡模块类型图标、成绩加权总分（官方总评优先 + 分项贡献列 + category 垃圾行过滤）、本文件 → 攒够一批走 v0.3.2。
- iOS：曾有 App Store 计划，未启动（需要 macOS + 开发者账号，CI 是 Windows runner）。

### 坑位表

- **PendingIntent 模板必须 MUTABLE 才能收 fill-in extras**（API 31+）：`setPendingIntentTemplate` 配 `FLAG_IMMUTABLE` 时，factory 里 `setOnClickFillInIntent` 的 extras 被**系统静默丢弃**——广播照收但 extras 为空，点击像没反应。模板（checkbox 切换这类）用 `FLAG_MUTABLE`；纯打开 Activity 的模板才可用 IMMUTABLE。实测：IMMUTABLE 版点击后 ops 队列为空，换 MUTABLE 后立即生效。
- **`<shape>`/`<layer-list>` drawable 不能放 `values-night/`**：values 限定符目录只收 values 类型资源，drawable 要用 `drawable-night/`。放错目录报 "Can't determine type for tag"。

- **TimeEdit feed 是约 7 天滚动窗口**（【2026-09-21 实证】同一订阅 9/18 拉是 9/15 起 38 事件、9/21 拉是 9/21 起 15/35 事件；`?days=`/`?weeks=` 参数无效；`{id}.json` 接口同窗口且类型列为空）：全量重同步每次都会删掉滑出窗口的旧课——这是「之前的课识别不到」的根因。`syncSource` 对 `windowDays` 源做增量合并（只删窗口 [min,max] 内的课），窗口外旧课保留；空 feed 视为瞬时空响应不清库。老源靠 `loadSources` 一次性迁移打标。
- **TimeEdit SUMMARY 与 SISU 格式不同**：`K200DJ96 Finnish 1 K200DJ96-3015 · KKIE26LABH`（码前缀 + 组号 + 专业码），SISU 的 `cleanTitle` 清不掉，需 `cleanTimeEditTitle` 专用清洗（剥离组号 `-3015`、码前缀、`Tunnus N` 段、`KoBScDDhebei1` 类驼峰码也要覆盖——首版正则漏了它）。存量脏标题在同步时对保留课做一次性重清洗（override 的 title 除外）。

## 2026-09-22 · 小组件课程行 → Moodle 课程页（真机 E2E）
- **RemoteViews ListView 的 fill-in 缓存很顽固**：payload（prefs）更新后，`notifyAppWidgetViewDataChanged` 可能仍不够——列表行的 fill-in intent 是 bind 时工厂快照。强杀应用重启（boot push → renderAll 重建）才刷新。验证点击时若 Intent 带旧 URL，先怀疑列表缓存而非路由代码。
- **dumpsys 查到的 Chrome `dat=` Intent 是任务 record 的首启 intent**——Chrome 复用任务栈时不会变。判断真实跳转 URL 要么强杀 Chrome 再点（冷启动记录），要么直接看 Chrome 地址栏。
- **假 courseid 会在真实 Moodle 报 "Can't find data record in database table course"**（已登录时）。E2E 注入测试数据绝不能用虚构 id——用真实账号 token 同步出真实身份表（备份 + tt_grades_source_v1 token 注入即可， enrol 同步 15s 内完成）。
- **`core_course_get_courses` 对学生 token 报 nopermissions**——不能用它验证 courseid 有效性；学生视角 `course/view.php?id=N`（已选课）才是真实路径。
- **Windows Electron 客户端空闲被系统杀**：CDP 9225 探活失败不代表数据丢，重启客户端即可（localStorage 持久）。

## 2026-09-22 · 身份表 code 来源修正（enrol 侧不再依赖课表交集）
- **身份表 code 直接从 Moodle shortname 提取**（`extractCourseCode(e.shortname) ?? extractCourseCode(e.fullname)`），删除 lessonCodes 交集条件——真实数据里 CT60A4500/BH60A7201/KE00BX35 这些「Moodle shortname 带码但课表无同码课」的行曾永远 null，TE 码（K200DJ96）对齐全靠课表恰好有这门课才侥幸命中。
- **emulator 的 WebView 有 DNS 负缓存**：宿主 `ping` 已恢复但 WebView 仍报 `Unable to resolve host`——重启应用进程才清掉。SISU K200DJ96 实测 `lab-cu-40081 Finnish 1`。
- 验证技巧：`saveIdentityFromEnrol` 的行覆盖率 = `rows.filter(r => r.code).length / rows.length`，真实数据 7/11 → 10/11（唯一 null 是无码 shortname「LUT digital orientation」，正确）。

## 2026-09-22 身份数据诊断区块实测
- 诊断区块的码匹配必须复用 `normalizeCourseCode`（trim + 剥 `-dddd` 组号 + 大写），自写 trim/uppercase 会在组号课（如 `BM20A9200-3001`）上给出偏低的解析率——诊断指标必须与真实 resolver（idForCode）语义一致，否则数字误导用户。
- Settings 的 revision 重算信号：日历同步走 `syncing/syncMessage`（App 状态），Moodle 域同步走 `md.busy`（useMoodleData 内部）——只盯其一就会漏掉另一路的刷新；组合信号 `\`${md.busy}|${syncing}|${syncMessage}\`` 覆盖两路。
- 手动课（manual）有 code 但无 Moodle 映射需求：计入源课程数（manual 桶）、不计入解析率分母。
- store 层 `s.count` 持久化与列表实有数可漂移（TE 35 vs 38 历史语义漂移）；诊断类 UI 应从合并列表重算而非信任持久化计数。

## 2026-09-22 · 诊断区 resync 按钮 E2E（模拟器）
- adb forward 到 WebView 调试口必须带 `localabstract:` 前缀；应用每次重启 socket 名都变（webview_devtools_remote_<pid>），先 cat /proc/net/unix 再逐个 curl /json/version 挑通的那个。
- Node22+ 原生 WebSocket 直连 CDP 完全可用（open~50ms，消息往返 <50ms）；HTTP 面板页 /json 偶发空响应，别依赖它做 UI 自动化。
- .freebuff 下的临时脚本 write_file/str_replace 偶发"文件不存在"竞态——先 ls 确认再重试，别推翻实现。
- enrol 缓存 key：`tt_ics_cache_v1:enrolled_courses`（TRANSIENT，含 fetchedAt/courses）；clearEnrolledCoursesCache 清内存+该 key。验证"真的重取"看 fetchedAt 是否等于点击时刻，而不是看 key 是否存在。

## iOS distribution (no App Store) - 2026-09-23
- **Unsigned device IPA CI**: xcodebuild with `CODE_SIGNING_ALLOWED=NO` + `-destination 'generic/platform=iOS'` + Release config, then `Payload/App.app` -> `zip` as IPA. AltStore/SideStore/Sideloadly re-sign at install time (free Apple ID, 7-day validity, AltServer auto-renews). No secrets needed.
- **pbxproj = old-style ASCII plist**: `plutil` REFUSES to write it back ("Conversion to OpenStep format is not supported") - patch MARKETING_VERSION/CURRENT_PROJECT_VERSION with `sed -i ''` on macOS.
- **IPA shape check trap**: `grep 'Payload/App.app/App/'` (trailing slash) only matches the directory entry, never the Mach-O file. Verify `Info.plist` presence + `CFBundleExecutable` instead.
- Version stamping parity: same tag-derived stamp as Android (MARKETING_VERSION="X.Y (Z*1000000+Y*1000+Z)" style), Info.plist verified to embed the tag version; web bundle embeds VITE_APP_VERSION the same way.

## iOS WidgetKit widget - 2026-09-23
- **Data path**: Capacitor Preferences on iOS = `UserDefaults.standard`; the `lutWidget` local plugin copies `widget_payload_v1` into the App Group suite (`group.dev.lut.timetable`) then `WidgetCenter.shared.reloadAllTimelines()`. Web layer unchanged (same contract as Android).
- **Plugin registration (Capacitor 8)**: auto-registration only reads `capacitor.config.json` packageClassList (regenerated by `cap sync` - hand edits are wiped). Local plugins must be registered via `bridge?.registerPluginInstance(...)` inside a `CAPBridgeViewController` subclass's `capacitorDidLoad()` hook (SceneDelegate instantiates the VC programmatically - no storyboard surgery needed).
- **pbxproj surgery checklist** (all four or the symbol is "not in scope"): PBXFileReference + PBXBuildFile + PBXGroup child + PBXSourcesBuildPhase entry. Extension targets additionally need: native target, product ref (appex), CopyFiles "Embed Foundation Extensions" (dstSubfolderSpec=13), PBXTargetDependency + PBXContainerItemProxy, build configs x2.
- **Swift access rule**: top-level `private` types cannot be referenced by internal members - payload/entry structs must be internal. Availability-annotated enums (WidgetFamily accessory cases, iOS 16+) cannot be switched directly at target 15 - isolate behind `@available` sub-views.
- **CI trap**: `xcodebuild ... | tail -30` swallows the exit code - a failed build then packages a 4KB empty zip and the verify step confuses. Always `set -o pipefail`.
- **Sideload App Group risk**: free-account resign may not honor App Groups (SideStore #1437); widget degrades to onboarding empty state. Real-device validation pending.

## iOS App Group under sideload - 2026-09-23
- **Free Apple ID resigning prefixes app group names with the Team ID** (`group.x` -> `<TeamID>.group.x`) - a hardcoded suite name never matches on sideloaded installs. Resolve at runtime: read `com.apple.security.application-groups` from the code signature via SecTask (bind `SecTaskCreateFromSelf`/`SecTaskCopyValueForEntitlement` with `@_silgen_name`; not stably exposed in the iOS SDK headers). Both writer AND reader must use the same resolution; fall back to the literal name for dev-signed installs.

## 2026-09-26 · 移动端壳层重排（底部标签栏 + 「更多」抽屉；表头只留信息）

- **真凶：`index.css` 的组件类没有入层。** 无层样式永远赢过 Tailwind 的 utilities（层级优先于特异性），所以 `class="app-seg hidden md:flex"` 在手机上照样渲染出桌面视图切换器，TodayView 的 `app-seg xl:hidden` 同样失效（≥1280px 变成两栏 + 多余 tab）。修法：从 `.app-card` 起（含 `.animate-*` / `.collapse-*` / `.line-clamp-2`）整体包一层 `@layer components`；**令牌块（`:root` / `:root[data-theme]`、`theme-presets.css` 的 `data-preset`）与 `.safe-top/.safe-bottom` 保持无层**——后两者入层后会被 `pb-4` 之类 utilities 抢走安全区内边距。改完必须在 390 / 700 / 1440 三档各截图核对一次。
- **移动端（<768px）只允许一套导航**：底部标签栏 = 4 个信息视图（今日 / 周 / 作业 / Moodle）+「更多」抽屉；表头在手机上只剩「应用名 + 搜索」，语言切换与 ⋯ 菜单用 `max-md:hidden` 收进抽屉（桌面端不变）。
- **周导航归 WeekGrid（<768px）**：删掉表头那两行（原 `sm:hidden` 行 + 桌面行改为 `hidden md:flex`），移动分支内联一行 `‹ 第 N 周 · 9/21 – 9/27 › [本周]`（完整文案留在 `title`）。`weekStart` 仍由 App 独占，WeekGrid 只发 `onShiftWeek` / `onThisWeek`。
- **抽屉不重写内容**：`MoreSheet` = 动作网格（设置 / 筛选 / 冲突 / 重复 / 隐藏恢复 / 更新 / 语言 / 重开引导，App 用 `useMemo` 组装成 `SheetAction[]`）+ `<Sidebar embedded>`；`embedded` 让侧栏在抽屉里 `flex-1 min-h-0` + 上边框（桌面仍 `h-full` + 右边框）。动作点击即关抽屉（`a.onRun()` 然后 `onClose()`）。
- **表单只留一份**：手动添加课程表单从 Sidebar 抽成 `ManualLessonForm.tsx`，侧栏与抽屉共用；折叠状态仍共享同一个 key `tt_sidebar_manual_open`。
- **空课日措辞按天区分**：手机按天视图滑到非今天时用 `noLessonsThatDay`（当天没有课程），只有真·今天才用 `noLessonsToday`——否则滑到周一却显示「今天没有课程」。
- **Windows 端口坑**：5233 这类端口 `vite preview` 直接 `EACCES`（系统保留段），5311 可用；端口被占用时 preview 直接失败，先 `curl` 探活再决定复用（旧进程仍在跑也能直接服务新 `dist/`）。
- **抽屉分区默认收起、分面记忆**：抽屉里四个数据/工具分区（来源同步 / 手动添加 / 查询课程 / 常用平台）全部折叠且 `defaultOpen=false`，手机打开「更多」先只看到动作网格。折叠状态用 **独立的 `tt_sheet_*` key**（`sheetSourcesOpen/ManualOpen/SearchOpen/LinksOpen`），与桌面侧栏的 `tt_sidebar_manual_open`/`tt_sidebar_links_open` 互不干扰——共用一个 key 会让桌面展开过的块在抽屉里也弹开，「默认只露动作网格」就守不住了。收起时在标题行右侧留 `hint`（如「1 个来源」），折叠区不至于是黑箱。
- **分区的唯一渲染入口**：`Sidebar.tsx` 的 `Group({ embedded, title, desktopKey?, desktopOpen?, sheetKey, hint? })` 统一分派——桌面没有 `desktopKey` 的块渲染为普通标题 `Block`（同步日历 / 查询课程，不可折叠，保持原样），有 key 的走 `Section`；`embedded` 一律走折叠 + sheet key。`CourseSearch` 自带的 `<h2>` 删掉了（标题归外层所有，否则抽屉里套一层会出现两个标题）。
- **两个入口的模式差异要用测试锁住**：`moreSheet.test.tsx` 断言默认四块 `aria-expanded=false` + 展开后写 `tt_sheet_*` 且**不动** `tt_sidebar_*` + 重挂载后仍保持；新建 `sidebar.test.tsx` 断言桌面侧栏仍是「普通标题 + 手动添加默认收起 + 常用平台默认展开」，写的是 `tt_sidebar_*`。折叠内容仍在 DOM 里（`collapse-wrap` 靠 0fr + `inert` 隐藏），所以断言要查 `aria-expanded`/类名而不是「文本不存在」。
- **动作格子自适应排序 = 纯函数**：格子只声明「有没有事」（`pending: 数量` / `attention: 有但数不清`）与 `priority`，排序在 `lib/sheetActions.ts` 的 `orderSheetActions`：有事的按 priority→数量排前，无事的保持声明顺序落底。App 的 `sheetActions` memo 不手动排序（否则每加一个动作都要想位置）。测试：`sheetActions.test.ts` 比顺序与零值不算有事；`moreSheet.test.tsx` 断言渲染后的格子顺序 + 角标。
- **数量进角标就别再写进文案**：`dupButton: '整理重复 ({n})'` 是给桌面 ⋯ 菜单的；抽屉格子用 `dupsTile`/`unhideTile`（无括号）＋ 角标数字，否则同一数字在一格里出现两次。
- **「可更新」也要算有事**：`updateState.kind ∈ {available, ready, downloading}` 时格子文案换成 `updateTileAvailable`/`updateTileReady`（带版本号）并提到第一位（priority 4），否则回到普通「检查更新」。
- **实测坑**：跨来源（SISU vs TimeEdit）同时段的同码课会被**自动合并**（不产生重复组），所以想造「整理重复」的真实数据得用**同源**两条同码同学时记录，否则格子永远不亮。
- 门禁：`npx tsc -b` / `npx vitest run`（490 通过；moreSheet 7 条含自适应排序 2 条 + sheetActions 4 条 + sidebar 2 条）/ `npm run test:consistent`（collected=executed=490）/ `npx oxlint`（0 error）/ `npm run build`；390 / 1440 两档截图核对（抽屉默认只露动作网格、待处理项带角标且排最前、展开后重载仍保持、桌面侧栏无变化）。

## 2026-09-26 · 导出 .ics 收口（死类型 + 按字节折行）

- **“声明了但没接”的 action = 死类型**：`PaletteAction` 里早有 `{ kind: 'exportIcs' }`，但 `buildPalette` 没条目、App 的 switch 没 case —— Ctrl+K 搜不到，手机上只剩 设置→数据备份 一条径。【教训】加 action 要同时改三处：union / buildPalette 条目 / App 的 dispatch switch，并名配一条测试（`palette.test.ts` + `exportIcs.test.ts` 各锁一条）。
- **导出入口唯一化**：Blob/文件名/MIME 从 Settings 里抽到 `lib/exportIcs.ts`（`exportTimetableIcs(lessons?)`）；Settings 改收 `onExportIcs` 回调，由 App 传 `tt.visibleLessons` —— 导出的是用户看到的课表（去隐藏、含手动课、已合并），而不是原始存储。
- **RFC 5545 折行按 octet，不按字符**（真 bug）：原 `foldIcs` 用 `String.length`（UTF-16 code unit）切，25 个汉字就超 75 字节，严格解析器会判不合规。改成按 code point 累计 UTF-8 字节（续行限 74，前导空格占 1 字节），`for...of` 迭代避免切断代理对；测试用 CJK 串逐行断言 ≤ 75 octets 且展开后等于原文。
- **导出内容**：SUMMARY 改成 `CODE · Title`（日历里同名课程靠代码区分）；补 `X-WR-CALNAME`（否则导入后日历列表显示“无标题”）；`buildIcs(lessons, { now, calName })` 可注入时钟，DTSTAMP 可测。
- **验证方式**：在 preview 里拦 `URL.createObjectURL` + `HTMLAnchorElement.prototype.click`，直接读导出的 Blob —— 不真下载也能看到 filename / MIME / VEVENT 数 / 每行 octets。两个入口（命令面板 / Settings）都跑了一次。

## 2026-09-26 · 桌面常驻：托盘 + 全局快捷键（+ 补齐前几批未记的功能）

- **关窗 ≠ 退出**：`win.on('close')` 在 `!isQuitting && platform !== 'darwin' && closeToTray` 时 `preventDefault() + hide()`；`app.on('before-quit')` 置 `isQuitting = true`，否则**更新安装（quitAndInstall）/ 系统关机也会被拦成 hide**，应用永远退不掉。托盘菜单「退出」先置位再 `app.quit()`。
- **状态唯一所有者在主进程**：偏好存 `userData/desktop-prefs.json`（带缓存读，close 处理器每次都问）。渲染端只有 preload 的 `lutDesktop` 桥（getState / setPrefs / setTrayLabels / onCommand），**不在 localStorage 再存一份** —— 两边各存一份就会出现“设置改了但行为没变”。浏览器 / 手机上桥是 `undefined`，设置页整块分区隐藏（不显示灰色不可用项）。
- **托盘文案由渲染端推，主进程只兜底中文**：菜单是原生对象，读不到 web 的 i18n。`lut-tray-labels` 的部分推送**合并到当前文案**而不是回默认值 —— 实测坑：只推一个键会把其他键打回中文。`lib/desktop.ts` 的 `trayLabels(lang)` 收 lang 而不是 `t`，这样 App 里 effect 依赖可以只写 `[lang]`（`t` 每次渲染都是新函数，写进去等于每次渲染都发 IPC，而且会吃一条 `exhaustive-deps` 警告）。
- **`prettyAccelerator`**：`CommandOrControl+Shift+L` 这种 Electron 写法不可读，设置页显示 `Ctrl + Shift + L`（mac 是 `⌘ + ⇧ + L`）；`shortcutActive=false` 时提示「被其他程序占用」——全局快捷键注册失败是**静默**的，不提示用户会以为功能坏了。
- **图标路径与打包**：`Tray` 图标 + 跳转列表共用 `appIconPath()`；打包后必须落在 `resources/`，所以 `package.json` 加了 `extraResources: [{ from: 'build/icon.ico', to: 'icon.ico' }]`（写成字符串数组会被拷成 `resources/build/icon.ico`，`resourcesPath/icon.ico` 落空 —— 跳转列表的图标其实一直是坏的）。无托盘环境（少数 Linux）`new Tray` 会抛，`try/catch` 静默降级。
- **验证方式（无 GUI）**：临时用假 electron shell 真跑 `main.cjs`（`Module._load` 拦 `'electron'`，Tray/Menu/globalShortcut/ipcMain 全替身），断言 21 条行为：菜单文案随推送变化、点菜单项显示窗口 + 写 `#/view/*` hash、「检查更新」发 `lut-tray-command`、close 被拦 + 气泡只出现一次、`set-prefs` 后 close 放行且快捷键注销、`before-quit` 后放行。脚本跑完即删（不进仓库）。
- **App 级接线也要锁**：`appDesktop.test.tsx` 真的渲染 `<App/>`（jsdom 可行，只需 ThemeProvider + I18nProvider），断言挂载拉状态、推七个 key 的托盘文案、托盘命令落到 `lutUpdate.check`、无桥时静默；`settingsDesktop.test.tsx` 锁分区显隐 / 平台化快捷键 / 占用提示 / 开关回调；`desktop.test.ts` 锁三方同键（main 的 `DEFAULT_TRAY_LABELS` ↔ `trayLabels(lang)` ↔ preload 方法名）与 `extraResources`。
- **本批（9/25–9/26）其余已落地但之前漏记的功能**：同步变更审计 + 变动提醒（`lib/syncAudit.ts`：added/moved/room/title/cancelled 稳定序，`added` 与 `moved` 曾经重复计数，测试抓到后才拆开）、每日摘要通知（`lib/dailyDigest.ts`）、教室连堂「赶得上吗」（`lib/roomHop.ts`）、成绩目标反解（`gradeCalc.goalPlan`）、考试倒计时提醒（`lib/examReminders.ts`）、作业优先级（`lib/taskPriority.ts`）、分享链接/二维码导入（`lib/shareLink.ts` + `lib/qr.ts` + `ShareImportDialog` / `ShareQrDialog`）、本地错误日志与导出诊断（`lib/errorLog.ts`）、无障碍字号/对比度（`uiPrefs` + `<html>` 属性）、命令面板自然语言录入（`lib/quickAdd.ts`）、订阅式提醒（`lib/subscriptions.ts`：课程变动 / 教室空出）。
- 门禁：`npx tsc -b` / `npx vitest run`（586 通过，65 文件）/ `npm run test:consistent`（collected=executed=586）/ `npx oxlint`（0 error，25 warning；新增的那条是 `i18n.tsx` 导出纯函数 `translate` 触发的 `only-export-components`，与该文件既有的两条同类）/ `npm run build`。浏览器侧回归：preview 5311 打开设置，13 个分区照旧、无「桌面端」（web 本就该没有）。

## 2026-09-26 · 后台刷新（Android 周期任务 + iOS BGAppRefreshTask）

- **不引第三方 headless-JS 插件**：后台要跑的是 App 自己的同步代码（ICS 解析 / 跨源合并 / 标题清洗 / 审计），所以两平台都用「隐藏 WebView 跑同一个 bundle 的 `?bg=1` 分支」+ 注入一个极小的宿主桥。代价是两个原生宿主文件（`BackgroundSyncJobService.kt` / `LUTWidgetBridgePlugin.swift` 里的 `BackgroundSyncRunner`），可回滚性 = 删掉服务/runner + `main.tsx` 的分支 + 种子写入；没有任何新依赖（`androidx.webkit` 早已在 `variables.gradle` 里声明）。
- **不新增后端、不新增存储**：后台 WebView 的 origin 看不到 App 的 localStorage，所以用「种子」：App 把白名单键（lessons/sources/tombstones/overrides/hidden/identity/syncAudit/tasks，**不含 token 类**）序列化进 Preferences `bg_seed_v1`，后台 pass 先回灌 localStorage 再跑既有的 `syncSource`——同步逻辑零分叉。载荷仍写 `widget_payload_v1` / `widget_tasks_payload_v1`，契约不变。
- **宿主桥契约（`src/lib/bgHost.ts`）**：`prefGet/prefSet/fetchText/refreshWidgets/done`。Android 是 `@JavascriptInterface`（同步返回，JS 侧包成 Promise）；iOS 是 `postMessage` + 回调 `window.__lutBgResolve(id, json)`。`fetchIcs.ts` 里后台是第一优先分支（在 Capacitor 之前）——后台没有 Capacitor，也没有 CORS。
- **`?bg=1` 不是唯一入口**：iOS 的 `file://` 不能带 query，所以宿主注入 `window.__LUT_BG__ = true`，`main.tsx` 两者都认。
- **实测坑 1：JobScheduler 带了网络约束就需要 `ACCESS_NETWORK_STATE`**，否则 `schedule()` 抛 `SecurityException: ACCESS_NETWORK_STATE required for jobs with a connectivity constraint`（不是返回失败也不是排队等待）。加权限即好（普通权限，无对话框）。
- **实测坑 2：忘了 `npx cap copy android` 就构建 APK = 装了个旧 web 包**。Gradle 只打包 `android/app/src/main/assets/public`，它不会自己同步 `dist/`；表现为「原生代码是新的、JS 行为是旧的」（种子永远写不下来）。CI 的 native-build 步骤里本来就有 cap sync，本地手动构建时必须先 copy。
- **实测坑 3（iOS 小组件一直是空态的真因）**：`@capacitor/preferences` 在 iOS 写的是 UserDefaults.standard 里**带 `CapacitorStorage.` 前缀**的键，而 `LUTWidgetBridgePlugin.refresh()` 读的是裸键 `widget_payload_v1` —— 镜像循环一直复制不到东西。修行：统一用 `payloadValue(for:)`（先带前缀、再回落裸键）取值，镜像逻辑抽成 `mirrorPayloadToWidget()`，前台 refresh 与后台 runner 共用。
- **调度只有一个控制**：跟着「自动同步」开关走（`lib/backgroundSchedule.ts`），周期 6 小时（JobScheduler 硬下限 15 分钟）；**不**新增用户看不见的开关。iOS 的 BGTask 请求只生效一次，所以 `applicationDidEnterBackground` 里用 Preferences 里的 `bg_schedule_v1` 意图续期（Android 不需要，JobInfo 是 PERSISTED）。
- **真机 E2E 方法（可重现）**：`E:/Android/jdk21` 构建（JDK 25 跑不了 Gradle 8.14，报 class file major 69；JDK 17 又编译不了 capacitor-android 的 Java 21 目标）→ `cap copy` → `assembleDebug` → `install -r -d` → CDP（`adb forward tcp:9223 localabstract:webview_devtools_remote_$(pidof)`，驱动脚本 `.freebuff/bg-cdp.mjs`）往 localStorage 注入一个指向本机 fixture 的源 → `adb shell cmd jobscheduler run -f dev.lut.timetable 7310` 强制触发 → `run-as dev.lut.timetable cat shared_prefs/CapacitorStorage.xml` 读 `widget_payload_v1` / `bg_status_v1` / `bg_schedule_v1`，logcat 过滤 `LUTBgSync`（started / refreshWidgets / done）。fixture 用 node 临时服务器（`http://10.0.2.2:5399/lut.ics`）——明文只允许在 debug 构建（`app/src/debug/AndroidManifest.xml` 的 `usesCleartextTraffic`），release 一律 HTTPS。
- **实测结果**：`I LUTBgSync: started` → `refreshWidgets` → `done ok=true note={"ok":true,"message":"lessons=2"}`，载荷里两条真实时间/教室。
- **实测坑 4（真机上发现的谎报）**：断网时 `fetchChain` 会退回本地 ICS 缓存（前台离线可用就是靠它），后台 pass 于是拿到一份旧 feed、差异为空，把结果写成 `ok:true, failed:[]` ——「小组件没更新」时诊断报告说一切正常。修行：`fetchChain` 多一个 `onDegraded` 回调（退缓存时带原因），`syncSource` 透传，后台 pass 记进 `stale[]`，且 `ok = failed+stale < sources`（全走缓存就写 false）。真机复验（无网络服务器）：`done ok=false`，`bg_status_v1` = `ok:false, failed:[], stale:[{id:"fixture",error:"bg fetch failed"}]`，载荷仍保留两条旧课（断网不该把小组件清空）。
  - 已知缺口：桥只能返回 `null` 表示失败（`@JavascriptInterface` 抛不过去），所以 `error` 是通用文案（“bg fetch failed”），真正的异常类名只在原生 logcat。要真名就得改三端桥的返回形状；不值得为一句文案动契约。
- **`backgroundStatus` 接进了诊断**：原生两个平台一直有这个方法（读 JobScheduler/`getPendingTaskRequests`），但 JS 一次都没调——属于“写好了没人用”。现在 `exportDiagnostics` 会带上 `scheduled=`（真机实测 `{scheduled:true,jobId:7310}`），分辨得出「没跑过」和「根本没排上」。调度这条缝（方法名 / 6 小时 / 意图镜像 `bg_schedule_v1` / 失败不吞）由新增的 `backgroundSchedule.test.ts`（7 条）锁住，因为 iOS 在本机跑不了。
- **实测坑 5（意图 vs 现实）**：意图镜像原本排在原生调用之后，于是「插件方法缺失」会写意图、“方法抛错”却不写——同一种用户意愿两个结果。改成先写意图（记的是想不想要，不是这一趟成没成），iOS 进后台靠它续期；成不成由 `backgroundStatus` 回答。
- **未做（明确留痕）**：提醒（通知）的**内容**仍然是 App 在下一次打开时重建的时间表；后台 pass 只保证小组件载荷与种子新鲜（载荷里的变动标记在后台同步后也会亮）。iOS 原生这条路没编译过（Windows 无 macOS），Swift 只做了括号/plist 静态校验，编译门禁在 CI。
- 门禁：`npx tsc -b` / `npx vitest run`（605 通过，67 文件；新增 `backgroundSync.test.ts` 12 条：宿主桥两种形状、种子白名单（凭据不进）、无种子不写、多源合入、隐藏课不进载荷、单源失败隔离、**缓存降级不算刷新**、变动审计入载荷、与 App 的 `syncSource` 产出完全一致；`backgroundSchedule.test.ts` 7 条）/ `test:consistent` 605/605 / `oxlint` 0 error / `vite build`；Android debug APK 编译 + 模拟器行为验证（含断网一趟）如上。真机 E2E 后用 `run-as` 核过 Preferences 里只有 5 个键（`bg_seed_v1`/`bg_status_v1`/`bg_schedule_v1`/两个小组件载荷），整份偏好文件里 `wstoken|password|authorization` 命中 0 —— 凭据只活在 localStorage。

## 2026-09-26 · 分享二维码（自写编码器，无新依赖）

- **为什么自己写**：本仓依赖表一直是最小集（Capacitor/React/Tailwind），而这里只需要**字节模式 + 纠错等级 L**这一条路径；引一个通用二维码库会带进数字/字母数字/汉字模式、多段拼接、结构化追加整套用不上的东西。`src/lib/qr.ts` 只做：字节模式、等级 L、版本 1–40 自动取最小、超容量返回 null。
- **渲染用内联 SVG 而不是 canvas**（`ShareQrDialog.tsx`）：矢量、可缩放、可打印，jsdom 里能直接断言（canvas 在测试环境没有实现）；整张图用一条 `<path>`（一个深色模块 = `M x y h1v1h-1z`），不用上万个 `<rect>`。**码永远是黑白**（不跟随主题：深色主题下用主题色的码在相机里对比度不够），并带 4 个模块的静默区。
- **容量天花板是真存在的分支**：单个二维码在等级 L 下的上限是 **2953 字节**，而分享链接允许到 3500 字符，所以课特别多时会出现「链接能给、二维码放不下」。这种情况不弹二维码，而是回 `shareWeekQrTooBig`（“链接已复制，发给同学即可”），不装作成功。
- **实测坑：块序必须「短块在前」——第三方扫描器才看得出来**。规格里数据码字分块后按块顺序轮询交织；把长块写在前面时，版本 1–9（单块或等长块）照样能读，**版本 10 起全废**（v10-L 是第一个块长不等的版本：2×68 + 2×69）。这个 bug **自写解码器看不见**（编解码两边同错，Reed-Solomon 校验子照样为零），是拿第三方 jsQR 扫出来的：v1–v9 过、v10–v40 全 null。修好后 v1/2/3/5/6/7/8/9/10/12/16/20/25/30/40 **全部**被 jsQR 解回原文。为避免重犯，块切分抽成导出的 `blockLayout(version)` 并在测试里按规格锁住（v10 = 2×68 + 2×69、v40 = 19×118 + 6×119、各版本块和 = 总码字）。
- **证明「真能扫」而不是「渲染出了个方块」**（可重现）：
  1. `npm run build` → 预览打开 → 设置 → 分享本周课表；
  2. 取 `[role=dialog] svg[role=img]`，`XMLSerializer` 序列化 → `data:image/svg+xml` → `Image` → 画到 canvas（按模块对齐的整数倍尺寸，如 89×16）；
  3. 页面里 `window.jsQR(imageData.data, w, h)`（jsQR 1.4.0，CDN 引入，第三方实现）解码结果必须**逐字符等于弹层里显示的那条链接**。本机实测 557 字符分享链接（版本 16）在 4px/模块与 8px/模块下都 `matchesLink: true`。
  4. 版本扫描（把 `encodeQr` 单独 `vite build --ssr src/lib/qr.ts` 出来，在 Node 里为每个版本生成矩阵）→ 页面里逐个用 jsQR 解。
- **测试**：`qr.test.ts` 12 条 = 几何锚点（40 个版本的「剩余位」恒等式、公布字节容量 V1=17…V10=271…V40=2953、校准图案表）+ 规格级解码器往返（格式信息 BCH → 去掩码 → 码字 → **RS 校验子全零** → 字节模式 → 等于原文；含中文与 2900 字符的长载荷）+ 真实分享链接往返；`components/shareQr.test.tsx` 4 条 = 从**渲染出来的 path 反解模块图并逐格等于编码器的矩阵**（静默区/定位图案/黑白颜色）、链接原文与节数可见、复制成功与失败两条路径。
- **未做**：没有做二维码**扫描**（用系统相机扫 → 打开链接 → 已有导入流程）；导入侧仍然只吃链接/文件，不吃图。
- 门禁：`npx tsc -b` / `npx vitest run`（621 通过，69 文件）/ `test:consistent` 621/621 / `oxlint` 0 error（25 warning，全是既有的）/ `vite build`。

## 2026-09-26 · 桌面端真产物验收（六个静默失效点，逐条真跑）

之前桌面常驻这批功能的全部证据只到「替换掉 `electron` 的假 shell 探针」——假 shell 能证明 `main.cjs` 的分支逻辑对，证明不了**打包产物**里图标落在哪、快捷键有没有真被系统接管。本次用 `npx electron-builder --dir --win`（绕过 `electron:build` 的 nsis+msi）产出 `release-electron/win-unpacked/`，真启动、真按键、真关窗，逐条验证到底：

1. **托盘图标真的出现**（OS 级 UIA，不是看截图）：`SystemTray.NormalButton` name=` LUT Timetable 0.2.20`，rect=`2466,1666,70,70`，挂在 `TopLevelWindowForOverflowXamlIsland` 浮出层里。
2. **`extraResources` 真的把图标拷进 `resources/`**：`md5sum build/icon.ico release-electron/win-unpacked/resources/icon.ico` 同为 `3a2574c2c5ba32f0ea38d2896afe9b10`；运行日志 `[desktop] tray ready, icon=…\win-unpacked\resources\icon.ico`（证明用的是 resources 那份，不是源码 fallback）。
3. **`Ctrl+Shift+L` 真的抢占到系统**：日志 `registered=true`，且 `WScript.Shell.SendKeys('^+l')` 真按键让窗口可见性 1→0→1（进程始终 4 个）。
4. **关窗真的进托盘**：`CloseMainWindow()` 之后 `running=4 visible=0`（既不是退出，也不是留下一个可见窗口）。
5. **托盘「退出」真的退出**：UIA 右键托盘图标 → 菜单项「退出」rect=`2501,1631,178,49` → `InvokePattern.Invoke()` → `running=False`（0 进程）。
6. **打包后 `userData` 偏好真的双向**：写入侧（关窗收托盘后文件出现 `{"closeToTray":true,…,"balloonShown":true}`）；读取侧（`closeToTray:false` 重启 → 关窗即退出）。真实路径 `%APPDATA%\lut-timetable\desktop-prefs.json`。

- **真产物跑出来的真 bug（已修）**：记事本 / PowerShell `Set-Content -Encoding UTF8` 保存的 `desktop-prefs.json` **带 BOM**，`JSON.parse` 直接抛 → catch 里静默回默认值 → **用户手改的「关窗即退出」被重置成默认的「收进托盘」**。修行：读取时 `replace(/^\uFEFF/, '')`；catch 只在 `err?.code !== 'ENOENT'` 时 `console.warn`（首次运行没文件不该刷日志，真读不懂才要留痕）。复验：带 BOM 的 `closeToTray:false` → 关窗 `running=0` 且日志无 unreadable 警告。
- **守卫缺口（真产物跑出来的第二条，就是这个实验的价值）**：关窗降级原本只覆盖「`new Tray` 抛错」，但**删掉 `resources/icon.ico` 后 Electron 根本不抛**，而是建出一个**看不见的托盘图标**（日志 `tray ready, icon=none`）——比没有托盘更糟，正好绕过守卫。修行：`setupTray()` 先看 `appIcon().isEmpty()`，空图标等同没有托盘（`tray skipped: icon empty`），close 处理器随之降级为关窗即退出。复验（配置仍是 `closeToTray:true`，即真的走了降级分支）：日志出现 `[desktop] close without tray -> quit`，`CloseMainWindow()` 后 `running=0`。
- **契约测试**：`desktop.test.ts` 新增 2 条锁住这两处守卫（`tray unavailable` / `icon.isEmpty()`→`tray skipped` / `close without tray -> quit` / BOM 剥离 / 只有非 ENOENT 才警告），因为这类守卫最容易被下次重构顺手改回去。
- **未验证（明说，不用推断顶替）**：macOS / Linux 的关窗与托盘行为只跑过代码路径（本机是 Windows）；`displayBalloon` 的气泡是否真弹没做视觉断言（专注助手会吞）；`--dir` 构建下 `app-update.yml` 缺失导致的 `Checking for update` ENOENT 是预期现象（nsis 产物才有这个文件，不是缺陷）；真实无托盘环境（少数 Linux 桌面）没条件复现，降级路径是用「删图标」造出来的等价场景。
- **冒烟脚本用完即删、仓库里不留**（做法记在这里，下次不用重新摸）：托盘退出 = 开溢出浮出层（Invoke「显示隐藏的图标」）+ 重试循环 → 按 UIA name 找 `LUT Timetable 0.x` → 光标移到图标中心右键 → 找 name 匹配 `^(退出|退出应用|Quit)$` 的菜单项 → Invoke；快捷键 = `WScript.Shell.SendKeys('^+l')` 配合 `CloseMainWindow()`，每次读「有 MainWindowHandle 的进程数」当可见性。教训：本机 Windows 的托盘浮出层 UIA **不稳定**——浮出层会自己关闭，必须重试循环；`Shift+F10` 键盘路径拿不到菜单，右键路径可以；`Start-Process -RedirectStandardOutput` 会把工具调用挂到超时，用 bash 后台重定向。
- 门禁：`npx tsc -b` / `npx vitest run`（623 通过，69 文件）/ `npm run test:consistent`（collected=executed=623）/ `npx oxlint`（0 error，25 warning 既有）/ `npm run build`。

## 2026-09-26 · 结构重组：一个关注点一个家（纯重构，不改行为）

审计对 DESIGN 打分很低的原因很具体：这一轮每加一个功能都往同一处塞接线——`App.tsx` 长到 1403 行（分享 / 订阅 / 诊断 / 桌面桥 / 小组件后台回调的 glue 全在里面，而 `src/hooks/` 才是这类东西的既有归属），`electron/main.cjs` 576 行同时装了 proxy / SSO / updater / 跳转列表 / 托盘 / 偏好（仓里已有 `external-links.cjs` 这种拆分先例），托盘文案还有三个家、值被抄了两份。本次只做拆分与去重，不加功能、不改行为，审计标了「你拍板」的两项（`i18n.tsx` 的 `translate` 抽取、全局热键默认开启）依然没动。

- **主进程：`main.cjs` 576 → 346 行，只留接线**。托盘 / 快捷键 / 偏好 / 关窗策略 / 托盘 IPC 整块进 `electron/desktop.cjs`（导出 `createDesktop({ ipcMain, getWindow, createWindow, sendToRenderer })`）；图标解析（托盘 + 跳转列表共用）进 `electron/app-icon.cjs`。关窗决策只在一处：`main.cjs` 现在就是 `win.on('close', (e) => desktop.handleClose(e))` —— 「收进托盘 / 无托盘时降级退出 / `before-quit` 放行」全在 `handleClose` 里，不再有两份判断。
- **托盘文案只剩一个家**：`electron/tray-labels.json`（7 条 × 中英）。主进程 require 它当兜底，渲染端 `lib/desktop.ts` 也读同一份（`trayLabels(lang)` 就是 `TRAY_LABEL_VALUES[lang]`），`i18n.tsx` 里那 14 条 `tray*` 重复文案删掉了。**改托盘文案就改这个 JSON**（两种语言一起），不要再回 i18n 里加——否则又是两个家。因为 `electron/**` 在 electron-builder 的 `files` 里，这个契约文件会进 asar；渲染端为它开了 `resolveJsonModule`。
- **渲染端：`App.tsx` 1403 → 1208 行**，搬走的是这一轮新增的 glue，全部落在既有归属 `src/hooks/`：`useDesktopBridge`（状态镜像 / 切语言推文案 / 托盘命令 / setPrefs）、`useSubscriptions`（订阅状态 + 持久化 + watch/markFired 一起，取消订阅仍是删除而不是静音）、`useDiagnostics`（错误条数 + 导出报告 + 清空）、`useShareLinks`（二维码弹层 + 导入 + 本周打包，仍是「装不下就只给链接并说出来」）、`useWidgetTaskBridge`（小组件勾选回灌 + 任务变化重抓种子）。组件只接 props，不再自己持有这些状态。
- **搬家时顺手修了一条 lint**：原来 `tasksRef.current = tasks` 写在渲染期（`react(refs)`），现在改成 effect 同步（声明在 drain 之前，同一次提交里先刷新 ref），警告数保持 25 不变。
- **行为由测试与真产物双保险**：`appDesktop.test.tsx`（渲染真 `<App/>` + 假桥）与 `settingsDesktop.test.tsx` 一个字没改就继续全绿——这是「拆分没改行为」的主证据；`desktop.test.ts` 改成读新家，并新增一条反向守卫：`main.cjs` 里**不得**再出现 `new Tray(` / `globalShortcut.` / `desktop-prefs.json`，防关注点回流。
- **重组让上一段的验证作废，所以全部重跑了一遍**（同一个 `--dir` 产物，六个点逐条）：① 日志 `tray ready, icon=…\win-unpacked\resources\icon.ico`；② `md5sum` 图标 `3a2574c2…` 与 `build/icon.ico` 一致；③ `registered=true` 且真按键 `Ctrl+Shift+L` 让窗口可见 1→0→1（进程始终 4）；④ `CloseMainWindow()` 后 `running=4 visible=0`；⑤ 托盘右键「退出」→ `running=0`；⑥ 偏好双向：`closeToTray:false` → 关窗 `running=0`，`closeToTray:true` 关窗后文件被写成 `balloonShown:true`（仍是 4 进程）。降级守卫同样重验：删掉 `resources/icon.ico` → `tray skipped: icon empty` + `close without tray -> quit` → `running=0`。
- **预览里的核心流程**（`vite preview` 5312，种一节今天的课）：今日视图正常渲染（`REF100 · 重构验证课 10:00–11:00 · M19_AUD1B`）；命令面板 →「分享本周课表」→ 二维码弹层出现（链接 + 1260 个深色模块的 SVG）；把弹层里的 `#/import/…` hash 灌回去 → 导入确认弹层「共 1 节课」→ 确认后去重提示「这些课都已在你的课表里」→ 关闭后 hash 被清掉；课程详情「有变动就提醒我订阅」→ `tt_subscriptions_v1` 出现 `course-change/REF100`；设置打开后「桌面端」分区**不存在**（web 本就没有 `lutDesktop` 桥），而订阅列表、导出诊断（点一下出「诊断文件已导出」）都在。控制台无报错。
- 门禁：`npx tsc -b` / `npx vitest run`（624 通过，69 文件）/ `npm run test:consistent`（collected=executed=624）/ `npx oxlint`（0 error，25 warning 既有）/ `npm run build`。

## 2026-09-26 · 删除优先的精简（只动这一轮新增的代码）

先删机制、再谈保留。每处保留都写了它为什么承重：

- **删掉：一次性托盘气泡及其记账**（`hintHiddenToTray` / 偏好字段 `balloonShown` / `tray-labels.json` 的 `hiddenHint` 中英文案）。它只在第一次收托盘时出现一次，代价是一个偏好字段、一段 Windows 专属调用、一条文案和一个「提示过了」的状态。**这是本轮唯一一次有意的行为移除**：现在收托盘的反馈就是托盘图标本身（外加随时可用的全局快捷键）。真产物上看得见：`closeToTray:true` 关窗后 `desktop-prefs.json` 不再被改写（以前会多出 `balloonShown:true`）。
- **删掉：通用修饰键格式化器**。`prettyAccelerator` 写了 CommandOrControl/Command/Control/Option/Shift 六种写法，而应用只有一个热键；换成单例 `acceleratorLabel`（只认 `CommandOrControl+Shift+*`）。可视断言没丢：`settingsDesktop.test.tsx` 仍锁 mac 文案 `⌘ + ⇧ + L`，`desktop.test.ts` 锁两个平台。
- **删掉：收拢后死掉的导出与死分支**。`desktop.cjs` 曾导出 `TOGGLE_ACCELERATOR` / `TRAY_LABEL_KEYS`（零 import），并返回 `markQuitting` / `dispose`（`before-quit` / `will-quit` 就注册在同一文件里，主进程根本拿不到）；`useShareLinks` 的 `ShareImportState` 类型只是内部用；`saveDesktopPrefs` 的返回值和 `appIcon()` 里嵌套的 `isEmpty` 分支（调用方已经判过）也一并删掉。只留了 `appIcon()` 的 `try`：这是启动路径，在这里抛一下就是应用起不来。
- **合成一条路径：主进程里那两处「显示窗口」和「跳视图」**。`second-instance` 的 `restore+show+focus` 与 `--open-view=` 的「等 did-finish-load 再写 hash」过去在 `main.cjs` 里各写了一份，和 `desktop.cjs` 里的重复；现在统一走控制器导出的 `desktop.showWindow()` / `desktop.navigateToView()`。`main.cjs` 337 行，只接线。
- **为什么剩下的不能删（对着审计的 20–25% 说）**：那个估算是按重组前算的，而它点名的三处大头——图标候选链两份、托盘文案三个家、App 里的 glue——上一次已经拆掉了，重算会重复计价。按重组后的基数，这次真正删掉的是 ~24 行生产代码（−8%）；剩下的每一块都有真实失效模式兜着：prefs 的 BOM/ENOENT 处理（打包产物里抓出的真 bug）、空图标守卫（删图标才暴露的「看不见的托盘」）、无托盘降级退出、与 preload 对齐的 IPC 面、必须能被主进程 require 的文案契约（原生菜单读不到 i18n）。再往下删就是删功能或删测试缝（`appIconPath` 与 `appIcon` 分开，就是为了「日志里看得见路径」和「Tray 要图像」两件事）。
- **临时脚本清零**：`release-electron/*.ps1`（托盘右键 / 真按键两个冒烟脚本）用完即删，仓库里不再有任何 `.ps1`；做法留在上一节的「冒烟脚本」一条里。
- **精简后重跑的真实证据**（新 `--dir` 产物）：① `tray ready, icon=…\resources\icon.ico`；② 图标 md5 `3a2574c2…` 与 `build/icon.ico` 一致；③ `registered=true` 且真按键 `Ctrl+Shift+L` 让可见性 1→0→1（进程始终 4）；④ 关窗后 `running=4 visible=0`；⑤ 托盘右键「退出」→ 0 进程；⑥ `closeToTray:false` → 关窗 `running=0`。降级守卫：`closeToTray:true` + 删掉 `icon.ico` → `tray skipped: icon empty` + `close without tray -> quit` → `running=0`（第一次跑时 prefs 还是 `false`，这条路径根本没被走到，结论无效——重跑了一次才算数）。预览（新 bundle）：启动渲染、分享弹层（链接 + 1246 模块 SVG）、设置里「桌面端」分区缺席而诊断/订阅在，控制台无报错。
- 门禁：`npx tsc -b` / `npx vitest run`（625 通过，69 文件）/ `npm run test:consistent`（625/625）/ `npx oxlint`（0 error，25 warning 既有）/ `npm run build`。

## 2026-09-26 · 修掉自己造的回归 + 把「合并路径 / 降级分支」在真产物里跑掉

- **回归一（安全：重复导入，已修）**：`useShareLinks.confirmShareImport` 曾把 `importLessons(...)` 写进 `setShareImport(prev => ...)`。`src/main.tsx` 用 `<StrictMode>`，dev / `electron:dev` 下 updater 会跑两次 → 同一批课**真的落库两遍**，而弹层只报「这些课都已在你的课表里」（`shareImportDone` 永远看不到）。修法是最小的：恢复重构前的次序——先 `importLessons(...)`，再 `setShareImport({ kind: 'done', … })`，回调依赖当前的 `shareImport`（与当年 App.tsx 里的闭包同形，没引入 ref 或新状态机）。
- **回归一现在有测试兜着**：新增 `src/__tests__/shareImportStrict.test.tsx`（2 条）。它用真 `<App/>`（包在 `<StrictMode>` 里）+ 真 `#/import/…` 入口，断言弹层出现「已导入 1 节」而不是去重文案、且 `tt_lessons_v1` 恰有一条；另一条断言取消不落库。**做过反向验证**：把 updater 版本临时放回去，测试立即失败并报 `expected [ { code: 'IMP100', … }, … ] to have a length of 1 but got 2` —— 即当年的症状比审计描述更重（不只文案错，是重复导入），测试不是摆设。
- **回归二（启动即弹错框，同样是这次合并暴露的，已修）**：`app.on('will-quit', …)` 交给 `createDesktop()` 后，它比 `if (!gotSingleLock) app.quit()` 先注册。启动第二个实例时 `will-quit` 早于 ready 到来，`globalShortcut.unregisterAll()` 直接抛 `Error: globalShortcut cannot be used before the app is ready`，第二个实例弹出一个标题为 “Error” 的原生错误框并驻留（旧代码把这一整段放在 `app.quit()` 后面，处理器根本还没注册，所以从未暴露）。修法：`will-quit` 里加 `if (app.isReady())`；`desktop.test.ts` 加一条反向守卫。（**追记：这只关掉了错误框，没有关掉竞态本身——拿不到锁的进程仍然跑完了整个启动，真正的根因与修法见下一节。**）
- **三条路径在同一个 `--dir` 产物里真跑过（各自有可观察结果）**：
  1. **`--open-view=week`**：带 `--remote-debugging-port=9334` 启动，DevTools target 的 url 实测 `…/app.asar/dist/index.html#/view/week` —— 合并后的 `desktop.navigateToView()` 真的等到了 did-finish-load 再写 hash。
  2. **第二个实例**：先关窗收进托盘（`running=4 visible=0`），再启动一个实例 → `running=4 visible=1`，进程表里只剩原来那 4 个（同一启动时间、标题 `LUT 课表`），**没有第五个进程、没有 Error 框** —— `second-instance → desktop.showWindow()` 合并生效，且上面那条崩溃确实没了。
  3. **快捷键被偏好关掉**：`shortcutEnabled:false` 启动后日志是 `tray ready…` + `shortcut disabled by preference`（没有 `registered=true`），随后真按 `Ctrl+Shift+L` 窗口保持可见（visible 1→1）、进程仍 4 —— 降级分支是真没注册，不只是打了行日志；托盘照旧可用。
- **仍未在真产物里跑（明说）**：macOS / Linux 的对应路径；Linux 真无托盘环境；`displayBalloon` 已删故不再涉及。
- 门禁：`npx tsc -b` / `npx vitest run`（628 通过，70 文件）/ `npm run test:consistent`（628/628）/ `npx oxlint`（0 error，25 warning 既有）/ `npm run build`。

## 2026-09-26 · 单实例竞态：真正关掉（上一轮只盖住了症状）

- **事实（拿失败进程自己的日志说话）**：`if (!gotSingleLock) app.quit()` 之后的代码照旧执行，而 `app.quit()` 是异步的——拿不到锁的进程会跑完整个启动。它的 stdout 里有 `[desktop] tray ready, icon=…`，而这行只在 whenReady 里的 `desktop.setup()` 才会打；即它建了自己的 BrowserWindow 与托盘图标、重新注册了 SSO 协议、起了第二条 updater 定时器链，并和活着的实例抢同一份 userData（`Unable to move the cache: 拒绝访问` / `Gpu Cache Creation failed`）。上一轮把 `createDesktop()` 提前注册，只是把「静默双启动」变成「显式崩溃」；随后的 `will-quit` + `app.isReady()` 又只消掉了那个错误框。
- **修法（最小，无新协议、无新抽象）**：拿不到锁的分支改成**同步退出** `app.exit(0)`（不发 quit 事件、立即结束），并把启动工作整体挂在锁上——`if (gotSingleLock) app.whenReady().then(…)`。两道保险：即使 `app.exit()` 在某种时序下被推迟，那个进程也不会进 whenReady。`second-instance` 的 restore+show+focus 分支未动。
- **真产物复验（同一个 `--dir` 产物，三步重跑）**：① 启动 A → `tray ready` + `registered=true`，`running=4 visible=1`；② 关窗收托盘 → `running=4 visible=0`；③ 启动 B（拿不到锁）→ 事后 `running=4 visible=1`，而 **B 自己的日志只有 2 字节（一个 CRLF）**：没有 `tray ready`、没有 `registered=`、没有 `Unable to move the cache` / `Gpu Cache Creation failed`，进程全程 4 个，A 被唤回可见。
- **分享导入在打包产物里重跑**（CDP 驱动真 UI，不是模拟）：清空课表 → hash 进 `#/import/v1.…` → 点「导入」→ 弹层 `导入分享的课表 | 已导入 1 节 | 关闭`，`tt_lessons_v1` 恰好 1 条（`打包导入验证课`）。driver 脚本用完即删，仓库里不留。
- **顺手清掉的老残留**：一个从 01:40 就在跑的 `vite preview --port 5311`（本项目 dist 的静态服务，属于早先几轮的验证）。
- 门禁：`npx tsc -b` / `npx vitest run`（629 通过，70 文件）/ `npm run test:consistent`（629/629）/ `npx oxlint`（0 error，25 warning 既有）/ `npm run build`。

## 2026-09-26 · 补齐托盘菜单与导入取消的证据（顺带抓出「作业」死链）

- **`--dir` 真产物上的菜单逐项验证（UIA 只认 `ControlType.MenuItem`，否则全树搜名字会误点应用自己的导航按钮）**：菜单实测内容 `显示主窗口 | 今日 | 周视图 | 作业 | 检查更新 | 退出`。每一项都有可读出的结果，不是「没报错」：
  1. **显示主窗口**：关窗后 `running=4 visible=0` → 点它 → `visible=1`。
  2. **今日**：hash `#/view/today`，段控 `aria-pressed` = 今日，正文渲染出 `9月26日星期六`。
  3. **周视图**：hash `#/view/week`，渲染出 `第 39 周 · 2026年9月21日周一 – 9月27日周日`。
  4. **作业**：**修复后** hash `#/view/assign`、`aria-pressed` = 作业、标题渲染出「作业与任务」。
  5. **检查更新**：点一次只多出两行主进程日志（`Checking for update` + `--dir` 下预期的 `app-update.yml` ENOENT），渲染端 UI 同步变成「检查更新失败，请稍后重试」——往返两边都看得见，且归因于这一次点击。
  6. **退出**：`running=0`。
- **真产物抓到的真缺陷：托盘「作业」与跳转列表「作业」都是死链**。主进程发的是 `assignments`，而渲染端路由词表只有 `today|week|assign|moodle`（`App.tsx` 的路由正则、`widgetData` 的桥、`main.tsx` 的 `consumeWidgetNav` 三处一致）。发错名字不报错：**hash 变成了 `#/view/assignments`，视图却停在今日**（修复前实测：`segActive` 仍是今日、正文仍是 `9月26日星期六`）。修法是两处一个词：`desktop.cjs` 的 `navigateToView('assign')`、`main.cjs` 跳转列表的 `view('assign', …)`（菜单**文案键** `assignments` 不变——那是文案键不是视图名）。
- **新增守卫 `only asks for views the renderer router knows`**：`desktop.test.ts` 把 `App.tsx` 也读进既有的 raw glob（键形状随 Vite 变化，按 `endsWith('App.tsx')` 取，别写死字符串），解析出词表后断言主进程用到的每个视图名都在其中。**做过反向验证**：把 `assign` 改回 `assignments`，测试立刻红，消息是 `主进程发了渲染端不认识的视图名: assignments: expected [ 'today', 'week', 'assign', 'moodle' ] to include 'assignments'`。
- **同一产物上重跑的其余项目**：`--open-view=week` → 文档 URL `…app.asar/dist/index.html#/view/week` + 周视图渲染；**跳转列表的作业项参数**`--open-view=assign` → `#/view/assign` + 「作业与任务」（跳转列表**点击本身**没跑，跑的是它要启动的 argv，如实记账）；`shortcutEnabled:false` → 日志 `tray ready` + `shortcut disabled by preference`（无 `registered=true`），随后真按 `Ctrl+Shift+L` 可见性 1→1、进程仍 4；分享导入的**取消**路径 → 弹层渲染出 `导入分享的课表 | 共 1 节课 … | 导入 | 取消`，点取消后弹层消失、`tt_lessons_v1` 为 0 条、hash 清空（不落库）。
- **同时在这一份产物上复验了原六项**（避免「编辑让旧证据退回声明」）：`tray ready, icon=…\resources\icon.ico`；真按键 `Ctrl+Shift+L` 可见性 1→0→1（进程始终 4）；关窗 → `running=4 visible=0`；托盘「退出」→ `running=0`；prefs 双向（`false` → 关窗即退／`true` → 收托盘）。
- **一次无效运行（记下来免得再犯）**：换构建重跑时忘了先杀上一个实例，结果探针全打在仍在运行的**旧实例**上（它有 `shortcutEnabled:false`，所以按键毫无反应），而新实例因拿不到锁**同步退出**——它的日志只有 2 字节。也就是说这次乌龙反过来又证明了一遍单实例修复。
- **仍未跑（明说缺哪条证据）**：macOS / Linux 的窗口与托盘路径；Linux 真无托盘环境（降级守卫是用「删掉 icon.ico」造的等价场景）；Windows 跳转列表条目本身的点击（上面跑的是它的 argv）。
- 门禁：`npx tsc -b` / `npx vitest run`（630 通过，70 文件）/ `npm run test:consistent`（630/630）/ `npx oxlint`（0 error，25 warning 既有）/ `npm run build`。收尾：无残留进程、无监听端口、仓库内无临时脚本（`tray-item.ps1` / `cdp.mjs` / `hotkey-probe.ps1` 用完即删），prefs 为 `{"closeToTray":true,"shortcutEnabled":true}`。

## 2026-09-26 · 成绩三件套：冷启动快照 + 分类权重继承 + 班级均分休眠通路（全部对着真实 Moodle 载荷）

- **真实载荷先于实现（11 门 LUT 课程全量 dump，146 行 gradeitems，经打包版 CDP 取 token 直打 WS）**。权重有三种形态，此前只认第一种：① 扁平课 weightraw 挂叶子（BM20A9200 每周 0.07143）；② **分类课 weightraw 挂在 itemtype 'category' 行、叶子项 weightraw 字段整个缺失**（KE00DA03 两个 25% 分类、CT60A4050 exam 0.25/Attendance 0.1）——旧代码把 category 行当垃圾行丢掉，这些课的权重全丢、what-if/未评提示退化成简单平均；③ 显式 weightraw:0（老师决定不计分）不是垃圾行。修法：parse 时按 raw 的 `iteminstance`（category 行）↔ 子项 `categoryid` 配对，把分类权重**均摊给无自身权重的成员项**（w_cat/n），然后照旧丢 category 行——GradeItem 形状零改动，gradeCalc/组件全链路不用动。配对键传平行数组（`spreadCategoryWeights(raw, items, catIds)`），不在 GradeItem 上加字段。真实回放验证：30361 的 Attendance 10% → 10 个成员各 1%；32632 Other 25% → 唯一成员 25%；分类无显式权重（如 "Assignments"）→ 成员保持 null，**不造假权重**；有自身 weightraw 的成员不碰。
- **成绩冷启动快照**：`tt_grades_cache_v1`（KEYS.gradesCache，随 BACKUP_KEYS 走）。此前成绩只活在内存——重启/断网时成绩段只剩空提示，要等 11 个 WS 请求全部回来才有内容。现在 fetchGrades 成功即写快照（两个写入点：refreshGrades + backgroundRefresh），启动时 useState 惰性读快照首屏即出；断网/刷新失败时快照留在原地（失败分支本来就不动 grades，天然不回退）；disconnectToken 连快照一起清（不留旧数据鬼影）。**打包产物 E2E**：正常启动 → `tt_grades_cache_v1` 写入 11 门课 → 杀进程重启并抢在初始刷新前用 CDP `emulateNetworkConditions offline` 断网 → moodle 视图 **11/11 门课全部渲染**（BM20A9200 28.6%、KE00DA03 100%），错误横幅同屏（刷新真的失败了，渲染只能来自快照）→ 恢复网络手动刷新 → 快照 fetchedAt 更新为刷新时刻。回放脚本用完即删。
- **班级均分是休眠通路，不是新功能**：LUT 学生 token 在任何可用端点都拿不到班级均分——`core_grades_get_grades` 在 LUT 站点不存在（`Can't find data record in database table external_functions`）、146 行 gradeitems 里 `gradeaverage`/`average` 出现 **0 次**、`gradereport_user_get_grades_table` 需要显式 userid 且列里也无统计列。解析层的 classAvg 一直在提取但从未展示——现在 GradeItemRow 在 classAvg 非空时显示 `均 75.5%`（i18n 新短键 `gradesClassAvgShort`，长键 `gradesClassAvg` 作 title）。哪个站点的 token 给了 gradeaverage，UI 立即生效，不需要再改代码。
- **顺手修掉的错误注释**：grades.ts 头部声称 `core_grades_get_grades → rata-rata kelas`——该函数在 LUT 根本不存在（学生 token 也不该有班级均分权限），现已改写为准确图景。
- **部分权重提示**：权重总和 <100% 时卡片 meta 行追加 `权重共 {w}%`（老师还没公布其余权重，别把「已计入 28%」误读成总分）。30361 的 HA 链全部无显式权重，正好落在这类。
- 测试：`grades.test.ts` 新增分类权重继承 4 条（均摊/不碰有权成员/丢 category+course 行/running total 计入继承权重，反向算过 106.25 = Baseline 100 + HA1 6.25）；`gradesSnapshot.test.tsx` 新增 6 条（快照往返/空数组与坏 JSON 拒收/清除/classAvg 渲染/部分权重出现与不出现）。门禁：tsc ✓ / **640 测试 71 文件** ✓ / consistent 640:640 ✓ / oxlint 0 error 25 warning 既有 ✓ / build ✓。
- 【坑】vitest `--root` 换目录跑临时测试会把项目里 70 个测试文件全拉进来再逐个报 `Cannot find module`（include 相对 root 解析）——真实载荷回放用 `vite-node` 跑临时 `.mts` 脚本更干净。CDP 断网用 `Network.emulateNetworkConditions`（渲染层 `navigator.onLine` 同步变 false），比拔网卡可编程。

## 2026-09-26 · 「同步提交状态」报错修复（教师视角 API 空返回的回退语义）

- **用户报「点击同步提交状态会出错」——真 token 复现链**：`mod_assign_get_assignments` 可用（29 个作业），但 ②`get_submissions` ③`get_grades` 直接 `invalid_parameter_exception`。分三步探参才定位全貌：① 代码传的 `assignmentids=JSON.stringify(ids)`（JSON 字符串）确实被拒；② 换 Moodle 的 indexed 格式（`assignmentids[0]=…`，URLSearchParams 键名带 `[0]` 即可，服务端接受 %5B 编码）后请求**成功但 assignments 恒为空**——mod_assign 提交/评分查询是教师视角 API，AGENTS.md 铁律②早有记录，但这里的表现不是报错而是**静默空**，更具迷惑性；③ 结论：LUT 学生 token 下该域**永远没有数据**，此前「成功」返回只是空集。
- **修法（两处）**：`fetchSubmissionStatus` 参数改 indexed 格式；新增 `fallbackStatusByCmid` 参数 + `fellBackToGrades` 返回——教师 API 空返回时不再把 subMap 清空（旧代码会把已有状态清掉），改从 grades 域（`gradeStatusByCmid`，93 个 mod 项里 submitted=33/graded=57，学生可读）按 cmid 合成状态，作业元数据（名称/dueAt/cmid 深链）仍来自可用的 `get_assignments`。`syncSubmissions` 点击时先拉一遍 grades 域做回退源（失败不阻塞主链路），消息条显示「Moodle 未开放提交查询，已用成绩单里的提交状态刷新」而不是报错。**打包产物真验证**：真点击按钮 → FALLBACK_MSG 文案出现，无异常。
- 【教训】「API 返回空」与「API 被拒绝」在 Moodle WS 上是两种失败：`invalid_parameter` 会抛（ gradesErrMsg 兜住），权限不足可能**静默空集**——解析层必须区分「网络成功但业务无数据」（回退/提示）与「网络失败」（报错）。参数格式教训同条：多值参数永远用 indexed 键名，别赌 JSON 字符串（curl 单发验证过 ≠ 服务器全局接受）。
- 顺手清掉 `lessonAlerts.ts` 两处既有 `no-useless-escape` warning（字符类里的 `\.`），oxlint 25→24 warning。
- 测试：`submissions.test.ts` 新增 4 条（indexed 参数形状/空返回回退且带 dueAt 与深链/真数据优先不被回退污染/无回退源时保持空集契约），vi.mock `wsCall`+`validateGradesToken`。门禁：tsc ✓ / **644 测试 71 文件** ✓ / consistent 644:644 ✓ / oxlint 0 error **24** warning ✓ / build ✓。

## SISU study planner structure (2026-10-01)

- `lib/sisuCourse.ts` owns public SISU GraphQL search and response parsing; `lib/sisuCourseCatalog.ts` owns the HDD reference rows, catalog source merge, focus ranking, and local preference storage. Cross-source Moodle identity comes from `courseIdentity.ts`; only exact-title matching is retained when both records have no code.
- `lib/sisuCourseSelection.ts` owns normalized planner/plan identities, selected candidate transitions, selected-credit totals, and visibility/relevance policy. Keep these policies pure; the component must not introduce parallel identity keys or filtering rules.
- `lib/sisuStudyPlan.ts` owns persisted plan item shape, validation, creation, and persistence. `lib/sisuStudyPlanReminders.ts` owns native reminder scheduling and URL validation.
- `hooks/useSisuStudyPlan.ts` is the single React state/orchestration owner: current plan, selected-course preferences, current SISU search result, request cancellation, reminder refresh, and form state. It derives merged candidates and totals from those owners. `components/SisuStudyPlan.tsx` renders the hook model and dispatches user events only.
- Flow: SISU search + timetable/enrolment/identity inputs → catalog model → selection policy + plan state → derived view model → renderer. Avoid duplicating selected result snapshots in component state: persist selected public records only, keep unselected hits scoped to the current search.
- Safety: never join a coded course to a code-less one by title alone; title joins can collapse distinct courses. Use the canonical identity index whenever Moodle enrolment ID ↔ course code resolution is available.

## 计划 ↔ SISU 公开目录结合（2026-10-01）

- **不碰 SISU 认证**：个人学习计划（PSP）在强认证后面，本应用没有也暂不打算有 SISU 登录。能做的「结合」只有两件：（1）计划项按课程代码深链到 SISU 官方课程页；（2）用公开目录核对名称/学分。别把「能核对学分」当成「同步了计划」。
- **一个代码一次请求**：`lib/sisuCourse.ts` 新增 `lookupSisuCourseByCode`（`codeQuery` + `universityOrgIds` + `validity: ONGOING_AND_FUTURE`，按规范化代码精确挑行、取不到才退回首行），顺带写 `tt_sisu_course_ids` 缓存供 `resolveSisuCourseUrl` 复用。真实响应字段实测为 `id code name{en fi} credits{min max}`；**没有**能证明当前授课学年的字段——与 `searchSisuPublicCatalog` 一致，`studyYears` 保持空，学年不参与核对（否则会误报不一致）。
- **解析只留一份**：`searchSisuPublicCatalog` 与 `lookupSisuCourseByCode` 共用 `parseCatalogRow`，别在两处各写一遍 credits/name 解析。
- **核对策略是纯函数**：`lib/sisuPlanMatch.ts` 的 `checkPlanItemAgainstCatalog` 只比名称（大小写/空白/尾部标点不敏感）与学分（**任一侧缺失就不下结论**，避免把「没填」当不一致），返回 `no-code | not-found | match | differs` + `differs[]` + 命中的目录记录。组件只渲染，不重算。
- **代码规范化唯一来源**：`normalizeSisuCode`（trim + 去 `-dddd` + 大写）在 sisuCourse 里；`planCourseCodes` 与深链都复用它，别自写正则。
- **mock 覆盖要跟上新导出**：hook 现在从 `../lib/sisuCourse` 导入 `lookupSisuCourseByCode` 与 `normalizeSisuCode`；旧测试只 mock 了 `searchSisuPublicCatalog`，整体替换模块会让这两个是 `undefined`，`catalogViewFor` 在**渲染期**抛错。mock 必须补全（见 `components/sisuStudyPlan.test.tsx`）。
- **实证**：浏览器直连 `https://sisu.lut.fi/api/`（无认证）→ CT60A4050 命中 `otm-5adbe49e-…`，计划项显示「SISU：名称与学分一致」并给出深链；深链实测打开到真实课程页（Fundamentals of Software Engineering (6) · 2026-2027）；伪代码 ZZ901 →「未找到」；学分填 3 →「SISU 学分：6」。测试 `sisuPlanMatch.test.ts`（6 条）+ `components/sisuPlanCatalog.test.tsx`（4 条）。

## 设置归类与偏好唯一入口（2026-10-01）

- **设置弹层从 15 个平铺小节归入 5 个分类**（外观与无障碍 / 同步与连接 / 学习偏好 / 数据与工具 / 日志与订阅），顶部加分类索引。实现是 `Settings.tsx` 里的 `Group` 组件（分类标题 + `settings-<id>` 锚点）；索引按钮跳转必须写成 `document.getElementById(...)?.scrollIntoView?.(...)`——jsdom 没有 `Element.scrollIntoView`，直接调用会让整个设置组件测试崩掉。
- **散落的偏好收口**：SISU 学习偏好（focus，`tt_sisu_course_preferences_v1`）与目标学分（`tt_sisu_study_plan_v1.goalCredits`）的唯一编辑入口移到设置；计划页只读展示 + 「在设置中修改」链接。表头那份重复的语言切换已删除，语言只在设置里（命令面板的语言项保留）。
- **跨界面生效靠 remount，不靠 effect**：设置改了偏好后 App 递增 `sisuPrefsRevision`，父组件拿它当 `<SisuStudyPlan key={sisuPrefsRevision}>`——重挂载让 `useState(load…)` 重新读存储。比在 hook 里加「revision 变化就 setState」的 effect 更简单，也不触发 `set-state-in-effect` 警告（该规则在本仓已有 4 处同类）。代价是重挂载丢计划页的临时 UI 状态（搜索词/表单），但此刻用户正在设置里，可接受。
- **同名文本查询要按 role 区分**：分类索引按钮与分类标题文案相同，`getByText` 会撞到多个元素——标题用 `getByRole('heading')`。契约测试见 `__tests__/components/settingsGroups.test.tsx`（分类数、索引跳转容错、focus/目标落盘、改目标不碰计划条目）。

## 2026-10-15 · 每周学习时段建议（纯函数排程 + 确认制落盘 + 只读呈现）

- **策略全体下沉到 `lib/studyBlocks.ts`**：窗口（本地日 08:00–22:00）、60 分钟块、块间 15 分钟缓冲、未来 7 个本地日、截止优先 + 同截止保持输入序、无空档进 `unscheduled`。`planStudyBlocks(input) => { recommendations, unscheduled }` 是唯一入口，hook 与组件不得自己算时段。**默认常量就是契约**：将来加「作息偏好」时必须让 `DEFAULT_*` 等于旧常量，既有排程测试才能继续当守卫。
- **身份键是 `sourceKind + sourceId`**：任务与 SISU 计划项可能撞同一个原始 id（测试里两源都叫 `shared-id`），只用 id 去重会静默吞掉一条建议、只用 kind 会重复排。确认走同一把键做幂等，所以单条确认、批量确认、重复点击都不会写出第二块。
- **本地日界线只由纯函数判**：`studyBlocksOnDay(blocks, day)` 负责按设备本地日分组 + 按开始时刻稳定排序；组件不许自己拆 ISO 串比日期（UTC+8 下 UTC 日期与本地日差一天，跨日边界会静默漏块）。非法日期返回 `[]`、坏记录被 `isStudyBlock` 过滤——脏数据不能把整块视图弄崩。
- **只读叠加要真的「只读」**：周视图/今日页的学习块走独立 prop（`studyBlocks?: StudyBlock[]`，默认 `[]` ⇒ 不传即旧行为），**不进** `layoutDay` / `conflictGroupsOf` / 便签 / 订阅 / ICS 导出，也不借课程色板（课程色是写在内联 style 的 background 上的，学习块的内联 style 里不许出现它）；渲染顺序在课程按钮之前，课程照旧可点、可盖住它。断言写成「既有冲突徽标数不变 + `onSelect` 不被触发 + 类名是 dashed」，这类边界最容易被下次重构顺手合并掉。
- **周视图可视窗 08:00–20:00 vs 学习窗 08:00–22:00**：起始 ≥20:00 的块不画进周视图网格（不动 `END_HOUR` 与密度缩放），但今日页照常列出当天全部块——是刻意取舍、不是丢数据。两侧各一条测试锁住，并写进设计文档，别只活在代码里。
- **App 接线靠 `view` 重算（本批有意为之，非疏忽）**：今日/周/Moodle 三视图互斥渲染，确认只可能发生在 Moodle 视图，所以 `useMemo(() => loadStudyBlocks(), [view])` 就够。这条隐式机制由渲染真 `App` 的 `studyBlockVisibility.test.tsx` 锁住（把它改成 `studyBlocks={[]}` 立刻变红，已反向验证）。下一批做提醒时必须升级为「变更即重算」，别让它烂在那里。
- **流程教训（本批的账）**：三个任务的实现早就落地，但计划文档 checkbox 全空、设计文档还写着「未批准前不实现」、SDD 账本只记到 Task 1——**收尾不同步等于没记录**。规则：每个任务收尾同时更新 ① 计划 checkbox + 执行结果段、② 设计文档状态行与实际口径、③ 账本、④ 本节经验。UI 验证若因工具受限走了替代路径（本批 `agent-browser` CLI 因 Windows 文件锁起不来，改用 `vite preview` 服务本地构建产物 + 隔离无痕会话 + 临时样例数据），必须把「替代路径 + 原因 + 未覆盖的部分」写进执行结果，不当作等价验证。
- 门禁（2026-10-15 实跑，退出码逐条保留）：`npx tsc -b --pretty false` → 0；`npx vitest run` → 96 文件 / **760 通过** / 退出码 0；`npm run test:consistent` → `collected=760 executed=760` / 0；`npx oxlint` → **0 error、25 warning**（均为既存）/ 0；`npm run build` → ✓ built in 551ms / 0。本批涉及测试：`studyBlocks.test.ts`、`sisuStudyBlockHook.test.tsx`、`components/studyBlockReview.test.tsx`、`components/weekGrid.test.tsx`、`components/todayView.test.tsx`、`components/studyBlockVisibility.test.tsx`。

## 2026-10-15 · 学习时段偏好（窗口 / 时长 / 缓冲 / 范围）——默认常量即契约

- **偏好器独立成 `lib/studyBlockPrefs.ts`**（本轮新建）：`StudyBlockPrefs` + `DEFAULT_STUDY_BLOCK_PREFS` + `STUDY_BLOCK_LIMITS` + `normalizeStudyBlockPrefs` / `loadStudyBlockPrefs` / `saveStudyBlockPrefs`，键 `tt_study_block_prefs_v1`（进 `BACKUP_KEYS`）。`planStudyBlocks` 只多一个**可选** `prefs`：不传时归一化结果必须等于旧硬编码常量（08:00–22:00 / 60 分钟 / 15 分钟 / 7 天 / 不跳过周末），所以 Phase 1 的全部排程测试原样通过就是这条契约的守卫——加偏好不许再改 `DEFAULT_*`，要改就得同时改测试。
- **归一化写在一个地方**：逐字段按步长取整 + 夹区间，非数字回默认，**布尔只认真布尔**（`'yes'`/`1` 回默认，别把用户的字符串当同意）；跨字段再做「窗口至少放得下一块 + 缓冲」——放不下先抬结束时间，抬到 24:00 还不够就前移开始时间，绝不留一个永远排不出建议的窗口。存储/备份来的脏值一律过它，测试直接锁「越界 + 不齐步长 + 非布尔 + 坏 JSON + 数组 + 字符串」五类。
- **偏好是现读的，不是挂载时读的**：hook 在每次「生成学习时段建议」时 `loadStudyBlockPrefs()`，所以设置页改完立刻生效；`onSisuPrefsChanged` 只负责让计划页重挂载（清掉旧窗口下算出的待确认建议）。别把 prefs 塞进 `useState` 初始值了事——那样改完不重挂载就等于没改。
- **滑杆的无障碍名不能与既有控件撞名**：`role=slider` 的 `aria-label` 是测试定位锚点，但侧栏「手动添加课程」的时间输入早已占用「开始时间/结束时间」，真 DOM 里两者同时存在 → `querySelector('[aria-label="开始时间"]')` 命中 2 个元素、屏幕阅读器也分不清。改名「每日开始/每日结束」后才唯一。**教训**：新控件的 `aria-label` 先用真页面查一遍同名元素数量，别只在组件测试里看自己的那份 DOM。
- **验证方法（本轮可复用的做法）**：`vite preview`（本机 IPv6 loopback；`netstat` 确认 listener）服务本地构建产物 → 真浏览器里 ① 数 `input[type=range][aria-label]` 的名字/区间/默认值并断言全部落在 `#settings-study` 内；② 用 `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set` + `dispatchEvent(new Event('input'))` 拖 range（React 受控值必须这样驱动），断言**落盘值 + 控件回显**（拖到 9 被钳成 10）；③ 种一条明天的任务后真点「生成学习时段建议」，看真实排程结果随偏好变化（存 30 分钟/窗口 08–10 → `10月16日 08:00–08:30`；清掉偏好键 → 回到 60 分钟块），且确认前 `tt_study_blocks_v1` 为 null、来源任务逐字节未变。用完清样例数据 + 停 preview 进程（`taskkill //PID`）；**这不是打包产物/装机验证**，如实记账。
- **【修正·2026-10-15 后续批次】`remindEnabled` 已不是「无消费方的意图位」**：它是学习块提醒的开关（设置 → 学习偏好），有消费方（`NotificationManager` 收 `studyBlockRemindEnabled`）、有落盘、有测试锁定；诊断面板也按它决定「这家该不该有排期」。原文那条「本轮不排任何通知」只描述了那个批次当时的状态。**仍未做**：按星期几的差异化作息、偏好跨设备同步。
- 门禁（2026-10-15 实跑，退出码逐条保留）：`npx tsc -b --pretty false` → 0；`npx vitest run` → 98 文件 / **776 通过**（基线 760 + 新增 16）/ 0；`npm run test:consistent` → `collected=776 executed=776` / 0；`npx oxlint` → **0 error、25 warning**（均既存）/ 0；`npm run build` → ✓ built in 438ms / 0。本批涉及测试：`studyBlockPrefs.test.ts`（新增 5）、`components/studyBlockSettings.test.tsx`（新增 6）、`studyBlocks.test.ts`（+4 偏好用例）、`sisuStudyBlockHook.test.tsx`（+1 偏好用例）。

## 2026-10-15 · 学习块提醒（10 分钟前）+ 「变更即重算」显式化

- **提醒复用既有模式，但换了 id 反推方式**：`lib/studyBlockReminders.ts` 沿用 `sisuStudyPlanReminders` 的「权限闸门 + 已排期清单对账 + FNV-1a 稳定 id」，**不用** `examReminders` 那种「从当前数据反推 id」——学习块是用户可删除的实体，删掉后不在列表里、id 再也反推不出来，陈旧通知会永远留着。清单键 `tt_study_blocks_v1:scheduled`（派生后缀，**不**进 `BACKUP_KEYS`），对账只动自己的条目。
- **权限闸门必须排在碰插件之前**：Android 13+ 未授权时插件在原生线程 NPE 会**直接杀进程**（`.catch` 抓不到）。闸门返回 false 时的正确行为是「清掉旧的、不排新的、不抛错」；测试要显式声明权限前提——`vi.clearAllMocks()` **不还原** `mockResolvedValue`，同一文件里前面的用例把权限改成 `denied` 会静默污染后面的用例（本轮真的踩到，红→绿差一轮）。
- **通知总开关关闭时也要清自己的记账**：`cancelAllNotifications` 只撤销排期、不改「已排期 id」清单，清单会与实际漂移，下次开启时的对账就是基于脏数据。早退分支里补一次自己的清理。
- **`useMemo(() => load(), [cacheBust])` 是 lint 陷阱**：oxlint 的 `react-hooks(exhaustive-deps)` 会把不参与计算的依赖判为「unnecessary dependency」（本轮实测出现 2 条新 warning）。正确写法是让**变更信号自己驱动重读**：`lib/studyBlocks` 写盘后发信号，`hooks/useStudyBlocks.ts` 订阅并把列表放进 state；偏好开关同理，由设置保存时经回调推给 App（`onStudyBlockPrefsChanged`），不要在 App 里按修订号重读。副产品：删掉旧 memo 后既存 warning 25 → 24，0 新增。
- **「变更即重算」没法在浏览器里点出来**：今日/周/Moodle 三视图互斥渲染，块视图挂载时**没有**任何能改学习块的入口，所以「不切视图就更新」这条属性在真浏览器里不可能被点到区分。锁法：渲染真 `<App/>` 的测试直接调模块 API 确认/删除（`components/studyBlockLiveUpdate.test.tsx`），并做反向验证（把订阅换成空 effect → 两条用例立刻红）。
- **真浏览器里可观察的提醒证据**：应用启动时（偏好关着）`tt_study_blocks_v1:scheduled` 被写成 `[]` —— 这就是「接线真的跑起来了」的正面证据（只有该模块写这个键）；打开「开始前 10 分钟提醒」且存在未来的块时，浏览器通知权限为 `denied` → 不排期、键保持 `[]`、控制台零消息，即权限闸门在真产物里的表现。**未验证**：真机/打包产物上的实际推送（本轮明确不做）。
- 门禁（2026-10-15 实跑，退出码逐条保留）：`npx tsc -b --pretty false` → 0；`npx vitest run` → 101 文件 / **796 通过**（基线 776 + 新增 20）/ 0；`npm run test:consistent` → `collected=796 executed=796` / 0；`npx oxlint` → **0 error、24 warning**（比上轮少 1 条，无新增）/ 0；`npm run build` → ✓ built in 400ms / 0。本批涉及测试：`studyBlockReminders.test.ts`（新 13）、`components/studyBlockLiveUpdate.test.tsx`（新 2）、`components/notificationManagerStudyBlocks.test.tsx`（新 3）、`components/studyBlockSettings.test.tsx`（+2）。

## 2026-10-15 · 学习块完成状态 + 本周负荷概览（只读纯函数汇总）

- **完成状态是块自己的字段，不是来源的状态**：`StudyBlock.completed?`（缺省 = 未完成，旧记录无需迁移），唯一变更入口 `setStudyBlockCompleted(id, completed)` 只写学习块键 + 发变更信号，**未知 id 直接返回原列表**（空操作）。绝不回写任务/SISU 计划项/Moodle——这条不变量在 lib、hook、组件三层各用一次「逐字节比对」锁住（`KEYS.tasks` / `KEYS.sisuStudyPlan`），因为「完成一个学习块」和「完成一件作业」是最容易被下一个人顺手合并的两个动作。完成不影响排程：已确认块（含已完成）照旧占位、照旧阻止同一来源再被推荐。
- **概览必须是「只吃已确认块」的纯函数**：`lib/studyLoad.ts` 的 `studyLoadSummary(blocks, weekStart, now)`。「概览不因未确认建议而变」这条要求因此是**结构上成立**的，而不是靠组件记得别传：未确认建议只活在 hook 内存里，根本进不了函数签名。别为了「顺手也统计一下建议」把 pending 传进来，那会立刻打破这条被测试锁住的性质。
- **坏数据校验复用存储层那个**：概览用 `isStudyBlock`（已导出）而不是另写一份字段检查——两份校验迟早分叉，就会把「存储层拒绝的记录」算进负荷。周锚点非法 → 返回空概览（`days: []`），不是抛错也不是算 0 块（两者可区分）。
- **本地日分桶用本地日期算术**：`setDate(+offset)` 逐日构造桶与周界，不要 `+7×24h`（夏令时会把边界挪错一小时、跨日边界静默漏块）。归属按**开始时刻**，跨日/跨周的块不重复计数。
- **概览可以每次渲染现算，不必 memo**：纯函数 + 个位数循环，用 `new Date()` 现取当前时刻反而不会停旧；别写成 `useMemo(..., [revision])`（上一批已记录：oxlint 会判为多余依赖，且容易被下次重构顺手删掉而静默失效）。
- **组件测试里点击后立刻读 DOM 会读到旧值**：`fireEvent.click` / `element.click()` 之后同一 tick 读 `innerText` 可能仍是 React 提交前的文本（本轮真浏览器验证里踩了两次，靠「再读一次」复核）。真产物验证要读 setted 值；测试里用 `waitFor`/`findBy*` 而不是同步 `getByText`。
- **未做（留痕）**：周视图/今日页的只读叠加**不区分已完成**（那里没有改块入口，完成只发生在计划页）——刻意不动，不是遗忘；概览也不含任务/学分（只汇总已确认学习块，避免与成绩/计划两批数据的所有权重叠）。
- 门禁（2026-10-15 实跑，退出码逐条保留）：`npx tsc -b --pretty false` → 0；`npx vitest run` → 103 文件 / **811 通过**（基线 796 + 新增 15）/ 0；`npm run test:consistent` → `collected=811 executed=811` / 0；`npx oxlint` → **0 error、24 warning**（与上轮持平、无新增）/ 0；`npm run build` → ✓ built in 384ms / 0。本批涉及测试：`studyLoad.test.ts`（新 6）、`studyBlocks.test.ts`（+3）、`sisuStudyBlockHook.test.tsx`（+1）、`components/studyLoadOverview.test.tsx`（新 5）。

## 2026-10-15 · Phase 2 验证轮（五门禁 + 真实交付形态：打包桌面产物 + Android 装机）

- **门禁（本轮实跑，退出码逐条保留）**：`npx tsc -b --pretty false` → 0；`npx vitest run` → 103 文件 / **811 通过** / 0；`npm run test:consistent` → `collected=811 executed=811` / 0；`npx oxlint` → **0 error、24 warning**（均既存）/ 0；`npm run build` → ✓ built in 1.11s / 0。
- **「打包产物是不是当前树」用内容哈希证明，不看时间戳**：`electron-builder --dir` 产物的 `resources/app.asar` 里内嵌的是 `dist/assets/index-<hash>.js` 这类**内容哈希文件名**；`npm run build` 后拿当前 `dist/assets` 的名字 `grep -aq` 那个 asar，命中即同名同内容（本轮 `index-BdG5g7-A.js` / `index-ipPEFJn3.css` 命中；`resources/icon.ico` 与 `build/icon.ico` md5 同为 `3a2574c2c5ba32f0ea38d2896afe9b10`）。比 mtime 可靠、也比重装一次便宜。**nsis/msi 链受 EPERM 阻塞时 `--dir` 仍是可用的真产物**。
- **Electron 桌面端有可用的 LocalNotifications（web 实现），别默认「通知是原生专属」**：桌面里 `Capacitor.getPlatform()` = `'web'`、`isNativePlatform()` = false，但 `window.Capacitor.Plugins.LocalNotifications` 已注册且**真能工作**（`checkPermissions()` → `{display:'granted'}`，`schedule`/`getPending`/`cancel` 全实测可用）。判断「某类提醒到底排上没有」看 `getPending()`，别只看自己那份 tracked id 清单——本轮作业截止提醒与学习块提醒都真的出现在里面。
- **动手查排程 bug 之前，先确认数据真的进了应用状态**：把学习块直接写进 `tt_study_blocks_v1` 后重载，看到 `tt_study_blocks_v1:scheduled` 恒为 `[]`、`getPending()` 里没有学习块提醒，几乎要当成调度 bug；真因是 fixture 少了 `dueAt`——`isStudyBlock` 要求 `dueAt` 存在且 `endAt <= dueAt`，记录被**静默丢弃**。判别顺序：先看计划页「已确认的学习时段」是否列出这条块（应用看不到的=脏数据），再怀疑调度链。补上 `dueAt` 后同一条路径立刻 `tracked=[1980667240]`、pending 标题 `学习时段提醒`、body `有效块验证 · 10:00 开始`、`at` = 开始前 10 分钟。
- **打包桌面产物上真跑过的本批 UI**（`release-electron/win-unpacked`，CDP 驱动真窗口，非模拟）：首次启动会弹「欢迎使用 LUT 课表」引导层**遮住计划页**，先点「跳过引导」再截图（否则截图全被盖住）；`#/view/moodle` + `tt_moodle_section=studyplan` 进计划页；生成建议按截止优先排出 `10月15日周四 19:15–20:15`（截止 10/17）与 `20:30–21:30`（截止 10/18，块间 **15 分钟缓冲**、同截止保序）；加入计划只写一条、待确认留另一条；本周负荷 `学习块 1 个（已完成 0）· 计划 60 分钟（已完成 0 分钟）`、7 个日格里周四 60 分钟；勾 `标记「打包产物验证 A」完成` → 仅该块 `completed:true`、概览变 `已完成 1 / 60 分钟`，而 `tt_tasks_v1` 两条任务**逐字节未变**；今日页出现只读虚线卡 `19:15–20:15 | 打包产物验证 A | 任务`；设置 `#settings-study` 五个 range（`每日开始 8/0-23`、`每日结束 22/1-24`、`单块时长 60/15-240 步长 15`、`间隔缓冲 15/0-60 步长 5`、`推荐范围 7/1-14`）与两个 checkbox 齐备且无重名；原生 setter 拖 `单块时长`→30 落盘 `blockMinutes:30`、点提醒 checkbox 落盘 `remindEnabled:true`，全程零异常。
- **提醒投递（本批唯一此前未证实的环节）已在 Android 模拟器上兑现**：开关走**真 UI** 打开（后门写 localStorage 会被应用自身状态覆写，`tt_notif` 就是活例）→ 预置一条块 → `LocalNotifications.schedule` 被真正调用（logcat 看得见载荷）→ 系统转储 `dumpsys notification --noredact` 里出现 `NotificationRecord(pkg=dev.lut.timetable id=1798852662 title=学习时段提醒)`，**id = FNV-1a(`study-block:<块 id>:10`)**，播出时刻 = 块开始前 10 分钟。
- **Android 排程先过两道系统闸门**：① `POST_NOTIFICATIONS`（13+ 运行时权限）；② `SCHEDULE_EXACT_ALARM`（14+ **默认拒绝**）——被拒时 `schedule()` 在 JS 侧只表现为「排不上」，应用还会自己拉起精确闹钟设置页；这两项没排查完就别怀疑代码。
- **应用被系统设置页盖住时 WebView 会暂停**：此时 CDP 的 `Runtime.evaluate`（awaitPromise）可能挂到超时；给探针加**硬超时**并先把应用拉回前台。「那次 schedule 其实成功了、只是解析得很晚」是本轮真实的误判来源。
- **收尾**：模拟器种子数据清空、打包产物的探针键（任务/块/偏好/段）删除且 `getPending()` 归零、应用进程归零、临时脚本与截图用完即删；`.superpowers/` 不入库。

## 2026-10-15 · 「已排期通知」诊断面板 + 桌面投递实证

- **面板的归属**：`src/lib/pendingNotifications.ts` 是**唯一所有者**（纯函数 `pendingItemFrom` / `summarizePending` + 容忍型加载器 `loadPendingNotifications`，含 `PENDING_LIST_LIMIT`）；`src/components/PendingNotificationsPanel.tsx` 只渲染，挂在设置 → 日志与订阅（`Group id="logs"`）。12 条 zh/en i18n 键。**刻意不挂 revision/自动刷新**：诊断要的是「点一下看此刻的队列」，后台同步来回触发重读只会让用户正在看的那一屏自己变掉。
- **失败必须说出原因，且不能伪装成空队列**：读不到系统队列时显示 `读不到系统队列：{msg}` 并**不**显示「没有排期中的提醒」也不报数字——把失败显示成「没排期」正好掩盖了要查的那个问题。组件测试两条锁住这个区分，另有一条「数字只在读成功时才可信」。
- **lint 细节（本轮 0 新增 warning 的关键）**：`useEffect(() => { void read() }, [read])` 里的 `read` **只在 Promise 回调里落状态**，effect 体内不同步 setState——oxlint 的 `set-state-in-effect` 才不会命中（仓库里 IdentityDiagnostics / SyncProtection 恰恰是这个规则的既存命中项）。把 `setReading(true)` 放进被 effect 调用的函数体就会多一条。
- **【关键事实】web 实现的排期是真的按 `at` 走的**（此前我误以为「桌面会立即弹」）：`node_modules/@capacitor/local-notifications/dist/esm/web.js` 的 `sendNotification` 用 `setTimeout(at - now)`，到点才 `sendPending()` → `new Notification(...)`，并从 `pending` 移除。**桌面端能排也能投**：计划 16:31:06.631 → 构造发生在 16:31:06.638（5–6 ms 误差），`getDeliveredNotifications()` 里能看到它，`getPending()` 随即清空。面板因此忠实反映真实队列（同一 id 在预定时刻前可读、投递后消失）。
- **【未证实】Windows 系统级 toast 没在截图里出现过**：fire+0.5s / fire+4s 两张定点图 + 覆盖 fire−1s…fire+12s 的 14 张（~2.5s 间隔）扫图均无 toast。环境侧：`HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Notifications\Settings\electron.app.LUT Timetable` 键**存在**（Windows 认得这个通知源）、全局 toast 开关键缺省（=允许）、未见 quiet hours 键。未排查：专注助手、`--dir` 未安装产物缺带 AUMID 的快捷方式（Windows 自己建过一个 Start Menu 快捷方式）、renderer 的 `file://` origin 归因。**结论：“投递到 web/OS API”已证，“屏幕真的弹出来”仍未证——别把前者当后者。**
- **【已定案·2026-10-15 下文】那条「记着 id 但 `getPending()` 为空」的线索不是 effect 依赖身份不稳定**：真因是 `@capacitor/core` 的懒加载在 `await` 之后才赋值，**并发的首次调用各造一个插件实现实例**，排期写进了孤儿实例（打包桌面产物实测一次挂载 5 个实例）。结论与修法见下一节「提醒自愈 + 插件实例竞态的根因」。
- **验证方法（可复用）**：CDP 驱动真窗口（`--remote-debugging-port=9336`）+ 在页面里 **patch `window.Notification` 记录构造时刻**（比“排期成功”强得多的证据）+ PowerShell 整屏截图（`System.Windows.Forms.SystemInformation]::VirtualScreen` + `CopyFromScreen`）。**两个坑**：① `powershell -File x.ps1` 在本机被 ExecutionPolicy 拦下，必须 `-ExecutionPolicy Bypass`；② 把截图命令包成 bash 函数（`SHOT(){ ...; }`）会**静默失败**（退出码 0、文件不生成），直接写完整 `powershell ... -Out 'C:\\...\\x.png'` 才稳。
- 门禁（2026-10-15 实跑，退出码逐条保留）：`npx tsc -b --pretty false` → 0；`npx vitest run` → 105 文件 / **826 通过**（基线 811 + 新增 15）/ 0；`npm run test:consistent` → `collected=826 executed=826` / 0；`npx oxlint` → **0 error、24 warning**（与上轮持平、无新增）/ 0；`npm run build` → ✓ built in 385ms / 0。本批涉及测试：`pendingNotifications.test.ts`（新 10）、`components/pendingNotificationsPanel.test.tsx`（新 5，含接线守卫）。

## 2026-10-15 · 真 bug：课程提醒的「清扫」会删掉别的家族的提醒（已修 + 面板对账）

- **症状**：面板与新账目露出一个说不通的状态——`tt_study_blocks_v1:scheduled` 记着 id（说明 `schedule()` 成功返回）但 `getPending()` 是空的，**到点不会响**。新装打包产物 + 一条未来学习块：**2/2 复现**（早先还出现过同场景下队列里在、以为只是偶发）。
- **根因**：课程提醒的陈旧清扫写的是「取消队列里一切不在当前 wanted 里的条目」——`wanted` 为空（没课 / 周末夜里 / 新装）时等于**清空整个通知队列**，把任务、考试、学习时段、摘要提醒一起删掉；而 `NotificationManager` 的四个家族在 `refresh()` 里是**并发调用**（都不 await），所以任一家族的清扫都可能落在别家的 `schedule()` 之后。任务/考试两家的清扫本来就有 `isDueNotifId` / `isExamNotifId` 守卫，**只有课程这家没有**。
- **修法（记账收窄清扫）**：新增 `src/lib/notifLedger.ts` 作为这个模式的唯一所有者：`loadNotifLedger` / `saveNotifLedger` + 纯函数 `ownedStaleIds(recorded, queued, wanted)` = 「记账里有 ∧ 队列里在 ∧ 现在不想要」。课程家族改用记账清扫并在排期后写账；家族关闭与全部关闭时清账；`notifId` 改名导出为 `lessonNotifId`（测试与诊断复用）。记账键是**派生后缀**（`tt_lessons_v1:scheduled`），同学习块那家，**不进 BACKUP_KEYS**。
- **教训（可复用）**：① 清扫陈旧提醒时，能从当前数据反推的 id 只有「还在数据里的那些」——拿它去扫队列就是删别人的东西；**清扫必须只碰自己排过的 id**（记账）。② 四个家族并发、且部分清扫是“取反”式过滤时，任何一家都可能把別家刚排上的删掉，症状是“什么都不发生”。③ 这类 bug 无法靠“看代码”确信，必须有一条把**记账 vs 真实队列**摆在一起的面板/对账函数；本轮的对账在几秒内就把根因缩到了那个 `filter`。
- **面板新增对账**：`src/lib/reminderHealth.ts`（装配：队列 + 记账 + 当前块，**队列读不到时 audit=null，不造假警报**）+ `auditStudyBlockReminders`（纯函数，在 studyBlockReminders 里：expected / missing / stale，提醒点已过去的块不算 missing 所以投递后不留假警报）；UI 三态：`已就位：{n}`（绿）/ `有 {n} 条…应该排上却没排上`（红）/ `{n} 条记账记录已不在系统队列里`（灰）。
- **真产物验证**（重新打包 `--dir`，内容哈希校对）：同场景下队列**保住了**提醒（`tracked=[1387477475]` 且 `queued` 命中 `学习时段提醒`，修复前同场景为空）；面板健康态显示 `学习时段提醒已就位：1 条` + `下一条：10月15日周四 21:41 · 学习时段提醒`；从外部取消队列（模拟系统清理/重载）后点「重新读取」→ `有 1 条学习时段提醒应该排上却没排上——到点不会响`。
- **未做（留痕）**：任务/考试两家“已删除条目”的残留 id 同样反推不出来（它们的清扫不会伤别人，但会漏掉已删条目的通知）——同一把记账能覆盖，留给下一轮；`dailyDigest` 本来就只扫自己的窗口 id，不需要改。
- 门禁（2026-10-15 实跑，退出码逐条保留）：`npx tsc -b --pretty false` → 0；`npx vitest run` → 107 文件 / **844 通过**（基线 826 + 新增 18）/ 0；`npm run test:consistent` → `collected=844 executed=844` / 0；`npx oxlint` → **0 error、24 warning**（无新增）/ 0；`npm run build` → ✓ built in 460ms / 0。新增测试：`notifLedger.test.ts`（9：三集合运算 + 隔离回归点 + 家族关闭清账）、`reminderHealth.test.ts`（7：对账语义 + 读不到队列不造假警报）、面板 +2（缺失警告 / 已就位）。

## 2026-10-15 · 提醒自愈（对账发现缺失就当场重排）+ 插件实例竞态的根因

- **【关键定案】`@capacitor/core` 的懒加载在 `await` 之后才赋值**：`if (!jsImplementation) jsImplementation = await jsImplementations[platform]()` —— 所以**并发的首次调用**各自 `await factory()`、各造一个实现实例，只有最后那个被记住，其余成孤儿。web 实现的状态（`pending` / `deliveredNotifications`）是**实例字段**，写进孤儿实例的排期谁也读不回来。打包桌面产物实测：**一次挂载周期造出 5 个实例**，任务提醒排进实例 2、学习块排进实例 4，而应用后续调用用的是实例 5——队列看起来是空的，面板因此报「有 1 条应该排上却没排上」，用户到点什么都听不到。原生平台是无状态桥（状态在系统里），**不受影响**：这个故障只在桌面端/浏览器（web 实现）发作。
- **修法：把「第一次碰插件」收敛到同步赋值的单例 promise**。新建 `src/lib/localNotifications.ts` 作为插件的**唯一入口**：`pluginReady()`（promise 同步赋值，体内用 `Promise.resolve().then(...)` 起微任务）+ 代理里所有会读写插件状态的方法（getPending / schedule / update / cancel / checkPermissions / requestPermissions / checkExactNotificationSetting）先 `await pluginReady()`；`ensurePermission()` 也先等它。**只修 `ensurePermission` 不够**：实测还有一条直接 `getPending()` 的路径抢在 prime 之前造出第二个实例。
- **代理要懒，不能在模块初始化期取属性**：早先写成显式对象（`PluginLocalNotifications.getPending.bind(...)`）会在 import 时就访问插件属性，而测试常只 mock 用到的那几个方法 → 整个模块导入即抛 TypeError。改用 `new Proxy`（只在真正调用时读属性、签名完整保留）。`addListener` **刻意不包**：它只在原生平台被调用（组件先判 `isNativePlatform()`），原生实现无孤儿问题，包一层还会破坏 `.then(h => h.remove())` 形状。
- **自愈 = `lib/reminderHealth.healMissingReminders`**（审计发现缺失就重排，不把「去开关一次提醒」推给用户）。边界每条都刻意：① **不猜**——队列读不到（`audit === null`）时什么都不做（把读失败当「全都缺失」是在制造噪音）；② **不越权**——`enabled` 关着只清不排；③ **有界**——一次调用最多重排一趟，仍缺失留给下个周期（排期失败通常是环境问题，原地空转只烧电）；④ **幂等**——重排走 `refreshStudyBlockReminders`（先取消自己的记账再排），与常规刷新重叠也不产生副本。接线在 `NotificationManager.refresh()` 里、**排在家族刷新之后**（抢在排期前对账会把「还没写队列」当成缺失，每轮白排一次；组件测试用可控 promise 固定这个顺序）；补不回来时 `logError('other', …)` 留痕。面板文案同步改口径：`pendingNotifMissing` 从「去开关一次」改成「应用会在下一个刷新周期自动重排，无需手动干预」（zh/en）。面板本身仍**只读**，自愈只发生在提醒周期里。
- **E2E（打包桌面产物，两向都跑）**：观察面用应用**自己的面板**（Settings → 已排期通知，真 UI 读数），别从探针直接读插件。① **队列被外部清掉**：`cancel` 那条 → 面板报「有 1 条…没排上」→ 跑一轮提醒周期 → 队列里又有了、面板回「已就位：1 条」。② **数据漂移**（唯一能隔离自愈的构造）：直接往 localStorage 写 `tt_study_blocks_v1 = [A, B]`（**不发变更信号**，所以 App 内存里的 studyBlocks 还是 `[A]`）→ refresh 拿到的数组里没有 B、**只有自愈能补上 B 的 id** → 记账变 `[idA, idB]`、队列两条、面板「已就位：2 条」，而周视图/今日页**仍不渲染 B**（证明 App 状态没被刷新，补上 B 的是自愈）。**反向验证**：临时删掉自愈调用重打包 → 同探针里 B 永远补不上、面板停在「有 1 条…没排上」。
- **【坑·本轮代价】`npm run build` 失败（tsc 红）时 `dist` 是旧的，`electron-builder --dir` 照样成功、照样把旧 bundle 打进 asar**：反向验证时改了源码，`npm run build` 因 TS18047 退出 2，打包照跑，`grep -aq 当前 index hash` 命中的是**上一次**的 bundle——那次「反向验证」其实在测旧代码。**规则**：`npm run build` 的退出码必须查；打包后用**当前** `dist/assets/index-<hash>.js` 去 grep `resources/app.asar`（`ls dist/assets | sed -n 's/^\(index-.*\.js\)$/\1/p'`），命中才算产物等于当前树。
- **【坑】`.accent-sky-500` 在设置里有 7 个复选框**（大字号 / 高对比度 / 自动同步 / 课程与考试提醒 / 每日摘要 / 收进托盘 / 全局快捷键），`document.querySelector('input.accent-sky-500')` 命中的是**大字号**——第一轮探针点它，既没触发提醒周期（它不是 NotificationManager 的依赖），又把 `tt_ui_prefs_v1` 改成了 large（收尾得还原）。**按外层 label 文本选**；「触发一轮提醒周期」用的就是这个**与提醒无关**的 `digestEnabled` 开关（在 effect 依赖里），全程不碰提醒开关。
- 门禁（2026-10-15 实跑，退出码逐条保留）：`npx tsc -b --pretty false` → 0；`npx vitest run` → 108 文件 / **858 通过** / 0；`npm run test:consistent` → `collected=858 executed=858` / 0；`npx oxlint` → **0 error、24 warning**（无新增）/ 0；`npm run build` → ✓ 466ms / 0。本轮新增测试（三份文件共 13 条）：`notificationPluginPrime.test.ts`（6：单例 prime、代理懒取属性、`addListener` 不被包）、`reminderHealth.test.ts`（heal +5：已就位不重排 / 缺失补齐且**队列里真的有** / 读不到队列不猜 / 开关关着不排 / 静默丢弃一趟内补回）、`components/notificationManagerStudyBlocks.test.tsx`（+2：自愈排在刷新之后、自愈失败才 logError）。
- **收尾**：打包产物里的探针数据清掉（blocks 置空、`:scheduled` 键移除、prefs/notif/digest 还原、`tt_ui_prefs_v1` 还原为默认）、应用进程按开工时的样子重启（4 个进程、无调试端口）、临时脚本与探针文件全删（`.freebuff/` 清空）。
- **集成层守卫：六家并发跑一轮，队列里必须仍有每一家的条目**（`src/__tests__/reminderFamiliesConcurrency.test.ts`，6 条）。为什么必须放集成层：各家单测只面对自己那份队列，而真实调用是六家**并发、互不 await**——「A 家清扫删掉 B 家刚排上的」在单测里天然看不见。断言面是**有状态假队列**（`schedule` 真入队 / `cancel` 真出队 / `getPending` 回读），不是「调没调 schedule」；时钟用 `vi.useFakeTimers()` + `setSystemTime` 冻结（各家内部都读 `Date.now()`，摘要还按本地 07:30 决定排不排今天），期望 id 用各家自己的纯函数推导（不手写魔数、不手写日期）。六条：① 一轮并发后每家都在（摘要还锁「队列里的窗口 id 正好等于本轮计划」）；② 课程提醒 `wanted` 变空只清自家那条、其余一条不少；③ 连跑三轮幂等（队列大小不变）；④ 单条被插件静默丢掉，同一轮里自愈补回且不影响别家；⑤ 空输入 + 空记账 → **一条都不少**（当年「清空整个队列」的输入）；⑥ 不认领的陌生 id 一律不碰。
- **反向验证（可复用的判据）**：临时把课程家族的清扫还原成历史 bug（`queuedIds.filter(id => !wanted.has(id))`）→ 集成测试 **6 条红 5 条**，同时 `notifLedger.test.ts` 的 3 条也红（共 2 文件 8 条）→ 恢复后 864 条全绿。教训：这个 bug 单测其实也能抓到（`notifLedger` 那三条就是），别把「加了集成测试」当成唯一防线；集成测试的独有价值是**共享队列的终态**——以后新增一个家族忘了收窄清扫，也只有这里会红。

## 2026-10-15 · 记账泛化到全部家族 + 面板逐家呈现 + 「关掉的家族不产生期望」

- **记账只留一个家**：`lib/notifLedger.ts` 是「已排期记账」的唯一所有者，六个家族各有一条**派生后缀**键（`lesson`/`due`/`exam`/`digest`/`studyBlock`/`sisuPlan`），清扫一律走同一个纯函数 `ownedStaleIds(recorded, queued, wanted)` =「记账里有 ∧ 队列里在 ∧ 现在不想要」。本轮把最后两家自己 `readJson`/`writeJson` 的（学习块、SISU 计划）也收进来了——**两份容错迟早分叉**，会出现「一家认得的记录另一家当垃圾」。凡是要写「已排期 id 清单」的新家族，先来这里登记键，别自建存储。
- **【本轮真缺陷】诊断面板对「开关关着的家族」报假缺失**：`storedFamilyExpectations` 过去无条件按窗口天数算摘要期望（恒 6–7 条），于是**每一台新装设备**打开设置都会看到「有 6 条提醒应该排上却没排上」。这是诊断类 UI 最坏的失败模式——不是缺诊断，而是**指向一个不存在的问题**。修法：期望装配按各自的存储开关门控（`tt_notif` / `tt_daily_digest` / 学习偏好的 `remindEnabled`），关掉的一家期望为空、行里显示「当前没有要排的」。教训：诊断数字的口径必须与**产生方**（`NotificationManager` 的分支）逐条对齐，否则数字是错的，而且错得很有说服力。
- **面板逐家呈现，而不是只报一个总数**：`FamilyAudit`（expected / missing / stale）逐家一行「已就位 {n} / 缺 {n} / 当前没有要排的」。总数只说明「有事」，**哪一家**才决定去查什么（截断顺序、权限、开关）。家族标签**不复用**各家的通知标题（那是通知正文措辞），另立 `pendingNotifFamily*` 键。
- **三处接线要一起动，缺一处就静默失效**：① `NotificationManager` 的家族注册表（`FamilyRepair[]`：`expected(at)` 纯函数 + `refresh()`，自愈据此只修缺的那几家）；② `storedFamilyExpectations`（面板的期望装配，读存储）；③ 面板渲染与 i18n。本轮踩到的具体表现：注册表已经换成 `(repairs, options)` 形状，但组件测试仍按旧的 `(texts, options)` 断言 → 断言在语法上过不了，**而更深的坑是 mock 结果少一个 `families` 字段**（那句日志模板自己抛异常、被链尾 `.catch` 吞掉），症状是「日志永远不落盘、测试报 0 次调用」。改形状时把人造返回值也一起补齐。
- **`lessons: []` 不是「课程家无事可做」的输入**：集成测试里用空课表表达「课程提醒 wanted 为空」会**连带**让考试家真的失去自己的考试（它该取消自己那条），于是「队列一条不少」的期望本身就是错的。表达「某一家无活干」要用**只属于那一家的**输入（远在未来 48 小时窗口外的考试），其余各家的期望保持不变。这条错误期望在红灯里表现成「少了一个 id」，很容易被误判成隔离又坏了。
- **反向验证（本条新守卫的判据）**：把 `storedFamilyExpectations` 里摘要那一行的开关门控去掉 → `reminderHealth.test.ts` + `components/pendingNotificationsPanel.test.tsx` **共 4 条变红**（`expected [] to deeply equal [ 1800020741, … ]`）。恢复后 27 条全绿。**新守卫必须有这种「去掉就红」的配对验证，否则它只是一段注释。**
- **打包产物 E2E（同一份 `--dir` 产物，CDP 驱动真窗口）**：① 三个开关全关 + 队列清空 → 面板逐家「当前没有要排的」，**没有**「应该排上却没排上」的横幅，只有一条「另有 11 条陈旧记账」的中性提示（陈旧 ≠ 缺失，两个数字必须分开）；② 开关全开并重新挂载 → 逐家就位（截止 2 / 摘要 7 / 学习块 1），队列里正好 10 条；③ 从外部 `cancel` 清空队列 → 面板报「有 10 条提醒应该排上却没排上」，逐家 `缺 2 / 缺 7 / 缺 1`；④ 走过一个完整刷新周期（挂载即跑一轮 refresh + heal）→ 队列 10 条全部回来、面板回到逐家「已就位」。这四步一起才说明「跨家族对账 + 自愈」在真产物上成立。
- **收尾**：探针数据从打包产物里清掉（任务/学习块置空、`...:scheduled` 键移除、队列撤干净），应用进程杀干净（0 个），临时脚本与日志全删（`.freebuff/` 空）。
- 门禁（2026-10-15 实跑，退出码逐条保留）：`npx tsc -b --pretty false` → 0；`npx vitest run` → 109 文件 / **880 通过** / 0；`npm run test:consistent` → `collected=880 executed=880` / 0；`npx oxlint` → **0 error、24 warning**（无新增）/ 0；`npm run build` → ✓ built in 401ms / 0；`electron-builder --dir --win` → 产物内命中当前内容哈希 bundle `index-B7TAoY2i.js`。
