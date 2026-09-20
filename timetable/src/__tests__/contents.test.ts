// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { updateCachedCompletion } from '../lib/contents'
import { writeCache, domainCacheKey, type CacheEnvelope } from '../lib/moodleSync'
import type { CourseSection } from '../lib/contents'

// 反向同步缓存侧：任务卡勾选成功 → contents 缓存的 completion 立即改写，
// 已打开的内容树下次渲染就一致（不等 6h TTL / 网络重拉）。
const mkSections = (cmid: number, completion?: number): CourseSection[] => [
  { id: 1, name: 'Week 1', visible: true, modules: [
    { id: 42, name: 'Other module', modname: 'page', visible: true },
    { id: cmid, name: 'Assignment 2: Persona', modname: 'assign', visible: true, completion, url: `https://moodle.lut.fi/mod/assign/view.php?id=${cmid}` },
  ] },
]

describe('updateCachedCompletion (任务→树 缓存同步)', () => {
  beforeEach(() => localStorage.clear())

  it('rewrites completion to 1 (complete) for the matching cmid across course caches', () => {
    writeCache(domainCacheKey('contents', 30565), mkSections(2179011, 0))
    updateCachedCompletion(2179011, true)
    const raw = JSON.parse(localStorage.getItem(domainCacheKey('contents', 30565))!) as CacheEnvelope<CourseSection>
    const mod = raw.items[0].modules.find((m) => m.id === 2179011)
    expect(mod?.completion).toBe(1)
  })

  it('rewrites to 0 (incomplete) and leaves other modules untouched', () => {
    writeCache(domainCacheKey('contents', 30565), mkSections(2179011, 1))
    updateCachedCompletion(2179011, false)
    const raw = JSON.parse(localStorage.getItem(domainCacheKey('contents', 30565))!) as CacheEnvelope<CourseSection>
    expect(raw.items[0].modules.find((m) => m.id === 2179011)?.completion).toBe(0)
    expect(raw.items[0].modules.find((m) => m.id === 42)?.completion).toBeUndefined()
  })

  it('is a silent no-op when no cache holds the cmid', () => {
    expect(() => updateCachedCompletion(999999, true)).not.toThrow()
  })
})
