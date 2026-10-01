// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import SisuStudyPlan from '../../components/SisuStudyPlan'
import { I18nProvider } from '../../i18n'
import { lookupSisuCourseByCode, type SisuCatalogMatch } from '../../lib/sisuCourse'
import { KEYS } from '../../lib/storage'

vi.mock('../../lib/sisuCourse', () => ({
  searchSisuPublicCatalog: vi.fn(),
  lookupSisuCourseByCode: vi.fn(),
  normalizeSisuCode: (code: string) => code.trim().toUpperCase().replace(/-\d{4}$/, ''),
}))
vi.mock('../../lib/sisuStudyPlanReminders', () => ({ refreshSisuPlanReminders: vi.fn(async () => {}) }))

const lookup = vi.mocked(lookupSisuCourseByCode)

const catalogMatch: SisuCatalogMatch = {
  id: 'otm-abc',
  code: 'CT60A4050',
  name: 'Fundamentals of Software Engineering',
  credits: 6,
}

function seedPlan(item: Record<string, unknown>) {
  localStorage.setItem(KEYS.sisuStudyPlan, JSON.stringify({
    goalCredits: 180,
    items: [{ id: 'i1', kind: 'course', completed: false, createdAt: new Date().toISOString(), ...item }],
  }))
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('plan item ↔ SISU public catalogue', () => {
  it('confirms a matching course and links to the SISU course unit', async () => {
    lookup.mockResolvedValue(catalogMatch)
    seedPlan({ title: 'Fundamentals of Software Engineering', courseCode: 'CT60A4050', credits: 6 })

    render(<I18nProvider><SisuStudyPlan /></I18nProvider>)

    expect(await screen.findByText('SISU：名称与学分一致')).toBeTruthy()
    const link = screen.getByRole('link', { name: /在 SISU 打开/ })
    expect(link.getAttribute('href')).toBe('https://sisu.lut.fi/student/courseunit/otm-abc')
    expect(lookup).toHaveBeenCalledWith('CT60A4050', expect.anything())
  })

  it('says so when the code is not in the public catalogue', async () => {
    lookup.mockResolvedValue(null)
    seedPlan({ title: 'Some elective', courseCode: 'ZZ901', credits: 3 })

    render(<I18nProvider><SisuStudyPlan /></I18nProvider>)

    expect(await screen.findByText('SISU 公开目录未找到该课程代码')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /在 SISU 打开/ })).toBeNull()
  })

  it('surfaces a credit mismatch instead of pretending it matches', async () => {
    lookup.mockResolvedValue(catalogMatch)
    seedPlan({ title: 'Fundamentals of Software Engineering', courseCode: 'CT60A4050', credits: 3 })

    render(<I18nProvider><SisuStudyPlan /></I18nProvider>)

    expect(await screen.findByText('SISU 学分：6')).toBeTruthy()
    expect(screen.queryByText('SISU：名称与学分一致')).toBeNull()
  })

  it('does not query the catalogue for items without a course code', async () => {
    seedPlan({ title: 'Study milestone' })

    render(<I18nProvider><SisuStudyPlan /></I18nProvider>)

    await waitFor(() => expect(screen.getByText('Study milestone')).toBeTruthy())
    expect(lookup).not.toHaveBeenCalled()
    expect(screen.queryByText('SISU 公开目录未找到该课程代码')).toBeNull()
  })
})
