// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ExternalLink from '../../components/ExternalLink'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ExternalLink', () => {
  it('keeps href for right-click and opens exactly once per click', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<ExternalLink href="https://elut.lut.fi/en">eLUT</ExternalLink>)
    const link = screen.getByRole('link', { name: 'eLUT' })

    expect(link.getAttribute('href')).toBe('https://elut.lut.fi/en')
    fireEvent.click(link)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://elut.lut.fi/en', '_blank', 'noopener')
  })

  it('does not leak the click to a clickable parent row when asked', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onParent = vi.fn()
    render(
      <div onClick={onParent}>
        <ExternalLink href="https://moodle.lut.fi/x" stopPropagation>
          open
        </ExternalLink>
      </div>,
    )
    fireEvent.click(screen.getByRole('link', { name: 'open' }))
    expect(onParent).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledTimes(1)
  })
})
