// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import AppMenu from '../../components/AppMenu'
import type { AppCommand } from '../../lib/commands'

afterEach(cleanup)

const commands: AppCommand[] = [
  {
    id: 'settings',
    label: '设置',
    icon: 'settings',
    run: vi.fn(),
    showInMenu: true,
  },
  {
    id: 'update',
    label: '检查更新',
    icon: 'sync',
    run: vi.fn(),
    showInMenu: true,
  },
]

describe('AppMenu', () => {
  it('renders the registry order and closes after running an item', () => {
    const onClose = vi.fn()
    render(<AppMenu open commands={commands} onClose={onClose} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      '设置',
      '检查更新',
    ])
    fireEvent.click(screen.getByText('检查更新'))
    expect(commands[1].run).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when closed', () => {
    const { container } = render(<AppMenu open={false} commands={commands} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})
