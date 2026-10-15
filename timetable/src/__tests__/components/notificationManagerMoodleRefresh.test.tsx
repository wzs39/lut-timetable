// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import NotificationManager from '../../components/NotificationManager'
import { I18nProvider } from '../../i18n'
import type { MoodleData } from '../../hooks/useMoodleData'
import { KEYS } from '../../lib/storage'

const { mockRefreshFromNotification, mockMarkNotificationRead, mockReceivedListener, mockAddListener } = vi.hoisted(() => {
  const receivedListener = vi.fn<(event: () => void) => void>()
  return {
    mockRefreshFromNotification: vi.fn<() => Promise<void>>(),
    mockMarkNotificationRead: vi.fn(),
    mockReceivedListener: receivedListener,
    mockAddListener: vi.fn((event: string, callback: () => void) => {
      if (event === 'localNotificationReceived') receivedListener(callback)
      return Promise.resolve({ remove: vi.fn() })
    }),
  }
})

vi.mock('../../hooks/useMoodleData', () => ({
  useMoodleData: () => ({
    refreshFromNotification: mockRefreshFromNotification,
    markNotificationRead: mockMarkNotificationRead,
  } as unknown as MoodleData),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}))

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { addListener: mockAddListener },
}))

vi.mock('../../lib/notifications', () => ({
  cancelLessonReminders: vi.fn(async () => {}),
  refreshNotifications: vi.fn(async () => {}),
  cancelAllNotifications: vi.fn(async () => {}),
  notifyNow: vi.fn(async () => {}),
}))
vi.mock('../../lib/dueNotifications', () => ({
  cancelDueReminders: vi.fn(async () => {}),
  refreshDueNotifications: vi.fn(async () => {}),
}))
vi.mock('../../lib/examReminders', () => ({
  cancelExamReminders: vi.fn(async () => {}),
  refreshExamReminders: vi.fn(async () => {}),
}))
vi.mock('../../lib/dailyDigest', () => ({
  cancelDigestNotifications: vi.fn(async () => {}),
  refreshDigestNotifications: vi.fn(async () => {}),
}))
vi.mock('../../lib/subscriptions', () => ({ dueSubscriptions: vi.fn(() => []) }))
vi.mock('../../lib/syncAudit', () => ({ loadAudits: vi.fn(() => []), CHANGE_KIND_KEY: {} }))
vi.mock('../../lib/freeRooms', () => ({ freeRoomsNow: vi.fn(() => []) }))
vi.mock('../../lib/openExternal', () => ({ openExternal: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NotificationManager foreground Moodle refresh', () => {
  it('refreshes Moodle data on receipt without marking any Moodle notification read', () => {
    mockRefreshFromNotification.mockResolvedValue(undefined)
    localStorage.setItem(KEYS.ntfRead, JSON.stringify(['ntf-existing']))
    render(
      <I18nProvider>
        <NotificationManager enabled={false} digestEnabled lessons={[]} />
      </I18nProvider>,
    )

    expect(mockReceivedListener).toHaveBeenCalledTimes(1)
    mockReceivedListener.mock.calls[0][0]()

    expect(mockRefreshFromNotification).toHaveBeenCalledTimes(1)
    expect(mockMarkNotificationRead).not.toHaveBeenCalled()
    expect(localStorage.getItem(KEYS.ntfRead)).toBe(JSON.stringify(['ntf-existing']))
    expect(mockAddListener).toHaveBeenCalledWith(
      'localNotificationReceived',
      expect.any(Function),
    )
  })
})
