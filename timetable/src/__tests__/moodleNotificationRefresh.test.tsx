// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import { MoodleProvider, useMoodleData } from '../hooks/useMoodleData'
import { KEYS } from '../lib/storage'
import type { Task } from '../lib/tasks'

const CMID = 42001
const { fetchGradesMock, fetchSubmissionsMock, fetchNotificationsMock, fetchActionsMock, markReadMock, applySubmissionMock, primeEnrolMock } = vi.hoisted(() => ({
  fetchGradesMock: vi.fn(),
  fetchSubmissionsMock: vi.fn(),
  fetchNotificationsMock: vi.fn(),
  fetchActionsMock: vi.fn(),
  markReadMock: vi.fn(),
  applySubmissionMock: vi.fn(),
  primeEnrolMock: vi.fn(),
}))

vi.mock('../lib/grades', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/grades')>()
  return { ...original, fetchGrades: fetchGradesMock }
})
vi.mock('../lib/submissions', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/submissions')>()
  return {
    ...original,
    fetchSubmissionStatus: fetchSubmissionsMock,
    applySubmissionStatus: applySubmissionMock,
  }
})
vi.mock('../lib/notificationsFeed', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/notificationsFeed')>()
  return {
    ...original,
    fetchNotifications: fetchNotificationsMock,
    markRead: markReadMock,
  }
})
vi.mock('../lib/actions', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/actions')>()
  return { ...original, fetchActionEvents: fetchActionsMock }
})
vi.mock('../lib/moodleSync', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/moodleSync')>()
  return { ...original, primeEnrolAnchor: primeEnrolMock }
})
vi.mock('../lib/ssoLogin', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/ssoLogin')>()
  return { ...original, coldStartLaunchUrl: vi.fn(async () => null) }
})

const tasks: Task[] = []
const gradeStatus = new Map([[CMID, { state: 'submitted' as const }]])
const assignmentStatus = new Map([[CMID, { state: 'graded' as const, grade: '9/10' }]])
const deadline = new Map([[CMID, '2030-01-01T00:00:00.000Z']])

function RefreshProbe() {
  const md = useMoodleData()
  return <>
    <button onClick={() => void md.refreshFromNotification()}>refresh once</button>
    <button onClick={() => {
      void md.refreshFromNotification()
      void md.refreshFromNotification()
    }}>refresh twice</button>
    <output data-testid="status">{md.subByCmid.get(CMID)?.state ?? 'none'}</output>
    <output data-testid="notification">{md.notifications?.[0]?.id ?? 'none'}</output>
    <output data-testid="deadline">{md.activityDeadlinesByCmid.get(CMID) ?? 'none'}</output>
  </>
}

function renderProbe(onTasks = vi.fn()) {
  localStorage.setItem(KEYS.gradesSource, JSON.stringify({ token: 'fixture-token', userid: 7 }))
  return render(
    <I18nProvider>
      <MoodleProvider tasks={tasks} lessons={[]} onTasks={onTasks}>
        <RefreshProbe />
      </MoodleProvider>
    </I18nProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchGradesMock.mockResolvedValue({ courses: [], statusByCmid: gradeStatus })
  fetchSubmissionsMock.mockImplementation(async (_src, fallback?: () => Promise<Map<number, { state: 'submitted' | 'graded'; grade?: string; submittedAt?: string }>>) => {
    const fallbackStatus = fallback ? await fallback() : new Map()
    return {
      status: new Map(),
      urlByKey: new Map(),
      statusByCmid: new Map([...fallbackStatus, ...assignmentStatus]),
      deadlinesByCmid: deadline,
      datesByCmid: new Map([...deadline].map(([cmid, dueAt]) => [cmid, { dueAt }])),
      fellBackToGrades: Boolean(fallbackStatus.size),
    }
  })
  fetchNotificationsMock.mockResolvedValue([{ id: 'ntf-new', subject: 'New activity', read: false, kind: 'submission' }])
  applySubmissionMock.mockImplementation((current: Task[]) => ({ tasks: current, archived: 0 }))
  primeEnrolMock.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('Moodle notification refresh path', () => {
  it('refreshes notifications and cmid activity status without fetching timeline or changing read state', async () => {
    localStorage.setItem(KEYS.ntfRead, JSON.stringify(['ntf-existing']))
    renderProbe()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'refresh once' }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.getByTestId('notification').textContent).toBe('ntf-new')
    expect(fetchGradesMock).toHaveBeenCalledTimes(1)
    expect(fetchSubmissionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'fixture-token', userid: 7 }),
      expect.any(Function),
    )
    expect(fetchNotificationsMock).toHaveBeenCalledWith(
      { token: 'fixture-token', userid: 7 },
      { force: true },
    )
    expect(fetchActionsMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('status').textContent).toBe('graded')
    expect(screen.getByTestId('deadline').textContent).toBe('2030-01-01T00:00:00.000Z')
    expect(markReadMock).not.toHaveBeenCalled()
    expect(localStorage.getItem(KEYS.ntfRead)).toBe(JSON.stringify(['ntf-existing']))
  })

  it('coalesces simultaneous notification refreshes into one request set', async () => {
    renderProbe()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'refresh twice' }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(fetchNotificationsMock).toHaveBeenCalledTimes(1)
    expect(fetchGradesMock).toHaveBeenCalledTimes(1)
    expect(fetchSubmissionsMock).toHaveBeenCalledTimes(1)
    expect(fetchActionsMock).not.toHaveBeenCalled()
  })
})
