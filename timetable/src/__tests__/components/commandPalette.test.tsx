// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CommandPalette from '../../components/CommandPalette'
import { I18nProvider, useI18n } from '../../i18n'
import { buildPalette, type PaletteAction } from '../../lib/palette'
import type { Lesson } from '../../types'
import type { Task } from '../../lib/tasks'

// 【渲染契约】命令面板：输入筛选 → ↑↓ 移动 → Enter/点击执行；Esc 关闭；
// 分组标题出现在第一项与分组切换处。动作本身由 App 解释，这里只断言回调。

const lessons: Lesson[] = [
  {
    id: 'l1',
    source: 'sisu',
    title: 'Software Engineering',
    code: 'CT60A4050',
    start: '2026-09-21T08:00:00.000Z',
    end: '2026-09-21T10:00:00.000Z',
  },
]

const tasks: Task[] = [
  {
    id: 't1',
    title: 'Essay deadline',
    course: 'HDD4010',
    completed: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
]

/** 用真实 i18n 构建候选（面板文案 = 应用文案，assertion 才可信） */
function Harness({
  onRun,
  onClose,
}: {
  onRun: (a: PaletteAction) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const items = buildPalette({ t, locale: 'zh-CN', lessons, tasks, dupCount: 0 })
  return <CommandPalette items={items} onRun={onRun} onClose={onClose} />
}

function mount() {
  const onRun = vi.fn()
  const onClose = vi.fn()
  render(
    <I18nProvider>
      <Harness onRun={onRun} onClose={onClose} />
    </I18nProvider>,
  )
  return { onRun, onClose }
}

const input = () => screen.getByLabelText('命令面板 (Ctrl+K)')

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('CommandPalette', () => {
  it('renders group headers and the shortcut hint while browsing', () => {
    mount()
    // 分组标题按渲染顺序出现（切换分支：标题只在组切换处渲染一次）
    const headers = [...document.querySelectorAll('div.uppercase')].map((el) => el.textContent)
    expect(headers).toEqual(['视图', '操作', '课程', '作业'])
    expect(screen.getByText(/快捷键：1–4 切换视图/)).toBeTruthy()
  })

  it('filters to a course and runs it on Enter', () => {
    const { onRun } = mount()
    fireEvent.change(input(), { target: { value: 'ct60' } })
    expect(screen.getByText('CT60A4050')).toBeTruthy()
    expect(screen.queryByText('Essay deadline')).toBeNull()

    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onRun).toHaveBeenCalledWith({
      kind: 'course',
      code: 'CT60A4050',
      title: 'Software Engineering',
    })
  })

  it('matches assignments by title and runs the task action on click', () => {
    const { onRun } = mount()
    fireEvent.change(input(), { target: { value: 'essay' } })
    fireEvent.click(screen.getByText('Essay deadline'))
    expect(onRun).toHaveBeenCalledWith({ kind: 'task', taskId: 't1' })
  })

  it('moves the highlight with arrow keys and runs the highlighted action', () => {
    const { onRun } = mount()
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    // 视图顺序：今日 → 本周课表 → 作业
    expect(onRun).toHaveBeenCalledWith({ kind: 'view', view: 'assign' })
  })

  it('wraps the highlight inside the result list', () => {
    const { onRun } = mount()
    fireEvent.change(input(), { target: { value: '设置' } })
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onRun).toHaveBeenCalledWith({ kind: 'settings' })
  })

  it('closes on Escape without running anything', () => {
    const { onRun, onClose } = mount()
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onRun).not.toHaveBeenCalled()
  })

  it('shows the empty state when nothing matches', () => {
    const { onRun } = mount()
    fireEvent.change(input(), { target: { value: 'zzzzz' } })
    expect(screen.getByText('没有匹配项')).toBeTruthy()
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onRun).not.toHaveBeenCalled()
  })
})
