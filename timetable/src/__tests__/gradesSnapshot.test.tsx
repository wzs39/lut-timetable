// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import GradeCourseCard from '../components/GradeCourseCard'
import {
  loadGradesSnapshot,
  saveGradesSnapshot,
  clearGradesSnapshot,
  type CourseGrades,
  type GradeItem,
} from '../lib/grades'

// 【冷启动快照】重启/断网时成绩段的唯一数据源。锁三件事：往返保真、
// 空数组/损坏 JSON 不产出快照（首屏不显示垃圾）、清除即消失。
describe('grades snapshot (cold start)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  const courses: CourseGrades[] = [
    {
      course: 'BM20A9200',
      matched: true,
      average: 82.5,
      officialTotal: 82.5,
      courseId: 30565,
      items: [
        { name: 'Week 1', grade: 100, max: 8, weight: 7.14, classAvg: null },
        { name: 'Week 5', grade: null, max: 8, weight: 7.14, classAvg: null },
      ],
    },
  ]

  it('round-trips courses through save/load with a timestamp', () => {
    expect(loadGradesSnapshot()).toBeNull()
    saveGradesSnapshot(courses)
    const snap = loadGradesSnapshot()
    expect(snap?.courses).toEqual(courses)
    expect(typeof snap?.fetchedAt).toBe('string')
    expect(Number.isNaN(Date.parse(snap!.fetchedAt))).toBe(false)
  })

  it('rejects empty or malformed snapshots (no garbage on first paint)', () => {
    saveGradesSnapshot([])
    expect(loadGradesSnapshot()).toBeNull()
    localStorage.setItem('tt_grades_cache_v1', '{not json')
    expect(loadGradesSnapshot()).toBeNull()
    localStorage.setItem('tt_grades_cache_v1', JSON.stringify({ fetchedAt: 'x', courses: 'nope' }))
    expect(loadGradesSnapshot()).toBeNull()
  })

  it('clearGradesSnapshot removes the stored data', () => {
    saveGradesSnapshot(courses)
    clearGradesSnapshot()
    expect(loadGradesSnapshot()).toBeNull()
  })
})

// 【渲染】班级均分（classAvg，服务器给就显示——LUT 目前不给，休眠通路）
// 与「部分权重」提示（权重总和 <100% 时出现在卡片 meta 行）。
describe('GradeCourseCard — class average & partial weight', () => {
  afterEach(cleanup)

  const item = (over: Partial<GradeItem>): GradeItem => ({
    name: 'item',
    grade: null,
    max: 100,
    classAvg: null,
    weight: null,
    ...over,
  })

  it('renders the class average next to the item when the server provides it', () => {
    const c: CourseGrades = {
      course: 'XX00AA11',
      matched: false,
      average: 70,
      items: [item({ name: 'Exam', grade: 90, max: 100, weight: 100, classAvg: 75.5 })],
    }
    render(
      <I18nProvider>
        <GradeCourseCard c={c} />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByText('预估总分'))
    const row = screen.getByText('Exam').closest('li')!
    expect(row.textContent).toMatch(/均 75\.5%/)
  })

  it('shows a partial-weight hint when weights do not cover the course total', () => {
    const c: CourseGrades = {
      course: 'XX00AA11',
      matched: false,
      average: 50,
      items: [
        item({ name: 'Graded A', grade: 50, max: 10, weight: 10 }),
        item({ name: 'Unweighted B', grade: null, max: 10, weight: null }),
      ],
    }
    render(
      <I18nProvider>
        <GradeCourseCard c={c} />
      </I18nProvider>,
    )
    // meta 行（无 title 属性）直接查文本
    expect(screen.getByText(/已计入权重/).textContent).toMatch(/权重共 10%/)
  })

  it('shows no partial-weight hint when weights cover the full course', () => {
    const c: CourseGrades = {
      course: 'XX00AA11',
      matched: false,
      average: 50,
      items: [item({ name: 'All', grade: 50, max: 10, weight: 100 })],
    }
    render(
      <I18nProvider>
        <GradeCourseCard c={c} />
      </I18nProvider>,
    )
    expect(screen.queryByText(/权重共/)).toBeNull()
  })
})
