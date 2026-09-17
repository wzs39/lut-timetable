# LUT Timetable / LUT 课表

A clean-slate timetable app for LUT / LAB students (Windows + Android + iOS), with automatic sync from **SISU** and **TimeEdit**, conflict handling, per-course coloring, filters, and lesson reminders. Built with React + TypeScript + Vite, packaged with **Electron** (Windows) and **Capacitor** (Android / iOS).

一个面向 LUT / LAB 学生的简约课表软件（Windows + Android + iOS），支持 **SISU** 与 **TimeEdit** 自动同步、冲突处理、按课程着色、筛选与上课提醒。前端为 React + TypeScript + Vite，Windows 版用 **Electron** 打包，Android / iOS 版用 **Capacitor**。

---

## Versions / 版本

| Platform 平台 | Package 安装包 | Status 状态 | Notes 说明 |
|---|---|---|---|
| **Windows** (Electron) | `LUT.Timetable.Setup-<version>.exe` | ✅ Released 已发布 | NSIS installer. **Supports auto-update** from GitHub Releases. 支持自动更新（每次推送到 main 自动出新版）。 |
| **Windows** (Electron) | `LUT.Timetable-<version>.msi` | ✅ Released 已发布 | MSI for enterprise deployment 企业批量部署用. **No auto-update** 无自动更新。 |
| **Android** | `app-release.apk` | ✅ Released 已发布 | **Release-signed** APK (own keystore) — install with "allow unknown sources". 正式签名安装包，需允许"未知来源"。Checks GitHub Releases in-app. 内置更新检查。Still not on Google Play. 仍未上架。 |
| **Web 网页版** | — | ❌ Deprecated 已废弃 | Removed: SISU ICS has no CORS headers, so browser sync depended on flaky public proxies. 已废弃：浏览器同步依赖不稳定的公共代理。 |
| **iOS / macOS** | 源码构建 | 🔧 **Build from source 从源码构建** | **No signed release / no App Store version.** The Xcode project (`timetable/ios/`) is committed and **CI compile-checks it on every push** (simulator build, unsigned). To run it you need a Mac with Xcode: `npm ci && npm run build && npx cap sync ios`, open `timetable/ios/App/App.xcodeproj`, press Run. sideload to a device requires your own free Apple ID (7-day validity) or a paid Developer account. **无签名发布版、不上架 App Store。** Xcode 工程已提交，CI 每次推送都会编译验证（模拟器、无签名）。自建需 Mac + Xcode：`npm ci && npm run build && npx cap sync ios`，打开 `timetable/ios/App/App.xcodeproj` 点 Run；装真机需用自己的免费 Apple ID（7 天有效）或付费开发者账号。 |

Latest installers are always at: 最新安装包始终发布在：
**https://github.com/wzs39/lut-timetable/releases/latest**

---

## English

### Install

1. **Windows (recommended)** — download `LUT.Timetable.Setup-<version>.exe`, double-click, install. The app **auto-updates** (checks GitHub Releases at launch, downloads new versions, one-click restart to apply).
2. **Windows (alternate)** — `LUT.Timetable-<version>.msi` via Group Policy / silent deploy. Manual reinstall needed for updates.
3. **Android** — download `app-release.apk`, allow "unknown sources", open the file. The app checks GitHub Releases itself and offers a **Download APK** button when a newer build exists.
   - Coming from an older **debug-signed** build (0.2.12 or earlier)? Android only upgrades an app signed with the same key, so that build can never update in place: **uninstall it once**, then install this APK. From there on updates work normally.
   - Released APKs are signed with the project's own release key; the fingerprint is printed by CI on every build (`Verify the APK` step).

### First run / sync

1. Open the app, go to the sidebar **Sync calendar**.
2. **SISU**: in SISU (`https://sisu.lut.fi/student/calendar/enrolments`) open your calendar share, copy the link like `https://sisu.lut.fi/ilmo/api/calendar-share/<uuid>` and paste it.
3. **TimeEdit**: on the LUT TimeEdit page (`https://cloud.timeedit.net/lut-saimia/...`), select your courses, copy the page link (`.html`), paste it. The app converts it to the `.ics` subscription and imports it.
4. Click **Sync** per source (or enable auto-sync: on startup + every 15 minutes).

Sync runs through the native network stack (`CapacitorHttp` on Android, a Node `fetch` IPC bridge in Electron) — no CORS limits, works offline-first with a 2-hour ICS cache.

### Features

- Cross-source dedupe: the same course code + time from SISU & TimeEdit is merged into one entry; sync protects your manual deletes/edits (see the 🛡 panel in the sidebar to review/undo).
- Conflict highlighting, per-course colors, lesson-type tags (lecture / exercise / tutorial / seminar / exam).
- Batch filter: search, filter by date/day/source/type, **hide without deleting**, save filter presets, batch delete.
- Desktop/device notifications 10 minutes before each lesson; today view with next-lesson countdown and building-grouped indoor navigation hints.
- **Lecture Translator integration** (optional, manual): in the sidebar, enter your Lecture Translator URL (default `http://localhost:8000`) and press **“Link current lesson to Lecture Translator”** while a lesson is in session. The timetable then creates/activates the matching course session in [Lecture Translator](https://github.com/wzs39/lecture-translator) — so live captions, translation, glossary, and notes land in the right course. Sessions are cached per course code and reused across weeks. Nothing happens automatically; if the translator is off, you just get a message and the timetable keeps working.
- Backup: sidebar → export/import JSON to move data between devices.

### Data & privacy

All data is stored locally on your device (`localStorage`). Nothing is sent to our servers — the app only talks to SISU/TimeEdit directly.

---

## 中文

### 安装

1. **Windows（推荐）** — 下载 `LUT.Timetable.Setup-<version>.exe`，双击安装。应用启动时自动检查 GitHub Releases 新版、后台下载，**一键重启即可完成更新**。
2. **Windows（备选）** — `LUT.Timetable-<version>.msi` 适合企业批量部署；更新需手动重装。
3. **Android** — 下载 `app-release.apk`，允许"未知来源"后打开安装。应用会自己检查 GitHub Releases，有新版本时给出 **下载 APK** 按钮（点它会在系统浏览器里下载）。
   - 如果你装的是更早的**调试签名**版本（0.2.12 及以前）：Android 只允许同签名覆盖安装，那个版本无法原地升级，需要**先卸载一次**再装这个包；之后更新就正常了。
   - 发布包使用项目自己的正式签名密钥，每次 CI 构建都会打印证书指纹（`Verify the APK` 步骤）。

### 首次使用 / 同步

1. 打开应用，在侧栏 **同步日历** 处添加来源。
2. **SISU**：在 SISU（`https://sisu.lut.fi/student/calendar/enrolments`）打开你的日历共享，复制形如 `https://sisu.lut.fi/ilmo/api/calendar-share/<uuid>` 的链接粘贴进来。
3. **TimeEdit**：在 LUT TimeEdit 页面（`https://cloud.timeedit.net/lut-saimia/...`）勾选你的课程后复制页面链接（`.html`）粘贴；应用会自动转为 `.ics` 订阅并导入。
4. 每个来源点 **同步**（或开启自动同步：启动时 + 每 15 分钟一次）。

同步走原生网络栈（Android 为 `CapacitorHttp`，Electron 为主进程 Node `fetch` IPC 桥），完全没有 CORS 限制；数据离线优先，ICS 内容缓存 2 小时。

### 功能

- **跨来源去重**：SISU 与 TimeEdit 相同课程代码 + 相同时段的条目合并为一条；同步保护你手动删除/编辑的记录（侧栏 🛡 面板可查看/撤销）。
- 冲突高亮、按课程着色、课型标签（讲课 / 辅导 / 研讨 / 习题 / 考试）。
- 批量筛选：按关键词、日期、星期、来源、课型检索，支持**筛选隐藏（不删除）**、保存筛选预设、批量删除。
- 每节课前 10 分钟系统通知；今日视图含下节倒计时与按楼栋分组的室内导航提示。
- **Lecture Translator 联动**（可选、手动）：侧栏填入 Lecture Translator 地址（默认 `http://localhost:8000`），上课时点一下 **「链接当前课程到 Lecture Translator」**，课表就会在 [Lecture Translator](https://github.com/wzs39/lecture-translator) 中创建/激活对应课程会话——实时字幕、翻译、术语表、笔记自动归入正确的课程。会话按课程代码缓存，每周重复使用。不做任何自动操作；翻译器没开时只会提示，课表不受影响。
- 数据备份：侧栏"数据备份"导出/导入 JSON，轻松迁移到其他设备。

### 数据与隐私

所有数据仅保存在设备本地（`localStorage`），不会上传到任何服务器；应用只直接访问 SISU / TimeEdit。

---

## Development / 开发

```bash
cd timetable
npm install
npm run dev        # http://localhost:5210 (port pinned, strictPort)
npm test           # vitest
npm run build      # production web build -> dist/
```

- Every push to `main` triggers CI (`.github/workflows/native-build.yml`) which builds the Windows installers **and** the Android APK, auto-increments the patch version, and publishes everything to GitHub Releases — including `latest.yml` that drives the Windows auto-updater.
- Android APK can also be built in a Docker sandbox without a local Android SDK: see `timetable/docker/` (`build-android.bat` / `build-android.sh`). That path builds a **debug** APK for local testing; signed release APKs are produced by CI.
- **Android release signing**: the keystore is never in the repository. CI decodes it from the `ANDROID_KEYSTORE_BASE64` secret and passes the path/passwords through `LUT_KEYSTORE_FILE` / `LUT_KEYSTORE_PASSWORD` / `LUT_KEY_ALIAS` / `LUT_KEY_PASSWORD`; `app/build.gradle` reads those names, so a local `assembleRelease` works the same way with `-PLUT_KEYSTORE_FILE=...` etc. Without them the release build stays unsigned instead of silently using the debug key. The keystore lives outside the repo — **back it up**: losing it means no existing install can ever be updated again.
- **Manual CI run**: `workflow_dispatch` on any branch builds and verifies the Android APK only (no publishing). Pass `publish: true` to reproduce the full push behaviour.
- Troubleshooting: if a sync fails, check you're on the latest release (Windows), and for Android make sure notifications permission is granted if reminders don't fire.