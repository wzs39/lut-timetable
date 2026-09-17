// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import TodayView from '../../components/TodayView'
import { I18nProvider } from '../../i18n'
import { KEYS } from '../../lib/storage'
import type { Task } from '../../lib/tasks'
import type { Lesson } from '../../types'

/** 2026-09-15 12:00 waktu lokal (hari Selasa) */
const NOW = new Date(2026, 8, 15, 12, 0, 0)

function at(day: number, hour: number, minute = 0): string {
  return new Date(2026, 8, day, hour, minute, 0).toISOString()
}

function lesson(p: Partial<Lesson> & { id: string; start: string; end: string }): Lesson {
  return { source: 'sisu', title: `Course ${p.id}`, ...p }
}

function task(p: Partial<Task> & { id: string; title: string }): Task {
  return {
    completed: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...p,
  }
}

/** Tombol dicari lewat textContent karena label sering digabung dengan ikon. */
function buttonsMatching(re: RegExp): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((b) => re.test(b.textContent || ''))
}

function renderToday(lessons: Lesson[], tasks: Task[]) {
  return render(
    <I18nProvider>
      <TodayView lessons={lessons} tasks={tasks} onSelect={() => {}} />
    </I18nProvider>,
  )
}

describe('TodayView', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("shows today's lessons and previews the next day separately", () => {
    renderToday(
      [
        lesson({ id: 'l1', code: 'CT60A0250', title: 'Programming', start: at(15, 13), end: at(15, 15) }),
        lesson({ id: 'l2', code: 'BM20A9200', title: 'Maths A', start: at(16, 9), end: at(16, 11) }),
      ],
      [],
    )

    // hari ini: satu kartu dengan jamnya
    expect(buttonsMatching(/CT60A0250/).length).toBe(1)
    expect(buttonsMatching(/CT60A0250/)[0].textContent).toContain('13:00')
    // selama hari ini belum selesai, pratinjau hari berikutnya belum muncul
    expect(buttonsMatching(/BM20A9200/).length).toBe(0)
  })

  it('switches to the next-day preview once today is over', () => {
    renderToday(
      [
        lesson({ id: 'l1', code: 'CT60A0250', title: 'Programming', start: at(15, 8), end: at(15, 10) }),
        lesson({ id: 'l2', code: 'BM20A9200', title: 'Maths A', start: at(16, 9), end: at(16, 11) }),
      ],
      [],
    )

    expect(screen.getByText(/今天的课程已结束/)).toBeTruthy()
    // pelajaran hari ini yang sudah lewat tidak lagi ditumpuk sebagai kartu
    expect(buttonsMatching(/CT60A0250/).length).toBe(0)
    expect(buttonsMatching(/BM20A9200/).length).toBe(1)
  })

  it('excludes already-passed deadlines from the due-today count (they are overdue)', () => {
    renderToday(
      [],
      [
        task({ id: 't1', title: 'Late essay', dueAt: at(14, 23) }),
        task({ id: 't2', title: 'Tonight quiz', dueAt: at(15, 18) }),
        task({ id: 't3', title: 'This morning', dueAt: at(15, 9) }),
      ],
    )

    // t1 (kemarin) + t3 (hari ini tapi sudah lewat) = 2 terlambat
    expect(screen.getByText('2 项作业已逾期')).toBeTruthy()
    // hanya t2 yang masih bisa dikerjakan hari ini
    expect(screen.getByText('今日截止（1）')).toBeTruthy()
    expect(screen.getByText('Tonight quiz')).toBeTruthy()
    expect(screen.queryByText('This morning')).toBeNull()
  })

  it('ignores completed tasks and lessons from other days', () => {
    renderToday(
      [lesson({ id: 'l9', start: at(20, 10), end: at(20, 12) })],
      [task({ id: 't9', title: 'Done already', dueAt: at(14, 10), completed: true })],
    )

    expect(screen.queryByText(/已逾期/)).toBeNull()
    expect(screen.queryByText(/今日截止/)).toBeNull()
    expect(screen.getAllByText('今天没有课程').length).toBeGreaterThan(0)
    expect(screen.queryByText('Done already')).toBeNull()
  })

  it('collapses both task sections and remembers the choice', () => {
    renderToday(
      [],
      [
        task({ id: 't1', title: 'Late essay', dueAt: at(14, 18) }),
        task({ id: 't2', title: 'Tonight quiz', dueAt: at(15, 18) }),
      ],
    )

    expect(screen.getByText('Tonight quiz')).toBeTruthy()

    fireEvent.click(buttonsMatching(/项作业已逾期/)[0])
    expect(localStorage.getItem(KEYS.todayTasksOpen)).toBe('0')
    // 折叠动画把内容留在 DOM 里（grid 0fr 过渡），但 inert 让它移出无障碍树：
    // 不可见、不可点、不可被 tab 到 —— 语义上等同旧实现的卸载。
    expect(screen.getByText('Tonight quiz').closest('[inert]')).toBeTruthy()
    // judul ringkas tetap terlihat meski terlipat
    expect(screen.getByText('今日截止（1）')).toBeTruthy()

    fireEvent.click(buttonsMatching(/今日截止/)[0])
    expect(localStorage.getItem(KEYS.todayTasksOpen)).toBe('1')
    expect(screen.getByText('Tonight quiz')).toBeTruthy()
  })

  it('opens a lesson through onSelect', () => {
    const onSelect = vi.fn()
    render(
      <I18nProvider>
        <TodayView
          lessons={[
            lesson({ id: 'l1', code: 'CT60A0250', title: 'Programming', start: at(15, 10), end: at(15, 12) }),
          ]}
          onSelect={onSelect}
        />
      </I18nProvider>,
    )

    fireEvent.click(buttonsMatching(/CT60A0250/)[0])
    expect(onSelect).toHaveBeenCalledWith('l1')
  })
})
