// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SisuStudyPlan from '../../components/SisuStudyPlan'
import { I18nProvider } from '../../i18n'
import { searchSisuPublicCatalog, type SisuPublicCourse } from '../../lib/sisuCourse'
import { refreshSisuPlanReminders } from '../../lib/sisuStudyPlanReminders'
import { KEYS } from '../../lib/storage'

vi.mock('../../lib/sisuCourse', () => ({
  searchSisuPublicCatalog: vi.fn(),
  lookupSisuCourseByCode: vi.fn(async () => null),
  normalizeSisuCode: (code: string) => code.trim().toUpperCase().replace(/-\d{4}$/, ''),
}))
vi.mock('../../lib/sisuStudyPlanReminders', () => ({ refreshSisuPlanReminders: vi.fn(async () => {}) }))

const search = vi.mocked(searchSisuPublicCatalog)

function course(id: string, code: string, name: string): SisuPublicCourse {
  return { id, code, name, credits: 6, studyYears: [], studyFields: [], searchTags: [] }
}

function emptyPlan() {
  localStorage.setItem(KEYS.sisuStudyPlan, JSON.stringify({ goalCredits: 180, items: [] }))
}

function seedPlan() {
  localStorage.setItem(KEYS.sisuStudyPlan, JSON.stringify({
    goalCredits: 180,
    items: [
      {
        id: 'a', kind: 'course', title: 'Mathematics A', courseCode: 'BM20A9200', credits: 6,
        category: 'general', studyYear: '2026-2027', periods: [1, 2], completed: false,
        createdAt: '2026-08-20T00:00:00.000Z', timingSource: 'pdf-plan',
      },
      {
        id: 'b', kind: 'course', title: 'Statistics', courseCode: 'BM20A9301', credits: 3,
        category: 'general', studyYear: '2026-2027', periods: [3], completed: false,
        createdAt: '2026-08-20T00:00:00.000Z', timingSource: 'pdf-plan',
      },
      {
        id: 'c', kind: 'course', title: 'Thesis', courseCode: 'CT10A5000', credits: 12,
        category: 'intermediate', studyYear: '2028-2029', periods: [1, 2], completed: false,
        createdAt: '2026-08-20T00:00:00.000Z', timingSource: 'pdf-plan',
      },
    ],
  }))
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
  emptyPlan()
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
    // Completed items leave the default "unfinished" filter; switch to all before deleting.
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    fireEvent.click(screen.getByRole('button', { name: '删除: Test registration' }))
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(KEYS.sisuStudyPlan) ?? '{}').items).toEqual([])
      expect(refreshReminders).toHaveBeenCalledWith([], expect.objectContaining({ title: expect.any(String) }))
    })
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

  it('renders the overview, scenario controls and term grid from the pure scenario', () => {
    seedPlan()
    renderPlan()

    expect(screen.getByRole('heading', { name: '学业概览' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '毕业情景' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '学期时间地图' })).toBeTruthy()
    expect(screen.getByText(/个人学习计划 20\.08\.2026 · 计划共 21 学分/)).toBeTruthy()
    // 3 年目标把 2028–29 的论文压进最后一年
    expect(screen.getByRole('button', { name: '3 年毕业' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: '2 年毕业' }))
    expect(JSON.parse(localStorage.getItem(KEYS.sisuScenario) ?? '{}').targetYears).toBe(2)
    expect(screen.getByRole('button', { name: '2 年毕业' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByText('CT10A5000').length).toBeGreaterThan(0)
  })

  it('compares 2/3/4 year targets in one read-only card and never writes the plan', () => {
    seedPlan()
    renderPlan()

    expect(screen.getByRole('heading', { name: '毕业年限对比' })).toBeTruthy()
    const before = localStorage.getItem(KEYS.sisuStudyPlan)
    // 三行各自一个年限标签；当前目标（默认 3 年）带 aria-current
    for (const years of ['2 年', '3 年', '4 年']) expect(screen.getByText(years)).toBeTruthy()
    const marked = () => [...document.querySelectorAll('li[aria-current="true"]')].map((li) => li.textContent)
    expect(marked()).toHaveLength(1)
    expect(marked()[0]).toContain('3 年')
    expect(screen.getByText(/最短可行年限：|2–4 年内都排不完/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '4 年毕业' }))
    expect(marked()[0]).toContain('4 年')
    // 对比只是投影：计划本体逐字节不变，只有偏好键变了
    expect(localStorage.getItem(KEYS.sisuStudyPlan)).toBe(before)
    expect(JSON.parse(localStorage.getItem(KEYS.sisuScenario) ?? '{}').targetYears).toBe(4)
  })

  it('lays the page out as a dashboard: KPI tiles, a nested two-column main area, collapsible catalogue', () => {
    seedPlan()
    renderPlan()

    // 仪表盘：学分环（aria 带百分比）+ 毕业 + 风险三块同属一个网格
    const ring = screen.getByRole('img', { name: /已完成/ })
    const tiles = ring.closest('div.grid')
    expect(tiles).toBeTruthy()
    expect(tiles!.contains(screen.getByText('预计毕业'))).toBe(true)
    expect(tiles!.contains(screen.getByText('负荷与风险'))).toBe(true)

    // 学期地图与情景/对比/提醒在同一个两栏网格里，而不是各自一条长列表
    const main = screen.getByRole('heading', { name: '学期时间地图' }).closest('div.grid')
    expect(main).toBeTruthy()
    expect(main!.contains(screen.getByRole('heading', { name: '毕业情景' }))).toBe(true)
    expect(main!.contains(screen.getByRole('heading', { name: '毕业年限对比' }))).toBe(true)
    expect(main!.contains(screen.getByRole('heading', { name: '学期时间地图' }))).toBe(true)

    // 目录补充收到可折叠的 <details>（默认展开，不藏功能）
    const tools = screen.getByRole('heading', { name: '从 SISU 公开目录补充课程' }).closest('details')
    expect(tools?.open).toBe(true)
  })

  it('adds a recommended optional course only after the explicit button', () => {
    seedPlan()
    renderPlan()

    expect(screen.getByRole('heading', { name: '可选课程建议' })).toBeTruthy()
    const before = JSON.parse(localStorage.getItem(KEYS.sisuStudyPlan) ?? '{}').items.length
    fireEvent.click(screen.getAllByRole('button', { name: '加入计划' })[0])
    const after = JSON.parse(localStorage.getItem(KEYS.sisuStudyPlan) ?? '{}')
    expect(after.items).toHaveLength(before + 1)
    expect(after.items[0]).toMatchObject({ timingSource: 'scenario' })
    expect(['elective', 'language']).toContain(after.items[0].category)
    expect(screen.getByText(/已加入 /)).toBeTruthy()
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

describe('SisuStudyPlan section tabs', () => {
  it('separates overview, plan and tools into one visible panel at a time', () => {
    seedPlan()
    renderPlan()

    const rail = screen.getByRole('tablist', { name: '我的 SISU 学习计划' })
    const tabs = [...rail.querySelectorAll('[role="tab"]')]
    expect(tabs.map((tab) => tab.textContent)).toEqual(['概览', '计划', '选课与学习'])

    const panel = (id: string) => document.getElementById(`sisu-panel-${id}`)!
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(panel('overview').className).not.toContain('hidden')
    expect(panel('plan').className).toContain('hidden')
    expect(panel('tools').className).toContain('hidden')

    fireEvent.click(screen.getByRole('tab', { name: '计划' }))
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    expect(panel('plan').className).not.toContain('hidden')
    expect(panel('overview').className).toContain('hidden')
    // 计划本体与搜索框不再同屏：选择项在「选课与学习」里
    expect(panel('tools').className).toContain('hidden')

    fireEvent.click(screen.getByRole('tab', { name: '选课与学习' }))
    expect(panel('tools').className).not.toContain('hidden')
    expect(panel('plan').className).toContain('hidden')
  })
})
