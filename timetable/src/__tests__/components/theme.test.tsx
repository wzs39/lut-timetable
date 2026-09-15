// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider, useTheme } from '../../theme'
import { KEYS } from '../../lib/storage'

/** Dua konsumen independen — keduanya harus membaca nilai yang sama. */
function Reader({ id }: { id: string }) {
  const { theme } = useTheme()
  return <span data-testid={id}>{theme}</span>
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>toggle</button>
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    cleanup()
    document.documentElement.removeAttribute('data-theme')
  })

  it('hands every consumer the same theme, and a change is persisted + applied', () => {
    render(
      <ThemeProvider>
        <Reader id="a" />
        <Reader id="b" />
        <ThemeToggle />
      </ThemeProvider>,
    )

    expect(screen.getByTestId('a').textContent).toBe('dark')
    expect(screen.getByTestId('b').textContent).toBe('dark')
    expect(localStorage.getItem(KEYS.theme)).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    fireEvent.click(screen.getByText('toggle'))

    expect(screen.getByTestId('a').textContent).toBe('light')
    expect(screen.getByTestId('b').textContent).toBe('light')
    expect(localStorage.getItem(KEYS.theme)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('starts from the persisted value after a reload', () => {
    localStorage.setItem(KEYS.theme, 'light')
    render(
      <ThemeProvider>
        <Reader id="a" />
      </ThemeProvider>,
    )

    expect(screen.getByTestId('a').textContent).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('rejects a consumer that is not inside the provider', () => {
    expect(() => render(<Reader id="a" />)).toThrow(/ThemeProvider/)
  })
})
