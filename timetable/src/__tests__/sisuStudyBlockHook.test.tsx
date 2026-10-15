// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import { useSisuStudyPlan } from '../hooks/useSisuStudyPlan'
import { KEYS } from '../lib/storage'
import { createSisuPlanItem, saveSisuStudyPlan } from '../lib/sisuStudyPlan'
import { createTask, saveTasks } from '../lib/tasks'
import { loadStudyBlocks } from '../lib/studyBlocks'
import type { Lesson } from '../types'

vi.mock('../lib/sisuCourse', () => ({
  searchSisuPublicCatalog: vi.fn(async () => ({ courses: [], total: 0 })),
  lookupSisuCourseByCode: vi.fn(async () => null),
  normalizeSisuCode: (code: string) => code.trim().toUpperCase(),
}))
vi.mock('../lib/sisuStudyPlanReminders', () => ({ refreshSisuPlanReminders: vi.fn(async () => {}) }))

const now = new Date(2026, 8, 14, 7)
const wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>
const due = new Date(2026, 8, 15, 20).toISOString()

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

describe('useSisuStudyPlan study block orchestration', () => {
  it('aggregates eligible tasks and SISU items, isolates equal ids, and supports generate/skip/confirm/delete/remount', () => {
    const sisuItem = { ...createSisuPlanItem({ kind: 'milestone', title: 'Read chapter', dueAt: due }), id: 'shared-id' }
    saveSisuStudyPlan({ goalCredits: 180, items: [sisuItem, { ...sisuItem, id: 'done', completed: true }, { ...sisuItem, id: 'no-date', dueAt: undefined }] })
    const task = { ...createTask({ title: 'Finish worksheet', dueAt: due, course: 'CT60A' }), id: 'shared-id' }
    const completed = { ...createTask({ title: 'Already done', dueAt: due }), id: 'done-task', completed: true }
    const noDue = { ...createTask({ title: 'No due date' }), id: 'no-date-task' }
    saveTasks([task, completed, noDue])
    localStorage.setItem('unchanged-marker', JSON.stringify({ value: 1 }))
    const lessons: Lesson[] = []
    const { result, unmount } = renderHook(() => useSisuStudyPlan(lessons, []), { wrapper })

    expect(result.current.studyBlocks).toEqual([])
    expect(loadStudyBlocks()).toEqual([])
    act(() => result.current.generateStudyBlockRecommendations())
    expect(result.current.studyBlockRecommendations.map((item) => [item.sourceKind, item.sourceId])).toEqual([
      ['task', 'shared-id'], ['sisu-plan', 'shared-id'],
    ])
    expect(loadStudyBlocks()).toEqual([])

    act(() => result.current.skipStudyBlockRecommendation('task', 'shared-id'))
    expect(result.current.studyBlockRecommendations.map((item) => item.sourceKind)).toEqual(['sisu-plan'])
    act(() => result.current.generateStudyBlockRecommendations())
    expect(result.current.studyBlockRecommendations).toHaveLength(2)
    act(() => result.current.confirmStudyBlockRecommendation(result.current.studyBlockRecommendations[0]))
    expect(loadStudyBlocks()).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(KEYS.tasks) ?? '[]')).toEqual([task, completed, noDue])
    expect(JSON.parse(localStorage.getItem(KEYS.sisuStudyPlan) ?? '{}').items).toEqual([sisuItem, { ...sisuItem, id: 'done', completed: true }, { ...sisuItem, id: 'no-date', dueAt: undefined }])
    expect(localStorage.getItem('unchanged-marker')).toBe(JSON.stringify({ value: 1 }))

    unmount()
    const remounted = renderHook(() => useSisuStudyPlan(lessons, []), { wrapper })
    expect(remounted.result.current.studyBlocks).toHaveLength(1)
    const blockId = remounted.result.current.studyBlocks[0].id
    act(() => remounted.result.current.deleteStudyBlock(blockId))
    expect(loadStudyBlocks()).toEqual([])
    remounted.unmount()
  })

  it('confirms every pending suggestion at once and keeps sources byte-identical', () => {
    const sisuItem = { ...createSisuPlanItem({ kind: 'milestone', title: 'Read chapter', dueAt: due }), id: 'shared-id' }
    saveSisuStudyPlan({ goalCredits: 180, items: [sisuItem] })
    const task = { ...createTask({ title: 'Finish worksheet', dueAt: due, course: 'CT60A' }), id: 'shared-id' }
    saveTasks([task])
    const tasksBefore = localStorage.getItem(KEYS.tasks)
    const planBefore = localStorage.getItem(KEYS.sisuStudyPlan)
    const { result, unmount } = renderHook(() => useSisuStudyPlan([], []), { wrapper })

    act(() => result.current.generateStudyBlockRecommendations())
    expect(result.current.studyBlockRecommendations).toHaveLength(2)
    act(() => result.current.confirmAllStudyBlockRecommendations())
    expect(result.current.studyBlockRecommendations).toEqual([])
    expect(result.current.unscheduledStudyItems).toEqual([])
    // 跨源同 ID 各自成块：批量确认不做任何去重合并。
    expect(loadStudyBlocks().map((block) => [block.sourceKind, block.sourceId])).toEqual([
      ['task', 'shared-id'], ['sisu-plan', 'shared-id'],
    ])
    expect(localStorage.getItem(KEYS.tasks)).toBe(tasksBefore)
    expect(localStorage.getItem(KEYS.sisuStudyPlan)).toBe(planBefore)

    unmount()
    const remounted = renderHook(() => useSisuStudyPlan([], []), { wrapper })
    expect(remounted.result.current.studyBlocks).toHaveLength(2)
    act(() => remounted.result.current.generateStudyBlockRecommendations())
    expect(remounted.result.current.studyBlockRecommendations).toEqual([])
    expect(remounted.result.current.studyBlocks).toHaveLength(2)
    remounted.unmount()
  })
})
