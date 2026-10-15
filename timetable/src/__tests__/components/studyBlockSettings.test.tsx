// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Settings from '../../components/Settings'
import { I18nProvider, translate } from '../../i18n'
import { MoodleProvider } from '../../hooks/useMoodleData'
import { ThemeProvider } from '../../theme'
import { KEYS } from '../../lib/storage'
import { DEFAULT_STUDY_BLOCK_PREFS, loadStudyBlockPrefs } from '../../lib/studyBlockPrefs'

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

function renderSettings(onSisuPrefsChanged = vi.fn()) {
  render(
    <I18nProvider>
      <ThemeProvider>
        <MoodleProvider tasks={[]} lessons={[]} onTasks={() => {}}>
          <Settings {...baseProps} onSisuPrefsChanged={onSisuPrefsChanged} />
        </MoodleProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
  return onSisuPrefsChanged
}

const slider = (key: string) => screen.getByRole('slider', { name: translate('zh', key) }) as HTMLInputElement

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
    ]
    for (const key of keys) {
      expect(translate('zh', key)).not.toBe(key)
      expect(translate('en', key)).not.toBe(key)
    }
  })

  it('keeps the preferences inside the study group', () => {
    renderSettings()
    const group = document.getElementById('settings-study') as HTMLElement
    expect(group).toBeTruthy()
    expect(group.contains(slider('studyBlockPrefLength'))).toBe(true)
    expect(group.textContent).toContain(translate('zh', 'studyBlockPrefsTitle'))
  })
})
