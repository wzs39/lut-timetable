// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SisuStudyPlan from '../../components/SisuStudyPlan'
import { I18nProvider, translate } from '../../i18n'
import { KEYS } from '../../lib/storage'
import { confirmStudyBlock, loadStudyBlocks } from '../../lib/studyBlocks'
import { createTask, saveTasks } from '../../lib/tasks'
import { createSisuPlanItem, saveSisuStudyPlan } from '../../lib/sisuStudyPlan'
import type { Lesson } from '../../types'

/**
 * 【概览契约】本周负荷是只读汇总：
 * - 数字只来自**已确认**学习块（生成未确认建议不得改变任何数字）
 * - 完成勾选写在学习块自己身上（来源任务 / SISU 计划项必须逐字节不变）
 */

vi.mock('../../lib/sisuCourse', () => ({
  searchSisuPublicCatalog: vi.fn(async () => ({ courses: [], total: 0 })),
  lookupSisuCourseByCode: vi.fn(async () => null),
  normalizeSisuCode: (code: string) => code.trim().toUpperCase(),
}))
vi.mock('../../lib/sisuStudyPlanReminders', () => ({ refreshSisuPlanReminders: vi.fn(async () => {}) }))

const now = new Date(2026, 8, 14, 7) // 周一早上：本周 = 9/14–9/20
const lessons: Lesson[] = []

/** 本周二 09:00 起、时长可控的已确认块（绕开排程器，直接落 DB 保证确定性）。 */
function seedBlock(title: string, minutes = 60) {
  const start = new Date(2026, 8, 15, 9, 0, 0, 0)
  const end = new Date(start.getTime() + minutes * 60_000)
  const due = new Date(2026, 8, 15, 20, 0, 0, 0)
  return confirmStudyBlock({
    sourceKind: 'task',
    sourceId: `seed-${title}`,
    title,
    dueAt: due.toISOString(),
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  })
}

function renderPlan() {
  return render(<I18nProvider><SisuStudyPlan lessons={lessons} /></I18nProvider>)
}

/** 概览就绪的那两行，供「生成前后不变」比对。 */
function loadLines() {
  return [
    translate('zh', 'studyLoadBlocks', { total: 1, done: 0 }),
    translate('zh', 'studyLoadMinutes', { minutes: 60, done: 0 }),
  ].map((expected) => screen.getAllByText(expected).length)
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(now)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})

describe('weekly load overview', () => {
  it('summarises the confirmed blocks of the current week', () => {
    seedBlock('Alpha')
    renderPlan()

    expect(screen.getByText(translate('zh', 'studyLoadTitle'))).toBeTruthy()
    expect(screen.getByText(translate('zh', 'studyLoadBlocks', { total: 1, done: 0 }))).toBeTruthy()
    expect(screen.getByText(translate('zh', 'studyLoadMinutes', { minutes: 60, done: 0 }))).toBeTruthy()
    // 7 个本地日格子，每格带标题（含块数与分钟）
    expect(screen.getByTitle(translate('zh', 'studyLoadDayTitle', { day: '2026-09-15', total: 1, minutes: 60 }))).toBeTruthy()
    expect(screen.getByTitle(translate('zh', 'studyLoadDayTitle', { day: '2026-09-16', total: 0, minutes: 0 }))).toBeTruthy()
  })

  it('shows an empty-state line and keeps a zeroed summary when nothing is confirmed', () => {
    renderPlan()
    expect(screen.getByText(translate('zh', 'studyLoadEmpty'))).toBeTruthy()
    expect(screen.queryByText(translate('zh', 'studyLoadBlocks', { total: 0, done: 0 }))).toBeNull()
  })

  it('does not move a single number when unconfirmed suggestions are generated', () => {
    seedBlock('Alpha')
    saveTasks([{ ...createTask({ title: 'Finish worksheet', dueAt: new Date(2026, 8, 15, 20).toISOString(), course: 'CT60A' }), id: 'task-sheet' }])
    saveSisuStudyPlan({
      goalCredits: 180,
      items: [{ ...createSisuPlanItem({ kind: 'milestone', title: 'Read chapter', dueAt: new Date(2026, 8, 15, 20).toISOString() }), id: 'plan-read' }],
    })
    const tasksBefore = localStorage.getItem(KEYS.tasks)
    const planBefore = localStorage.getItem(KEYS.sisuStudyPlan)
    renderPlan()
    const before = loadLines()

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'studyBlockGenerate') }))

    // 建议真的出来了（否则这条用例什么都没证明）
    expect(screen.getByText('Finish worksheet')).toBeTruthy()
    expect(loadLines()).toEqual(before)
    expect(loadStudyBlocks()).toHaveLength(1)
    expect(localStorage.getItem(KEYS.tasks)).toBe(tasksBefore)
    expect(localStorage.getItem(KEYS.sisuStudyPlan)).toBe(planBefore)
  })

  it('writes completion onto the block itself and the overview follows', () => {
    const block = seedBlock('Alpha')
    saveTasks([{ ...createTask({ title: 'Finish worksheet', dueAt: new Date(2026, 8, 15, 20).toISOString() }), id: 'task-sheet' }])
    const tasksBefore = localStorage.getItem(KEYS.tasks)
    renderPlan()

    fireEvent.click(screen.getByRole('checkbox', { name: translate('zh', 'studyBlockMarkDone', { title: 'Alpha' }) }))

    expect(loadStudyBlocks()[0]).toMatchObject({ id: block.id, completed: true })
    expect(screen.getByText(translate('zh', 'studyLoadBlocks', { total: 1, done: 1 }))).toBeTruthy()
    expect(screen.getByText(translate('zh', 'studyLoadMinutes', { minutes: 60, done: 60 }))).toBeTruthy()
    expect(localStorage.getItem(KEYS.tasks)).toBe(tasksBefore)
  })

  it('defines every overview label in Chinese and English', () => {
    for (const key of ['studyLoadTitle', 'studyLoadBlocks', 'studyLoadMinutes', 'studyLoadOverdue', 'studyLoadEmpty', 'studyLoadDayTitle', 'studyBlockMarkDone']) {
      expect(translate('zh', key)).not.toBe(key)
      expect(translate('en', key)).not.toBe(key)
    }
  })
})
