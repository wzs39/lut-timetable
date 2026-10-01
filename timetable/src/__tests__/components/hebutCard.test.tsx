// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '../../i18n'
import HebutCard from '../../components/moodle/HebutCard'
import NotConnectedCard from '../../components/moodle/NotConnectedCard'
import MoodleView from '../../components/MoodleView'
import { heButLoginUrl } from '../../lib/courseResources'
import type { MoodleData } from '../../hooks/useMoodleData'

let mockMd: MoodleData

vi.mock('../../hooks/useMoodleData', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../hooks/useMoodleData')>()
  return { ...orig, useMoodleData: () => mockMd }
})

const HEBUT_HREF = 'https://hebut.maisterilms.com/login/index.php'
const HEBUT_LABEL = '打开 HEBUT 登录'
const HEBUT_TITLE = 'HEBUT Moodle · HDD 独立入口'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

function renderWithI18n(node: ReactElement) {
  return render(<I18nProvider>{node}</I18nProvider>)
}

/** The two call sites must expose the exact same single HEBUT entry. */
function expectOneHebutEntry() {
  const links = screen.getAllByRole('link', { name: HEBUT_LABEL })
  expect(links).toHaveLength(1)
  expect(links[0].getAttribute('href')).toBe(HEBUT_HREF)
  expect(screen.getByText(HEBUT_TITLE)).toBeTruthy()
}

describe('HebutCard', () => {
  it('links to the HEBUT login and explains the separate HDD access', () => {
    renderWithI18n(<HebutCard />)

    expect(heButLoginUrl()).toBe(HEBUT_HREF)
    expectOneHebutEntry()
  })

  it('renders the same entry on the not-connected Moodle page', () => {
    renderWithI18n(<NotConnectedCard onOpenSettings={() => {}} />)

    expectOneHebutEntry()
  })

  it('renders the same entry on the connected courses section', () => {
    mockMd = { connected: true, token: null, grades: [] } as unknown as MoodleData
    localStorage.setItem('tt_moodle_section', 'courses')

    renderWithI18n(
      <MoodleView
        tasks={[]}
        lessons={[]}
        onTasks={() => {}}
        onOpenAssignments={() => {}}
        onOpenSettings={() => {}}
      />,
    )

    expect(screen.getByRole('tab', { name: '课程' }).getAttribute('aria-selected')).toBe('true')
    expectOneHebutEntry()
  })
})
