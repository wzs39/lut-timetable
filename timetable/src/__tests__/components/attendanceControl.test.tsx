// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import AttendanceControl from '../../components/AttendanceControl'
import { I18nProvider } from '../../i18n'
import { KEYS } from '../../lib/storage'
import type { Lesson } from '../../types'

/**
 * 【打卡渲染契约】三态互斥、再点同态清除、课程级比例来自 lib（停课不计分母）。
 */

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const lesson = (id: string, uid: string, start: Date, end: Date): Lesson =>
  ({
    id,
    uid,
    title: 'Signals',
    code: 'CT60A0001',
    start: start.toISOString(),
    end: end.toISOString(),
    source: 'sisu',
  }) as unknown as Lesson

function pastLesson(id = 'l1', uid = 'u1', day = 19) {
  return lesson(id, uid, new Date(2026, 9, day, 10), new Date(2026, 9, day, 12))
}

describe('AttendanceControl', () => {
  it('marks a lesson and shows the course rate', () => {
    const l = pastLesson()
    render(
      <I18nProvider>
        <AttendanceControl lesson={l} lessons={[l]} />
      </I18nProvider>,
    )
    expect(screen.getByText('还没记录')).toBeTruthy()
    fireEvent.click(screen.getByText('到课'))
    expect(screen.getByText('1/1 · 100%')).toBeTruthy()
    const stored = JSON.parse(localStorage.getItem(KEYS.attendance) || '{}')
    expect(stored.u1.status).toBe('attended')
  })

  it('clears the record when the same state is clicked again', () => {
    const l = pastLesson()
    render(
      <I18nProvider>
        <AttendanceControl lesson={l} lessons={[l]} />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByText('缺勤'))
    expect(screen.getByText('0/1 · 0%')).toBeTruthy()
    fireEvent.click(screen.getByText('缺勤'))
    expect(screen.getByText('还没记录')).toBeTruthy()
    expect(localStorage.getItem(KEYS.attendance)).toBe('{}')
  })

  it('hides itself for lessons that have not started', () => {
    const future = lesson('f', 'uf', new Date(2099, 0, 1, 10), new Date(2099, 0, 1, 12))
    const { container } = render(
      <I18nProvider>
        <AttendanceControl lesson={future} lessons={[future]} />
      </I18nProvider>,
    )
    expect(container.firstChild).toBeNull()
  })
})
