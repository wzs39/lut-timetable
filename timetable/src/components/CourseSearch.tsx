import { useState } from 'react'
import { searchSisuCourses, type SisuCourse } from '../lib/sisuCourse'
import { useI18n } from '../i18n'

/** Panel pencarian kursus di katalog SISU */
export default function CourseSearch() {
  const { t } = useI18n()
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<SisuCourse[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doSearch = async () => {
    const q = term.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    try {
      const list = await searchSisuCourses(q)
      setResults(list)
      if (list.length === 0) setError(t('noResults'))
    } catch {
      setResults(null)
      setError(t('searchFail'))
    } finally {
      setLoading(false)
    }
  }

  const openCourse = (c: SisuCourse) => {
    window.open(
      `https://sisu.lut.fi/student/courseunit/${c.id}`,
      '_blank',
      'noopener',
    )
  }

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
        {t('courseSearch')}
      </h2>
      <div className="flex gap-1.5">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder={t('courseSearchPh')}
          className="flex-1 min-w-0 rounded-md bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs focus:outline-none focus:border-sky-500"
        />
        <button
          onClick={doSearch}
          disabled={loading}
          className="rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-50 px-2.5 py-1 text-xs font-medium"
        >
          {loading ? '…' : t('search')}
        </button>
      </div>

      {error && <p className="text-[11px] text-rose-400 mt-1">{error}</p>}

      {results && results.length > 0 && (
        <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => openCourse(c)}
              className="w-full text-left rounded-md bg-zinc-800/70 hover:bg-zinc-700/70 border border-zinc-700 px-2 py-1.5"
            >
              <span className="text-xs font-medium text-sky-300">{c.code}</span>
              <span className="text-[11px] text-zinc-300"> · {c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
