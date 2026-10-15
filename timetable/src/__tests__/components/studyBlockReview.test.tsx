// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SisuStudyPlan from '../../components/SisuStudyPlan'
import { I18nProvider, translate } from '../../i18n'
import { KEYS } from '../../lib/storage'
import { createSisuPlanItem, saveSisuStudyPlan } from '../../lib/sisuStudyPlan'
import { createTask, saveTasks } from '../../lib/tasks'
import { loadStudyBlocks } from '../../lib/studyBlocks'
import type { Lesson } from '../../types'

vi.mock('../../lib/sisuCourse', () => ({
  searchSisuPublicCatalog: vi.fn(async () => ({ courses: [], total: 0 })),
  lookupSisuCourseByCode: vi.fn(async () => null),
  normalizeSisuCode: (code: string) => code.trim().toUpperCase(),
}))
vi.mock('../../lib/sisuStudyPlanReminders', () => ({ refreshSisuPlanReminders: vi.fn(async () => {}) }))

const now = new Date(2026, 8, 14, 7)
const due = new Date(2026, 8, 15, 20).toISOString()
const sisuItem = { ...createSisuPlanItem({ kind: 'milestone', title: 'Read chapter', dueAt: due }), id: 'plan-read' }
const task = { ...createTask({ title: 'Finish worksheet', dueAt: due, course: 'CT60A' }), id: 'task-sheet' }
const lesson: Lesson = {
  id: 'class', source: 'manual', title: 'Morning lecture', start: new Date(2026, 8, 14, 8, 30).toISOString(),
  end: new Date(2026, 8, 14, 9, 30).toISOString(),
}

function renderPlan() {
  return render(<I18nProvider><SisuStudyPlan lessons={[lesson]} /></I18nProvider>)
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(now)
  saveSisuStudyPlan({ goalCredits: 180, items: [sisuItem] })
  saveTasks([task])
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})

describe('study block review UI', () => {
  it('generates conflict-free suggestions, skips only the selected suggestion and does not persist until confirmation', () => {
    renderPlan()
    expect(loadStudyBlocks()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'studyBlockGenerate') }))
    expect(screen.getByText('Finish worksheet')).toBeTruthy()
    expect(screen.getAllByText('Read chapter').length).toBeGreaterThan(0)
    expect(screen.getByText(/09:45/)).toBeTruthy()
    expect(loadStudyBlocks()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: `${translate('zh', 'studyBlockSkip')}: Finish worksheet` }))
    expect(screen.queryByText('Finish worksheet')).toBeNull()
    expect(screen.getAllByText('Read chapter').length).toBeGreaterThan(0)
    expect(loadStudyBlocks()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'studyBlockGenerate') }))
    expect(screen.getByText('Finish worksheet')).toBeTruthy()
    const sourceTasksBefore = localStorage.getItem(KEYS.tasks)
    const sourcePlanBefore = localStorage.getItem(KEYS.sisuStudyPlan)
    fireEvent.click(screen.getByRole('button', { name: `${translate('zh', 'studyBlockConfirm')}: Finish worksheet` }))
    expect(loadStudyBlocks()).toHaveLength(1)
    expect(screen.getByText(translate('zh', 'studyBlockConfirmed'))).toBeTruthy()
    expect(localStorage.getItem(KEYS.tasks)).toBe(sourceTasksBefore)
    expect(localStorage.getItem(KEYS.sisuStudyPlan)).toBe(sourcePlanBefore)
  })

  it('restores confirmed blocks after remount and deletes only the block', () => {
    const { unmount } = renderPlan()
    fireEvent.click(screen.getByRole('button', { name: translate('zh', 'studyBlockGenerate') }))
    fireEvent.click(screen.getByRole('button', { name: `${translate('zh', 'studyBlockConfirm')}: Read chapter` }))
    const beforeTasks = localStorage.getItem(KEYS.tasks)
    const beforePlan = localStorage.getItem(KEYS.sisuStudyPlan)
    unmount()
    renderPlan()
    expect(screen.getByText(translate('zh', 'studyBlockConfirmed'))).toBeTruthy()
    expect(screen.getAllByText('Read chapter').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: `${translate('zh', 'studyBlockDelete')}: Read chapter` }))
    expect(loadStudyBlocks()).toEqual([])
    expect(localStorage.getItem(KEYS.tasks)).toBe(beforeTasks)
    expect(localStorage.getItem(KEYS.sisuStudyPlan)).toBe(beforePlan)
  })

  it('defines all review labels in Chinese and English', () => {
    const keys = [
      'studyBlockGenerate', 'studyBlockRecommendations', 'studyBlockTaskSource', 'studyBlockPlanSource',
      'studyBlockDeadline', 'studyBlockUnscheduled', 'studyBlockUnscheduledEmpty', 'studyBlockConfirm',
      'studyBlockSkip', 'studyBlockConfirmed', 'studyBlockDelete', 'studyBlockWindowHint',
    ]
    for (const key of keys) {
      expect(translate('zh', key)).not.toBe(key)
      expect(translate('en', key)).not.toBe(key)
    }
  })
})
