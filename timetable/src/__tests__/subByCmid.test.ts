import { describe, expect, it, vi } from 'vitest'

// fetchSubmissionStatus 直接打 wsCall（网络）。mock 掉它，锁定
// statusByCmid 的 cmid 联接契约：内容树按模块 cmid 查提交态。
vi.mock('../lib/grades', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../lib/grades')>()
  return {
    ...orig,
    wsCall: vi.fn(async (_token: string, fn: string, params?: Record<string, unknown>) => {
      if (fn === 'mod_assign_get_assignments') {
        return {
          courses: [
            {
              shortname: 'CT60A4050',
              fullname: 'Fundamentals of Software Engineering',
              assignments: [
                {
                  id: 77,
                  name: 'Individual Home Assignment 2',
                  duedate: 1790000000,
                  cmid: 3358,
                },
              ],
            },
          ],
        }
      }
      if (fn === 'mod_assign_get_submissions') {
        return {
          assignments: [
            { assignmentid: 77, submissions: [{ userid: 42, status: 'submitted', timemodified: 1780000000 }] },
          ],
        }
      }
      if (fn === 'mod_assign_get_grades') {
        return {
          assignments: [
            { assignmentid: 77, grades: [{ userid: 42, grade: '9/10', timemodified: 1785000000, feedbacktext: 'Good' }] },
          ],
        }
      }
      void params
      throw new Error(`unexpected wsCall ${fn}`)
    }),
    validateGradesToken: vi.fn(async () => 42),
  }
})

import { fetchSubmissionStatus, currentSubmissionSource } from '../lib/submissions'

describe('fetchSubmissionStatus statusByCmid', () => {
  it('keys submission status by cmid for the contents tree join', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ token: 'tok', userid: 42 }),
      setItem: () => {},
      removeItem: () => {},
    })
    const { statusByCmid } = await fetchSubmissionStatus(currentSubmissionSource())
    const st = statusByCmid.get(3358)
    expect(st).toBeDefined()
    expect(st!.state).toBe('graded')
    expect(st!.grade).toBe('9/10')
    expect(statusByCmid.get(999999)).toBeUndefined()
  })

  it('carries dueAt into both maps so the contents tree aligns with task cards', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ token: 'tok', userid: 42 }),
      setItem: () => {},
      removeItem: () => {},
    })
    const { statusByCmid, status } = await fetchSubmissionStatus(currentSubmissionSource())
    // fixture: duedate 1790000000 → ISO
    const due = new Date(1790000000 * 1000).toISOString()
    const byCmid = statusByCmid.get(3358)
    expect(byCmid!.dueAt).toBe(due)
    // 模糊键 map 同样带 dueAt（任务卡数据源），两侧信息量一致
    const [byKey] = [...status.values()]
    expect(byKey.dueAt).toBe(due)
    // 无 duedate 的 assignment：dueAt 保持 undefined（树里不显示截止）
    const { parseAssignments } = await import('../lib/submissions')
    const meta = parseAssignments({ courses: [{ id: 1, shortname: 'X', assignments: [{ id: 5, name: 'No due' }] }] })
    expect(meta[0].dueAt).toBeUndefined()
  })
})
