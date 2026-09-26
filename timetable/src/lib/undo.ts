import type { Lesson } from '../types'

/**
 * 删除/隐藏操作的撤销快照（数据侧）。
 *
 * 只保存「回到操作前」所需的最小信息：被移除的 lesson 对象、它们在原
 * 数组中的位置，以及删除时一并失效的同步保护键（tombstone / override /
 * hidden）。复原副作用（写回 localStorage）由 store/useTimetable 负责，
 * 这里保持纯函数以便单测。
 */
export interface LessonSlot {
  lesson: Lesson
  /** 删除前在 lessons 数组中的下标 */
  index: number
}

/** 取出要移除的 lesson 及其原下标（顺序 = 数组顺序） */
export function pickSlots(lessons: Lesson[], ids: Iterable<string>): LessonSlot[] {
  const set = new Set(ids)
  const out: LessonSlot[] = []
  lessons.forEach((lesson, index) => {
    if (set.has(lesson.id)) out.push({ lesson, index })
  })
  return out
}

/**
 * 撤销时把快照放回原下标位置。已存在的 id 跳过（幂等：重复点「撤销」
 * 或撤销后又同步回来的课程都不会重复插入）。下标越界时夹到末尾。
 */
/**
 * 删除 / 隐藏操作的完整撤销快照：数据 + 同步保护键。
 * useTimetable 负责生产与消费（还原 localStorage 副作用），
 * App 只负责把它挂到撤销条上。
 */
export interface TimetableUndo {
  /** 被移除的 lesson（隐藏操作不填：只是不显示） */
  slots: LessonSlot[]
  /** 操作写入的 tombstone key（撤销时移除，让课程可再次同步进来） */
  tombstones: string[]
  /** 操作清掉的用户编辑 override（撤销时写回） */
  overrides: Record<string, Partial<Lesson>>
  /** 操作写入的 hidden key（撤销时移除） */
  hidden: string[]
}

export function restoreSlots(lessons: Lesson[], slots: LessonSlot[]): Lesson[] {
  const out = [...lessons]
  for (const slot of [...slots].sort((a, b) => a.index - b.index)) {
    if (out.some((l) => l.id === slot.lesson.id)) continue
    out.splice(Math.max(0, Math.min(slot.index, out.length)), 0, slot.lesson)
  }
  return out
}
