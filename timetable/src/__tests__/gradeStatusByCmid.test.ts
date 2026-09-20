import { describe, expect, it } from 'vitest'
import { gradeStatusByCmid } from '../lib/grades'

/** gradereport_user_get_grade_items 的原始 gradeitem 形态（LUT 实测字段）。 */
function rawItem(over: Record<string, unknown>) {
  return {
    itemname: 'Quiz: Honor code',
    itemtype: 'mod',
    itemmodule: 'quiz',
    cmid: 2105246,
    graderaw: 5,
    grademax: 5,
    gradeformatted: '5',
    gradedatesubmitted: 1788511020,
    gradedategraded: 1788511020,
    ...over,
  }
}

describe('gradeStatusByCmid', () => {
  it('extracts graded items keyed by cmid with clean grade text', () => {
    const m = gradeStatusByCmid({
      usergrades: [
        {
          courseid: 30361,
          gradeitems: [rawItem({}), rawItem({ itemname: 'Report Unfair Peer Review 1', cmid: 2105254, graderaw: null, gradeformatted: '', gradedatesubmitted: null, gradedategraded: null })],
        },
      ],
    })
    const st = m.get(2105246)
    expect(st).toBeDefined()
    expect(st!.state).toBe('graded')
    expect(st!.grade).toBe('5')
    expect(st!.submittedAt).toBeTruthy()
    // 未提交项不进 map（树里保持勾选框语义）
    expect(m.get(2105254)).toBeUndefined()
  })

  it('treats submitted-but-ungraded as submitted (pass-icon HTML cleaned)', () => {
    const m = gradeStatusByCmid({
      usergrades: [
        {
          gradeitems: [
            rawItem({
              itemmodule: 'assign',
              cmid: 999,
              graderaw: null,
              gradedategraded: null,
              gradeformatted: '<i class="icon fa fa-check text-success"></i>',
            }),
          ],
        },
      ],
    })
    const st = m.get(999)
    expect(st).toBeDefined()
    expect(st!.state).toBe('submitted')
    expect(st!.grade).toBeUndefined()
  })

  it('ignores non-mod rows and malformed payloads', () => {
    const m = gradeStatusByCmid({
      usergrades: [
        {
          gradeitems: [
            rawItem({ itemtype: 'course', cmid: undefined, itemname: null }),
            rawItem({ cmid: undefined }),
          ],
        },
        { gradeitems: 'junk' },
      ],
    })
    expect(m.size).toBe(0)
  })
})
