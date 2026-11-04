// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '../../i18n'
import BreakGame from '../../components/BreakGame'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

function renderGame() {
  return render(
    <I18nProvider>
      <BreakGame />
    </I18nProvider>,
  )
}

describe('BreakGame component', () => {
  it('renders canvas and controls correctly', () => {
    const { container } = renderGame()
    expect(screen.getByText(/课间减压|Break Game/i)).toBeTruthy()
    expect(screen.getByText(/得分|Score/i)).toBeTruthy()
    expect(screen.getByText(/最高|High/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /跳跃|Jump/i })).toBeTruthy()

    const canvas = container.querySelector('canvas')
    expect(canvas).toBeTruthy()
  })

  it('handles jump button click and canvas click without errors', () => {
    const { container } = renderGame()
    const jumpBtn = screen.getByRole('button', { name: /跳跃|Jump/i })
    fireEvent.click(jumpBtn)

    const canvas = container.querySelector('canvas')
    if (canvas) {
      fireEvent.click(canvas)
    }
  })

  it('listens for keyboard space and arrow up events', () => {
    renderGame()
    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    fireEvent.keyDown(window, { code: 'ArrowUp', key: 'ArrowUp' })
    fireEvent.keyDown(window, { code: 'KeyA', key: 'a' })
  })
})
