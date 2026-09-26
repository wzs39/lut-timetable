import { describe, expect, it } from 'vitest'
import type { Lesson } from '../types'
import { EXAM_REMIND_BEFORE_D, examNotifId, wantedExamReminders } from '../lib/examReminders'

// 【考试提醒契约】考试前 7 天 / 1 天各一条，沿用考试的钟点；已过去的时点、
// 太远的考试、非考试条目都不排。id 由 lessonId+档位决定，便于反推与取消。

function lesson(start: string, type: Lesson['type'] = 'exam', id = start): Lesson {
  return {
    id,
    title: 'Exam Course',
    code: 'CT60A0250',
    location: 'R112',
    start,
    end: new Date(new Date(start).getTime() + 3 * 3600 * 1000).toISOString(),
    source: 'sisu',
    type,
  } as unknown as Lesson
}

const DAY = 24 * 3600 * 1000

/** 本地时刻文本（测试机 TZ 非 UTC，不能用 toISOString 比钟点） */
const localTime = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

describe('wantedExamReminders', () => {
  const now = new Date('2026-09-21T12:00:00').getTime()

  it('schedules 7-day and 1-day reminders at the exam clock time', () => {
    const exam = lesson('2026-10-01T08:15:00')
    const wanted = [...wantedExamReminders([exam], now).values()]
    expect(wanted).toHaveLength(EXAM_REMIND_BEFORE_D.length)
    const seven = wanted.find((w) => w.beforeD === 7)
    const one = wanted.find((w) => w.beforeD === 1)
    expect(localTime(seven!.at)).toBe('2026-09-24 08:15')
    expect(localTime(one!.at)).toBe('2026-09-30 08:15')
    expect(seven?.id).toBe(examNotifId(exam.id, 7))
  })

  it('skips past offsets, exams already started, other lesson types and far-away exams', () => {
    // 早上看：明天考试的「1 天前」时点还没到 → 照排；七天前那条已过
    const morning = new Date('2026-09-21T06:00:00').getTime()
    const tomorrow = wantedExamReminders([lesson('2026-09-22T08:15:00')], morning)
    expect([...tomorrow.values()].map((w) => w.beforeD)).toEqual([1])
    // 中午看：连「1 天前」的 08:15 也过了 → 不补发（不搞“立刻弹一条”的意外通知）
    expect(wantedExamReminders([lesson('2026-09-22T08:15:00')], now).size).toBe(0)

    const started = wantedExamReminders([lesson('2026-09-21T08:00:00')], now)
    expect(started.size).toBe(0)

    const lecture = wantedExamReminders([lesson('2026-10-01T08:15:00', 'lecture')], now)
    expect(lecture.size).toBe(0)

    const far = wantedExamReminders([lesson('2026-12-01T08:15:00')], now)
    expect(far.size).toBe(0)

    // 刚好落在 45 天窗口边界内
    const edge = new Date(now + 45 * DAY).toISOString()
    expect(wantedExamReminders([lesson(edge)], now).size).toBeGreaterThan(0)
    const over = new Date(now + 46 * DAY).toISOString()
    expect(wantedExamReminders([lesson(over)], now).size).toBe(0)
  })

  it('gives each exam and offset a distinct id', () => {
    const a = lesson('2026-10-01T08:15:00', 'exam', 'id-a')
    const b = lesson('2026-10-02T08:15:00', 'exam', 'id-b')
    const ids = [
      examNotifId(a.id, 7),
      examNotifId(a.id, 1),
      examNotifId(b.id, 7),
      examNotifId(b.id, 1),
    ]
    expect(new Set(ids).size).toBe(4)
    expect(wantedExamReminders([a, b], now).size).toBe(4)
  })
})
