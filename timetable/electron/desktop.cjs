// 系统托盘 + 全局快捷键（桌面常驻）—— 与 external-links.cjs 同一种拆法：
// 一个关注点一个文件，main.cjs 只负责接线。
//
// 桌面端关窗 ≠ 退出：窗口收进托盘继续在后台跑，托盘菜单直达三大视图，一个
// 全局快捷键随时呼出/收起窗口。偏好存 userData/desktop-prefs.json —— 主进程
// 是唯一读写者；渲染进程通过 preload 的 lutDesktop 桥拿状态、改偏好、推托盘
// 文案（菜单因此跟着 App 语言走）。没有托盘的环境功能自动降级，不影响启动。
const path = require('node:path')
const fs = require('node:fs')
const { app, Menu, Tray, globalShortcut } = require('electron')
const { appIcon, appIconPath } = require('./app-icon.cjs')
// 托盘文案只有这一个家（渲染端 lib/desktop.ts 读同一份 JSON）：菜单是原生对象，
// 读不到 web 的 i18n，所以契约必须放在两边都能 require 的地方。
const TRAY_LABEL_VALUES = require('./tray-labels.json')

/** 偏好就两项：关窗收托盘、全局快捷键开关。 */
const DEFAULT_DESKTOP_PREFS = { closeToTray: true, shortcutEnabled: true }

/** 兜底文案（中文）；渲染进程 ready 后会推当前语言的版本覆盖它。 */
const DEFAULT_TRAY_LABELS = TRAY_LABEL_VALUES.zh

/** 唯一的加速键：不提供自定义——自定义组合需要冲突校验 UI，误伤系统快捷键
 *  的概率也不小。开关在「设置 → 桌面端」。 */
const TOGGLE_ACCELERATOR = 'CommandOrControl+Shift+L'

/**
 * 建一个桌面常驻控制器。窗口的显示/创建仍是 main.cjs 的事，这里只决定
 * 「什么时候显示、关窗怎么处理、托盘长什么样」。
 *
 * @param {{
 *   ipcMain: import('electron').IpcMain,
 *   getWindow: () => import('electron').BrowserWindow | null,
 *   createWindow: () => void,
 *   sendToRenderer: (channel: string, payload?: unknown) => void,
 * }} deps
 */
function createDesktop({ ipcMain, getWindow, createWindow, sendToRenderer }) {
  let tray = null
  let quitting = false
  let cachedPrefs = null
  let trayLabels = { ...DEFAULT_TRAY_LABELS }

  function desktopPrefsPath() {
    return path.join(app.getPath('userData'), 'desktop-prefs.json')
  }

  /** 带缓存读：close 处理器每次关窗都要问一次，不想每次都碰磁盘。 */
  function desktopPrefs() {
    if (!cachedPrefs) {
      try {
        // 去掉 BOM：用记事本等工具手改过这个文件时会带 BOM，JSON.parse 直接抛，
        // 结果是「用户改的偏好被静默重置成默认值」（实测过）。
        const raw = JSON.parse(fs.readFileSync(desktopPrefsPath(), 'utf8').replace(/^\uFEFF/, ''))
        cachedPrefs = {
          closeToTray: raw?.closeToTray !== false,
          shortcutEnabled: raw?.shortcutEnabled !== false,
        }
      } catch (err) {
        // 首次运行（文件不存在）走默认值；只有真读不懂时才警告一声，不然「设置自己变了」没法查。
        if (err?.code !== 'ENOENT') {
          console.warn('[desktop] desktop-prefs.json unreadable, using defaults: ' + (err?.message ?? err))
        }
        cachedPrefs = { ...DEFAULT_DESKTOP_PREFS }
      }
    }
    return cachedPrefs
  }

  function saveDesktopPrefs(patch) {
    cachedPrefs = { ...desktopPrefs(), ...patch }
    try {
      fs.writeFileSync(desktopPrefsPath(), JSON.stringify(cachedPrefs))
    } catch { /* 写不进去也不该影响托盘行为 */ }
  }

  function showMainWindow() {
    const win = getWindow()
    if (!win || win.isDestroyed()) {
      createWindow()
      return
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  /** 快捷键是「呼出 / 收起」开关：窗口已在最前时再按一次就收进托盘。 */
  function toggleMainWindow() {
    const win = getWindow()
    const focused = !!win && !win.isDestroyed() && win.isVisible() && win.isFocused()
    if (focused) win.hide()
    else showMainWindow()
  }

  /** 托盘菜单 → 视图：复用 web 侧已有的 hashchange 消费（同 --open-view=）。 */
  function navigateToView(view) {
    showMainWindow()
    const wc = getWindow()?.webContents
    if (!wc || wc.isDestroyed()) return
    const go = () => wc.executeJavaScript(`location.hash = '#/view/${view}'`).catch(() => {})
    // 刚创建的窗口还没加载完，executeJavaScript 会落空——等 did-finish-load 再来一次。
    if (wc.isLoading()) wc.once('did-finish-load', go)
    else go()
  }

  function buildTrayMenu() {
    const L = trayLabels
    return Menu.buildFromTemplate([
      { label: L.show, click: () => showMainWindow() },
      { type: 'separator' },
      { label: L.today, click: () => navigateToView('today') },
      { label: L.week, click: () => navigateToView('week') },
      // 视图名必须用渲染端路由的词表（today|week|assign|moodle）——发错名字不会报错，只会点了没反应。
      { label: L.assignments, click: () => navigateToView('assign') },
      { type: 'separator' },
      {
        label: L.checkUpdate,
        click: () => {
          showMainWindow()
          // 更新检查的 UI 状态归渲染进程，主进程只负责叫它一声（APK 路径也在这条链上）。
          sendToRenderer('lut-tray-command', { command: 'check-update' })
        },
      },
      { type: 'separator' },
      {
        label: L.quit,
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ])
  }

  function setupTray() {
    if (tray) return
    const icon = appIcon()
    if (icon.isEmpty()) {
      // 实测（打包产物里删掉 icon.ico）：Electron 不会抛错，而是建出一个「看不见的
      // 托盘图标」——比没有托盘更糟，关窗会收进用户找不到的地方。所以图标空就等于
      // 没有托盘，close 处理器跟着降级为退出。
      console.warn('[desktop] tray skipped: icon empty')
      return
    }
    try {
      tray = new Tray(icon)
    } catch (err) {
      // 无托盘环境（少数 Linux 桌面 / 图标坏掉）：功能降级，应用照常工作。
      // 关窗行为也跟着降级（见 handleClose）—— 否则会变成「进程活着但没入口」。
      console.warn('[desktop] tray unavailable: ' + (err?.message ?? err))
      return
    }
    tray.setToolTip('LUT Timetable ' + app.getVersion())
    tray.setContextMenu(buildTrayMenu())
    tray.on('click', () => toggleMainWindow())
    console.log('[desktop] tray ready, icon=' + appIconPath())
  }

  function applyGlobalShortcut() {
    globalShortcut.unregisterAll()
    if (!desktopPrefs().shortcutEnabled) {
      console.log('[desktop] shortcut disabled by preference')
      return
    }
    let ok = false
    try {
      // register() 返回 false（而不是报错）就说明组合被别的程序占了 —— 两种都要留痕，
      // 否则用户只会感觉「快捷键没反应」。
      ok = globalShortcut.register(TOGGLE_ACCELERATOR, () => toggleMainWindow())
    } catch (err) {
      console.warn('[desktop] shortcut register threw: ' + (err?.message ?? err))
    }
    console.log('[desktop] shortcut ' + TOGGLE_ACCELERATOR + ' registered=' + ok)
  }

  function desktopState() {
    const p = desktopPrefs()
    return {
      closeToTray: p.closeToTray,
      shortcutEnabled: p.shortcutEnabled,
      accelerator: TOGGLE_ACCELERATOR,
      shortcutActive: globalShortcut.isRegistered(TOGGLE_ACCELERATOR),
      platform: process.platform,
    }
  }

  /**
   * 关窗策略的唯一决策点。放行返回 true（可能是「真的退出」，也可能是
   * 系统/平台自己接管）；返回 false 表示已经 preventDefault + 收进托盘。
   * @param {import('electron').Event} event
   */
  function handleClose(event) {
    if (quitting) return true
    // macOS 有自己的约定（关窗即隐藏、进程留在程序坞），不额外接管。
    if (process.platform === 'darwin') return true
    if (!desktopPrefs().closeToTray) return true
    const win = getWindow()
    if (!win || win.isDestroyed()) return true
    // 没有托盘就不该「收起来接着跑」：窗口一关就只剩一个看不见的进程
    // （全局快捷键可能也被别的程序占了，那就彻底没有入口了）。降级回关窗即退出。
    if (!tray) {
      console.log('[desktop] close without tray -> quit')
      quitting = true
      return true
    }
    event.preventDefault()
    win.hide()
    return false
  }

  ipcMain.handle('lut-desktop-get-state', () => desktopState())

  ipcMain.handle('lut-desktop-set-prefs', (_event, patch) => {
    const next = {}
    if (typeof patch?.closeToTray === 'boolean') next.closeToTray = patch.closeToTray
    if (typeof patch?.shortcutEnabled === 'boolean') next.shortcutEnabled = patch.shortcutEnabled
    saveDesktopPrefs(next)
    applyGlobalShortcut()
    return desktopState()
  })

  /** 渲染进程推来当前语言的托盘文案（挂载时 + 每次切语言）。 */
  ipcMain.on('lut-tray-labels', (_event, labels) => {
    const clean = {}
    for (const key of Object.keys(DEFAULT_TRAY_LABELS)) {
      if (typeof labels?.[key] === 'string' && labels[key].trim()) clean[key] = labels[key]
    }
    // 合并到当前文案上（不是回到默认值）：部分推送不会把其他键打回中文。
    trayLabels = { ...trayLabels, ...clean }
    if (tray) tray.setContextMenu(buildTrayMenu())
  })

  // 退出流程（托盘菜单 / 更新安装 / 系统关机）都必须放行 close 处理器，不能拦成 hide。
  app.on('before-quit', () => { quitting = true })
  // isReady 判断是必需的：第二个实例拿到锁失败会在模块加载时就 app.quit()，
  // 这时 will-quit 早于 ready 到来，直接调 globalShortcut 会抛
  // 「globalShortcut cannot be used before the app is ready」并弹出错误框
  // （真产物实测过；控制器现在比那行 app.quit() 先注册，所以必须自己把关）。
  app.on('will-quit', () => {
    if (app.isReady()) globalShortcut.unregisterAll()
  })

  // showWindow / navigateToView 也在这里导出：主进程还有两处需要它（第二个实例被拉起、
  // --open-view 启动参数），让它们复用同一套「显示 + 等加载完再写 hash」，而不是各写一份。
  return {
    setup: () => {
      setupTray()
      applyGlobalShortcut()
    },
    handleClose,
    showWindow: showMainWindow,
    navigateToView,
  }
}

module.exports = { createDesktop }
