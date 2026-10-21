import { KEYS, readJson, writeJson } from './storage'

export interface SisuScenarioPrefs {
  targetYears: number
  cancelledCodes: string[]
  reduceToMinimum: boolean
  /** Level overloaded terms by shifting courses inside the same year's P1–P4. */
  autoBalance: boolean
  /** Only use windows inside the SISU offering pattern (smaller levelling, no verification needed). */
  strictOffering: boolean
}

export const DEFAULT_SCENARIO_PREFS: SisuScenarioPrefs = {
  targetYears: 3,
  cancelledCodes: [],
  reduceToMinimum: false,
  autoBalance: false,
  strictOffering: false,
}

export function normalizeScenarioPrefs(value: unknown): SisuScenarioPrefs {
  const raw = value && typeof value === 'object' ? value as Partial<SisuScenarioPrefs> : {}
  const years = Number(raw.targetYears)
  return {
    targetYears: Number.isFinite(years) ? Math.max(1, Math.min(6, Math.round(years))) : DEFAULT_SCENARIO_PREFS.targetYears,
    cancelledCodes: Array.isArray(raw.cancelledCodes)
      ? [...new Set(raw.cancelledCodes
        .filter((code): code is string => typeof code === 'string' && code.trim().length > 0)
        .map((code) => code.trim().toUpperCase().replace(/-\d{4}$/, '')))]
      : [],
    reduceToMinimum: raw.reduceToMinimum === true,
    // Booleans are booleans: a stored "yes"/1 must not silently turn this on.
    autoBalance: raw.autoBalance === true,
    strictOffering: raw.strictOffering === true,
  }
}

export function loadScenarioPrefs(): SisuScenarioPrefs {
  return normalizeScenarioPrefs(readJson<unknown>(KEYS.sisuScenario, DEFAULT_SCENARIO_PREFS))
}

export function saveScenarioPrefs(patch: Partial<SisuScenarioPrefs>): SisuScenarioPrefs {
  const next = normalizeScenarioPrefs({ ...loadScenarioPrefs(), ...patch })
  writeJson(KEYS.sisuScenario, next)
  return next
}
