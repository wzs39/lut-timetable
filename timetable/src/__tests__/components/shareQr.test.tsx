// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ShareQrDialog from '../../components/ShareQrDialog'
import { I18nProvider } from '../../i18n'
import { encodeQr } from '../../lib/qr'
import { shareLinkFor } from '../../lib/shareLink'
import type { Lesson } from '../../types'

/**
 * 【渲染契约】分享二维码弹层：
 * 1) 画出来的东西**就是**编码器那个矩阵——把 SVG 的 path 反解回模块图，必须逐格相等；
 *    （「矩阵 → 原文」在 qr.test.ts 里已用规格级解码器证过，两段接起来才等于「扫得回来」）
 * 2) 静默区是真的留白（规格 ≥4 模块），且三个定位图案在渲染结果里完好；
 * 3) 码永远黑白（深色主题下用主题色对比度不够）；
 * 4) 复制按钮把链接交给分享通道，失败也有可读提示。
 */

const lesson = (i: number): Lesson => ({
  id: `l${i}`,
  code: `CT60A40${i}0`,
  title: `Course ${i}`,
  location: `R1${i}`,
  start: new Date(2026, 8, 28 + i, 8 + i, 0).toISOString(),
  end: new Date(2026, 8, 28 + i, 9 + i, 0).toISOString(),
  source: 'manual',
})

const link = shareLinkFor([lesson(0), lesson(1)], 'https://lut.example/app/')!
const qr = encodeQr(link)!

/** 把渲染出来的 path 反解成 {x,y} 集合（path 里每个深色模块 = "M{x} {y}h1v1h-1z"） */
function modulesFromPath(d: string): Set<string> {
  const cells = new Set<string>()
  for (const m of d.matchAll(/M(-?\d+) (-?\d+)h1v1h-1z/g)) cells.add(`${m[1]},${m[2]}`)
  return cells
}

afterEach(cleanup)

function renderDialog() {
  const onClose = vi.fn()
  render(
    <I18nProvider>
      <ShareQrDialog link={link} qr={qr} count={2} onClose={onClose} />
    </I18nProvider>,
  )
  return { onClose }
}

describe('ShareQrDialog', () => {
  it('把编码器的矩阵原样画出来（含 4 模块静默区与完整的定位图案）', () => {
    renderDialog()
    const svg = screen.getByRole('img', { name: '本周课表的分享二维码' })
    const side = qr.size + 8
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${side} ${side}`)

    const rendered = modulesFromPath(svg.querySelector('path')!.getAttribute('d')!)
    const quiet = 4

    // 逐格比对：渲染的深色模块必须正好是矩阵里的深色模块（偏移静默区）
    const expected = new Set<string>()
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) expected.add(`${x + quiet},${y + quiet}`)
    }
    expect(rendered.size).toBe(expected.size)
    for (const cell of expected) expect(rendered.has(cell), `missing ${cell}`).toBe(true)

    // 静默区必须是空的：整圈 4 模块内没有深色格
    for (const cell of rendered) {
      const [x, y] = cell.split(',').map(Number)
      expect(x >= quiet && y >= quiet && x < side - quiet && y < side - quiet).toBe(true)
    }

    // 定位图案（左上角）在渲染结果里完好：7×7 环 + 3×3 芯
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const onRing = dx === 0 || dx === 6 || dy === 0 || dy === 6
        const inCore = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
        expect(rendered.has(`${quiet + dx},${quiet + dy}`)).toBe(onRing || inCore)
      }
    }
  })

  it('码永远是黑白（不跟随主题），并给出链接原文与课节数', () => {
    renderDialog()
    const svg = screen.getByRole('img', { name: '本周课表的分享二维码' })
    expect(svg.querySelector('rect')!.getAttribute('fill')).toBe('#ffffff')
    expect(svg.querySelector('path')!.getAttribute('fill')).toBe('#000000')
    expect(screen.getByText(link)).toBeTruthy()
    expect(screen.getByText(/本周 2 节课/)).toBeTruthy()
  })

  it('复制链接交给分享通道；失败时提示手动复制而不是静默', async () => {
    // web 上 shareLinkText 走 navigator.clipboard
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { onClose } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '复制链接' }))
    await screen.findByText('链接已复制')
    expect(writeText).toHaveBeenCalledWith(link)

    // 两个关闭入口：右上角的 ✕（aria/title 不同）与底部的「关闭」
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('复制失败（无权限）时给出可操作的提示', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('NotAllowedError')
        },
      },
    })
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '复制链接' }))
    await screen.findByText(/长按上面的链接/)
  })
})
