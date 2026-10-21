import type { AppCommand } from '../lib/commands'
import Icon from './Icon'

/**
 * 桌面端 ⋯ 弹出菜单。
 *
 * 内容来自 lib/commands 的注册表（App 已经把 label 本地化），这里只负责
 * 弹层样式与「点完就关」。以前这 60 行是按动作手写的，加一个动作要在这里
 * 再抄一遍；现在加一条命令即可，三处入口同时出现。
 */
export default function AppMenu({
  open,
  commands,
  onClose,
}: {
  open: boolean
  commands: AppCommand[]
  onClose: () => void
}) {
  if (!open) return null
  return (
    <div className="animate-pop-in absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-1.5 shadow-2xl shadow-black/50">
      {commands.map((command) => (
        <button
          key={command.id}
          type="button"
          onClick={() => {
            command.run()
            onClose()
          }}
          className="app-menu-item"
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <Icon name={command.icon} />
            <span className="truncate">{command.label}</span>
          </span>
          <span className="shrink-0 text-[var(--text-3)]">
            <Icon name="chevron-right" size={12} />
          </span>
        </button>
      ))}
    </div>
  )
}
