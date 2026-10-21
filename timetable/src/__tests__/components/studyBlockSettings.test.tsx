// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Settings from '../../components/Settings'
import { I18nProvider, translate } from '../../i18n'
import { MoodleProvider } from '../../hooks/useMoodleData'
import { ThemeProvider } from '../../theme'
import { KEYS } from '../../lib/storage'
import { DEFAULT_STUDY_BLOCK_PREFS, loadStudyBlockPrefs } from '../../lib/studyBlockPrefs'
import type { Lesson } from '../../types'

// 【渲染契约】学习时段偏好的唯一编辑入口在设置的「学习偏好」分类里：
// 五条滑杆（窗口起止 / 单块时长 / 间隔 / 范围）+ 周末开关，改动即落盘并通知
// App 重挂载计划页；看不见的编辑器与落盘值必须一致（含跨字段钳位）。
//
// 注意：刻意用 range（role=slider）而不是 number/select —— Settings 的既有测试
// 用单数 getByRole('spinbutton'/'combobox') 找 SISU 目标学分与 focus，加同类控件
// 会让那些用例变成「找到多个元素」而失败。

const baseProps = {
  sources: [],
  syncing: false,
  syncMessage: null,
  autoSync: true,
  onToggleAutoSync: () => {},
  notifEnabled: true,
  onToggleNotif: () => {},
  digestEnabled: false,
  onToggleDigest: () => {},
  onAddSource: () => {},
  onRemoveSource: () => {},
  onSync: () => {},
  translatorUrl: '',
  onTranslatorUrl: () => {},
  onLinkTranslator: () => {},
  translatorMsg: null,
  notes: {},
  onRemoveNote: () => {},
  onExportIcs: () => {},
  onShareWeek: async () => '',
  subscriptions: [],
  onToggleSubscription: () => {},
  onRemoveSubscription: () => {},
  textScale: 'normal' as const,
  contrast: 'normal' as const,
  onTextScale: () => {},
  onContrast: () => {},
  errorCount: 0,
  onExportDiagnostics: async () => '',
  onClearErrors: () => {},
  audits: [],
  onClearAudits: () => {},
  desktop: null,
  onDesktopPrefs: () => {},
  onClose: () => {},
}

function renderSettings(onSisuPrefsChanged = vi.fn(), lessons: Lesson[] = []) {
  render(
    <I18nProvider>
      <ThemeProvider>
        <MoodleProvider tasks={[]} lessons={[]} onTasks={() => {}}>
          <Settings {...baseProps} lessons={lessons} onSisuPrefsChanged={onSisuPrefsChanged} />
        </MoodleProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
  return onSisuPrefsChanged
}

const slider = (key: string, params?: Record<string, string | number>) =>
  screen.getByRole('slider', { name: translate('zh', key, params) }) as HTMLInputElement

/** 按日编辑器用来选星期：无障碍名就是 locale 的星期短名。 */
const dayButton = (label: string) => screen.getByRole('button', { name: label })

/** 当前周的某一天（0 = 周日）的一节课；日期从当前时间推导，不写死字面量。 */
function lessonOn(weekday: number, startHour: number, endHour: number): Lesson {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const monday = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - monday + ((weekday + 6) % 7))
  start.setHours(startHour, 0, 0, 0)
  const end = new Date(start)
  end.setHours(endHour, 0, 0, 0)
  return {
    id: `lesson-${weekday}-${startHour}`,
    source: 'sisu',
    title: 'Lecture',
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('settings → study block preferences', () => {
  it('shows every preference with its stored default value', () => {
    renderSettings()

    expect(Number(slider('studyBlockPrefStart').value)).toBe(DEFAULT_STUDY_BLOCK_PREFS.dayStartHour)
    expect(Number(slider('studyBlockPrefEnd').value)).toBe(DEFAULT_STUDY_BLOCK_PREFS.dayEndHour)
    expect(Number(slider('studyBlockPrefLength').value)).toBe(DEFAULT_STUDY_BLOCK_PREFS.blockMinutes)
    expect(Number(slider('studyBlockPrefBuffer').value)).toBe(DEFAULT_STUDY_BLOCK_PREFS.bufferMinutes)
    expect(Number(slider('studyBlockPrefHorizon').value)).toBe(DEFAULT_STUDY_BLOCK_PREFS.horizonDays)
    expect((screen.getByRole('checkbox', { name: translate('zh', 'studyBlockPrefSkipWeekends') }) as HTMLInputElement).checked).toBe(false)
  })

  it('persists a changed block length and asks App to refresh the plan', () => {
    const onSisuPrefsChanged = renderSettings()

    fireEvent.change(slider('studyBlockPrefLength'), { target: { value: '30' } })

    expect(loadStudyBlockPrefs().blockMinutes).toBe(30)
    expect(onSisuPrefsChanged).toHaveBeenCalledTimes(1)
    expect(Number(slider('studyBlockPrefLength').value)).toBe(30)
  })

  it('clamps a window the user squeezed below one block plus its buffer', () => {
    renderSettings()

    // 结束时间被拖到 09:00，而 08:00 起放一块 60 分钟 + 15 分钟缓冲需要到 10:00
    fireEvent.change(slider('studyBlockPrefEnd'), { target: { value: '9' } })

    expect(loadStudyBlockPrefs().dayEndHour).toBe(10)
    expect(Number(slider('studyBlockPrefEnd').value)).toBe(10)
    expect(Number(slider('studyBlockPrefStart').value)).toBe(DEFAULT_STUDY_BLOCK_PREFS.dayStartHour)
  })

  it('toggles the weekend preference', () => {
    renderSettings()
    const weekend = screen.getByRole('checkbox', { name: translate('zh', 'studyBlockPrefSkipWeekends') })

    fireEvent.click(weekend)

    expect(loadStudyBlockPrefs().skipWeekends).toBe(true)
    expect((weekend as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: translate('zh', 'studyBlockPrefSkipWeekends') }) as HTMLInputElement).checked).toBe(true)
  })

  it('exposes the reminder switch that turns the ten-minute study reminder on and off', () => {
    const onSisuPrefsChanged = renderSettings()
    const remind = screen.getByRole('checkbox', { name: translate('zh', 'studyBlockPrefRemind') }) as HTMLInputElement
    expect(remind.checked).toBe(false)

    fireEvent.click(remind)

    expect(loadStudyBlockPrefs().remindEnabled).toBe(true)
    expect((screen.getByRole('checkbox', { name: translate('zh', 'studyBlockPrefRemind') }) as HTMLInputElement).checked).toBe(true)
    expect(onSisuPrefsChanged).toHaveBeenCalledTimes(1)
    // 开关只影响提醒排期，不写任何学习块
    expect(localStorage.getItem(KEYS.studyBlocks)).toBeNull()
  })

  it('defines the reminder switch and its notification texts in Chinese and English', () => {
    for (const key of ['studyBlockPrefRemind', 'studyBlockReminderTitle', 'studyBlockReminderBody']) {
      expect(translate('zh', key)).not.toBe(key)
      expect(translate('en', key)).not.toBe(key)
    }
  })

  it('defines every preference label in Chinese and English', () => {
    const keys = [
      'studyBlockPrefsTitle', 'studyBlockPrefsHint', 'studyBlockPrefStart', 'studyBlockPrefEnd',
      'studyBlockPrefLength', 'studyBlockPrefBuffer', 'studyBlockPrefHorizon', 'studyBlockPrefSkipWeekends',
      'studyBlockPrefUnitMinutes', 'studyBlockPrefUnitDays',
      'studyBlockPrefPerDay', 'studyBlockPrefPerDayHint', 'studyBlockPrefDayStart', 'studyBlockPrefDayEnd',
      'studyBlockPrefDayOff', 'studyBlockPrefDayInherited', 'studyBlockPrefDayCustom',
      'studyBlockPrefDayReset', 'studyBlockPrefDaySkipWeekendNote',
    ]
    for (const key of keys) {
      expect(translate('zh', key)).not.toBe(key)
      expect(translate('en', key)).not.toBe(key)
    }
  })

  it('shows the selected weekday inheriting the daily window by default', () => {
    renderSettings()

    // 默认选中周一，未单独设置 → 显示继承来的 08:00–22:00，滑杆回显实际生效值
    expect(screen.getByText(translate('zh', 'studyBlockPrefDayInherited', { window: '08:00–22:00' }))).toBeTruthy()
    expect(Number(slider('studyBlockPrefDayStart', { day: '周一' }).value)).toBe(DEFAULT_STUDY_BLOCK_PREFS.dayStartHour)
    expect(Number(slider('studyBlockPrefDayEnd', { day: '周一' }).value)).toBe(DEFAULT_STUDY_BLOCK_PREFS.dayEndHour)
    expect(screen.getByTitle('周一 · 08:00–22:00')).toBeTruthy()
  })

  it('persists a single-day window and leaves other days on the daily window', () => {
    const onSisuPrefsChanged = renderSettings()

    fireEvent.click(dayButton('周三'))
    fireEvent.change(slider('studyBlockPrefDayEnd', { day: '周三' }), { target: { value: '16' } })

    // 只写周三、且只写被改动的那一侧（开始时间继续继承全局）
    expect(loadStudyBlockPrefs().dayOverrides).toEqual({ 3: { endHour: 16 } })
    expect(loadStudyBlockPrefs().dayEndHour).toBe(DEFAULT_STUDY_BLOCK_PREFS.dayEndHour)
    expect(onSisuPrefsChanged).toHaveBeenCalled()
    expect(Number(slider('studyBlockPrefDayEnd', { day: '周三' }).value)).toBe(16)
    expect(screen.getByTitle('周三 · 08:00–16:00')).toBeTruthy()

    // 周四仍然是全局窗口
    fireEvent.click(dayButton('周四'))
    expect(screen.getByText(translate('zh', 'studyBlockPrefDayInherited', { window: '08:00–22:00' }))).toBeTruthy()
  })

  it('marks a weekday as off and hides its window controls', () => {
    renderSettings()

    fireEvent.click(dayButton('周五'))
    fireEvent.click(screen.getByRole('checkbox', { name: translate('zh', 'studyBlockPrefDayOff') }))

    expect(loadStudyBlockPrefs().dayOverrides[5]).toEqual({ off: true })
    expect(screen.queryByRole('slider', { name: translate('zh', 'studyBlockPrefDayStart', { day: '周五' }) })).toBeNull()
    expect(screen.getByTitle(`周五 · ${translate('zh', 'studyBlockPrefDayOff')}`)).toBeTruthy()
  })

  it('clears a day override and falls back to the daily window', () => {
    localStorage.setItem(KEYS.studyBlockPrefs, JSON.stringify({
      ...DEFAULT_STUDY_BLOCK_PREFS,
      dayOverrides: { 3: { startHour: 12, endHour: 18 } },
    }))
    renderSettings()

    fireEvent.click(dayButton('周三'))
    expect(Number(slider('studyBlockPrefDayStart', { day: '周三' }).value)).toBe(12)
    fireEvent.click(dayButton(translate('zh', 'studyBlockPrefDayReset')))

    expect(loadStudyBlockPrefs().dayOverrides).toEqual({})
    expect(screen.getByText(translate('zh', 'studyBlockPrefDayInherited', { window: '08:00–22:00' }))).toBeTruthy()
  })

  it('keeps weekend editing shut while “skip weekends” is on', () => {
    localStorage.setItem(KEYS.studyBlockPrefs, JSON.stringify({
      ...DEFAULT_STUDY_BLOCK_PREFS,
      skipWeekends: true,
    }))
    renderSettings()

    fireEvent.click(dayButton('周六'))

    expect((screen.getByRole('checkbox', { name: translate('zh', 'studyBlockPrefDayOff') }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('slider', { name: translate('zh', 'studyBlockPrefDayStart', { day: '周六' }) })).toBeNull()
    expect(screen.getByText(translate('zh', 'studyBlockPrefDaySkipWeekendNote'))).toBeTruthy()
  })

  it('keeps the preferences inside the study group', () => {
    renderSettings()
    const group = document.getElementById('settings-study') as HTMLElement
    expect(group).toBeTruthy()
    expect(group.contains(slider('studyBlockPrefLength'))).toBe(true)
    expect(group.textContent).toContain(translate('zh', 'studyBlockPrefsTitle'))
  })
})

// 按课表推导建议窗口 + 一键采纳：预览列出的就是采纳后的每一天，未改变的日子
// 继续继承全局窗口（不写覆盖），课表塞满的日子落成「不安排」。
describe('settings → study windows derived from the timetable', () => {
  it('derives a window per weekday and adopts them in one click', () => {
    const onSisuPrefsChanged = renderSettings(vi.fn(), [lessonOn(1, 10, 12)])

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'studyBlockSuggestButton') }))

    // 周一最大空档是下课后 13:00–22:00；没课的周二沿用全局窗口
    const list = screen.getByTestId('study-window-suggestions')
    expect(list.textContent).toContain('周一')
    expect(list.textContent).toContain('13:00–22:00')
    expect(list.textContent).toContain('周二')
    expect(list.textContent).toContain('08:00–22:00')

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'studyBlockSuggestApply') }))

    expect(loadStudyBlockPrefs().dayOverrides).toEqual({ 1: { startHour: 13, endHour: 22 } })
    expect(onSisuPrefsChanged).toHaveBeenCalled()
    expect(screen.getByText(translate('zh', 'studyBlockSuggestApplied'))).toBeTruthy()
    expect(screen.queryByTestId('study-window-suggestions')).toBeNull()
    expect(screen.getByTitle('周一 · 13:00–22:00')).toBeTruthy()
  })

  it('marks a day with no free slot as off and leaves other days inherited', () => {
    renderSettings(vi.fn(), [lessonOn(2, 8, 12), lessonOn(2, 12, 16), lessonOn(2, 16, 22)])

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'studyBlockSuggestButton') }))
    expect(screen.getByTestId('study-window-suggestions').textContent).toContain(
      translate('zh', 'studyBlockSuggestNoGap'),
    )

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'studyBlockSuggestApply') }))

    expect(loadStudyBlockPrefs().dayOverrides).toEqual({ 2: { off: true } })
  })

  it('keeps the derive action disabled until a timetable is synced', () => {
    renderSettings()

    const button = screen.getByRole('button', {
      name: translate('zh', 'studyBlockSuggestButton'),
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText(translate('zh', 'studyBlockSuggestEmpty'))).toBeTruthy()
  })

  it('defines the derive texts in Chinese and English', () => {
    const keys = [
      'studyBlockSuggestButton', 'studyBlockSuggestEmpty', 'studyBlockSuggestPreviewHint',
      'studyBlockSuggestNoGap', 'studyBlockSuggestOff', 'studyBlockSuggestBusy',
      'studyBlockSuggestApply', 'studyBlockSuggestDismiss', 'studyBlockSuggestApplied',
    ]
    for (const key of keys) {
      expect(translate('zh', key)).not.toBe(key)
      expect(translate('en', key)).not.toBe(key)
    }
  })
})
