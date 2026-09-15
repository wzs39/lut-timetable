import type { LessonSource, LessonType } from '../types'
import { KEYS, readJson, writeJson } from './storage'

export interface FilterPreset {
  id: string
  name: string
  q: string
  from: string
  to: string
  /** 0=周一..6=周日 */
  days: number[]
  /** 空数组 = 全部来源 */
  sources: LessonSource[]
  /** 空数组 = 全部类型 */
  types: LessonType[]
  sort: 'time' | 'name' | 'source'
}

export function loadPresets(): FilterPreset[] {
  const arr = readJson<unknown>(KEYS.filterPresets, [])
  return Array.isArray(arr) ? (arr as FilterPreset[]) : []
}

function savePresets(p: FilterPreset[]) {
  writeJson(KEYS.filterPresets, p)
}

export function addPreset(
  preset: Omit<FilterPreset, 'id'>,
): FilterPreset[] {
  const list = loadPresets()
  const entry: FilterPreset = { ...preset, id: crypto.randomUUID() }
  savePresets([...list, entry])
  return [...list, entry]
}

export function removePreset(id: string): FilterPreset[] {
  const list = loadPresets().filter((p) => p.id !== id)
  savePresets(list)
  return list
}
