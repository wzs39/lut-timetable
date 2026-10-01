// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import NotificationsSection from '../../components/moodle/NotificationsSection'
import { I18nProvider } from '../../i18n'
import type { MoodleData } from '../../hooks/useMoodleData'
import type { MoodleNotification } from '../../lib/notificationsFeed'
import { openExternal } from '../../lib/openExternal'

let mockMd: MoodleData

vi.mock('../../hooks/useMoodleData', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../hooks/useMoodleData')>()
  return { ...orig, useMoodleData: () => mockMd }
})

vi.mock('../../lib/openExternal', () => ({ openExternal: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function notification(overrides: Partial<MoodleNotification> = {}): MoodleNotification {
  return {
    id: 'ntf-1',
    subject: 'Assignment due soon',
    url: 'https://moodle.lut.fi/mod/assign/view.php?id=42',
    read: false,
    kind: 'submission',
    ...overrides,
  }
}

function renderSection(items: MoodleNotification[]) {
  const markNotificationRead = vi.fn()
  mockMd = {
    notifications: items,
    markNotificationRead,
    refreshNotifications: vi.fn(async () => {}),
    token: null,
  } as unknown as MoodleData
  render(
    <I18nProvider>
      <NotificationsSection />
    </I18nProvider>,
  )
  return { markNotificationRead }
}

describe('NotificationsSection Moodle navigation', () => {
  it('opens the notification activity and marks it read', () => {
    const { markNotificationRead } = renderSection([notification()])
    fireEvent.click(screen.getByRole('link', { name: 'Assignment due soon' }))
    expect(openExternal).toHaveBeenCalledWith('https://moodle.lut.fi/mod/assign/view.php?id=42')
    expect(markNotificationRead).toHaveBeenCalledWith('ntf-1')
  })

  it('falls back to the Moodle course page when an activity URL is missing', () => {
    renderSection([notification({ url: undefined, courseid: 123 })])
    const link = screen.getByRole('link', { name: 'Assignment due soon' })
    expect(link.getAttribute('href')).toBe('https://moodle.lut.fi/course/view.php?id=123')
    fireEvent.click(link)
    expect(openExternal).toHaveBeenCalledWith('https://moodle.lut.fi/course/view.php?id=123')
  })

  it('leaves notifications without a safe Moodle destination non-clickable', () => {
    renderSection([notification({ url: undefined })])
    expect(screen.queryByRole('link', { name: 'Assignment due soon' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Assignment due soon' })).toBeTruthy()
  })
})
