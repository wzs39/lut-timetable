// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { acceleratorLabel, desktopBridge, trayLabels } from '../lib/desktop'

/**
 * 守卫：桌面常驻功能（托盘 / 全局快捷键）的契约。
 *
 * 桥接是 contextBridge 暴露的裸对象，键名写错不会在编译期报错——只会静默失效
 * （设置页整块不出现、托盘菜单还是中文、打包后图标丢失）。所以这里把
 * main.cjs / desktop.cjs / app-icon.cjs / preload.cjs / tray-labels.json /
 * package.json 当数据集读，断言各方对齐；托盘文案只有 tray-labels.json 一个家。
 */
const sources = import.meta.glob(
  ['../../electron/*.cjs', '../../electron/*.json', '../../package.json', '../../src/App.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const mainCjs = sources['../../electron/main.cjs'] ?? ''
const desktopCjs = sources['../../electron/desktop.cjs'] ?? ''
const appIconCjs = sources['../../electron/app-icon.cjs'] ?? ''
const trayLabelsJson = sources['../../electron/tray-labels.json'] ?? ''
const preloadCjs = sources['../../electron/preload.cjs'] ?? ''
const pkgJson = sources['../../package.json'] ?? ''
// glob 的键形状随 Vite 解析而变化，按后缀取，别写死。
const appTsx = sources[Object.keys(sources).find((k) => k.endsWith('App.tsx')) ?? ''] ?? ''

/** 视图名的唯一权威：渲染端路由词表。主进程发的名字必须在这里面。 */
function routerViewNames(): string[] {
  expect(appTsx.length, 'App.tsx 没进 import.meta.glob，词表守卫等于没跑').toBeGreaterThan(100)
  const hit = /\((today\|[a-z]+(?:\|[a-z]+)+)\)/.exec(appTsx)
  expect(hit, 'App.tsx 里找不到视图路由词表').not.toBeNull()
  return hit![1].split('|')
}

/** 托盘文案契约的键（主进程兜底、渲染端推送、i18n 都必须同键）。 */
function trayLabelContractKeys(): string[] {
  const parsed = JSON.parse(trayLabelsJson) as { zh: Record<string, string>; en: Record<string, string> }
  expect(Object.keys(parsed.zh).length, 'tray-labels.json kosong').toBeGreaterThan(0)
  expect(Object.keys(parsed.en).sort()).toEqual(Object.keys(parsed.zh).sort())
  return Object.keys(parsed.zh)
}

describe('desktop bridge', () => {
  it('is absent on web / mobile (no window.lutDesktop)', () => {
    expect(desktopBridge()).toBeNull()
  })

  it('stays absent when a partial/stale object is exposed', () => {
    ;(window as unknown as { lutDesktop?: unknown }).lutDesktop = { setPrefs: () => {} }
    expect(desktopBridge()).toBeNull()
  })

  it('exposes getState / setPrefs / setTrayLabels / onCommand', async () => {
    const bridge = {
      getState: vi.fn(async () => ({
        closeToTray: true,
        shortcutEnabled: true,
        accelerator: 'CommandOrControl+Shift+L',
        shortcutActive: true,
        platform: 'win32',
      })),
      setPrefs: vi.fn(async () => ({
        closeToTray: false,
        shortcutEnabled: false,
        accelerator: 'CommandOrControl+Shift+L',
        shortcutActive: false,
        platform: 'win32',
      })),
      setTrayLabels: vi.fn(),
      onCommand: vi.fn(() => () => {}),
    }
    ;(window as unknown as { lutDesktop?: unknown }).lutDesktop = bridge

    const found = desktopBridge()
    expect(found).not.toBeNull()
    expect((await found!.getState()).shortcutActive).toBe(true)
    expect((await found!.setPrefs({ closeToTray: false })).closeToTray).toBe(false)
    found!.setTrayLabels({ show: 'x' })
    expect(bridge.setTrayLabels).toHaveBeenCalledWith({ show: 'x' })
  })
})

describe('tray labels', () => {
  it('uses exactly the keys of the shared contract file', () => {
    expect(Object.keys(trayLabels('zh')).sort()).toEqual(trayLabelContractKeys().sort())
  })

  it('localizes every key in both languages (no raw key leaking into the tray)', () => {
    for (const lang of ['zh', 'en'] as const) {
      for (const [key, value] of Object.entries(trayLabels(lang))) {
        expect(value, `${lang}/${key}`).toBeTruthy()
        expect(value).not.toBe(key)
      }
    }
    expect(trayLabels('zh').today).toBe('今日')
    expect(trayLabels('en').today).toBe('Today')
  })

  it('carries no one-shot balloon copy: the tray icon itself is the feedback', () => {
    // 一次性气泡（+ 记住「已经提示过」的偏好项）已删：它只在第一次收托盘时出现一次，
    // 却要多一个偏好、一段 Windows 专属调用和一条文案。别再回来。
    expect(desktopCjs).not.toMatch(/displayBalloon|balloonShown/)
    expect(trayLabelContractKeys()).not.toContain('hiddenHint')
  })
})

describe('accelerator label', () => {
  it('renders the one accelerator readably per platform', () => {
    expect(acceleratorLabel('CommandOrControl+Shift+L', false)).toBe('Ctrl + Shift + L')
    expect(acceleratorLabel('CommandOrControl+Shift+L', true)).toBe('⌘ + ⇧ + L')
  })
})

describe('electron desktop wiring', () => {
  it('creates a tray, registers the global shortcut and keeps the menu localized', () => {
    expect(desktopCjs).toMatch(/new Tray\(/)
    expect(desktopCjs).toMatch(/globalShortcut\.register\(TOGGLE_ACCELERATOR/)
    expect(desktopCjs).toMatch(/Menu\.buildFromTemplate/)
    expect(desktopCjs).toMatch(/ipcMain\.on\('lut-tray-labels'/)
    expect(desktopCjs).toMatch(/lut-tray-command/)
  })

  it('decides the close policy in one place and always lets a real quit through', () => {
    // 策略（放行 / 收托盘）只在 desktop.cjs 的 handleClose 里决策；
    // main.cjs 只把事件接过去，自己不再写第二份判断。
    expect(desktopCjs).toMatch(/function handleClose\(event\)/)
    expect(desktopCjs).toMatch(/event\.preventDefault\(\)/)
    expect(desktopCjs).toMatch(/app\.on\('before-quit'/)
    expect(desktopCjs).toMatch(/quitting = true/)
    expect(mainCjs).toMatch(/win\.on\('close', \(e\) => desktop\.handleClose\(e\)\)/)
  })

  it('degrades close-to-tray into a real quit when no tray exists', () => {
    // 托盘起不来（少数 Linux 桌面 / 图标坏掉）时关窗必须变回退出：否则窗口一关
    // 就只剩一个看不见的进程，连全局快捷键都可能被别的程序占着，彻底没有入口。
    expect(desktopCjs).toMatch(/if \(!tray\) \{[\s\S]{0,120}quitting = true[\s\S]{0,40}return/)
    expect(desktopCjs).toMatch(/close without tray -> quit/)
    // 托盘创建失败走 catch 分支并且不能把启动带崩。
    expect(desktopCjs).toMatch(/\[desktop\] tray unavailable/)
    // 图标缺失时 Electron 不抛错、只给一个看不见的托盘图标（打包产物实测），
    // 所以空图标必须等同「没有托盘」，否则降级守卫会被绕过。
    expect(desktopCjs).toMatch(/icon\.isEmpty\(\)[\s\S]{0,200}tray skipped/)
  })

  it('reads desktop-prefs.json even when it was saved with a BOM', () => {
    // 记事本 / PowerShell Set-Content 保存会带 BOM，JSON.parse 直接抛，用户手改的
    // 偏好就被静默重置成默认值（真产物实测到过）。只有真的读不懂才警告。
    expect(desktopCjs).toMatch(/replace\(\/\^\\uFEFF\/, ''\)/)
    expect(desktopCjs).toMatch(/err\?\.code !== 'ENOENT'/)
    expect(desktopCjs).toMatch(/desktop-prefs\.json unreadable/)
  })

  it('serves the pref channel the renderer talks to', () => {
    expect(desktopCjs).toMatch(/ipcMain\.handle\('lut-desktop-get-state'/)
    expect(desktopCjs).toMatch(/ipcMain\.handle\('lut-desktop-set-prefs'/)
    for (const method of ['getState', 'setPrefs', 'setTrayLabels', 'onCommand']) {
      expect(preloadCjs).toMatch(new RegExp(`${method}:`))
    }
    expect(preloadCjs).toMatch(/exposeInMainWorld\('lutDesktop'/)
  })

  it('guards the will-quit cleanup behind app readiness', () => {
    // 第二个实例拿到锁失败时会在模块加载阶段 app.quit()，will-quit 于是早于 ready
    // 到来——此时 globalShortcut 还不能用，少这一道判断就是启动即弹出错误框（实测）。
    expect(desktopCjs).toMatch(/app\.on\('will-quit', \(\) => \{\s*\n\s*if \(app\.isReady\(\)\)/)
  })

  it('exits a lock-less second instance before any startup work', () => {
    // app.quit() 是异步的：只写 quit() 的话，第二个进程会照旧跑完 whenReady（建窗口、
    // 建托盘、注册协议、再起一条 updater、和活着的实例抢 userData），实测过。
    // 所以失败分支必须同步退出，而且启动工作要整体挂在 gotSingleLock 上。
    expect(mainCjs).toMatch(/if \(!gotSingleLock\) \{[\s\S]{0,500}app\.exit\(0\)/)
    expect(mainCjs).toMatch(/if \(gotSingleLock\) app\.whenReady\(\)/)
  })

  it('only asks for views the renderer router knows', () => {
    // 托盘「作业」/ 跳转列表曾发 'assignments'，而渲染端路由只认 'assign'——
    // 发错名字不报错，只是点了没反应（真产物实测：hash 变了、视图还是今日）。
    const allowed = routerViewNames()
    const used = [
      ...desktopCjs.matchAll(/navigateToView\('([a-z]+)'\)/g),
      ...mainCjs.matchAll(/view\('([a-z]+)'/g),
    ].map((m) => m[1])
    expect(used.length, '主进程没有任何视图入口，这本身就说明守卫失效了').toBeGreaterThan(3)
    for (const name of used) {
      expect(allowed, `主进程发了渲染端不认识的视图名: ${name}`).toContain(name)
    }
  })

  it('routes external assignment entries into the Moodle timeline (assign view removed)', () => {
    // 【2026-09-26】作业模块并入 Moodle 时间线：独立 assign 视图已删。
    // 主进程两个入口（托盘菜单 + 跳转列表）都必须发 'moodle'，不再发 'assign'——
    // 渲染端虽兼容映射 assign，但入口统一词表，避免两套语义并存。
    const desktopViews = [...desktopCjs.matchAll(/navigateToView\('([a-z]+)'\)/g)].map((m) => m[1])
    const jumpViews = [...mainCjs.matchAll(/view\('([a-z]+)'/g)].map((m) => m[1])
    expect(desktopViews).not.toContain('assign')
    expect(jumpViews).not.toContain('assign')
    expect(desktopViews).toContain('moodle')
    expect(jumpViews).toContain('moodle')
  })

  it('keeps main.cjs to wiring: the desktop concern does not live there', () => {
    expect(mainCjs).toMatch(/createDesktop\(\{/)
    expect(mainCjs).toMatch(/desktop\.setup\(\)/)
    // 关注点不该回流——原生托盘/快捷键/偏好读写在 main.cjs 里按名字就能发现。
    expect(mainCjs).not.toMatch(/new Tray\(|globalShortcut\.|desktop-prefs\.json/)
  })

  it('ships the tray icon into the packaged resources dir', () => {
    // Tray 图标在打包后必须能找到：files 里不含 build/，所以要显式 extraResources。
    const parsed = JSON.parse(pkgJson) as {
      build?: { extraResources?: unknown; files?: string[] }
    }
    const extra = parsed.build?.extraResources as Array<{ from?: string; to?: string }>
    expect(extra?.some((e) => e.from === 'build/icon.ico' && e.to === 'icon.ico')).toBe(true)
    expect(appIconCjs).toMatch(/path\.join\(process\.resourcesPath \|\| '', 'icon\.ico'\)/)
  })
})
