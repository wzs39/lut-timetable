// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '../../i18n'
import PendingNotificationsPanel from '../../components/PendingNotificationsPanel'
import { KEYS } from '../../lib/storage'
import { studyBlockNotifId } from '../../lib/studyBlockReminders'
import { saveStudyBlockPrefs } from '../../lib/studyBlockPrefs'

/**
 * 【接线契约】设置 → 日志与订阅 里的「已排期通知」面板。
 *
 * 它存在的理由就是「勾了开关却没提醒」时能自己查出**为什么**，所以断言的重点是：
 * 队列里有东西要列出来（含下一跳）、空队列要说清是空的、**读失败必须把原因显示出来
 * 而不是显示成空队列**（把失败伪装成「没排期」正好掩盖了要查的那个问题）。
 */

const { mockGetPending } = vi.hoisted(() => ({
  mockGetPending: vi.fn<() => Promise<unknown>>(),
}))

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { getPending: mockGetPending },
}))

/**
 * 三个开关的默认值都是「关」，而关着的家族本就不该有排期——诊断期望要跟着开关走，
 * 否则每台新装设备都会看到一堆「应该排上却没排上」的假警报。
 */
function setSwitches({ content = false, digest = false, blocks = false } = {}) {
  localStorage.setItem(KEYS.notif, String(content))
  localStorage.setItem(KEYS.digest, String(digest))
  saveStudyBlockPrefs({ remindEnabled: blocks })
}

/** 种一条未来学习块（日期从 Date.now() 推导，别写字面量）+ 可选的记账清单。 */
function seedFutureBlock(blockId: string, tracked: number[]) {
  const start = new Date(Date.now() + 2 * 3600 * 1000)
  const block = {
    id: blockId,
    sourceKind: 'task',
    sourceId: blockId,
    title: '诊断面板块',
    dueAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 30 * 60000).toISOString(),
    createdAt: new Date().toISOString(),
  }
  localStorage.setItem(KEYS.studyBlocks, JSON.stringify([block]))
  if (tracked.length > 0) localStorage.setItem(`${KEYS.studyBlocks}:scheduled`, JSON.stringify(tracked))
}

// 源码当数据集读（desktop.test.ts 同一惯用法）：glob 的键形状随 Vite 变化，按后缀取。
const sources = import.meta.glob(
  ['../../components/Settings.tsx', '../../components/settings/*.tsx'],
  {
  query: '?raw',
  import: 'default',
    eager: true,
  },
) as Record<string, string>

function renderPanel() {
  render(
    <I18nProvider>
      <PendingNotificationsPanel />
    </I18nProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.removeItem(KEYS.studyBlocks)
  localStorage.removeItem(`${KEYS.studyBlocks}:scheduled`)
  localStorage.removeItem(KEYS.studyBlockPrefs)
  localStorage.removeItem(KEYS.notif)
  localStorage.removeItem(KEYS.digest)
})

describe('PendingNotificationsPanel', () => {
  it('lists the queued notifications with the next one called out', async () => {
    mockGetPending.mockResolvedValue({
      notifications: [
        { id: 1, title: '学习时段提醒', body: '有效块 · 10:00 开始', schedule: { at: '2030-01-01T07:50:00.000Z' } },
        { id: 2, title: '作业即将截止', body: '报告 A · 截止 10月17日', schedule: { at: '2030-01-01T09:00:00.000Z' } },
      ],
    })
    renderPanel()

    // 「下一条」行与列表行都会出现同一个标题，所以按出现次数断言而不是唯一命中
    await waitFor(() => expect(screen.getAllByText(/学习时段提醒/).length).toBeGreaterThanOrEqual(1))
    expect(screen.getByText('已排期通知 (2)')).toBeTruthy()
    expect(screen.getByText(/下一条：.*学习时段提醒/)).toBeTruthy()
    expect(screen.getAllByText(/作业即将截止/).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/系统队列里没有排期中的提醒/)).toBeNull()
    // 读取时刻必须显示：诊断要能区分「刚刚读过是空的」与「从来没读成功」
    await waitFor(() => expect(screen.getByText(/读取于 /)).toBeTruthy())
  })

  it('says the queue is empty without hiding the reason when the plugin fails', async () => {
    mockGetPending.mockRejectedValue(new Error('LocalNotifications.getPending not implemented on web'))
    renderPanel()

    await waitFor(() => expect(screen.getByText(/读不到系统队列/)).toBeTruthy())
    expect(screen.getByText(/not implemented on web/)).toBeTruthy()
    // 失败不等于空队列：不能显示空态文案，也不报数字（数字只在读成功时才可信）
    expect(screen.queryByText(/系统队列里没有排期中的提醒/)).toBeNull()
    expect(screen.queryByText(/已排期通知 \(/)).toBeNull()
  })

  it('shows the empty state only on a successful read with nothing queued', async () => {
    mockGetPending.mockResolvedValue({ notifications: [] })
    renderPanel()

    await waitFor(() => expect(screen.getByText(/系统队列里没有排期中的提醒/)).toBeTruthy())
    expect(screen.getByText('已排期通知 (0)')).toBeTruthy()
    expect(screen.queryByText(/读不到系统队列/)).toBeNull()
  })

  it('re-reads on demand and reflects the new queue', async () => {
    mockGetPending.mockResolvedValueOnce({ notifications: [] })
    renderPanel()
    await waitFor(() => expect(screen.getByText('已排期通知 (0)')).toBeTruthy())

    mockGetPending.mockResolvedValueOnce({
      notifications: [{ id: 5, title: '课程提醒', schedule: { at: '2030-01-01T07:00:00.000Z' } }],
    })
    screen.getByText('重新读取').click()

    await waitFor(() => expect(screen.getByText('已排期通知 (1)')).toBeTruthy())
    expect(screen.getAllByText(/课程提醒/).length).toBeGreaterThanOrEqual(1)
    expect(mockGetPending).toHaveBeenCalledTimes(2)
  })

  it('warns when an expected study-block reminder is missing from the queue', async () => {
    setSwitches({ blocks: true })
    seedFutureBlock('panel-block', [])
    mockGetPending.mockResolvedValue({ notifications: [] })
    renderPanel()

    // 队列为空但“应该有”一条 → 必须报缺失，而不是只显示“没有排期中的提醒”
    await waitFor(() => expect(screen.getByText(/应该排上却没排上/)).toBeTruthy())
    // 有缺失就不能同时报“已就位”（同页两个相反结论是最坏的诊断）
    expect(screen.queryByText(/条已就位/)).toBeNull()
  })

  it('reports nothing when every family is switched off (silent switches are not faults)', async () => {
    setSwitches()
    seedFutureBlock('panel-block', [])
    mockGetPending.mockResolvedValue({ notifications: [] })
    renderPanel()

    // 学习块提醒关着、内容/摘要也关着 → 那条块“没排上”不是故障
    await waitFor(() => expect(screen.getByText('已排期通知 (0)')).toBeTruthy())
    expect(screen.queryByText(/应该排上却没排上/)).toBeNull()
    expect(screen.queryByText(/条已就位/)).toBeNull()
  })

  it('confirms the reminders are armed when bookkeeping and queue agree', async () => {
    setSwitches({ blocks: true })
    const id = studyBlockNotifId('panel-block', 10)
    seedFutureBlock('panel-block', [id])
    mockGetPending.mockResolvedValue({
      notifications: [{ id, title: '学习时段提醒', schedule: { at: new Date(Date.now() + 3600000).toISOString() } }],
    })
    renderPanel()

    // 逐家一行：家族名 + 「N 条已就位」是同一行里的两个节点（诊断要的是「哪一家」）
    await waitFor(() => expect(screen.getByText('1 条已就位')).toBeTruthy())
    // 「学习时段提醒」既是家族标签、也是队列里那条通知的标题 —— 所以按次数断言
    expect(screen.getAllByText('学习时段提醒').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/应该排上却没排上/)).toBeNull()
    expect(screen.queryByText(/缺 \d+ 条/)).toBeNull()
  })

  it('is mounted inside the settings logs group (wiring guard)', () => {
    // 设置拆成分区文件后，「logs 分组里挂了面板」变成两跳：
    // Settings.tsx 的 logs 分组渲染 <LogsSection>，LogsSection 渲染面板。
    const source = (suffix: string) =>
      sources[Object.keys(sources).find((k) => k.endsWith(suffix)) ?? ''] ?? ''
    const settings = source('Settings.tsx')
    expect(settings.length, 'Settings.tsx 没进 import.meta.glob，接线守卫等于没跑').toBeGreaterThan(1000)
    // 分组属性可以换行（导轨改造后 id / title / active 各占一行），
    // 所以这里匹配「含 id="logs" 的 Group 块」而不是一行字面量。
    const logs = settings.search(/<Group[\s\S]{0,200}?id="logs"/)
    expect(logs, 'Settings.tsx 里找不到 logs 分组').toBeGreaterThan(-1)
    expect(settings.indexOf('<LogsSection', logs), 'logs 分组没渲染 LogsSection').toBeGreaterThan(logs)

    const logsSection = source('settings/LogsSection.tsx')
    expect(logsSection.length, 'LogsSection.tsx 没进 import.meta.glob').toBeGreaterThan(500)
    expect(logsSection).toContain('<PendingNotificationsPanel />')
  })
})
