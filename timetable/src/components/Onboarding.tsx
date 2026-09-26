import { useState } from 'react'
import { useI18n } from '../i18n'
import Icon from './Icon'

interface Props {
  /** 添加课表源；返回 null = 链接无法识别（组件显示 badUrl） */
  onAddSource: (url: string) => string | null
  /** 用 LUT 账号登录 Moodle（SSO 流程由 App/MoodleProvider 处理） */
  onLoginMoodle: () => void
  /** 走完全部三步或「跳过引导」 */
  onFinish: () => void
  /** 打开设置（引导第二步的「稍后连接」副路径） */
  onOpenSettings: () => void
}

const STEPS = 3

/**
 * 首次启动三步引导：导入课表 → （可选）连接 Moodle → 完成。
 * 只在「无来源且无课程」的首次启动出现；之后可从命令面板重新打开。
 * 链接解析与同步副作用都在 App（sourceFromUrl + sync），这里只收集输入。
 */
export default function Onboarding({ onAddSource, onLoginMoodle, onFinish, onOpenSettings }: Props) {
  const { t } = useI18n()
  const [step, setStep] = useState(0)
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState(false)

  const addSource = () => {
    const id = onAddSource(url)
    if (!id) {
      setError(t('badUrl'))
      return
    }
    setError(null)
    setAdded(true)
    setUrl('')
    setStep(1)
  }

  const finishMoodle = () => {
    onLoginMoodle()
    setStep(2)
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="animate-modal-in w-full max-w-md overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-1)] shadow-2xl shadow-black/50">
        <div className="border-b border-[var(--line)] px-4 py-3">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-1)]">
            <Icon name="compass" size={15} /> {t('obTitle')}
          </h3>
          <div className="mt-2 flex items-center gap-1.5">
            {Array.from({ length: STEPS }, (_, i) => (
              <span
                key={i}
                className={
                  'h-1 flex-1 rounded-full ' +
                  (i <= step ? 'bg-[var(--accent)]' : 'bg-[var(--surface-2)]')
                }
              />
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-[var(--text-3)]">
            {t('obStepOf', { i: step + 1, n: STEPS })}
          </p>
        </div>

        <div className="space-y-3 px-4 py-4 text-xs">
          {step === 0 && (
            <>
              <h4 className="font-medium text-[var(--text-1)]">{t('obImportTitle')}</h4>
              <p className="leading-relaxed text-[var(--text-2)]">{t('obImportHint')}</p>
              <textarea
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t('pasteUrl')}
                rows={2}
                className="w-full resize-none rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-xs focus:border-[var(--info)] focus:outline-none"
              />
              {error && <p className="text-[11px] text-[var(--danger)]">{error}</p>}
              <button
                onClick={addSource}
                disabled={!url.trim()}
                className="app-btn-primary w-full px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                {t('obImportCta')}
              </button>
            </>
          )}

          {step === 1 && (
            <>
              <h4 className="font-medium text-[var(--text-1)]">{t('obMoodleTitle')}</h4>
              <p className="leading-relaxed text-[var(--text-2)]">{t('obMoodleHint')}</p>
              {added && (
                <p className="inline-flex items-center gap-1.5 text-[11px] text-[var(--ok)]">
                  <Icon name="check" size={12} /> {t('obAdded')}
                </p>
              )}
              <button
                onClick={finishMoodle}
                className="app-btn-primary w-full px-3 py-1.5 text-xs font-medium"
              >
                {t('obMoodleCta')}
              </button>
              <button
                onClick={() => setStep(2)}
                className="w-full rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-[11px] text-[var(--text-2)] hover:bg-[var(--hover-1)]"
              >
                {t('obMoodleSkip')}
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h4 className="font-medium text-[var(--text-1)]">{t('obDoneTitle')}</h4>
              <p className="leading-relaxed text-[var(--text-2)]">{t('obDoneHint')}</p>
              <button
                onClick={onFinish}
                className="app-btn-primary w-full px-3 py-1.5 text-xs font-medium"
              >
                {t('obDoneCta')}
              </button>
              <button
                onClick={onOpenSettings}
                className="w-full rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-[11px] text-[var(--text-2)] hover:bg-[var(--hover-1)]"
              >
                {t('settingsTitle')}
              </button>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--line)] px-4 py-2 text-[11px]">
          <button
            onClick={onFinish}
            className="text-[var(--text-3)] hover:text-[var(--text-2)]"
          >
            {t('obSkipAll')}
          </button>
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="app-btn px-2.5 py-1"
            >
              {t('obBack')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
