# LUT Timetable / LUT 课表

Source code lives here; the **bilingual (中文/English) usage guide is in the repo root** → [README.md](../README.md).

Quick start 快速开始:

```bash
npm install
npm run dev        # http://localhost:5210 (port pinned)
npm test           # vitest
npm run build      # production build -> dist/
```

Installers (Windows `.exe`/`.msi`, Android `.apk`) are auto-built by CI and published to **GitHub Releases**（安装包由 CI 自动构建并发布到 GitHub Releases）:

- Windows: `LUT.Timetable.Setup-<version>.exe` (auto-update 支持自动更新) / `.msi` (no auto-update)
- Android: `app-debug.apk` (debug-signed 调试签名)
- **No iOS version / 无 iOS 版本** — iOS 需要 macOS + Apple 开发者证书，暂不支持（not planned）。

Latest: https://github.com/wzs39/lut-timetable/releases/latest