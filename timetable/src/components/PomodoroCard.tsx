import BreakGame from './BreakGame'
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import {
  formatRemaining,
  isRunning,
  phaseMinutes,
  progress,
  remainingMs,
  type PomodoroPhase,
} from '../lib/pomodoro'
import { usePomodoro } from '../hooks/usePomodoro'
import Icon from './Icon'
import { PrefSlider } from './settings/shared'

/**
 * 番茄钟卡片。
 *
 * 与学习时段（study blocks）的关系是**单向**的：番茄钟可以绑定一个已确认的时段，
 * 专注轮结束时把那块标记完成；反过来学习时段不读番茄钟状态——这样两块互不依赖，
 * 关掉番茄钟也不会让排程行为改变。
 *
 * 秒数跳动只在这里做（`usePomodoro` 每秒喂一次 `now`），真实剩余量始终由
 * `endsAt` 推导：应用被切到后台、WebView 被节流时不会「少走」时间。
 */
export default function PomodoroCard() {
  const { t } = useI18n()
  const pomodoro = usePomodoro()
  const { timer, config, roundsToday, justFinished, blocks } = pomodoro
  /** 当前选中的绑定块；`null` = 不绑定。开始后固定，暂停再继续不会换块。 */
  const [boundId, setBoundId] = useState<string | null>(null)
  /** 每秒推进的 now：只驱动渲染，不参与状态判定（判定在 hook 里）。 */
  const [now, setNow] = useState(() => Date.now())
  const [showGame, setShowGame] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  const running = timer !== null && isRunning(timer)

  useEffect(() => {
    if (!running) return
    const handle = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(handle)
  }, [running])

  // 阶段结束提示不需要 effect 清理：`start()` 自己会把 justFinished 置空，
  // 所以这条提示会一直留到用户开始下一轮——比「闪一下就没」更容易看见。

  const phaseLabel = (phase: PomodoroPhase): string => {
    if (phase === 'focus') return t('pomodoroPhaseFocus')
    if (phase === 'short') return t('pomodoroPhaseShort')
    return t('pomodoroPhaseLong')
  }

  const boundBlock = boundId ? blocks.find((block) => block.id === boundId) : undefined
  const remain = timer ? remainingMs(timer, now) : 0
  const pct = timer ? Math.round(progress(timer, now) * 100) : 0

  return (
    <section className="app-card p-4">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Icon name="hourglass" size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-1)]">{t('pomodoroTitle')}</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-3)] truncate">
              {t('pomodoroHint')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowConfig((v) => !v)}
          title={t('pomodoroConfigTitle')}
          className={`shrink-0 rounded p-1 transition ${showConfig ? 'bg-[var(--surface-2)] text-[var(--text-1)]' : 'text-[var(--text-3)] hover:text-[var(--text-1)]'}`}
        >
          <Icon name="settings" size={13} />
        </button>
      </header>

      {/* 计时面 */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-medium text-[var(--text-2)]">
            {timer ? phaseLabel(timer.phase) : t('pomodoroIdle')}
          </span>
          <span className="text-[10px] text-[var(--text-3)]">
            {t('pomodoroRoundsToday', { n: roundsToday })}
          </span>
        </div>
        <p
          className="mt-1 font-mono text-3xl tabular-nums text-[var(--text-1)]"
          aria-live="polite"
          aria-label={timer ? phaseLabel(timer.phase) : t('pomodoroIdle')}
        >
          {timer
            ? formatRemaining(remain)
            : formatRemaining(phaseMinutes(config, 'focus') * 60_000)}
        </p>
        {timer && (
          <div
            className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--border)]"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

                {/* 控制按钮：未开始显示三种起手，运行中显示暂停/继续 + 跳过 + 结束 */}
        {!timer && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-[var(--text-3)]">预设:</span>
            <button
              type="button"
              onClick={() => pomodoro.updateConfig({ focusMinutes: 25, shortMinutes: 5 })}
              className={`rounded border px-1.5 py-0.5 text-[10px] ${config.focusMinutes === 25 && config.shortMinutes === 5 ? 'border-[var(--accent)] text-[var(--text-1)] font-semibold' : 'border-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)]'}`}
            >
              {t('pomodoroPresetStandard')}
            </button>
            <button
              type="button"
              onClick={() => pomodoro.updateConfig({ focusMinutes: 50, shortMinutes: 10 })}
              className={`rounded border px-1.5 py-0.5 text-[10px] ${config.focusMinutes === 50 && config.shortMinutes === 10 ? 'border-[var(--accent)] text-[var(--text-1)] font-semibold' : 'border-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)]'}`}
            >
              {t('pomodoroPresetDeep')}
            </button>
            <button
              type="button"
              onClick={() => pomodoro.updateConfig({ focusMinutes: 90, shortMinutes: 15 })}
              className={`rounded border px-1.5 py-0.5 text-[10px] ${config.focusMinutes === 90 && config.shortMinutes === 15 ? 'border-[var(--accent)] text-[var(--text-1)] font-semibold' : 'border-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)]'}`}
            >
              {t('pomodoroPresetExtended')}
            </button>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {!timer && (
            <>
              <button
                type="button"
                onClick={() => pomodoro.start('focus', boundId)}
                className="app-btn-primary px-2.5 py-1 text-[11px]"
              >
                {t('pomodoroStart')}
              </button>
              <button
                type="button"
                onClick={() => pomodoro.start('short', null)}
                className="app-btn px-2.5 py-1 text-[11px]"
              >
                {t('pomodoroStartShort')}
              </button>
              <button
                type="button"
                onClick={() => pomodoro.start('long', null)}
                className="app-btn px-2.5 py-1 text-[11px]"
              >
                {t('pomodoroStartLong')}
              </button>
            </>
          )}
          {timer && running && (
            <button
              type="button"
              onClick={pomodoro.pause}
              className="app-btn px-2.5 py-1 text-[11px]"
            >
              {t('pomodoroPause')}
            </button>
          )}
          {timer && !running && (
            <button
              type="button"
              onClick={pomodoro.resume}
              className="app-btn-primary px-2.5 py-1 text-[11px]"
            >
              {t('pomodoroResume')}
            </button>
          )}
          {timer && (
            <>
              <button
                type="button"
                onClick={pomodoro.skip}
                className="app-btn px-2.5 py-1 text-[11px]"
              >
                {t('pomodoroSkip')}
              </button>
              <button
                type="button"
                onClick={pomodoro.reset}
                className="app-btn px-2.5 py-1 text-[11px]"
              >
                {t('pomodoroReset')}
              </button>
            </>
          )}
        </div>

        {/* 绑定学习时段：只在未开始时可选（开始后换块会让「标哪块完成」含糊） */}
        {!timer && (
          <div className="mt-2">
            {blocks.length === 0 ? (
              <p className="text-[10px] leading-relaxed text-[var(--text-3)]">
                {t('pomodoroNoBlocks')}
              </p>
            ) : (
              <label className="flex items-center gap-2 text-[10px] text-[var(--text-3)]">
                <input
                  type="checkbox"
                  checked={boundId !== null}
                  onChange={(e) => {
                    const first = blocks[0]
                    setBoundId(e.target.checked && first ? first.id : null)
                  }}
                  className="accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  {boundBlock
                    ? t('pomodoroBoundBlock', { title: boundBlock.title })
                    : t('pomodoroBindBlock', { title: blocks[0]?.title ?? '' })}
                </span>
              </label>
            )}
            {boundId && blocks.length > 1 && (
              <select
                aria-label={t('pomodoroBindBlock', { title: '' })}
                value={boundId}
                onChange={(e) => setBoundId(e.target.value || null)}
                className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--text-2)]"
              >
                {blocks.map((block) => (
                  <option key={block.id} value={block.id}>
                    {block.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* 时长设置（按需展开，默认收拢） */}
      {showConfig && (
        <div className="animate-modal-in mt-3 rounded-md border border-[var(--line)] bg-[var(--surface-0)] p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
              {t('pomodoroConfigTitle')}
            </h4>
            <button
              type="button"
              onClick={() => setShowConfig(false)}
              className="text-[10px] text-[var(--text-3)] hover:text-[var(--text-1)]"
            >
              ✕
            </button>
          </div>
          <PrefSlider
            label={t('pomodoroConfigFocus')}
            value={config.focusMinutes}
            min={1}
            max={180}
            step={1}
            display={`${config.focusMinutes} ${t('studyBlockPrefUnitMinutes')}`}
            onChange={(focusMinutes) => pomodoro.updateConfig({ focusMinutes })}
          />
          <PrefSlider
            label={t('pomodoroConfigShort')}
            value={config.shortMinutes}
            min={1}
            max={60}
            step={1}
            display={`${config.shortMinutes} ${t('studyBlockPrefUnitMinutes')}`}
            onChange={(shortMinutes) => pomodoro.updateConfig({ shortMinutes })}
          />
          <PrefSlider
            label={t('pomodoroConfigLong')}
            value={config.longMinutes}
            min={1}
            max={120}
            step={1}
            display={`${config.longMinutes} ${t('studyBlockPrefUnitMinutes')}`}
            onChange={(longMinutes) => pomodoro.updateConfig({ longMinutes })}
          />
          <PrefSlider
            label={t('pomodoroConfigRounds')}
            value={config.roundsPerLong}
            min={1}
            max={12}
            step={1}
            display={String(config.roundsPerLong)}
            onChange={(roundsPerLong) => pomodoro.updateConfig({ roundsPerLong })}
          />
          <label className="mt-2 flex items-center gap-2 text-[11px] text-[var(--text-2)]">
            <input
              type="checkbox"
              checked={config.autoAdvance}
              onChange={(e) => pomodoro.updateConfig({ autoAdvance: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            <span>{t('pomodoroConfigAuto')}</span>
          </label>
        </div>
      )}

      {/* 阶段结束提示 */}
      {justFinished && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--accent)]">
          <Icon name="check" size={12} />
          {justFinished === 'focus' ? t('pomodoroFinishedFocus') : t('pomodoroFinishedBreak')}
        </p>
      )}

      {/* 课间减压小游戏 */}
      <div className="mt-3 border-t border-[var(--border)] pt-2.5">
        <button
          type="button"
          onClick={() => setShowGame((v) => !v)}
          className="flex w-full items-center justify-between text-left text-xs font-medium text-[var(--text-2)] hover:text-[var(--text-1)]"
        >
          <span className="inline-flex items-center gap-1.5">
            <Icon name="puzzle" size={13} className="text-[var(--accent)]" />
            <span>{t('pomodoroBreakGame')}</span>
            {timer && (timer.phase === 'short' || timer.phase === 'long') && (
              <span className="app-badge-due ml-1 text-[9px] px-1 py-0.2">
                {t(timer.phase === 'short' ? 'pomodoroPhaseShort' : 'pomodoroPhaseLong')}
              </span>
            )}
          </span>
          <span className="text-[10px] text-[var(--text-3)]">
            {showGame ? '▲' : '▼'}
          </span>
        </button>
        {(showGame || (timer !== null && (timer.phase === 'short' || timer.phase === 'long') && isRunning(timer))) && (
          <BreakGame />
        )}
      </div>
    </section>
  )
}
