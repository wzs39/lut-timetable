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
    location: '1325',
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
  const items = buildPalette({
    t,
    locale: 'zh-CN',
    lessons,
    tasks,
    commands: [{ id: 'settings', label: t('settingsTitle'), icon: 'settings' as const }],
  })
  return <CommandPalette items={items} lessons={lessons} onRun={onRun} onClose={onClose} />
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
    expect(onRun).toHaveBeenCalledWith({ kind: 'command', id: 'settings' })
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

  it('parses natural-language study block creation (Omni-Command 2.0)', () => {
    const { onRun } = mount()
    fireEvent.change(input(), { target: { value: '周四 15:00 算法复习 90m' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onRun).toHaveBeenCalledTimes(1)
    const action = onRun.mock.calls[0][0] as PaletteAction
    expect(action.kind).toBe('quickAddStudyBlock')
    if (action.kind === 'quickAddStudyBlock') {
      expect(action.title).toContain('算法复习')
      expect(action.durationMin).toBe(90)
    }
  })

  it('renders classroom full-day 08:00-20:00 occupancy visual timeline on room query', () => {
    const { onRun } = mount()
    fireEvent.change(input(), { target: { value: 'room 1325' } })
    expect(screen.getByTestId('room-timeline-1325')).toBeTruthy()
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'roomStatus',
        room: '1325',
      }),
    )
  })

  it('computes inline grade target reverse calculation in one step', () => {
    const { onRun } = mount()
    fireEvent.change(input(), { target: { value: 'grade CT60A4050 4' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'gradeCalcResult',
        courseCode: 'CT60A4050',
        resultText: expect.stringContaining('80%'),
      }),
    )
  })

  it('dispatches Unified Course Dossier inspection via dossier query or inline button', () => {
    const { onRun } = mount()
    fireEvent.change(input(), { target: { value: 'dossier CT60A4050' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'dossier',
        code: 'CT60A4050',
      }),
    )
  })
})
