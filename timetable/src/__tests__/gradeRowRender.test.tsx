// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import GradeCourseCard from '../components/GradeCourseCard'
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
