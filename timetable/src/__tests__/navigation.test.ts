import { describe, expect, it } from 'vitest'
import {
  VIEWS,
  WEEK_NAV,
  WEEK_NAV_ORDER,
  viewDeclForKey,
  viewDeclForRoute,
  viewDeclFromHash,
  weekNavForKey,
  weekNavForDelta,
  weekStartAfter,
  type AppView,
} from '../lib/navigation'
import { buildPalette } from '../lib/palette'
import { translate } from '../i18n'

/**
 * 【导航声明契约】视图与周导航只有 `lib/navigation` 一份清单：
 * 头部、底部标签栏、命令面板、键盘快门都从它派生。这里锁住「加一行就够」
 * 的三条硬约束——路由名唯一、每个壳层入口都指向真页面、键位不撞车。
 */

describe('view declaration', () => {
  it('keeps routes unique', () => {
    const routes = VIEWS.map((decl) => decl.route)
    expect(new Set(routes).size).toBe(routes.length)
  })

  it('only puts real pages in the shell switchers', () => {
    const pages = new Set<AppView>(['today', 'week', 'moodle'])
    for (const decl of VIEWS) {
      expect(pages.has(decl.view), `${decl.route} → ${decl.view}`).toBe(true)
      // 壳层按钮点击后落到 decl.view；别名（assign）不许出现在壳层，
      // 否则「作业」和「Moodle」会成为两个长一样的按钮。
      if (decl.inHeader || decl.inBottomNav) expect(decl.route).toBe(decl.view)
    }
    expect(VIEWS.filter((decl) => decl.inHeader).map((decl) => decl.route)).toEqual(['today', 'week', 'moodle'])
    expect(VIEWS.filter((decl) => decl.inBottomNav).map((decl) => decl.route)).toEqual(['today', 'week', 'moodle'])
  })

  it('gives every shortcut to exactly one action', () => {
    const shortcuts = [
      ...VIEWS.map((decl) => decl.shortcut),
      ...WEEK_NAV_ORDER.map((id) => WEEK_NAV[id].shortcut),
    ].filter((key): key is string => Boolean(key)).map((key) => key.toLowerCase())
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
  })

  it('resolves the router vocabulary and history aliases', () => {
    expect(viewDeclForRoute('moodle')?.view).toBe('moodle')
    expect(viewDeclForRoute('assignments')).toBeUndefined()
    expect(viewDeclFromHash('#/view/assign')).toMatchObject({ view: 'moodle', clearsAssignPreset: true })
    expect(viewDeclFromHash('#/view/week')?.view).toBe('week')
    expect(viewDeclFromHash('#/view/nope')).toBeUndefined()
    expect(viewDeclFromHash('#/view/week/extra')).toBeUndefined()
    expect(viewDeclFromHash('')).toBeUndefined()
  })

  it('maps keys case-insensitively and ignores everything else', () => {
    expect(viewDeclForKey('4')?.view).toBe('moodle')
    expect(viewDeclForKey('3')?.route).toBe('assign')
    expect(viewDeclForKey('9')).toBeUndefined()
    expect(viewDeclForKey('Escape')).toBeUndefined()
    expect(weekNavForKey('ArrowLeft')?.id).toBe('prev')
    expect(weekNavForKey('ArrowRight')?.id).toBe('next')
    expect(weekNavForKey('T')?.id).toBe('this')
    expect(weekNavForKey('ArrowUp')).toBeUndefined()
  })

  it('has a label in both languages for every entry', () => {
    const keys = [
      ...VIEWS.map((decl) => decl.labelKey),
      ...WEEK_NAV_ORDER.map((id) => WEEK_NAV[id].labelKey),
    ]
    for (const key of keys) {
      expect(translate('zh', key), `zh 缺 ${key}`).not.toBe(key)
      expect(translate('en', key), `en 缺 ${key}`).not.toBe(key)
    }
  })
})

describe('week navigation', () => {
  it('applies deltas from any anchor week', () => {
    const anchor = new Date(2026, 9, 12) // 周一
    expect(weekStartAfter(anchor, WEEK_NAV.next).getTime()).toBe(new Date(2026, 9, 19).getTime())
    expect(weekStartAfter(anchor, WEEK_NAV.prev).getTime()).toBe(new Date(2026, 9, 5).getTime())
  })

  it('“this week” follows the clock, not the current anchor week', () => {
    const anchor = new Date(2026, 8, 7) // 很久以前的一周
    const now = new Date(2026, 9, 21, 15) // 周三 → 本周一 10/19
    expect(weekStartAfter(anchor, WEEK_NAV.this, now).getTime()).toBe(new Date(2026, 9, 19).getTime())
  })

  it('turns a swipe delta into the declared action instead of a bare ±1', () => {
    expect(weekNavForDelta(-1).id).toBe('prev')
    expect(weekNavForDelta(1).id).toBe('next')
  })
})

describe('command palette derivation', () => {
  it('lists exactly one entry per view route plus the week nav, in declaration order', () => {
    const items = buildPalette({
      t: (key) => key,
      locale: 'en',
      lessons: [],
      tasks: [],
      commands: [],
    })
    expect(items.map((item) => item.id)).toEqual([
      ...VIEWS.map((decl) => `view:${decl.route}`),
      ...WEEK_NAV_ORDER.map((id) => `week:${id}`),
    ])
  })

  it('hands the declared route back as the action payload (App resolves the alias)', () => {
    const views = buildPalette({ t: (key) => key, locale: 'en', lessons: [], tasks: [], commands: [] })
      .filter((item) => item.group === 'views')
    expect(views.find((item) => item.id === 'view:assign')?.action).toEqual({ kind: 'view', view: 'assign' })
  })
})
