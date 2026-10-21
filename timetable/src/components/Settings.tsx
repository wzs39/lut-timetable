import { useState } from 'react'
import { useI18n } from '../i18n'
import Icon from './Icon'
import { useExitAnimation } from '../lib/useExitAnimation'
import type { Lesson, SyncSource } from '../types'
import type { NotesMap } from '../lib/notes'
import type { Contrast, TextScale } from '../lib/uiPrefs'
import type { DesktopPrefs, DesktopState } from '../lib/desktop'
import type { Subscription } from '../lib/subscriptions'
import type { SyncAudit } from '../lib/syncAudit'
import type { StudyBlockPrefs } from '../lib/studyBlockPrefs'
import { Group } from './settings/shared'
import {
  DEFAULT_SETTINGS_GROUP,
  GROUP_DESC_KEYS,
  GROUP_ICON,
  GROUP_LABEL_KEYS,
  SETTINGS_GROUP_IDS,
  type SettingsGroupId,
} from './settings/tokens'
import AppearanceSection from './settings/AppearanceSection'
import SyncSection from './settings/SyncSection'
import StudySection from './settings/StudySection'
import DataSection from './settings/DataSection'
import LogsSection from './settings/LogsSection'

interface Props {
  sources: SyncSource[]
  syncing: boolean
  syncMessage: string | null
  autoSync: boolean
  onToggleAutoSync: (v: boolean) => void
  notifEnabled: boolean
  onToggleNotif: (v: boolean) => void
  digestEnabled: boolean
  onToggleDigest: (v: boolean) => void
  onAddSource: (s: SyncSource) => void
  onRemoveSource: (id: string) => void
  onSync: (s: SyncSource) => void
  translatorUrl: string
  onTranslatorUrl: (u: string) => void
  onLinkTranslator: () => void
  translatorMsg: string | null
  notes: NotesMap
  onRemoveNote: (key: string) => void
  /** 导出 .ics（App 提供：用可见课表而不是原始存储，单一入口在 lib/exportIcs） */
  onExportIcs: () => void
  /** 分享本周课表链接（返回给用户的提示语：已复制 / 已分享 / 太大） */
  onShareWeek: () => Promise<string>
  /** 订阅式提醒（课程变动 / 教室空出）：在这里可以静音或删除 */
  subscriptions: Subscription[]
  onToggleSubscription: (id: string) => void
  onRemoveSubscription: (id: string) => void
  /** 无障碍：字号档 / 对比度档 */
  textScale: TextScale
  contrast: Contrast
  onTextScale: (v: TextScale) => void
  onContrast: (v: Contrast) => void
  /** 本地错误条数（打开设置时刷新） */
  errorCount: number
  /** 导出诊断文本（返回给用户看的提示语） */
  onExportDiagnostics: () => Promise<string>
  onClearErrors: () => void
  /** 已同步的可见课表：设置里的「按课表推导」学习窗口用它（不写回课表） */
  lessons?: Lesson[]
  /** 同步变更审计（lib/syncAudit） */
  audits: SyncAudit[]
  onClearAudits: () => void
  /** 桌面端（Electron）托盘 / 全局快捷键：浏览器与移动端为 null，整个分区隐藏 */
  desktop: DesktopState | null
  onDesktopPrefs: (patch: Partial<DesktopPrefs>) => void
  /** SISU 学习偏好/目标在设置里改了：通知 App 让计划页重新读取 */
  onSisuPrefsChanged?: () => void
  /** 学习块偏好在设置里改了：把落盘后的整份偏好推给 App（提醒开关在 App 侧） */
  onStudyBlockPrefsChanged?: (prefs: StudyBlockPrefs) => void
  onClose: () => void
}

/**
 * 设置弹层 = 外框 + 分类索引 + 五个分区。
 *
 * 加一个设置项时改的是 `components/settings/<分区>.tsx`；加一个新分类才动
 * 这个文件（登记两个标题键 + 一行 `<Group>`）。分区的本地状态跟着分区走，
 * 不在这里堆成第二个大组件。
 */
export default function Settings({
  sources,
  syncing,
  syncMessage,
  autoSync,
  onToggleAutoSync,
  notifEnabled,
  onToggleNotif,
  digestEnabled,
  onToggleDigest,
  onAddSource,
  onRemoveSource,
  onSync,
  translatorUrl,
  onTranslatorUrl,
  onLinkTranslator,
  translatorMsg,
  notes,
  onRemoveNote,
  onExportIcs,
  onShareWeek,
  subscriptions,
  onToggleSubscription,
  onRemoveSubscription,
  textScale,
  contrast,
  onTextScale,
  onContrast,
  errorCount,
  onExportDiagnostics,
  onClearErrors,
  lessons = [],
  audits,
  onClearAudits,
  desktop,
  onDesktopPrefs,
  onSisuPrefsChanged,
  onStudyBlockPrefsChanged,
  onClose,
}: Props) {
  const { t } = useI18n()

  // Semua jalur tutup (✕ / ESC / klik luar) lewat satu frame keluar.
  const [closing, requestClose] = useExitAnimation(onClose)
  // 一次只显示一组：导轨切分类而不是在同一条长滚里找位置。
  // 初始停在外观（最常改的开关）；不持久化——每次打开都从同一处开始。
  const [active, setActive] = useState<SettingsGroupId>(DEFAULT_SETTINGS_GROUP)

  return (
    <div
      className={
        (closing ? 'animate-fade-out ' : 'animate-fade-in ') +
        'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4'
      }
      onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
      onKeyDown={(e) => e.key === 'Escape' && requestClose()}
      tabIndex={-1}
    >
      <div
        className={
          (closing ? 'animate-exit-down ' : 'animate-modal-in ') +
          'flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] shadow-2xl md:max-w-4xl md:flex-row'
        }
      >
        <aside className="flex shrink-0 flex-col border-b border-[var(--line)] bg-gradient-to-b from-[var(--surface-1)] to-[var(--surface-0)] md:w-56 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4 md:pb-3">
            <h3 className="inline-flex items-center gap-2 text-sm font-semibold">
              <Icon name="settings" size={15} /> {t('settingsTitle')}
            </h3>
            <button
              onClick={requestClose}
              className="text-[var(--text-3)] hover:text-[var(--text-1)]"
              title={t('closeHint')}
            >
              <Icon name="close" size={13} />
            </button>
          </div>

          <nav
            className="app-rail px-3 pb-3 md:px-2"
            role="navigation"
            aria-label={t('settingsNav')}
          >
            {SETTINGS_GROUP_IDS.map((id) => {
              const current = active === id
              return (
                <button
                  key={id}
                  onClick={() => setActive(id)}
                  aria-current={current ? 'page' : undefined}
                  title={t(GROUP_LABEL_KEYS[id])}
                  className="app-rail-item"
                >
                  <Icon name={GROUP_ICON[id]} size={13} />
                  <span className="min-w-0 truncate">{t(GROUP_LABEL_KEYS[id])}</span>
                </button>
              )
            })}
          </nav>
          <p className="hidden px-4 pb-3 text-[10px] leading-relaxed text-[var(--text-3)] md:block">
            {t('settingsPaneHint')}
          </p>
        </aside>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-8 text-xs">
          <Group
            id="appearance"
            title={t('settingsGroupAppearance')}
            description={t(GROUP_DESC_KEYS.appearance)}
            active={active === 'appearance'}
          >
            <AppearanceSection
              textScale={textScale}
              contrast={contrast}
              onTextScale={onTextScale}
              onContrast={onContrast}
            />
          </Group>

          <Group
            id="sync"
            title={t('settingsGroupSync')}
            description={t(GROUP_DESC_KEYS.sync)}
            active={active === 'sync'}
          >
            <SyncSection
              sources={sources}
              syncing={syncing}
              syncMessage={syncMessage}
              autoSync={autoSync}
              onToggleAutoSync={onToggleAutoSync}
              notifEnabled={notifEnabled}
              onToggleNotif={onToggleNotif}
              digestEnabled={digestEnabled}
              onToggleDigest={onToggleDigest}
              onAddSource={onAddSource}
              onRemoveSource={onRemoveSource}
              onSync={onSync}
            />
          </Group>

          <Group
            id="study"
            title={t('settingsGroupStudy')}
            description={t(GROUP_DESC_KEYS.study)}
            active={active === 'study'}
          >
            <StudySection
              lessons={lessons}
              onSisuPrefsChanged={onSisuPrefsChanged}
              onStudyBlockPrefsChanged={onStudyBlockPrefsChanged}
            />
          </Group>

          <Group
            id="data"
            title={t('settingsGroupData')}
            description={t(GROUP_DESC_KEYS.data)}
            active={active === 'data'}
          >
            <DataSection
              sources={sources}
              syncing={syncing}
              syncMessage={syncMessage}
              translatorUrl={translatorUrl}
              onTranslatorUrl={onTranslatorUrl}
              onLinkTranslator={onLinkTranslator}
              translatorMsg={translatorMsg}
              onExportIcs={onExportIcs}
              onShareWeek={onShareWeek}
              audits={audits}
              onClearAudits={onClearAudits}
              desktop={desktop}
              onDesktopPrefs={onDesktopPrefs}
            />
          </Group>

          <Group
            id="logs"
            title={t('settingsGroupLogs')}
            description={t(GROUP_DESC_KEYS.logs)}
            active={active === 'logs'}
          >
            <LogsSection
              subscriptions={subscriptions}
              onToggleSubscription={onToggleSubscription}
              onRemoveSubscription={onRemoveSubscription}
              errorCount={errorCount}
              onExportDiagnostics={onExportDiagnostics}
              onClearErrors={onClearErrors}
              notes={notes}
              onRemoveNote={onRemoveNote}
            />
          </Group>
        </div>
        </div>
      </div>
    </div>
  )
}
