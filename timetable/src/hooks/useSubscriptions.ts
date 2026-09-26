import { useCallback, useEffect, useState } from 'react'
import type { Lesson } from '../types'
import { displayTitle } from '../lib/display'
import { uid } from '../lib/store'
import {
  addSubscription,
  loadSubscriptions,
  markFired,
  removeSubscription,
  saveSubscriptions,
  toggleSubscription,
  type Subscription,
} from '../lib/subscriptions'

/**
 * 订阅式提醒（课程变动 / 教室空出）：单一拥有者 + 持久化都在这里。
 *
 * 取消课程订阅是**删除**而不是静音——从课程详情点掉这个开关的人就是不想再要它；
 * 静音留给设置页的列表（那里有单独的勾选框）。
 */
export function useSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(() => loadSubscriptions())

  useEffect(() => saveSubscriptions(subscriptions), [subscriptions])

  /** 订阅 / 取消订阅一门课的变动提醒。 */
  const watchCourse = useCallback((lesson: Lesson, on: boolean) => {
    setSubscriptions((prev) => {
      const code = lesson.code ?? ''
      if (!code) return prev
      if (!on) {
        return prev.filter(
          (s) => !(s.kind === 'course-change' && s.target.toLowerCase() === code.toLowerCase()),
        )
      }
      return addSubscription(prev, {
        id: `sub-${uid()}`,
        kind: 'course-change',
        target: code,
        label: displayTitle(lesson),
      })
    })
  }, [])

  /** 订阅 / 取消订阅一间教室（或一栋楼）的空出提醒。 */
  const watchRoom = useCallback((target: string, label: string, on: boolean) => {
    setSubscriptions((prev) => {
      if (!on) {
        return prev.filter(
          (s) => !(s.kind === 'room-free' && s.target.toLowerCase() === target.toLowerCase()),
        )
      }
      return addSubscription(prev, {
        id: `sub-${uid()}`,
        kind: 'room-free',
        target,
        label,
      })
    })
  }, [])

  /** 通知已经按订阅发过一轮：盖上触发时间，避免下次打开又提醒一遍。 */
  const markFiredAt = useCallback(
    (ids: string[], at: string) => setSubscriptions((prev) => markFired(prev, ids, at)),
    [],
  )

  /** 设置页列表的勾选框 / 删除按钮。 */
  const toggle = useCallback(
    (id: string) => setSubscriptions((prev) => toggleSubscription(prev, id)),
    [],
  )
  const remove = useCallback(
    (id: string) => setSubscriptions((prev) => removeSubscription(prev, id)),
    [],
  )

  return { subscriptions, watchCourse, watchRoom, markFiredAt, toggle, remove }
}
