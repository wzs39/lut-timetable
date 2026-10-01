import { useI18n } from '../../i18n'
import { heButLoginUrl } from '../../lib/courseResources'
import ExternalLink from '../ExternalLink'
import Icon from '../Icon'

/**
 * HEBUT Moodle · HDD 独立入口卡片。
 * 未连接页与课程/资料段共用这一份实现——两处手写副本曾经样式漂移
 * （一方带图标徽章、一方不带），改文案/链接时漏改一处就出现两个版本。
 * 外间距（如 mt-3）由调用方用 className 传入，卡片本身不自带边距。
 */
export default function HebutCard({ className = '' }: { className?: string }) {
  const { t } = useI18n()
  return (
    <section
      className={
        'app-card flex flex-wrap items-center justify-between gap-3 border-[var(--line-violet)] bg-[var(--surface-2)] p-3 ' +
        className
      }
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--tint-violet)] text-[var(--violet)]">
          <Icon name="globe" size={17} />
        </span>
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-[var(--text-1)]">{t('heButTitle')}</h3>
          <p className="mt-0.5 text-[10px] text-[var(--text-3)]">{t('heButDescription')}</p>
        </div>
      </div>
      <ExternalLink
        href={heButLoginUrl()}
        className="app-btn inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-[11px]"
      >
        {t('heButOpen')} <Icon name="external" size={11} />
      </ExternalLink>
    </section>
  )
}
