import { describe, expect, it } from 'vitest'
import { mergeActionEvents, parseActionEvents } from '../lib/actions'
import type { Task } from '../lib/tasks'
import type { Lesson } from '../types'

// Synthetic fixtures shaped like Moodle's core_calendar_get_action_events_by_timesort
// response — no real users, courses or tokens.
function actionEventsResponse() {
  return {
    events: [
      {
        id: 9001,
        name: 'IHA1 submit',
        timesort: 1759000000,
        modulename: 'assign',
        action: { actionable: true, itemtype: 'action', url: 'https://moodle.lut.fi/mod/assign/view.php?id=111' },
        course: { shortname: 'CT60A4050', fullname: 'Software Engineering' },
      },
      {
        id: 9002,
        name: 'C2-Q2 quiz',
        timesort: 1759100000,
        modulename: 'quiz',
        action: { actionable: true, itemtype: 'action', url: 'https://moodle.lut.fi/mod/quiz/view.php?id=222' },
        course: { shortname: 'CT60A4050' },
      },
      { id: 9003, name: 'Forum post', timesort: 1759200000, modulename: 'forum', action: { url: 'https://x' } }, // not an assignment module
      { id: 9004, name: 'No action event', timesort: 1759300000, modulename: 'assign' }, // no action url
    ],
  }
}

const lessons: Lesson[] = [
  {
    id: 'l1',
    source: 'sisu',
    title: 'Software Engineering',
    code: 'CT60A4050',
    start: '2026-09-14T08:00:00.000Z',
    end: '2026-09-14T10:00:00.000Z',
  },
]

function task(p: Partial<Task> & { id: string; title: string }): Task {
  const now = new Date().toISOString()
  return {
    course: p.course,
    dueAt: p.dueAt,
    note: p.note,
    completed: p.completed ?? false,
    createdAt: now,
    updatedAt: now,
    ...p,
  } as Task
}

describe('parseActionEvents', () => {
  it('keeps only assignment/quiz events with action URLs, mapping timesort → dueAt', () => {
    const out = parseActionEvents(actionEventsResponse())
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      id: 'moodle-act:9001',
      title: 'IHA1 submit',
      course: 'CT60A4050',
      url: 'https://moodle.lut.fi/mod/assign/view.php?id=111',
      modtype: 'assign',
    })
    expect(out[0].dueAt).toBe(new Date(1759000000 * 1000).toISOString())
  })

  it('returns [] for malformed responses', () => {
    expect(parseActionEvents(null)).toEqual([])
    expect(parseActionEvents({})).toEqual([])
    expect(parseActionEvents({ events: [] })).toEqual([])
  })
})

describe('mergeActionEvents', () => {
  it('adds action tasks and matches course code from the timetable', () => {
    const r = mergeActionEvents([], parseActionEvents(actionEventsResponse()), lessons)
    expect(r.added).toBe(2)
    expect(r.tasks[0].course).toBe('CT60A4050')
    expect(r.tasks[0].id).toBe('moodle-act:9001')
  })

  it('re-sync updates in place and removes events that vanished from the feed', () => {
    const events = parseActionEvents(actionEventsResponse())
    const r1 = mergeActionEvents([], events, lessons)
    // change one title, drop the other
    const changed = [{ ...events[0], title: 'IHA1 submit (extended)' }]
    const r2 = mergeActionEvents(r1.tasks, changed, lessons)
    expect(r2.updated).toBe(1)
    expect(r2.tasks).toHaveLength(1)
    expect(r2.tasks[0].title).toBe('IHA1 submit (extended)')
  })

  it('migrates legacy ICS task (moodle:<id>@moodle.lut.fi) preserving completed + note', () => {
    const legacy = task({
      id: 'moodle:9001@moodle.lut.fi',
      title: 'IHA1 submit',
      completed: true,
      note: 'user note',
    })
    const r = mergeActionEvents([legacy], parseActionEvents(actionEventsResponse()), lessons)
    const migrated = r.tasks.find((t) => t.id === 'moodle-act:9001')
    expect(migrated).toBeDefined()
    expect(migrated!.completed).toBe(true)
    expect(migrated!.note).toBe('user note')
    expect(migrated!.url).toContain('/mod/assign/')
    expect(r.tasks.some((t) => t.id === 'moodle:9001@moodle.lut.fi')).toBe(false)
  })

  it('never touches manual tasks', () => {
    const manual = task({ id: 'manual-1', title: 'mine' })
    const r = mergeActionEvents([manual], parseActionEvents(actionEventsResponse()), lessons)
    expect(r.tasks.find((t) => t.id === 'manual-1')).toBeDefined()
  })
})
