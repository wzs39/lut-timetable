// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import TodayView from '../../components/TodayView'
import { I18nProvider, translate } from '../../i18n'
import { MoodleProvider } from '../../hooks/useMoodleData'
import { KEYS } from '../../lib/storage'
import type { Task } from '../../lib/tasks'
import type { StudyBlock } from '../../lib/studyBlocks'
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

/** Tugas/ujian/pengumuman tinggal di tab 动态 — pindah dulu ke sana. */
function openFeedTab() {
  const feed = buttonsMatching(/动态/)[0]
  if (feed) fireEvent.click(feed)
}

function renderToday(lessons: Lesson[], tasks: Task[]) {
  return render(
    <I18nProvider>
      <MoodleProvider tasks={tasks} lessons={lessons} onTasks={() => {}}>
        <TodayView lessons={lessons} tasks={tasks} onSelect={() => {}} />
      </MoodleProvider>
    </I18nProvider>,
  )
}

function blockFor(day: number, hour: number, over: Partial<StudyBlock> = {}): StudyBlock {
  return {
    id: `sb-${day}-${hour}`,
    sourceKind: 'task',
    sourceId: `task-${day}-${hour}`,
    title: 'Focused reading',
    dueAt: at(day + 3, 20),
    startAt: at(day, hour),
    endAt: at(day, hour + 1),
    createdAt: NOW.toISOString(),
    ...over,
  }
}

function renderTodayWithBlocks(lessons: Lesson[], studyBlocks: StudyBlock[], onSelect: (id: string) => void = () => {}) {
  return render(
    <I18nProvider>
      <MoodleProvider tasks={[]} lessons={lessons} onTasks={() => {}}>
        <TodayView lessons={lessons} tasks={[]} onSelect={onSelect} studyBlocks={studyBlocks} />
      </MoodleProvider>
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

  it('lists today’s confirmed study blocks without turning them into lessons', () => {
    const onSelect = vi.fn()
    renderTodayWithBlocks(
      [lesson({ id: 'l1', code: 'CT60A0250', title: 'Programming', start: at(15, 13), end: at(15, 15) })],
      [
        blockFor(15, 12),
        // 周视图可视窗只到 20:00，晚于此开始的块必须在今日页仍可见（不静默丢弃）
        blockFor(15, 20, { id: 'late', title: 'Evening review' }),
        blockFor(16, 12, { id: 'tomorrow', title: 'Tomorrow review' }),
      ],
      onSelect,
    )

    const title = screen.getByText('Focused reading')
    const row = title.closest('li') as HTMLElement
    expect(title.closest('button')).toBeNull()
    expect(row.textContent).toContain('12:00')
    expect(row.textContent).toContain(translate('zh', 'studyBlockTaskSource'))
    expect(row.className).toContain('border-dashed')
    expect(screen.getByText('Evening review')).toBeTruthy()
    expect(screen.queryByText('Tomorrow review')).toBeNull()

    fireEvent.click(title)
    expect(onSelect).not.toHaveBeenCalled()
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

    openFeedTab()
    // t1 (kemarin) + t3 (hari ini tapi sudah lewat) = 2 terlambat
    expect(screen.getByText('2 项作业已逾期')).toBeTruthy()
    // hanya t2 yang masih bisa dikerjakan hari ini
    expect(screen.getByText('今日截止（1）')).toBeTruthy()
    expect(screen.getByText('Tonight quiz')).toBeTruthy()
    expect(screen.queryByText('This morning')).toBeNull()
  })

  it('shows the late cutoff and grading deadline on assignment rows', () => {
    renderToday(
      [],
      [task({
        id: 't1',
        title: 'Final essay',
        dueAt: at(15, 18),
        cutoffAt: at(18, 18),
        gradingDueAt: at(21, 18),
      })],
    )

    openFeedTab()
    const row = screen.getByText('Final essay').closest('li')!
    expect(row.textContent).toContain('迟交截止')
    expect(row.textContent).toContain('评分截止')
    expect(row.textContent).not.toContain('关闭')
  })

  it('ignores completed tasks and lessons from other days', () => {
    renderToday(
      [lesson({ id: 'l9', start: at(20, 10), end: at(20, 12) })],
      [task({ id: 't9', title: 'Done already', dueAt: at(14, 10), completed: true })],
    )

    // hari tanpa pelajaran tetap mengatakan demikian di tab 课程 (banner)
    expect(screen.getAllByText('今天没有课程').length).toBeGreaterThan(0)
    openFeedTab()
    expect(screen.queryByText(/已逾期/)).toBeNull()
    expect(screen.queryByText(/今日截止/)).toBeNull()
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

    openFeedTab()
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

  it('remembers the active tab across mounts', () => {
    renderToday([], [task({ id: 't1', title: 'Feed only', dueAt: at(15, 18) })])
    openFeedTab()
    expect(screen.getByText('Feed only')).toBeTruthy()
    cleanup()

    // mount baru → tab terakhir (动态) dipulihkan dari storage
    renderToday([], [])
    expect(buttonsMatching(/动态/)[0]?.getAttribute('aria-selected')).toBe('true')
  })

  it('keeps one hero card on top: date, next lesson and the day’s numbers', () => {
    renderToday(
      [
        lesson({ id: 'l1', code: 'CT60A0250', title: 'Programming', start: at(15, 13), end: at(15, 15) }),
        lesson({ id: 'l2', code: 'BM20A9200', title: 'Maths A', start: at(15, 16), end: at(15, 18) }),
      ],
      [
        task({ id: 'due', title: 'Due today', dueAt: at(15, 20) }),
        task({ id: 'late', title: 'Late one', dueAt: at(14, 20) }),
      ],
    )

    const hero = document.querySelector('.app-hero')!
    expect(hero).toBeTruthy()
    // 日期 + 下一节标题 + 时间都在英雄卡里，而不是分散成标题行与独立横幅
    expect(hero.textContent).toContain('9月15日星期二')
    expect(hero.textContent).toContain('CT60A0250')
    expect(hero.textContent).toContain('13:00 – 15:00')
    // 三个数字：今日课程 2 / 今日截止 1 / 已逾期 1
    expect(hero.textContent).toContain('今日课程')
    expect(hero.textContent).toContain('今日截止')
    expect(hero.textContent).toContain('已逾期')
  })
})
