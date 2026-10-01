// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalNotifications } from '@capacitor/local-notifications'
import { createSisuPlanItem, isSisuPlanItem, loadSisuStudyPlan, saveSisuStudyPlan } from '../lib/sisuStudyPlan'
import { normalizeSisuStudyPlanUrl, refreshSisuPlanReminders, sisuPlanReminderId } from '../lib/sisuStudyPlanReminders'
import { KEYS } from '../lib/storage'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
}))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: vi.fn(async () => ({ display: 'granted' })),
    checkExactNotificationSetting: vi.fn(async () => ({ exact_alarm: 'granted' })),
    requestPermissions: vi.fn(async () => ({ display: 'granted' })),
    getPending: vi.fn(async () => ({ notifications: [] })),
    schedule: vi.fn(async () => ({ notifications: [] })),
    cancel: vi.fn(async () => ({})),
  },
}))

const now = new Date('2026-09-15T12:00:00.000Z')
const item = (id: string, dueAt: string, completed = false) => ({
  id, kind: 'registration' as const, title: 'Register for course', dueAt, completed, createdAt: now.toISOString(),
})

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(now)
})

afterEach(() => vi.useRealTimers())

describe('SISU local study plan', () => {
  it('accepts only HTTPS URLs on the exact SISU host for reminder navigation', () => {
    expect(normalizeSisuStudyPlanUrl('https://sisu.lut.fi/')).toBe('https://sisu.lut.fi/')
    expect(normalizeSisuStudyPlanUrl('https://sisu.lut.fi/plan?id=1')).toBe('https://sisu.lut.fi/plan?id=1')
    expect(normalizeSisuStudyPlanUrl('http://sisu.lut.fi/')).toBeNull()
    expect(normalizeSisuStudyPlanUrl('https://sisu.lut.fi.attacker.example/')).toBeNull()
    expect(normalizeSisuStudyPlanUrl('https://attacker.example/?next=sisu.lut.fi')).toBeNull()
    expect(normalizeSisuStudyPlanUrl('https://user@sisu.lut.fi/')).toBeNull()
    expect(normalizeSisuStudyPlanUrl('https://sisu.lut.fi:444/')).toBeNull()
  })

  it('normalizes a new local item and rejects malformed records', () => {
    const created = createSisuPlanItem({ kind: 'course', title: '  Algorithms  ', courseCode: ' ct60a ', credits: 5 })
    expect(created).toMatchObject({ title: 'Algorithms', courseCode: 'CT60A', credits: 5, completed: false })
    expect(isSisuPlanItem(created)).toBe(true)
    expect(isSisuPlanItem({ id: 'bad', title: 'No kind' })).toBe(false)
    expect(isSisuPlanItem({ ...created, id: '  ' })).toBe(false)
    expect(isSisuPlanItem({ ...created, title: '  ' })).toBe(false)
  })

  it('loads defaults and preserves a validated local study plan in backup storage', () => {
    expect(loadSisuStudyPlan()).toEqual({ goalCredits: 180, items: [] })
    const created = createSisuPlanItem({ kind: 'course', title: 'Algorithms', credits: 5 })
    saveSisuStudyPlan({ goalCredits: 210, items: [created, { ...created, id: '' } as typeof created] })
    expect(loadSisuStudyPlan()).toEqual({
      goalCredits: 210,
      items: [JSON.parse(JSON.stringify(created))],
    })
    expect(KEYS.sisuStudyPlan).toBe('tt_sisu_study_plan_v1')
  })

  it('schedules only upcoming unfinished due dates within the reminder horizon', async () => {
    const dueSoon = item('soon', '2026-09-17T00:00:00.000Z')
    const dueFar = item('far', '2026-11-01T00:00:00.000Z')
    const done = item('done', '2026-09-17T00:00:00.000Z', true)
    await refreshSisuPlanReminders([dueSoon, dueFar, done], {
      title: 'Plan reminder',
      body: (value, hours) => `${value.title} in ${hours}h`,
    })
    const scheduled = vi.mocked(LocalNotifications.schedule).mock.calls[0][0].notifications
    expect(scheduled).toHaveLength(2)
    expect(scheduled.map((n) => n.id)).toEqual([
      sisuPlanReminderId('soon', 24),
      sisuPlanReminderId('soon', 1),
    ])
    expect(scheduled[0].extra).toEqual({ url: 'https://sisu.lut.fi/' })
    expect(scheduled[0].body).toContain('24h')
  })

  it('cancels only tracked SISU plan notifications when items are removed or completed', async () => {
    const before = item('tracked', '2026-09-17T12:30:00.000Z')
    await refreshSisuPlanReminders([before], { title: 'Reminder', body: () => 'body' })
    vi.mocked(LocalNotifications.getPending).mockResolvedValue({ notifications: [] })
    await refreshSisuPlanReminders([item('tracked', '2026-09-17T12:30:00.000Z', true)], { title: 'Reminder', body: () => 'body' })
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({ notifications: [
      { id: sisuPlanReminderId('tracked', 24) },
      { id: sisuPlanReminderId('tracked', 1) },
    ] })
  })

  it('cancels the old reminder if permission is revoked before the next refresh', async () => {
    localStorage.setItem(`${KEYS.sisuStudyPlan}:scheduled`, JSON.stringify([sisuPlanReminderId('tracked', 24)]))
    vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'denied' } as never)
    await refreshSisuPlanReminders([item('tracked', '2026-09-17T12:30:00.000Z')], {
      title: 'Reminder', body: () => 'body',
    })
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({
      notifications: [{ id: sisuPlanReminderId('tracked', 24) }],
    })
    expect(localStorage.getItem(`${KEYS.sisuStudyPlan}:scheduled`)).toBe('[]')
  })
})
