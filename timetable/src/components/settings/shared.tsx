import type { ReactNode } from 'react'
import type { SettingsGroupId } from './tokens'

/**
 * 设置分区共用的组件。
 *
 * 常量 / 纯函数在 `tokens.ts`（同文件混导出会破坏 fast refresh）；每个分区
 * 文件只放自己的小节，`Group`（分类标题 + 锚点）留由 Settings 壳统一渲染。
 */

/** 小节标题（设置里所有 h4 的唯一写法）。 */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
      {children}
    </h4>
  )
}

/**
 * 设置分类：一组的标题 + 说明 + 小节。
 *
 * `active=false` 时只加 `hidden` 类（不卸载）：切分类会丢掉正在输入的内容
 * 才是真问题；`hidden` 在真实浏览器里是 display:none（不占位、不可聚焦），
 * 测试环境没有样式表，所以仍能用 getByText 找到非当前组（既有契约测试依赖这点）。
 */
export function Group({
  id,
  title,
  description,
  active,
  children,
}: {
  id: SettingsGroupId
  title: string
  description?: string
  active: boolean
  children: ReactNode
}) {
  return (
    <section
      id={`settings-${id}`}
      aria-labelledby={`settings-${id}-title`}
      className={active ? 'animate-view-in space-y-6' : 'hidden'}
    >
      <header className="mb-1">
        <h2
          id={`settings-${id}-title`}
          className="text-sm font-semibold tracking-tight text-[var(--text-1)]"
        >
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-3)]">{description}</p>
        )}
      </header>
      <div className="space-y-6">{children}</div>
    </section>
  )
}

/**
 * 滑杆行：可见标签 + `aria-label`（与标签同文，供 role=slider 定位）+ 右侧现值。
 * 学习时段偏好统一用它，免得五个旋钮各写一遍排版。
 */
export function PrefSlider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (value: number) => void
}) {
  return (
    <label className="mt-2 flex items-center gap-2 text-[11px] text-[var(--text-2)]">
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-[var(--accent)]"
      />
      <span className="w-16 shrink-0 text-right text-[10px] text-[var(--text-3)]" title={display}>
        {display}
      </span>
    </label>
  )
}
