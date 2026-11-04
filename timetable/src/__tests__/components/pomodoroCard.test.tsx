// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '../../i18n'
import PomodoroCard from '../../components/PomodoroCard'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

function renderCard(node: ReactElement = <PomodoroCard />) {
  return render(<I18nProvider>{node}</I18nProvider>)
}

describe('PomodoroCard component', () => {
  it('renders the header and idle state by default', () => {
    renderCard()
    expect(screen.getByText(/番茄钟|Pomodoro/i)).toBeTruthy()
    expect(screen.getByText('25:00')).toBeTruthy()
    expect(screen.getByRole('button', { name: /开始专注|Start focus/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /短休息|Short break/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /长休息|Long break/i })).toBeTruthy()
  })

  it('starts the timer on clicking start focus', () => {
    renderCard()
    const startBtn = screen.getByRole('button', { name: /开始专注|Start focus/i })
    fireEvent.click(startBtn)

    // Now it should be running, showing Pause button and Skip / End timer
    expect(screen.getByRole('button', { name: /暂停|Pause/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /跳过|Skip/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /结束计时|Reset|End/i })).toBeTruthy()
  })

  it('pauses and resumes when clicking pause and resume buttons', () => {
    renderCard()
    const startBtn = screen.getByRole('button', { name: /开始专注|Start focus/i })
    fireEvent.click(startBtn)

    const pauseBtn = screen.getByRole('button', { name: /暂停|Pause/i })
    fireEvent.click(pauseBtn)

    const resumeBtn = screen.getByRole('button', { name: /继续|Resume/i })
    expect(resumeBtn).toBeTruthy()

    fireEvent.click(resumeBtn)
    expect(screen.getByRole('button', { name: /暂停|Pause/i })).toBeTruthy()
  })

  it('skips to next phase on clicking skip', () => {
    renderCard()
    const startBtn = screen.getByRole('button', { name: /开始专注|Start focus/i })
    fireEvent.click(startBtn)

    const skipBtn = screen.getByRole('button', { name: /跳过|Skip/i })
    fireEvent.click(skipBtn)

    // After focus, skipping goes to short break (05:00 or 05:01)
    expect(screen.getByText(/05:0[01]/)).toBeTruthy()
  })

  it('resets timer back to idle state on clicking reset', () => {
    renderCard()
    const startBtn = screen.getByRole('button', { name: /开始专注|Start focus/i })
    fireEvent.click(startBtn)

    const resetBtn = screen.getByRole('button', { name: /结束计时|Reset|End/i })
    fireEvent.click(resetBtn)

    expect(screen.getByRole('button', { name: /开始专注|Start focus/i })).toBeTruthy()
    expect(screen.getByText('25:00')).toBeTruthy()
  })
})
