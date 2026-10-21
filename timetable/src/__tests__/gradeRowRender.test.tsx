// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import GradeCourseCard from '../components/GradeCourseCard'
import { formatDateTime, formatDateTimeShort } from '../lib/date'
import type { CourseGrades, GradeItem } from '../lib/grades'

// 【渲染校验】量制项（Fail–Pass）必须显示 Moodle 官方文本 "Passed"，
// 不能把 1/2 渲染成 "50"；权重/贡献碎片保持同行；百分比只在无官方文本时兜底。
const item = (over: Partial<GradeItem>): GradeItem => ({
  name: 'item',
  grade: null,
  max: 100,
  classAvg: null,
  weight: null,
  ...over,
})

const failPassCourse: CourseGrades = {
  course: 'XX00AA11',
  matched: false,
  average: 7.1,
  items: [
    item({ name: 'CV upload', grade: 50, max: 2, weight: 7.1, gradeText: 'Passed' }),
    item({ name: 'Exam', grade: null, max: 100, weight: 92.9 }),
  ],
}

afterEach(cleanup)

describe('GradeCourseCard — Fail–Pass rendering', () => {
  it('shows the official scale text, never the raw percent, for graded scale items', () => {
    render(
      <I18nProvider>
        <GradeCourseCard c={failPassCourse} />
      </I18nProvider>,
    )
    // 展开条目列表
    fireEvent.click(screen.getByText('预估总分'))
    expect(screen.getByText('Passed')).toBeTruthy()
    expect(screen.queryByText('50')).toBeNull()
    // 行内同时含权重与贡献值（7.1%×50% ≈ +3.5，JSX 拆分文本节点 → 查行内容）
    const row = screen.getByText('CV upload').closest('li')!
    expect(row.textContent).toMatch(/权重 7\.1%/)
    expect(row.textContent).toMatch(/\+\d+\.\d/)
  })

  it('labels quiz dates as closing and shows the assignment late cutoff separately', () => {
    const dueAt = new Date(Date.now() + 2 * 86400000).toISOString()
    const cutoffAt = new Date(Date.now() + 6 * 86400000).toISOString()
    const locale = document.documentElement.lang || undefined
    const c: CourseGrades = {
      course: 'XX00AA11',
      matched: false,
      average: 50,
      items: [
        item({ name: 'Quiz 1', grade: 50, max: 100, cmid: 901 }),
        item({ name: 'Essay', grade: null, max: 100, cmid: 902 }),
      ],
    }
    render(
      <I18nProvider>
        <GradeCourseCard
          c={c}
          activityDates={new Map([[901, { dueAt }], [902, { dueAt, cutoffAt }]])}
          moduleKindByCmid={new Map([[901, 'quiz'], [902, 'assign']])}
        />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByText('预估总分'))
    const quizRow = screen.getByText('Quiz 1').closest('li')!
    const quizTitle = [...quizRow.querySelectorAll('span[title]')]
      .map((el) => el.getAttribute('title') ?? '')
      .find((title) => title.includes(formatDateTime(dueAt, locale)))!
    expect(quizTitle).toContain('关闭')
    expect(quizTitle).not.toContain('截止')

    const essayRow = screen.getByText('Essay').closest('li')!
    const essayDates = [...essayRow.querySelectorAll('span[title]')]
      .map((el) => el.getAttribute('title') ?? '')
      .find((title) => title.includes(formatDateTime(dueAt, locale)))!
    expect(essayDates).toContain('迟交截止')
    expect(essayDates).toContain(formatDateTime(cutoffAt, locale))
    expect(essayRow.textContent).toContain(`${formatDateTimeShort(cutoffAt, locale)}`)
  })

  it('marks a course whose weights come from the SISU teacher description', () => {
    const c: CourseGrades = {
      ...failPassCourse,
      weighting: {
        source: 'sisu',
        normalized: true,
        components: [
          { kind: 'exam', label: 'Exam', weight: 50 },
          { kind: 'exercises', label: 'Weekly exercises', weight: 30 },
          { kind: 'project', label: 'Project', weight: 20 },
        ],
      },
    }
    render(
      <I18nProvider>
        <GradeCourseCard c={c} />
      </I18nProvider>,
    )
    const badge = screen.getByText('SISU 权重')
    const title = badge.getAttribute('title') ?? ''
    expect(title).toContain('Exam 50%')
    expect(title).toContain('Weekly exercises 30%')
    expect(title).toContain('Project 20%')
    // 归一提示：老师和加起来不是 100% 时要说明
    expect(title).toContain('归一')
  })

  it('does not label courses that still use the Moodle gradebook weights', () => {
    render(
      <I18nProvider>
        <GradeCourseCard c={failPassCourse} />
      </I18nProvider>,
    )
    expect(screen.queryByText('SISU 权重')).toBeNull()
  })

  it('falls back to percent when gradeformatted is absent', () => {
    const numeric: CourseGrades = {
      ...failPassCourse,
      items: [item({ name: 'Week 1', grade: 100, max: 8, weight: 100 })],
    }
    render(
      <I18nProvider>
        <GradeCourseCard c={numeric} />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByText('预估总分'))
    expect(screen.getByText('100')).toBeTruthy()
  })
})
