import { describe, expect, it } from 'vitest'
import { checkPlanItemAgainstCatalog, planCourseCodes } from '../lib/sisuPlanMatch'
import type { SisuCatalogMatch } from '../lib/sisuCourse'

const match = (over: Partial<SisuCatalogMatch> = {}): SisuCatalogMatch => ({
  id: 'otm-1',
  code: 'CT60A4050',
  name: 'Fundamentals of Software Engineering',
  credits: 6,
  ...over,
})

const item = (over: Partial<{ title: string; courseCode: string; credits: number }> = {}) => ({
  title: 'Fundamentals of Software Engineering',
  courseCode: 'CT60A4050',
  credits: 6,
  ...over,
})

describe('checkPlanItemAgainstCatalog', () => {
  it('skips items without a course code and flags a missing catalogue record', () => {
    expect(checkPlanItemAgainstCatalog(item({ courseCode: '' }), match()).verdict).toBe('no-code')
    expect(checkPlanItemAgainstCatalog(item(), null).verdict).toBe('not-found')
    expect(checkPlanItemAgainstCatalog(item(), null).match).toBeNull()
  })

  it('accepts name differences in case, whitespace and trailing punctuation only', () => {
    const check = checkPlanItemAgainstCatalog(
      item({ title: '  fundamentals   of SOFTWARE engineering. ' }),
      match({ name: 'Fundamentals of Software Engineering' }),
    )
    expect(check.verdict).toBe('match')
    expect(check.differs).toEqual([])
  })

  it('reports a genuinely different name', () => {
    const check = checkPlanItemAgainstCatalog(item({ title: 'Algorithms' }), match())
    expect(check.verdict).toBe('differs')
    expect(check.differs).toEqual(['name'])
  })

  it('reports a credit mismatch only when both sides know the credits', () => {
    expect(checkPlanItemAgainstCatalog(item({ credits: 3 }), match({ credits: 6 })).differs).toEqual(['credits'])
    // 任一侧缺失就不下结论（避免把「没填」当成不一致）
    expect(checkPlanItemAgainstCatalog(item({ credits: undefined }), match()).differs).toEqual([])
    expect(checkPlanItemAgainstCatalog(item(), match({ credits: undefined, creditRange: { min: 3, max: 6 } })).differs).toEqual([])
  })

  it('carries the catalogue record so callers can deep link', () => {
    const check = checkPlanItemAgainstCatalog(item(), match())
    expect(check.match?.id).toBe('otm-1')
  })
})

describe('planCourseCodes', () => {
  it('normalizes, strips the group suffix and de-duplicates', () => {
    expect(planCourseCodes([
      { courseCode: 'ct60a4050' },
      { courseCode: 'CT60A4050-3001' },
      { courseCode: ' BM20A9200 ' },
      { courseCode: '' },
      { courseCode: undefined },
    ])).toEqual(['CT60A4050', 'BM20A9200'])
  })
})
