// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openExternal } from '../lib/openExternal'

afterEach(() => vi.restoreAllMocks())

/** Kedua aksi disuntik supaya cabang native benar-benar dieksekusi di tes. */
function spyActions() {
  return { navigate: vi.fn(), openTab: vi.fn() }
}

describe('openExternal', () => {
  it('navigates the main frame on native WebViews', () => {
    // Tab baru / target kosong diabaikan di sana — lihat lib/openExternal.ts.
    const actions = spyActions()
    openExternal('https://elut.lut.fi/en', { platform: 'android', actions })
    expect(actions.navigate).toHaveBeenCalledWith('https://elut.lut.fi/en')
    expect(actions.openTab).not.toHaveBeenCalled()
  })

  it('navigates the main frame on iOS too', () => {
    const actions = spyActions()
    openExternal('https://elut.lut.fi/en', { platform: 'ios', actions })
    expect(actions.navigate).toHaveBeenCalledTimes(1)
    expect(actions.openTab).not.toHaveBeenCalled()
  })

  it('opens a tab in the browser so the SPA stays loaded', () => {
    const actions = spyActions()
    openExternal('https://elut.lut.fi/en', { platform: 'web', actions })
    expect(actions.openTab).toHaveBeenCalledWith('https://elut.lut.fi/en')
    expect(actions.navigate).not.toHaveBeenCalled()
  })

  it('defaults to a fresh tab on the web', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    openExternal('https://elut.lut.fi/en', { platform: 'web' })
    expect(open).toHaveBeenCalledWith('https://elut.lut.fi/en', '_blank', 'noopener')
  })

  it('falls back to the Capacitor platform when none is given', () => {
    // jsdom has no androidBridge/webkit bridge, so Capacitor reports 'web'.
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    openExternal('https://elut.lut.fi/en')
    expect(open).toHaveBeenCalledTimes(1)
  })
})
