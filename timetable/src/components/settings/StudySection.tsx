import { useState } from 'react'
import { useI18n } from '../../i18n'
import { loadSisuStudyPlan, saveSisuStudyPlan } from '../../lib/sisuStudyPlan'
import {
  suggestStudyWindows,
  suggestionsToOverrides,
  type StudyWindowSuggestion,
} from '../../lib/studyWindowSuggestions'
import type { Lesson } from '../../types'
import {
  STUDY_BLOCK_LIMITS,
  STUDY_BLOCK_WEEKDAYS,
  loadStudyBlockPrefs,
  saveStudyBlockPrefs,
  studyDayWindow,
  withStudyDayOverride,
  type StudyBlockPrefs,
  type StudyBlockWeekday,
  type StudyDayOverride,
} from '../../lib/studyBlockPrefs'
import { hourLabel } from './tokens'
import { PrefSlider, SectionTitle } from './shared'

/**
 * 已知的周一（2026-01-05）：星期名一律借 locale 输出，不自己维护星期名表
 * （与计划页的冲突时间标签同一做法）。
 */
const WEEKDAY_REFERENCE = new Date(2026, 0, 5)

function weekdayLabel(weekday: StudyBlockWeekday, locale: string): string {
  const day = new Date(WEEKDAY_REFERENCE)
  day.setDate(day.getDate() + ((weekday + 6) % 7))
  return day.toLocaleDateString(locale, { weekday: 'short' })
}

/**
 * 学习偏好：计划目标学分 + 学习时段（窗口、粒度、缓冲、范围、按星期几、提醒）。
 *
 * 这些偏好跨界面生效，所以**唯一编辑入口**在这里：保存即落盘，并通过回调
 * 通知 App 重挂载计划页（重挂载 = 重新读存储，不需要 App 镜像这些值）。
 */
export default function StudySection({
  lessons = [],
  onSisuPrefsChanged,
  onStudyBlockPrefsChanged,
}: {
  /** 已同步的可见课表：只用于「按课表推导」建议窗口，不写回课表。 */
  lessons?: Lesson[]
  onSisuPrefsChanged?: () => void
  onStudyBlockPrefsChanged?: (prefs: StudyBlockPrefs) => void
}) {
  const { t, locale } = useI18n()
  const [sisuPlan, setSisuPlan] = useState(loadSisuStudyPlan)
  /** 学习时段偏好：保存即通知 App，计划页按新窗口重算待确认建议。 */
  const [studyPrefs, setStudyPrefs] = useState(loadStudyBlockPrefs)
  /** 按日编辑器当前选中的星期：固定默认周一（跟「今天」走会让测试与截图随日期漂移）。 */
  const [studyDay, setStudyDay] = useState<StudyBlockWeekday>(1)
  /** 「按课表推导」的预览；`null` = 收起。任何偏好改动都会让它作废。 */
  const [suggestion, setSuggestion] = useState<{
    rows: StudyWindowSuggestion[]
    overrides: ReturnType<typeof suggestionsToOverrides>
  } | null>(null)
  const [suggestionApplied, setSuggestionApplied] = useState(false)

  /** 空串/0（用户清空输入框）不写回：saveSisuStudyPlan 会把 <=0 夹回默认值，
   *  否则一按退格就被弹回 180，没法全选删空再输新值。blur 时再兜底夹一次。 */
  const changeSisuGoal = (raw: string) => {
    const next = Number(raw)
    if (!Number.isFinite(next) || next <= 0) return
    setSisuPlan(saveSisuStudyPlan({ ...sisuPlan, goalCredits: next }))
    onSisuPrefsChanged?.()
  }

  const commitStudyPrefs = (patch: Partial<StudyBlockPrefs>) => {
    const next = saveStudyBlockPrefs(patch)
    setStudyPrefs(next)
    onSisuPrefsChanged?.()
    onStudyBlockPrefsChanged?.(next)
    // 预览里的数字来自推导时的偏好；偏好一改就作废，避免「看着 08:00–10:00 却采纳了旧值」
    setSuggestion(null)
    setSuggestionApplied(false)
  }

  const deriveStudyWindows = () => {
    const rows = suggestStudyWindows(lessons, studyPrefs)
    setSuggestion({ rows, overrides: suggestionsToOverrides(rows, studyPrefs) })
    setSuggestionApplied(false)
  }

  /** 一键采纳：整份替换按日覆盖（预览里列出的就是采纳后的每一天）。 */
  const applySuggestion = () => {
    if (!suggestion) return
    const next = saveStudyBlockPrefs({ dayOverrides: suggestion.overrides })
    setStudyPrefs(next)
    onSisuPrefsChanged?.()
    onStudyBlockPrefsChanged?.(next)
    setSuggestion(null)
    setSuggestionApplied(true)
  }

  const changeStudyPrefs = (patch: Partial<StudyBlockPrefs>) => commitStudyPrefs(patch)

  /** 改选中那一天：与已存的覆盖合并（不传的字段继续继承全局窗口）。 */
  const changeStudyDay = (patch: StudyDayOverride) => {
    const current = studyPrefs.dayOverrides[studyDay] ?? {}
    const merged: StudyDayOverride = { ...current, ...patch }
    commitStudyPrefs({ dayOverrides: withStudyDayOverride(studyPrefs, studyDay, merged).dayOverrides })
  }

  const resetStudyDay = () => {
    commitStudyPrefs({ dayOverrides: withStudyDayOverride(studyPrefs, studyDay, null).dayOverrides })
  }

  const minutesLabel = (n: number) => `${n} ${t('studyBlockPrefUnitMinutes')}`

  const dayLabel = weekdayLabel(studyDay, locale)
  const dayOverride = studyPrefs.dayOverrides[studyDay]
  const dayWindow = studyDayWindow(studyPrefs, studyDay)
  const dayOff = dayOverride?.off === true
  const dayCustom = dayOverride !== undefined
  const dayWeekendSkipped = studyPrefs.skipWeekends && (studyDay === 0 || studyDay === 6)
  const windowText = (window: { startHour: number; endHour: number } | null) =>
    window ? `${hourLabel(window.startHour)}–${hourLabel(window.endHour)}` : t('studyBlockPrefDayOff')
  /** 「不安排」与周末禁排时不重复报一次状态：「这天不安排」复选框 / 说明已经说清楚了。 */
  const dayStatus = dayWindow
    ? dayCustom
      ? t('studyBlockPrefDayCustom', { window: windowText(dayWindow) })
      : t('studyBlockPrefDayInherited', { window: windowText(dayWindow) })
    : null

  return (
    <>
      <section>
        <p className="text-[10px] leading-relaxed text-[var(--text-3)]">{t('sisuPrefsHint')}</p>
        <label className="mt-1 flex items-center gap-2 text-[11px] text-[var(--text-2)]">
          {t('sisuPlanGoal')}
          <input
            type="number"
            min="1"
            value={sisuPlan.goalCredits}
            onChange={(e) => changeSisuGoal(e.target.value)}
            onBlur={(e) => changeSisuGoal(e.target.value)}
            className="app-input w-20 px-1 py-0.5 text-right text-xs"
          />
        </label>
      </section>

      {/* 学习时段偏好：只影响「生成学习时段建议」，不动已确认的时段 */}
      <section>
        <SectionTitle>{t('studyBlockPrefsTitle')}</SectionTitle>
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-3)]">
          {t('studyBlockPrefsHint')}
        </p>
        <PrefSlider
          label={t('studyBlockPrefStart')}
          value={studyPrefs.dayStartHour}
          min={STUDY_BLOCK_LIMITS.dayStartHour.min}
          max={STUDY_BLOCK_LIMITS.dayStartHour.max}
          step={1}
          display={hourLabel(studyPrefs.dayStartHour)}
          onChange={(dayStartHour) => changeStudyPrefs({ dayStartHour })}
        />
        <PrefSlider
          label={t('studyBlockPrefEnd')}
          value={studyPrefs.dayEndHour}
          min={STUDY_BLOCK_LIMITS.dayEndHour.min}
          max={STUDY_BLOCK_LIMITS.dayEndHour.max}
          step={1}
          display={hourLabel(studyPrefs.dayEndHour)}
          onChange={(dayEndHour) => changeStudyPrefs({ dayEndHour })}
        />
        <PrefSlider
          label={t('studyBlockPrefLength')}
          value={studyPrefs.blockMinutes}
          min={STUDY_BLOCK_LIMITS.blockMinutes.min}
          max={STUDY_BLOCK_LIMITS.blockMinutes.max}
          step={STUDY_BLOCK_LIMITS.blockMinutes.step}
          display={minutesLabel(studyPrefs.blockMinutes)}
          onChange={(blockMinutes) => changeStudyPrefs({ blockMinutes })}
        />
        <PrefSlider
          label={t('studyBlockPrefBuffer')}
          value={studyPrefs.bufferMinutes}
          min={STUDY_BLOCK_LIMITS.bufferMinutes.min}
          max={STUDY_BLOCK_LIMITS.bufferMinutes.max}
          step={STUDY_BLOCK_LIMITS.bufferMinutes.step}
          display={minutesLabel(studyPrefs.bufferMinutes)}
          onChange={(bufferMinutes) => changeStudyPrefs({ bufferMinutes })}
        />
        <PrefSlider
          label={t('studyBlockPrefHorizon')}
          value={studyPrefs.horizonDays}
          min={STUDY_BLOCK_LIMITS.horizonDays.min}
          max={STUDY_BLOCK_LIMITS.horizonDays.max}
          step={1}
          display={`${studyPrefs.horizonDays} ${t('studyBlockPrefUnitDays')}`}
          onChange={(horizonDays) => changeStudyPrefs({ horizonDays })}
        />
        <label className="mt-2 flex items-center gap-2 text-[11px] text-[var(--text-2)]">
          <input
            type="checkbox"
            aria-label={t('studyBlockPrefSkipWeekends')}
            checked={studyPrefs.skipWeekends}
            onChange={(e) => changeStudyPrefs({ skipWeekends: e.target.checked })}
            className="accent-[var(--accent)]"
          />
          {t('studyBlockPrefSkipWeekends')}
        </label>
        <label className="mt-1 flex items-center gap-2 text-[11px] text-[var(--text-2)]">
          <input
            type="checkbox"
            aria-label={t('studyBlockPrefRemind')}
            checked={studyPrefs.remindEnabled}
            onChange={(e) => changeStudyPrefs({ remindEnabled: e.target.checked })}
            className="accent-[var(--accent)]"
          />
          {t('studyBlockPrefRemind')}
        </label>
      </section>

      {/* 按星期几调整：单日窗口覆盖上面的每日窗口；「不安排」= 该日不生成建议。
          只渲染选中那一天的滑杆（7 天 × 2 条全铺开会让这一屏失去可读性），
          未单独设置的日子在按钮 title 里显示实际生效的窗口。 */}
      <section>
        <SectionTitle>{t('studyBlockPrefPerDay')}</SectionTitle>
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-3)]">
          {t('studyBlockPrefPerDayHint')}
        </p>
        <button
          type="button"
          onClick={deriveStudyWindows}
          disabled={lessons.length === 0}
          className="app-btn mt-2 w-full px-2.5 py-1.5 text-[11px] disabled:opacity-50"
        >
          {t('studyBlockSuggestButton')}
        </button>
        {lessons.length === 0 && (
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-3)]">
            {t('studyBlockSuggestEmpty')}
          </p>
        )}
        {suggestion && (
          <div className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
            <p className="text-[10px] leading-relaxed text-[var(--text-3)]">
              {t('studyBlockSuggestPreviewHint')}
            </p>
            <ul className="mt-1.5 space-y-1" data-testid="study-window-suggestions">
              {suggestion.rows.map((row) => (
                <li key={row.weekday} className="flex items-center gap-2 text-[11px]">
                  <span className="w-9 shrink-0 text-[var(--text-3)]">
                    {weekdayLabel(row.weekday, locale)}
                  </span>
                  <span className="min-w-0 flex-1 tabular-nums text-[var(--text-2)]">
                    {row.reason === 'no-gap'
                      ? t('studyBlockSuggestNoGap')
                      : row.reason === 'off'
                        ? t('studyBlockSuggestOff')
                        : windowText(row.window)}
                  </span>
                  {row.busyBlocks > 0 && (
                    <span className="shrink-0 text-[10px] text-[var(--text-3)]">
                      {t('studyBlockSuggestBusy', { n: row.busyBlocks })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={applySuggestion}
                className="app-btn-primary px-2.5 py-1 text-[11px]"
              >
                {t('studyBlockSuggestApply')}
              </button>
              <button
                type="button"
                onClick={() => setSuggestion(null)}
                className="app-btn px-2.5 py-1 text-[11px]"
              >
                {t('studyBlockSuggestDismiss')}
              </button>
            </div>
          </div>
        )}
        {suggestionApplied && (
          <p className="mt-1.5 text-[11px] text-[var(--text-2)]">{t('studyBlockSuggestApplied')}</p>
        )}
        <div className="app-seg mt-2 w-full" role="group" aria-label={t('studyBlockPrefPerDay')}>
          {STUDY_BLOCK_WEEKDAYS.map((weekday) => {
            const label = weekdayLabel(weekday, locale)
            return (
              <button
                key={weekday}
                type="button"
                aria-pressed={studyDay === weekday}
                onClick={() => setStudyDay(weekday)}
                className="min-w-0 flex-1 whitespace-nowrap px-0.5 py-1 text-[10px] leading-none"
                title={`${label} · ${windowText(studyDayWindow(studyPrefs, weekday))}`}
              >
                {label}
                {studyPrefs.dayOverrides[weekday] ? <span aria-hidden="true">·</span> : null}
              </button>
            )
          })}
        </div>
        {dayStatus && <p className="mt-1.5 text-[11px] text-[var(--text-2)]">{dayStatus}</p>}
        <label className="mt-1 flex items-center gap-2 text-[11px] text-[var(--text-2)]">
          <input
            type="checkbox"
            aria-label={t('studyBlockPrefDayOff')}
            checked={dayOff}
            disabled={dayWeekendSkipped}
            onChange={(e) => changeStudyDay({ off: e.target.checked })}
            className="accent-[var(--accent)]"
          />
          {t('studyBlockPrefDayOff')}
        </label>
        {dayWeekendSkipped && (
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-3)]">
            {t('studyBlockPrefDaySkipWeekendNote')}
          </p>
        )}
        {!dayOff && !dayWeekendSkipped && (
          <>
            <PrefSlider
              label={t('studyBlockPrefDayStart', { day: dayLabel })}
              value={dayWindow?.startHour ?? studyPrefs.dayStartHour}
              min={STUDY_BLOCK_LIMITS.dayStartHour.min}
              max={STUDY_BLOCK_LIMITS.dayStartHour.max}
              step={1}
              display={hourLabel(dayWindow?.startHour ?? studyPrefs.dayStartHour)}
              onChange={(startHour) => changeStudyDay({ startHour })}
            />
            <PrefSlider
              label={t('studyBlockPrefDayEnd', { day: dayLabel })}
              value={dayWindow?.endHour ?? studyPrefs.dayEndHour}
              min={STUDY_BLOCK_LIMITS.dayEndHour.min}
              max={STUDY_BLOCK_LIMITS.dayEndHour.max}
              step={1}
              display={hourLabel(dayWindow?.endHour ?? studyPrefs.dayEndHour)}
              onChange={(endHour) => changeStudyDay({ endHour })}
            />
          </>
        )}
        {dayCustom && (
          <button
            type="button"
            onClick={resetStudyDay}
            className="mt-2 text-[11px] text-[var(--text-3)] underline decoration-dotted underline-offset-2 hover:text-[var(--text-1)]"
          >
            {t('studyBlockPrefDayReset')}
          </button>
        )}
      </section>
    </>
  )
}
