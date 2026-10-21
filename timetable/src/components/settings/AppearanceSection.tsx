import { useI18n } from '../../i18n'
import { useTheme } from '../../theme'
import { THEME_PRESETS, type Preset } from '../../lib/theme'
import type { Contrast, TextScale } from '../../lib/uiPrefs'
import { SectionTitle } from './shared'

/**
 * 外观与无障碍：深浅模式 / 配色预设 / 字号 / 对比度 / 语言。
 * 主题与预设由 ThemeProvider 持有；字号与对比度存 uiPrefs（CSS 读 <html> 属性）。
 */
export default function AppearanceSection({
  textScale,
  contrast,
  onTextScale,
  onContrast,
}: {
  textScale: TextScale
  contrast: Contrast
  onTextScale: (v: TextScale) => void
  onContrast: (v: Contrast) => void
}) {
  const { t, lang, setLang } = useI18n()
  const { theme, setTheme, preset, setPreset } = useTheme()

  return (
    <>
      {/* 外观：跟随系统 / 深色 / 浅色 */}
      <section>
        <SectionTitle>{t('themeTitle')}</SectionTitle>
        <div className="app-seg w-full">
          {(['system', 'dark', 'light'] as const).map((v) => (
            <button
              key={v}
              aria-pressed={theme === v}
              onClick={() => setTheme(v)}
              className="flex-1"
            >
              {t(v === 'system' ? 'themeSystem' : v === 'dark' ? 'themeDark' : 'themeLight')}
            </button>
          ))}
        </div>
      </section>

      {/* 预设配色：Nord / Catppuccin / …，与深浅模式正交，全模块即时生效 */}
      <section>
        <SectionTitle>{t('presetTitle')}</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.id}
              aria-pressed={preset === p.id}
              onClick={() => setPreset(p.id as Preset)}
              className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2 transition-colors ${
                preset === p.id
                  ? 'border-[var(--info)] bg-[var(--tint-info)]'
                  : 'border-[var(--line)] hover:bg-[var(--hover-1)]'
              }`}
              title={t('presetHint')}
            >
              <span className="flex">
                {p.swatch.map((c) => (
                  <span
                    key={c}
                    className="h-4 w-4 first:rounded-l-full last:rounded-r-full"
                    style={{ background: c }}
                  />
                ))}
              </span>
              <span className="text-[10px] leading-none text-[var(--text-2)]">
                {p.id === 'default' ? t('presetDefault') : p.name}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* 无障碍：字号与对比度（存 uiPrefs，写在 <html> 上由 CSS 消费） */}
      <section>
        <SectionTitle>{t('a11yTitle')}</SectionTitle>
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-2)]">
          <input
            type="checkbox"
            checked={textScale === 'large'}
            onChange={(e) => onTextScale(e.target.checked ? 'large' : 'normal')}
            className="accent-sky-500"
          />
          {t('a11yLargeText')}
        </label>
        <label className="mt-1 flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-2)]">
          <input
            type="checkbox"
            checked={contrast === 'high'}
            onChange={(e) => onContrast(e.target.checked ? 'high' : 'normal')}
            className="accent-sky-500"
          />
          {t('a11yHighContrast')}
        </label>
      </section>

      {/* 语言 */}
      <section>
        <SectionTitle>{t('langTitle')}</SectionTitle>
        <div className="app-seg w-full">
          {(['zh', 'en'] as const).map((v) => (
            <button
              key={v}
              aria-pressed={lang === v}
              onClick={() => setLang(v)}
              className="flex-1"
            >
              {v === 'zh' ? '中文' : 'English'}
            </button>
          ))}
        </div>
      </section>
    </>
  )
}
