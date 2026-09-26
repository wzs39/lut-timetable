import { useEffect, useRef } from 'react'
import { pushBackgroundSeed } from '../lib/backgroundSeed'
import { drainWidgetTaskOps } from '../lib/widgetData'
import { taskCmidOf } from '../lib/submissions'
import { updateTask, type Task } from '../lib/tasks'

/**
 * 小组件（widget）后台回调的两条线，都只在 App 挂载一次：
 *
 * 1. 勾选回灌：桌面/移动小组件里的复选框可能发生在应用被杀时——在最早的机会
 *    排空 widget_task_ops_v1 队列（boot + 每次回前台）。Moodle 活动任务再走
 *    pushTaskCompletion 服务器反向同步，与 UI 内勾选完全同一链路。
 * 2. 种子重抓：任务变化后刷新后台 pass 用的种子（小组件载荷跟着变）。
 */
export function useWidgetTaskBridge(params: {
  tasks: Task[]
  setTasks: (t: Task[]) => void
  pushTaskCompletion: (cmid: number, completed: boolean) => void
}) {
  const { tasks, setTasks, pushTaskCompletion } = params

  const tasksRef = useRef<Task[]>(tasks)
  const busyRef = useRef(false)

  // 最新任务列表存进 ref（而不是每次变更重挂监听）：由 effect 同步，渲染期不写 ref。
  // 声明在 drain 之前，同一次提交里先更新 ref、再（可能）跑 drain。
  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  useEffect(() => {
    const drain = async () => {
      if (busyRef.current) return
      busyRef.current = true
      try {
        for (const op of await drainWidgetTaskOps()) {
          const current = tasksRef.current.find((x) => x.id === op.id)
          if (!current || current.completed === op.completed) continue
          setTasks(updateTask(tasksRef.current, op.id, { completed: op.completed }))
          const cmid = taskCmidOf(current)
          if (cmid !== undefined) pushTaskCompletion(cmid, op.completed)
        }
      } finally {
        busyRef.current = false
      }
    }
    void drain()
    const onVis = () => {
      if (document.visibilityState === 'visible') void drain()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
    // pushTaskCompletion 稳定（useCallback [token]）；tasks 经 ref 读取避免重挂。
  }, [pushTaskCompletion, setTasks])

  useEffect(() => {
    void pushBackgroundSeed()
  }, [tasks])
}
