// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SisuStudyPlan from '../../components/SisuStudyPlan'
import { I18nProvider, translate } from '../../i18n'
import { searchSisuPublicCatalog, type SisuPublicCourse } from '../../lib/sisuCourse'
import { refreshSisuPlanReminders } from '../../lib/sisuStudyPlanReminders'
import { KEYS } from '../../lib/storage'

vi.mock('../../lib/sisuCourse', () => ({ searchSisuPublicCatalog: vi.fn() }))
vi.mock('../../lib/sisuStudyPlanReminders', () => ({ refreshSisuPlanReminders: vi.fn(async () => {}) }))

const search = vi.mocked(searchSisuPublicCatalog)

function course(id: string, code: string, name: string, searchTags: string[] = ['software']): SisuPublicCourse {
  return { id, code, name, credits: 6, studyYears: [], studyFields: [], searchTags }
}

function renderPlan() {
  render(<I18nProvider><SisuStudyPlan /></I18nProvider>)
  return {
    input: screen.getByPlaceholderText(/搜索 SISU 公开课程/),
    searchButton: screen.getByRole('button', { name: '搜索 SISU' }),
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('SisuStudyPlan search UI', () => {
  it('keeps a selected SISU result available after the next search and adds it once', async () => {
    search.mockImplementation(async (term) => ({
      courses: term === 'software'
        ? [course('software-id', 'CT60A4050', 'Advanced software course')]
        : [course('systems-id', 'CT60A4100', 'Systems design')],
      total: 1,
    }))
    const { input, searchButton } = renderPlan()

    fireEvent.change(input, { target: { value: 'software' } })
    fireEvent.click(searchButton)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'CT60A4050 Advanced software course' }))

    fireEvent.change(input, { target: { value: 'systems' } })
    fireEvent.click(searchButton)
    await screen.findByRole('checkbox', { name: 'CT60A4100 Systems design' })
    expect((screen.getByRole('checkbox', { name: 'CT60A4050 Advanced software course' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'CT60A4100 Systems design' }) as HTMLInputElement).checked).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '加入本机学习计划' }))
    await waitFor(() => {
      const plan = JSON.parse(localStorage.getItem(KEYS.sisuStudyPlan) ?? '{}')
      expect(plan.items).toHaveLength(1)
      expect(plan.items[0]).toMatchObject({ courseCode: 'CT60A4050', title: 'Advanced software course' })
    })
  })

  it('persists completion and deletion commands and refreshes reminders from hook-owned plan state', async () => {
    const planItem = {
      id: 'hook-owned-item',
      kind: 'registration' as const,
      title: 'Test registration',
      dueAt: new Date(Date.now() + 2 * 86400000).toISOString(),
      completed: false,
      createdAt: new Date().toISOString(),
    }
    localStorage.setItem(KEYS.sisuStudyPlan, JSON.stringify({ goalCredits: 180, items: [planItem] }))
    renderPlan()
    const refreshReminders = vi.mocked(refreshSisuPlanReminders)
    await waitFor(() => expect(refreshReminders).toHaveBeenCalled())
    refreshReminders.mockClear()

    fireEvent.click(screen.getByRole('checkbox', { name: /Test registration/ }))
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(KEYS.sisuStudyPlan) ?? '{}').items[0].completed).toBe(true)
      expect(refreshReminders.mock.calls.at(-1)?.[0]).toMatchObject([
        { id: 'hook-owned-item', completed: true },
      ])
    })

    refreshReminders.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '删除: Test registration' }))
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(KEYS.sisuStudyPlan) ?? '{}').items).toEqual([])
      expect(refreshReminders).toHaveBeenCalledWith([], expect.objectContaining({ title: expect.any(String) }))
    })
  })

  it('shows only relevant public matches when enabled, and all server matches when disabled', async () => {
    expect(translate('zh', 'sisuPublicRelevantOnly')).toBe('仅显示软件与系统工程相关课程')
    expect(translate('en', 'sisuPublicRelevantOnly')).toBe('Show only courses relevant to software and systems engineering')
    search.mockResolvedValue({
      courses: [
        course('server-match', 'CT60A4050', 'Found by a SISU tag'),
        course('unrelated', 'ZZ901', 'General elective', ['elective']),
      ],
      total: 2,
    })
    const { input, searchButton } = renderPlan()
    fireEvent.change(input, { target: { value: 'software' } })
    fireEvent.click(searchButton)

    const relevantFilter = screen.getByRole('checkbox', { name: '仅显示软件与系统工程相关课程' })
    expect((relevantFilter as HTMLInputElement).checked).toBe(true)
    expect(await screen.findByRole('checkbox', { name: 'CT60A4050 Found by a SISU tag' })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'ZZ901 General elective' })).toBeNull()

    fireEvent.click(relevantFilter)
    expect((relevantFilter as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('checkbox', { name: 'CT60A4050 Found by a SISU tag' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'ZZ901 General elective' })).toBeTruthy()
  })

  it('restores selected SISU results after reload without restoring unselected results', async () => {
    search.mockResolvedValue({
      courses: [
        course('selected-id', 'CT60A4160', 'Fundamentals of Software Testing'),
        course('unselected-id', 'CT60A4050', 'Fundamentals of Software Engineering'),
      ],
      total: 2,
    })
    const { input, searchButton } = renderPlan()
    fireEvent.change(input, { target: { value: 'software' } })
    fireEvent.click(searchButton)

    fireEvent.click(await screen.findByRole('checkbox', { name: 'CT60A4160 Fundamentals of Software Testing' }))
    expect(localStorage.getItem(KEYS.sisuCoursePreferences)).toContain('selected-id')
    expect(localStorage.getItem(KEYS.sisuCoursePreferences)).not.toContain('unselected-id')

    cleanup()
    render(<I18nProvider><SisuStudyPlan /></I18nProvider>)
    expect(screen.getByRole('checkbox', { name: 'CT60A4160 Fundamentals of Software Testing' })).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: 'CT60A4160 Fundamentals of Software Testing' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('checkbox', { name: 'CT60A4050 Fundamentals of Software Engineering' })).toBeNull()
    expect(screen.getByText(/已选候选课程：1 门 · 6 学分/)).toBeTruthy()
  })

  it('ignores an older search response after a newer query completes', async () => {
    let resolveOld!: (value: { courses: SisuPublicCourse[]; total: number }) => void
    let resolveNew!: (value: { courses: SisuPublicCourse[]; total: number }) => void
    search.mockImplementation((term) => new Promise((resolve) => {
      if (term === 'software') resolveOld = resolve
      else resolveNew = resolve
    }))
    const { input, searchButton } = renderPlan()

    fireEvent.change(input, { target: { value: 'software' } })
    fireEvent.click(searchButton)
    fireEvent.change(input, { target: { value: 'systems' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(resolveNew).toBeTypeOf('function'))

    resolveNew({ courses: [course('new', 'CT60A4100', 'Systems design')], total: 1 })
    expect(await screen.findByRole('checkbox', { name: 'CT60A4100 Systems design' })).toBeTruthy()
    resolveOld({ courses: [course('old', 'CT60A4050', 'Stale software result')], total: 1 })
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'CT60A4050 Stale software result' })).toBeNull())
    expect(screen.getByText(/查询“systems”返回/)).toBeTruthy()
  })
})
