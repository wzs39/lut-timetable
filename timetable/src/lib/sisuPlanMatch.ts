import { normalizeSisuCode, type SisuCatalogMatch } from './sisuCourse'
import type { SisuPlanItem } from './sisuStudyPlan'

/**
 * 本机计划项 ↔ SISU 公开目录的对账（纯函数）。
 * 只做「能核对到的」：名称与学分。适用学年不参与——公开目录的
 * course-unit 版本课程表证明不了当前授课学年（见 sisuCourse 注释）。
 */
export type PlanCatalogVerdict = 'no-code' | 'not-found' | 'match' | 'differs'
export type PlanCatalogField = 'name' | 'credits'

export interface SisuPlanCatalogCheck {
  verdict: PlanCatalogVerdict
  /** 与 SISU 公开目录不一致的字段（verdict === 'differs' 时非空） */
  differs: PlanCatalogField[]
  match: SisuCatalogMatch | null
}

/** 名称比对用：去首尾空白、大小写不敏感、折叠空白、去尾部标点。 */
function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[.·:;,!?–—-]+$/, '')
    .trim()
}

export function checkPlanItemAgainstCatalog(
  item: Pick<SisuPlanItem, 'title' | 'courseCode' | 'credits'>,
  match: SisuCatalogMatch | null,
): SisuPlanCatalogCheck {
  if (!item.courseCode || !item.courseCode.trim()) {
    return { verdict: 'no-code', differs: [], match: null }
  }
  if (!match) return { verdict: 'not-found', differs: [], match: null }

  const differs: PlanCatalogField[] = []
  if (normalizeName(item.title) !== normalizeName(match.name)) differs.push('name')
  if (item.credits !== undefined && match.credits !== undefined && item.credits !== match.credits) {
    differs.push('credits')
  }
  return { verdict: differs.length > 0 ? 'differs' : 'match', differs, match }
}

/** 计划项里出现过的课程代码（去重、规范化），用于批量核对。 */
export function planCourseCodes(items: Array<Pick<SisuPlanItem, 'courseCode'>>): string[] {
  const seen = new Set<string>()
  for (const item of items) {
    const code = item.courseCode ? normalizeSisuCode(item.courseCode) : ''
    if (code) seen.add(code)
  }
  return [...seen]
}
