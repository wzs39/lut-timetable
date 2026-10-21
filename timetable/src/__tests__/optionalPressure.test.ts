import { describe, expect, it } from 'vitest'
import type { Lesson } from '../types'
import type { CourseOffering } from '../lib/sisuCourseFacts'
import { WEEKLY_SLOT_COUNT, bestOfferingPressure, windowPressure } from '../lib/optionalPressure'

/**
 * 默认给每条课时一个互不相同且**不带 code** 的 title：压力统计按
 * `code ?? title` 归并，同名同周的多条会被当成「平行分组，只去一节」。
 * 这些用例要表达的都是「45 节彼此不同的课」，所以标题必须唯一。
 */
let seq = 0
const lesson = (start: string, end: string, title = `x${seq++}`): Lesson => ({
  id: start + title, source: 'timeedit', title, start, end,
})

/**
 * 2026-09-14 是周一。刻意不带时区后缀：课表时间以本地墙钟为准（应用也是这么
 * 显示的），带 Z 会在 UTC runner 上整体平移，格子数与星期都会算错。
 */
const at = (dayOffset: number, hour: number): string =>
  `2026-09-${String(14 + dayOffset).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00`
const until = (dayOffset: number, hour: number): string =>
  `2026-09-${String(14 + dayOffset).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00`

const WINDOW = { start: '2026-09-01', end: '2026-12-31' }

describe('windowPressure', () => {
  it('reports no-data when the timetable has nothing in the window', () => {
    expect(windowPressure([], WINDOW.start, WINDOW.end)).toMatchObject({
      lessons: 0, occupiedSlots: 0, freeSlots: WEEKLY_SLOT_COUNT, status: 'no-data',
    })
    // A lesson outside the window is not evidence that the window is free.
    const outside = windowPressure([lesson('2027-03-01T08:00:00', '2027-03-01T10:00:00')], WINDOW.start, WINDOW.end)
    expect(outside.status).toBe('no-data')
  })

  it('classifies a packed week as full', () => {
    const lessons: Lesson[] = []
    for (let day = 0; day < 5; day++) {
      for (let hour = 8; hour < 17; hour++) lessons.push(lesson(at(day, hour), until(day, hour + 1)))
    }
    const pressure = windowPressure(lessons, WINDOW.start, WINDOW.end)
    expect(pressure.occupiedSlots).toBe(45)
    expect(pressure.freeSlots).toBe(WEEKLY_SLOT_COUNT - 45)
    expect(pressure.status).toBe('full')
  })

  it('classifies a partly used week as tight, a sparse one as roomy', () => {
    const make = (hours: number[]): Lesson[] =>
      [0, 1, 2, 3, 4].flatMap((day) => hours.map((hour) => lesson(at(day, hour), until(day, hour + 1))))

    const tight = windowPressure(make([8, 9, 10, 11, 12, 13, 14]), WINDOW.start, WINDOW.end)
    expect(tight.occupiedSlots).toBe(35)
    expect(tight.status).toBe('tight')

    const roomy = windowPressure(make([8, 9]), WINDOW.start, WINDOW.end)
    expect(roomy.occupiedSlots).toBe(10)
    expect(roomy.status).toBe('roomy')
  })

  it('expands a multi-hour lesson into every hour slot it covers', () => {
    const pressure = windowPressure([lesson(at(0, 9), until(0, 12))], WINDOW.start, WINDOW.end)
    expect(pressure.occupiedSlots).toBe(3)
    expect(pressure.lessons).toBe(1)
  })

  it('counts a pick-one parallel group once, not once per slot', () => {
    // 真实案例：CT60A0250 一周给出 10 个 tutorial 时段，学生只去一节。
    // 全算成必到会把明明空着 30 格的课表读成「只剩 2 格」。
    const slots: Array<[number, number]> = [
      [1, 12], [1, 14], [2, 8], [2, 14], [2, 17], [3, 8], [3, 16], [4, 8], [4, 10], [4, 14],
    ]
    const tutorials: Lesson[] = slots.map(([day, hour], i) => ({
      id: `t${i}`, source: 'timeedit', title: 'Fundamentals of Programming', code: 'CT60A0250',
      type: 'tutorial', start: at(day, hour), end: until(day, hour + 2),
    }))
    const pressure = windowPressure(tutorials, WINDOW.start, WINDOW.end)
    expect(pressure.parallelGroups).toBe(1)
    expect(pressure.occupiedSlots).toBe(0) // 落哪一格是可以挑的
    expect(pressure.parallelBlocked).toBe(0)
    expect(pressure.status).toBe('roomy')
  })

  it('marks a parallel group blocked when every one of its slots is taken', () => {
    // 必修课把周一到周五 8-18 全占满，tutorial 无论挑哪个都撞。
    const mandatory: Lesson[] = []
    for (let day = 0; day < 5; day++) {
      mandatory.push({
        id: `m${day}`, source: 'timeedit', title: `lecture-${day}`, code: 'BM20A9200',
        type: 'lecture', start: at(day, 8), end: until(day, 18),
      })
    }
    const tutorials: Lesson[] = [[1, 9], [2, 9]].map(([day, hour], i) => ({
      id: `t${i}`, source: 'timeedit', title: 'Fundamentals of Programming', code: 'CT60A0250',
      type: 'tutorial', start: at(day, hour)!, end: until(day, hour + 2)!,
    }))
    const pressure = windowPressure([...mandatory, ...tutorials], WINDOW.start, WINDOW.end)
    expect(pressure.occupiedSlots).toBe(50)
    expect(pressure.parallelGroups).toBe(1)
    expect(pressure.parallelBlocked).toBe(1)
    expect(pressure.status).toBe('full')
  })

  it('never bundles lectures into a pick-one group', () => {
    // HDD4010 这类密集课一周两次 lecture 都要出席；误判成选一会低估占用。
    const lectures: Lesson[] = [[0, 12], [1, 12]].map(([day, hour], i) => ({
      id: `l${i}`, source: 'timeedit', title: 'Engineering Mathematics I', code: 'HDD4010',
      type: 'lecture', start: at(day, hour)!, end: until(day, hour + 2)!,
    }))
    const pressure = windowPressure(lectures, WINDOW.start, WINDOW.end)
    expect(pressure.parallelGroups).toBe(0)
    expect(pressure.occupiedSlots).toBe(4)
  })

  it('treats a window with no weekday slots as no-data, not as free room', () => {
    // 2026-09-19 is a Saturday: it is a real lesson but proves nothing about
    // the weekday grid, so the window must stay unverified instead of "roomy".
    const weekend = windowPressure([lesson('2026-09-19T09:00:00', '2026-09-19T11:00:00')], WINDOW.start, WINDOW.end)
    expect(weekend.occupiedSlots).toBe(0)
    expect(weekend.lessons).toBe(1)
    expect(weekend.status).toBe('no-data')
  })
})

describe('bestOfferingPressure', () => {
  const offering = (startDate: string, endDate: string): CourseOffering =>
    ({ id: `${startDate}-${endDate}`, name: 'x', startDate, endDate, periods: [] })

  it('prefers the roomiest window so a course can be moved instead of dropped', () => {
    const packed: Lesson[] = []
    for (let day = 0; day < 5; day++) {
      for (let hour = 8; hour < 17; hour++) packed.push(lesson(at(day, hour), until(day, hour + 1)))
    }
    const best = bestOfferingPressure(packed, [
      offering('2026-09-01', '2026-12-31'),
      offering('2027-06-01', '2027-07-31'),
    ])
    // The autumn window is full, the summer one has no timetable data yet.
    expect(best?.window).toEqual({ start: '2027-06-01', end: '2027-07-31' })
    expect(best?.status).toBe('no-data')
  })

  it('treats a full-year online window as unverified, not as full', () => {
    const packed: Lesson[] = []
    for (let day = 0; day < 5; day++) {
      for (let hour = 8; hour < 17; hour++) packed.push(lesson(at(day, hour), until(day, hour + 1)))
    }
    // "Online teaching 2026-08-01 – 2027-07-31" has no weekly grid: cramming a
    // whole year of lessons into one window would always read as full.
    const rolling = windowPressure(packed, '2026-08-01', '2027-07-31')
    expect(rolling.lessons).toBe(45)
    expect(rolling.status).toBe('no-data')
  })

  it('needs a real timetable sample before claiming room', () => {
    // Only one published exam in the window: the term is not scheduled yet.
    const thin = bestOfferingPressure(
      [lesson('2027-03-03T08:00:00', '2027-03-03T10:00:00')],
      [offering('2027-01-11', '2027-04-24')],
    )
    expect(thin?.lessons).toBe(1)
    expect(thin?.status).toBe('no-data')
  })

  it('returns undefined when the course has no dated offerings', () => {
    expect(bestOfferingPressure([lesson(at(0, 8), until(0, 10))], [])).toBeUndefined()
    expect(bestOfferingPressure([], [offering('', '2027-01-01')])).toBeUndefined()
  })
})
