# 每周学习时段建议 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根据本地未完成且有截止时间的事项与课程日历推荐 60 分钟学习时段，并仅在用户确认后持久化。

**Architecture:** `lib/studyBlocks.ts` 作为纯推荐策略和已确认学习块存储的唯一所有者；`useSisuStudyPlan` 聚合 SISU 计划项、任务、课程，持有待确认建议和操作；`SisuStudyPlan.tsx` 展示建议与已确认块。原任务、课表和 SISU 计划项不改 schema。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、现有 `localStorage` helpers；不新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-14-weekly-study-block-recommendations-design.md`

## Global Constraints

- 每天 08:00–22:00 本地时间；滚动未来 7 个本地日（今天到第 6 天），周末可用。
- 学习块 60 分钟；与课表或已确认学习块至少间隔 15 分钟；每个事项每天最多一块、整个推荐周期最多一块。
- 仅对未完成且未来 7 天范围内有有效截止时间的 Moodle/手动任务和 SISU 计划项推荐；不推断未知耗时。
- 推荐不持久化；只有明确确认时保存独立 StudyBlock。确认/删除不更改来源事项的完成状态。
- 本功能不改 Moodle API、同步域、通知、课表/任务 schema，不增加第三方服务或依赖。
- 保留开始任务时工作树中已有的用户改动；不要清理、覆盖或提交不相关改动。

## Review Focus

1. 夏令时切换/本地日界线：候选块必须按本地日的 08:00–22:00 构造，测试跨日与使用本地 `Date` 构造时间。
2. 无效/零时长课程事件：排程忽略非法区间，不得变成 NaN 导致所有候选被误判冲突；测试无效与跨日事件。
3. 截止早于可用窗口或当前时间：事项保留在 unscheduled，不得被排到截止之后；测试当天 08:00 前截止及已过期事项。
4. 相同源 ID 与异源同 ID：去重键必须由 `sourceKind + sourceId` 组成；测试跨源不误去重、同源已确认不再推荐。
5. 确认/删除与原始来源状态隔离：仅学习块键变化；组件测试确认及删除后来源 SISU/任务数据不变。

---

### Task 1: Pure weekly scheduling and local StudyBlock storage

**Files:**
- Create: `src/lib/studyBlocks.ts`
- Create: `src/__tests__/studyBlocks.test.ts`
- Modify: `src/lib/storage.ts`

**Interfaces:**
- `StudyBlockSourceKind = 'task' | 'sisu-plan'`.
- `StudyBlockCandidate = { sourceKind: StudyBlockSourceKind; sourceId: string; title: string; dueAt: string; courseCode?: string }`.
- `StudyBlockRecommendation = StudyBlockCandidate & { startAt: string; endAt: string }`.
- `StudyBlock = StudyBlockRecommendation & { id: string; createdAt: string }`.
- `planStudyBlocks(input: { items: StudyBlockCandidate[]; lessons: Array<Pick<Lesson, 'start' | 'end'>>; confirmed: StudyBlock[]; now: Date }): { recommendations: StudyBlockRecommendation[]; unscheduled: StudyBlockCandidate[] }`.
- Storage exports: `loadStudyBlocks(): StudyBlock[]`, `confirmStudyBlock(recommendation: StudyBlockRecommendation, createdAt?: string): StudyBlock`, `removeStudyBlock(id: string): StudyBlock[]`.
- Add `KEYS.studyBlocks = 'tt_study_blocks_v1'`; because `BACKUP_KEYS` derives from `KEYS`, confirmed blocks join normal backup/import automatically.

- [x] **Step 1: Write failing pure scheduling and persistence tests**
  - `planStudyBlocks` tests use local `new Date(year, month, day, hour, minute)` fixtures and assert: lesson overlap/buffer avoidance; 15-minute spacing for adjacent blocks; 60-minute duration; 08:00/22:00 bounds; future-seven-local-days including weekend; overdue/completed/invalid filtering at candidate-building boundary (scheduler receives valid candidates and rejects invalid due strings); deadline ordering and deterministic ties; no slot preserves item in `unscheduled`; duplicate confirmed source identity prevents a recommendation; same ID under different source kinds remains distinct; invalid/zero-length lesson intervals are ignored.
  - Persistence tests assert empty default, malformed-record rejection, confirm survives reload, duplicate source confirmation does not add a second block, delete removes only matching block, and key is included in `BACKUP_KEYS`.
- [x] **Step 2: Run new tests and verify expected failure**
  - Run: `npx vitest run src/__tests__/studyBlocks.test.ts`
  - Expected: fail because module exports/key do not exist yet.
- [x] **Step 3: Implement scheduling and persistence**
  - Build local-day boundaries with device-local `Date` setters. Process items by ascending deadline, then original input order. For each item, search eligible local days from today forward through its deadline (bounded to today through day 6), and within each day search 15-minute-aligned candidate starts earliest-to-latest; accept the first 60-minute interval wholly inside 08:00–22:00, strictly after `now`, ending no later than deadline, and not overlapping any lesson/confirmed/recommended interval with at least 15 minutes between intervals. Each source identity (`sourceKind + sourceId`) is recommended at most once. If no interval fits, append the candidate to `unscheduled`.
  - Persist only validated `StudyBlock`s; create a UUID with the repository's `crypto.randomUUID` convention and a timestamp from the optional `createdAt` or current time.
- [x] **Step 4: Run tests to verify the task passes**
  - Run: `npx vitest run src/__tests__/studyBlocks.test.ts`
  - Expected: all new scheduling and storage tests pass.

### Task 2: Aggregate planner inputs in the SISU plan hook

**Files:**
- Modify: `src/hooks/useSisuStudyPlan.ts`
- Create: `src/__tests__/sisuStudyBlockHook.test.tsx`

**Interfaces:**
- Consumes Task 1 `planStudyBlocks`, `loadStudyBlocks`, `confirmStudyBlock`, `removeStudyBlock`.
- Hook model adds `studyBlocks`, `studyBlockRecommendations`, `unscheduledStudyItems`, `generateStudyBlockRecommendations(): void`, `confirmStudyBlockRecommendation(recommendation: StudyBlockRecommendation): void`, `skipStudyBlockRecommendation(sourceKind, sourceId): void`, and `deleteStudyBlock(id): void`.
- Task candidates map `Task.id/title/course/dueAt`; plan candidates map `SisuPlanItem.id/title/courseCode/dueAt`. Include only incomplete items with parseable future due dates within 7 local days. Lessons passed to the pure scheduler are the hook's `lessons` argument.

- [x] **Step 1: Write failing hook tests**
  - Render a small probe using the hook under `I18nProvider`; seed local SISU plan, tasks through `KEYS.tasks`, lessons, and confirmed blocks. Assert manual generation returns candidates with source tags; task and plan items with same raw ID remain separate; completed/no-due/expired/out-of-range items are excluded; confirmed sources are not repeated; confirm persists one block without mutating source keys; skip affects only pending suggestions; delete removes only the confirmed block; remount loads confirmed blocks.
- [x] **Step 2: Run hook tests and verify expected failure**
  - Run: `npx vitest run src/__tests__/sisuStudyBlockHook.test.tsx`
  - Expected: fail because hook study-block model is not exposed.
- [x] **Step 3: Implement hook aggregation and operations**
  - Load confirmed blocks lazily on mount. Generate recommendations on explicit user action from current tasks, plan items, lessons and `new Date()`; keep pending recommendations/unscheduled items in React state only. Confirm/delete through Task 1 persistence APIs. Skip removes only the matching `(sourceKind, sourceId)` recommendation from current in-memory recommendations; a subsequent generation may offer it again. Never mark sources completed.
- [x] **Step 4: Run hook tests to verify the task passes**
  - Run: `npx vitest run src/__tests__/sisuStudyBlockHook.test.tsx`
  - Expected: all hook integration/isolation tests pass.

### Task 3: Review, confirm, skip and delete recommendations in the plan UI

**Files:**
- Modify: `src/components/SisuStudyPlan.tsx`
- Modify: `src/i18n.tsx`
- Modify: `src/__tests__/components/sisuStudyPlan.test.tsx`
- Modify or create: `src/__tests__/components/studyBlockReview.test.tsx`

**Interfaces:**
- UI consumes Task 2 hook model; hook remains policy/state owner.
- Localized strings are added to both `zh` and `en` dictionaries for generate action, recommended section, source labels, schedule/deadline formatting labels, unscheduled message, confirm, skip, confirmed blocks, and delete.

- [x] **Step 1: Write failing component tests**
  - Render `SisuStudyPlan` with future SISU plan item, stored task, and a course lesson fixture. Assert no recommendation is persisted before generation; generate shows a conflict-free suggestion and any unscheduled item; confirm persists and remains visible after remount; skip does not persist; delete removes only the block; original plan/task/local read state remain byte-identical. Assert `translate('zh', key)` and `translate('en', key)` produce non-key values for every new key.
- [x] **Step 2: Run component tests and verify expected failure**
  - Run: `npx vitest run src/__tests__/components/studyBlockReview.test.tsx src/__tests__/components/sisuStudyPlan.test.tsx`
  - Expected: new test fails because generate/review controls are not rendered.
- [x] **Step 3: Implement bilingual review UI**
  - Add a dedicated card within the existing SISU local study plan section. Show an explicit generate button, pending recommendation cards with title/source/local start/end/deadline and confirm/skip controls, an unscheduled list, and confirmed blocks with delete controls. Do not add entries to course lessons or Moodle tasks and do not schedule notifications. Use existing card/button tokens and responsive wrapping; truncated labels retain `title`.
- [x] **Step 4: Run targeted tests and project gates**
  - Run: `npx vitest run src/__tests__/studyBlocks.test.ts src/__tests__/sisuStudyBlockHook.test.tsx src/__tests__/components/studyBlockReview.test.tsx src/__tests__/components/sisuStudyPlan.test.tsx`
  - Then run: `npx tsc -b --pretty false && npx vitest run && npm run test:consistent && npx oxlint && npm run build`
  - Expected: all tests pass, TypeScript/build pass, consistency count collected equals executed, Oxlint reports zero errors (existing warnings may remain).
- [x] **Step 5: Validate through the application UI**
  - Build and launch through the current local desktop app (do not use hosted preview); exercise generate → skip → generate → confirm → reload → delete using deterministic local sample data. Confirm proposed times avoid a seeded lesson and persisted source task/SISU completion values are unchanged. Do not inspect or print real user credentials or notification bodies.

## Self-review

- **Spec coverage:** pure algorithm/persistence (Task 1), source aggregation and source isolation (Task 2), user review/confirm/skip/delete and bilingual UX (Task 3), and full gates/UI validation (Task 3 Step 4–5).
- **Step scan:** every test step names a command and observable failure/pass; every implementation step names interfaces, storage identity and exact scheduling policy.
- **Type consistency:** Task 2 consumes `StudyBlockCandidate` and `StudyBlockRecommendation` from Task 1; Task 3 consumes the hook fields from Task 2; all dates remain ISO strings and are formatted only in the component.
- **Review Focus coverage:** local day/DST, invalid intervals, deadline boundary, cross-source identity and source-state isolation are covered in Task 1/2/3 named assertions.
- **Proportion:** three tasks align with the pure-data, hook orchestration and rendering boundaries already present in this repository; no dependencies, native changes or unrelated refactoring.
- **Execution recommendation:** Native inline execution is preferred: the three tasks share a small, explicitly defined interface and one person can verify the full UI flow without coordinating concurrent edits. No commits are included because none were requested.

---

## 执行结果（2026-10-15）

Task 1–3 的实现全部落在工作树，记录与实现已对齐。本文件只勾选 Step 与追加本节，正文不改写。

- **Task 1（纯排程 + 本地存储）**：`src/lib/studyBlocks.ts`（`planStudyBlocks` + `loadStudyBlocks` / `confirmStudyBlock` / `removeStudyBlock`，另含只读投影 `studyBlocksOnDay`）、`src/lib/storage.ts` 的 `KEYS.studyBlocks = 'tt_study_blocks_v1'`（随 `BACKUP_KEYS` 进入备份/导入）、`src/__tests__/studyBlocks.test.ts`。定向命令 `npx vitest run src/__tests__/studyBlocks.test.ts` 首轮 12/12 通过，补完后 17/17。
- **Task 2（hook 聚合）**：`src/hooks/useSisuStudyPlan.ts` 暴露 `studyBlocks`、`studyBlockRecommendations`、`unscheduledStudyItems`、`generateStudyBlockRecommendations`、`confirmStudyBlockRecommendation`、`confirmAllStudyBlockRecommendations`、`skipStudyBlockRecommendation`、`deleteStudyBlock`；`src/__tests__/sisuStudyBlockHook.test.tsx` 锁定跨源同 ID 隔离、确认/删除不碰来源键（`KEYS.tasks` / `KEYS.sisuStudyPlan` 逐字节比对）、重挂载恢复已确认块。
- **Task 3（评审 UI）**：`src/components/SisuStudyPlan.tsx`（生成 / 待确认建议 / 无可用时段 / 已确认块删除 / 全部加入计划）、`src/i18n.tsx` 中英各 14 键；`src/__tests__/components/studyBlockReview.test.tsx` 与既有 `sisuStudyPlan.test.tsx` 覆盖生成、跳过、确认、重挂载、删除与「中英键都不是死键」。
- **Step 4 全量门禁**（2026-10-15 实跑，退出码逐条保留）：`npx tsc -b --pretty false` → 0；`npx vitest run` → 96 文件 / 760 通过 / 0；`npm run test:consistent` → `collected=760 executed=760` / 0；`npx oxlint` → 0 error、25 warning（均既存）/ 0；`npm run build` → ✓ built in 551ms / 0。
- **Step 5 UI 验证（口径修正，如实记录）**：**没有**走「本地桌面应用」的字面路径。`agent-browser` CLI 在本机因 Windows 文件锁无法启动（退出码 127），改用 `vite preview` 服务**本地构建产物**（`127.0.0.1`，非托管预览）+ 隔离的无痕会话与临时样例数据，跑完 生成 → 跳过 → 生成 → 确认 → 重载 → 删除，核对建议时段避开已种课程并留出 15 分钟缓冲，且确认/删除后任务、SISU 计划完成状态与课程数据均未改变。临时预览进程与样例数据已清理；真实登录态、真实凭据与通知正文未被读取或打印。**未覆盖**：桌面打包产物（`electron-builder --dir` 的 `win-unpacked`）与 Android 装机路径本轮没有跑。
- **落地时补完的两项（设计文档允许但当时未做）**：① 待确认 ≥2 条时出现「全部加入计划」——逐条复用幂等的 `sourceKind + sourceId` 持久化，清空待确认但保留无空档清单，来源完成状态一概不动；② 已确认块在**周视图与今日页只读呈现**——中性虚线卡（标题、起止时间、来源标签），不参与 `layoutDay` / 冲突组 / 便签 / 订阅 / ICS 导出，不用课程色板、不可点。
- **周视图可视窗规则（原计划未写明，此处补记并写进设计文档）**：周视图时间轴可视窗是 **08:00–20:00**，因此**起始时间 ≥20:00 的已确认块不画进周视图网格**；今日页照常列出当天全部块。这是刻意取舍（不改 `WeekGrid` 的 `END_HOUR` 与密度缩放），**不是静默丢弃**：今日页可见、计划页可删可查。两侧各有一条测试锁住——`__tests__/components/weekGrid.test.tsx`（20:30 的块在网格中不出现）与 `__tests__/components/todayView.test.tsx`（20:00 的块在今日页出现）。

### Phase 2 验证轮（2026-10-15）：五门禁 + 真实交付形态

本批（Phase 2 三项：窗口/时长偏好、10 分钟提醒、完成状态 + 本周负荷）在**打包桌面产物**与 **Android 装机**上各自跑了一遍，本节的数字与观察都是实跑所得。

- **五门禁（当前工作树，逐条保留退出码）**：`npx tsc -b --pretty false` → 0；`npx vitest run` → 103 文件 / **811 通过** / 0；`npm run test:consistent` → `collected=811 executed=811` / 0；`npx oxlint` → **0 error、24 warning**（均既存）/ 0；`npm run build` → ✓ built in 1.11s / 0。
- **打包产物 = `electron-builder --dir` 的 `release-electron/win-unpacked`**（本机 nsis/msi 打包链此前受 EPERM 影响，`--dir` 这条已可用）。**是否等于当前代码用内容哈希判定**：新建 `npm run build` 产出的 `dist/assets/index-BdG5g7-A.js` / `index-ipPEFJn3.css` 这两个内容哈希文件名在 `resources/app.asar` 里都能命中，`resources/icon.ico` 与 `build/icon.ico` 的 md5 同为 `3a2574c2c5ba32f0ea38d2896afe9b10` —— 名字即内容，比时间戳可靠。
- **打包产物上走的本批 UI（CDP 驱动真窗口，非模拟）**：先点掉首次引导遮罩 → `#/view/moodle` 的 `studyplan` 段 → 生成建议排出 `10月15日周四 19:15–20:15`（截止 10/17）与 `20:30–21:30`（截止 10/18，块间 15 分钟缓冲）→ 加入计划一条、待确认留另一条 → 本周负荷 `学习块 1 个（已完成 0）· 计划 60 分钟（已完成 0 分钟）`、周四格 60 分钟 → 勾选完成后 `已完成 1 / 60 分钟` 且 `tt_tasks_v1` 逐字节未变 → 今日页出现只读虚线块 → 设置里五个滑杆（每日开始/每日结束/单块时长/间隔缓冲/推荐范围）与两个勾选框齐备，拖 `单块时长` 到 30 与勾提醒都正确落盘。
- **提醒的投递（此前唯一未证实的环节）已在 Android 模拟器上证实**：系统通知转储里出现 `NotificationRecord(pkg=dev.lut.timetable id=1798852662 title=学习时段提醒)`，`1798852662` = FNV-1a(`study-block:probe-block:10`)，播出时刻正是块开始前 10 分钟。
- **桌面端不是「没有本地通知」**：Electron 里 `Capacitor.Plugins.LocalNotifications` 是**可用的 web 实现**（`checkPermissions()` → `granted`，`schedule`/`getPending`/`cancel` 均实测可用）；用一条**合法**的学习块（带 `dueAt`）在打包产物上复验到 `tracked=[1980667240]`、pending 标题 `学习时段提醒`、`at` = 开始前 10 分钟。
- **本轮的一次误判（记下来免得重犯）**：手写 `tt_study_blocks_v1` 时漏了 `dueAt`，`isStudyBlock` 静默丢弃该记录，于是「提醒排不上」的假象出现（`tracked` 恒为 `[]`、`getPending()` 里没有学习块提醒）。真因是 fixture 不合法，不是调度链。
- **未在真交付形态上覆盖**：macOS/Linux 的桌面产物（本机只有 Windows）；release 签名产物与应用内更新链路（本轮用 `--dir` 未签名产物）；块内提醒在**真机厂商 ROM** 上的表现（只在 AOSP 模拟器上验过投递）。

### Phase 2 · Task 13（2026-10-15）：提醒家族记账泛化 + 面板逐家对账

- **范围**：把「已排期记账」这件模式扩到全部六个家族，并让诊断面板逐家说出「谁缺了几条」；不新增功能开关、不新增依赖。
- **实现**：`src/lib/notifLedger.ts`（唯一所有者：键表 + `loadNotifLedger` / `saveNotifLedger` / `ownedStaleIds` / `auditFamily`）；`src/lib/reminderHealth.ts`（`auditReminderFamilies` / `storedFamilyExpectations` / `loadReminderHealth` / `healMissingReminders`）；`src/components/NotificationManager.tsx` 的家族注册表 + 挂载/周期刷新后的自愈；`src/components/PendingNotificationsPanel.tsx` 逐家渲染 + i18n（面板 `pendingNotif*` 共 23 键/语言，其中本批新增 11：10 条家族行 + `pendingNotifMissingAny`）。
- **本轮抓出并修掉的真缺陷**：面板对**开关关着的家族**报假缺失（摘要期望恒按窗口天数算）→ 期望改为按 `tt_notif` / `tt_daily_digest` / 学习偏好 `remindEnabled` 门控。
- **测试**：`notifLedger.test.ts`（17）、`reminderHealth.test.ts`（17，含开关门控 3 条与自愈 5 条）、`reminderFamiliesConcurrency.test.ts`（6，六家并发共享一个有状态假队列）、`components/pendingNotificationsPanel.test.tsx`（8）、`components/notificationManagerStudyBlocks.test.tsx`（6，锁「自愈排在刷新之后」与注册表形状）。
- **反向验证**：去掉摘要那一行的开关门控 → 2 文件共 4 条红；恢复后 27 条绿。
- **门禁**（2026-10-15 实跑，退出码逐条保留）：`npx tsc -b --pretty false` → 0；`npx vitest run` → 109 文件 / **880 通过** / 0；`npm run test:consistent` → `collected=880 executed=880` / 0；`npx oxlint` → 0 error、24 warning（无新增）/ 0；`npm run build` → ✓ built in 401ms / 0；`electron-builder --dir --win` → 产物命中当前 bundle 哈希。
- **真产物验证（`release-electron/win-unpacked` + CDP）**：开关全关 → 逐家「当前没有要排的」且无缺失横幅；开关全开并重新挂载 → 逐家就位（截止 2 / 摘要 7 / 学习块 1，队列正好 10 条）；外部清空队列 → 逐家报缺（2/7/1）；再过一轮刷新周期 → 队列 10 条全回来、面板回「已就位」。**未覆盖**：Android/iOS 装机路径与真机 ROM 的投递（本批只跑桌面打包产物；投递链本身已在上一批的模拟器上验过）。
