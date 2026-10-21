# 架构与功能落位

这份文档只回答一件事：**新功能写到哪里，以及为什么**。
它是 AGENTS.md 的补充，不重复历史教训。

## 1. 分层

```
src/
  lib/          纯逻辑（无 DOM、无 React）。所有阈值、分桶、合并、匹配
  hooks/        React 状态与编排（唯一所有者）。组件不自己持有跨视图状态
  components/   渲染 + 事件派发。组件里不写业务规则
  components/settings/  设置按分区拆文件（一个分类一个文件，见 §3.2）
  i18n/         文案（messages.ts：zh / en 同一文件，键必须对齐）
  __tests__/    与模块对应的测试（组件测试在 __tests__/components/）
```

判断一段逻辑该放哪：**能不能写成 `(input) => output`？** 能 → `lib/` + 测试。
只是"记住用户点了什么" → hook。只是"把它画出来" → 组件。

## 2. 归属表

| 要加的东西 | 唯一归属 | 备注 |
|---|---|---|
| 阈值 / 排序 / 分桶 / 匹配 | `lib/<domain>.ts` | 必须导出常量，测试用真实常量断言 |
| 持久化键 | `lib/storage.ts` 的 `KEYS` | 自动进 `BACKUP_KEYS`；键名 `tt_<domain>_v1` |
| 跨视图状态 | `hooks/use<Domain>.ts` | 组件只接 props |
| 文案 | `i18n/messages.ts` 的 zh + en | `i18nParity.test.ts` 会拦漏翻/占位符不一致 |
| 一个动作（设置 / 筛选 / 导出 / 检查更新…） | `lib/commands.ts` 的 `buildAppCommands` 加一条 | 命令面板、桌面 ⋯ 菜单、移动「更多」抽屉自动同步；见 §3.1 |
| 视图 / 周导航入口 | `lib/navigation.ts` 的 `VIEWS` / `WEEK_NAV` | 头部、底部标签栏、命令面板、键盘快捷键全派生；见 §3.4 |
| 一个弹层（对话框 / 抽屉 / 面板） | `lib/overlays.ts` 的 `OverlayId` + `OVERLAY_META` 一行 | 快捷键闸门与 Esc 从表推导；见 §3.2 |
| 一个设置项 | `components/settings/<分类>.tsx` | 分类壳在 `Settings.tsx`，常量在 `settings/tokens.ts` |
| 从课表推导作息建议 | `lib/studyWindowSuggestions.ts` | 纯函数：最宽空档（扣除缓冲、向内取整）；`suggestionsToOverrides` 决定采纳时写哪些按日覆盖 |
| 平台能力开关 | `lib/<capability>.ts` | 例如 `print.ts` 的 `canPrintSchedule()` |
| 原生桥接线 | `hooks/use<Platform>Bridge.ts` | 状态所有者留在原生侧 |

## 3. 加法配方（加东西时照抄）

### 3.1 新增一个动作

1. `lib/commands.ts` 的 `AppCommandInput` 加回调，`buildAppCommands` 里 push 一条
   `{ id, label: t('…'), icon, run, showInPalette / showInMenu / showInSheet }`。
2. 三个入口自动出现（顺序 = 声明顺序；「更多」抽屉再按 `pending/priority` 重排）。
3. 测试：`__tests__/commands.test.ts` 断声明与排序；入口渲染由
   `commandPalette` / `appMenu` / `moreSheet` 既有测试覆盖。

### 3.2 新增一个弹层

1. `lib/overlays.ts`：`OverlayId` 加名字，`OVERLAY_META` 写 `blocking`（是否拦
   1-4/方向键快捷键）与 `escapeCloses`（Esc 是否直接关；大弹层自己处理以保留退出动画）。
2. App 里用 `overlays.open('x')` / `overlays.isOpen('x')` 渲染与关闭；**不要**再加
   `useState`，也不要在快捷键 effect 里枚举弹层。
3. 携带值（如课程详情 = lesson id）用 `overlays.open('lesson', id)` /
   `overlays.value('lesson')`，不要另开一个 id state。

### 3.3 新增一个设置项

1. 选分类，改 `components/settings/<分区>.tsx`；分区自己的本地状态留在分区里。
2. 新分类才动 `Settings.tsx`：`tokens.ts` 的标题键 / 说明键 / 图标 + 一行 `<Group active={active === 'id'}>`。
   设置是「左侧导轨 + 右侧单组」：非当前组只加 `hidden` 类（不卸载，避免切分类丢输入），
   所以分类标题与说明都得由 `Group` 渲染；不要在外层再写一个同名 h2（`getByRole` 会重复命中）。
3. 分隔：常量/纯函数放 `tokens.ts`，组件放 `shared.tsx`（混导出会触发
   `only-export-components` 警告）。
4. 读源码的接线守卫记得把 glob 扩到 `components/settings/*.tsx`；匹配 `<Group id="x">`
   要用正则跨行（属性现在分行了），别写单行字面量。

### 3.4 新增一个视图 / 周导航动作

1. `lib/navigation.ts` 的 `VIEWS` 加一行：`route`（路由名，也是命令面板的 id）、
   `view`（真正落到哪个页面）、`labelKey`、`icon`、`shortcut`、
   `inHeader` / `inBottomNav` / `headerIcon` / `badges`。历史别名用
   `route !== view` 表达（`assign → moodle` 并 `clearsAssignPreset`）。
2. **新页面才动 `App.tsx`**：`view === '…'` 分支里加渲染；别名不需要新分支。
3. 文案：`messages.ts` 加 `labelKey` 的中英各一行；`navigation.test.ts`
   会拦漏翻、路由重复、快捷键撞车、壳层指向不存在的页面。
4. 深链/小组件/托盘：只发 `route` 名；`viewDeclFromHash` / `viewDeclForRoute`
   是唯一解析器，不要另写正则。`desktop.test.ts` 直接用 `VIEWS` 校验主进程词表。
5. 周导航：在 `WEEK_NAV` 里加/改条目，并把 id 放进 `WEEK_NAV_ORDER`（面板顺序）。
   头部与周视图用 `WEEK_NAV.prev/next/this`，滑动用 `weekNavForDelta`。

### 3.5 新增一个页内分区（Moodle / SISU 计划）

1. 分区清单只声明一次（order / labelKey / icon / 可选计数），渲染成一条 `app-rail`：
   手机横滑 chip、`md:` 起左侧竖排，同一份 DOM，不复制按钮、不写左右翻页箭头。
2. 内容一次只挂一个分区；切换靠 `aria-selected`，面板 `role=tabpanel` + `aria-labelledby`。
3. 页首先给「一眼概览」（4 个 `stat-tile`：待办 / 逾期 / 未读 / 均分），数字可点即跳分区；
   筛选器与设置项不要和结果列表同屏堆叠，收进各自的折叠面板或子页。

## 4. 新增一个只读功能的六步

以「学期全景带」为例：

1. **纯模型** `lib/semester.ts`：窗口推导、分桶、负荷归一化。
2. **测试** `__tests__/semester.test.ts`：窗口边界、跨年、空输入、本地日归属。
3. **文案** `i18n/messages.ts`：zh 与 en 同时加，占位符一致。
4. **组件** `components/SemesterStrip.tsx`：只渲染模型输出，点击只发回调。
5. **接线** 在拥有数据的组件/App 里挂载，回调改视图状态。
6. **门禁** `tsc` / `vitest` / `test:consistent` / `oxlint` / `build`。

## 5. 数据一致性

- Moodle courseid ↔ SISU 课程码 ↔ 显示名：只查 `lib/courseIdentity.ts`。
- 任务 id 前缀：`moodle:` 与 `moodle-act:`，判定用 `/^moodle(-act)?:/`。
- 出勤记录键：`lessonOccurrenceKey()`（uid → 代码|开始），**不要用** `lesson.id`。
- Moodle 活动开始/截止：`lib/activityDates.ts`（cmid 键控；assign 元数据 → 内容树 `dates[]`
  合并，活动有值覆盖任务推断值、缺字段保留原值）。渲染唯一件是
  `components/ActivityDatesText.tsx`；任务列表由 `useMoodleData` 的 `commitTasks` 唯一出口套用，
  内容树经 `registerContentsDates` 零网络回灌，成绩卡按 `GradeItem.cmid` 取同源日期。
- 个人学习计划：`lib/personalStudyPlan.ts` 是唯一数据源（67 行课程 + 分类最低要求 + 确定性 id）。
  首次运行由 `lib/sisuStudyPlan.ts` 的 `loadSisuStudyPlan()` 落盘；已存在的计划（含空计划）永不覆盖。
- SISU 课程事实：`lib/sisuCourseFacts.ts` 是**生成快照**（开课学段、总学时、先修、评分），
  由 `scripts/fetch-sisu-facts.mjs` 生成，运行时零请求；不要手改，换学年重新生成。
- 毕业情景：`lib/sisuScenario.ts` 的 `buildScenario()` 是唯一排程实现（压缩学年、先修顺序、
  取消、周负荷、延期、分类进度）。情景只读，不写回计划。`lib/sisuScenarioPrefs.ts` 只存目标年限 /
  取消代码 / 最低要求开关 / 自动均衡开关。
- 成绩权重来源：用户确认的方案（`gradeScheme.activeSchemeWeights`）> SISU 教师权重（`lib/sisuGradeWeights.ts`）> Moodle 成绩册。
  SISU 一侧只在两个条件同时成立时接管：`parseSisuWeights` 解析出的比例合计在 90–110 之间（再按比例归一），
  且每个分项都能对到至少一个 Moodle 项目（exam / exercises / project / attendance 四类关键词）。半套映射一律不接管——
  否则权重会被悄悄挪到别的分项。官方总评（`officialTotal`）仍然是卡片上的 headline，SISU 权重改变的是项目权重、
  贡献列、what-if 与 local `average` 链。
- 自动均衡负荷：`lib/sisuRebalance.ts` 的 `rebalanceScenario()` 只做「同年 P1–P4 重排」——产出
  `periodOverrides` 交回 `buildScenario` 重算，页面上所有数字（学期格、风险卡、年限对比）都来自同一份投影。
  先修边同年的两端锁死不动；窗口优先落在 SISU 开课学段内，落在外面时 `withinOffering: false` 由 UI 标「需核对开课」。
  目标是「先压低最忙学段、再减少超标学段」；批级守卫允许用峰值上升换超标学段减少（先修解锁会把延期的课拉回同年），
  摘要必须同时报峰值与超标数，不要只报一个。
  不要在这里写回计划、改学年或另写学时换算（`courseWeeklyHours` 是唯一实现）或第二套阈值
  （60h/周的唯一来源是 `sisuWorkload.DEFAULT_MAX_WEEKLY_HOURS`，`buildScenario` / `rebalanceScenario` 只消费它）。
- 可选课程：`lib/optionalCourses.ts` 的 `recommendOptionalCourses()` 只吃个人计划 + 课程事实，
  先修等价表 `LIKELY_EQUIVALENT` 与替换组合 `findSwapOptions()` 都在这一个文件；
  点击「加入计划」才走 `createSisuPlanItem` 落盘。**候选池只收计算机/软件工程课程**：
  HDD（HEBUT）的中文与国情课不是本专业的选修，不要再加回推荐（曾经的「双学位中文要求」文案是错的）。
- SISU 公开目录搜索：`lib/sisuCourse.ts` 负责 GraphQL 与分页，`lib/sisuCourseCatalog.ts` 只做
  合并（计划 / Moodle / 课表 / 搜索结果），`lib/sisuCourseSelection.ts` 只做选中与可见性。
  焦点偏好与 HDD 静态目录已删除，不要再加回第二套筛选。
- 成绩权重：`weightraw` 是**同级相对权**（0.1 = 10%；缺字段 = 无权重、不参与，显式 0 也排除），不是课程占比。
  唯一合成入口是 `lib/grades.ts` 的 `composeHierarchicalWeights`（有 `parentcategories` 时
  沿树逐层兄弟归一，根合计 100%），拿不到层级才退回 `spreadCategoryWeights` 的一层均摊。
  层级由 `fetchGrades` 只对「分类行带权重」的课程额外调 `gradereport_user_get_grades_table`
  取（`data-categoryid` + `parentcategories`），扁平课不多打。**不要**把 percent 与 ratio
  混用（缺省项会被算成 1%），也不要用「Σw>100 就缩放」代替真实层级。

- 仪表盘骨架：唯一实现在 `components/Dashboard.tsx`（`DashboardHero` + `StatTile` + `DashboardSplit`），
  折叠工具复用 `CollapsiblePanel`（`defaultOpen` 只在用户没选过时生效）。SISU 计划、Moodle 成绩、作业页共用同一套结构：
  KPI 概览 → 主区（2/3）+ 侧栏工具（1/3）→ 窄容器单列。`DashboardSplit` 自己带 `@container`，
  页面不要假设祖先有容器查询上下文（否则 `@2xl:` 永不触发）。侧栏折叠状态逐页独立
  （`tt_grades_tools_open` / `tt_assign_tools_open`），不要与侧栏/抽屉的 key 混用。
  KPI 数字的口径属于 lib，组件不重算；`data-dashboard="hero|split"` 是给结构测试的稳定锚点。

## 6. 测试约定

- 时间一律从 `Date.now()` 或显式 `new Date(y, m, d, …)` 推导，禁止手写 UTC 字面量。
- 组件测试需要 `I18nProvider`；涉及 Moodle 数据的再包 `MoodleProvider`。
- 纯函数测试放在 `__tests__/` 根目录，组件测试放在 `__tests__/components/`。
