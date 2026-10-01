import { describe, expect, it } from 'vitest'
import { supportsSsoLogin } from '../lib/ssoLogin'

describe('Moodle SSO availability', () => {
  it('offers login only when a native or Electron return bridge is available', () => {
    expect(supportsSsoLogin(false, false)).toBe(false)
    expect(supportsSsoLogin(true, false)).toBe(true)
    expect(supportsSsoLogin(false, true)).toBe(true)
    expect(supportsSsoLogin(true, true)).toBe(true)
  })
})
