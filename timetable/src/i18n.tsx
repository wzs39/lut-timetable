import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { KEYS, readString, writeString } from './lib/storage'
import { messages, type Lang } from './i18n/messages'
export type { Lang } from './i18n/messages'


/** Locale untuk toLocaleDateString / toLocaleTimeString */
export const localeOf: Record<Lang, string> = { zh: 'zh-CN', en: 'en-US' }


interface I18nCtx {
  lang: Lang
  /** Locale BCP-47 untuk toLocaleDateString / toLocaleTimeString */
  locale: string
  setLang: (l: Lang) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const Ctx = createContext<I18nCtx | null>(null)



/** 纯查表：少键时回退英语，再不行才露出 key。Provider 的 `t` 与不需要 React
 *  的地方（主进程托盘菜单文案等）共用同一套回退规则。 */
export function translate(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>,
): string {
  let s = messages[lang][key] ?? messages.en[key] ?? key
  if (params) {
    for (const [p, v] of Object.entries(params)) {
      s = s.replaceAll(`{${p}}`, String(v))
    }
  }
  return s
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = readString(KEYS.lang)
    return saved === 'en' || saved === 'zh' ? saved : 'zh'
  })

  useEffect(() => {
    writeString(KEYS.lang, lang)
    document.documentElement.lang = localeOf[lang]
  }, [lang])

  const t = (key: string, params?: Record<string, string | number>): string =>
    translate(lang, key, params)

  return (
    <Ctx.Provider value={{ lang, locale: localeOf[lang], setLang, t }}>
      {children}
    </Ctx.Provider>
  )
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
