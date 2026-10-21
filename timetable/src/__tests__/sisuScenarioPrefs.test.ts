// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SCENARIO_PREFS, loadScenarioPrefs, normalizeScenarioPrefs, saveScenarioPrefs } from '../lib/sisuScenarioPrefs'
import { BACKUP_KEYS, KEYS } from '../lib/storage'

beforeEach(() => localStorage.clear())

describe('scenario preferences', () => {
  it('starts at three years with no cancellations and no levelling', () => {
    expect(loadScenarioPrefs()).toEqual(DEFAULT_SCENARIO_PREFS)
    expect(DEFAULT_SCENARIO_PREFS.autoBalance).toBe(false)
    expect(DEFAULT_SCENARIO_PREFS.strictOffering).toBe(false)
    expect(BACKUP_KEYS).toContain(KEYS.sisuScenario)
  })

  it('clamps years, normalizes codes and only trusts a real boolean', () => {
    expect(normalizeScenarioPrefs({ targetYears: 99, cancelledCodes: [' ct60a4050-3001 ', 'CT60A4050', ''], reduceToMinimum: 'yes' }))
      .toEqual({ targetYears: 6, cancelledCodes: ['CT60A4050'], reduceToMinimum: false, autoBalance: false, strictOffering: false })
    expect(normalizeScenarioPrefs({ targetYears: 0 }).targetYears).toBe(1)
    expect(normalizeScenarioPrefs(null)).toEqual(DEFAULT_SCENARIO_PREFS)
  })

  it('keeps the levelling switches off unless they are stored as true', () => {
    expect(normalizeScenarioPrefs({ autoBalance: 'yes', strictOffering: 1 })).toMatchObject({ autoBalance: false, strictOffering: false })
    expect(normalizeScenarioPrefs({ autoBalance: true, strictOffering: true })).toMatchObject({ autoBalance: true, strictOffering: true })
  })

  it('merges patches and persists the normalized result', () => {
    saveScenarioPrefs({ targetYears: 2, cancelledCodes: ['zz901-3001'] })
    const next = saveScenarioPrefs({ reduceToMinimum: true })
    expect(next).toEqual({ targetYears: 2, cancelledCodes: ['ZZ901'], reduceToMinimum: true, autoBalance: false, strictOffering: false })
    expect(loadScenarioPrefs()).toEqual(next)
  })
})
