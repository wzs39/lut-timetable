import { describe, expect, it } from 'vitest'
import {
  alignmentPositions,
  blockLayout,
  dataCodewords,
  dataModuleCount,
  encodeQr,
  functionMap,
  maskFn,
  totalCodewords,
  type QrCode,
} from '../lib/qr'
import { encodeShare, shareLinkFor } from '../lib/shareLink'
import type { Lesson } from '../types'

/**
 * 二维码编码器：证明它真能被扫，而不是「渲染出了一个方块」。
 *
 * 三条独立证据：
 *  1. **几何锚点**：版本 → 数据模块数必须与规格的「总码字 + 剩余位」吻合（40 个版本全查），
 *     字节容量对已公布的表（V1=17 … V10=271 … V40=2953）；
 *  2. **规格级解码器**（本文件内实现，见下）：从矩阵解出格式信息（BCH 校验）、去掩码、
 *     取码字、拆块、**Reed-Solomon 校验子必须全为零**、再按字节模式解回原文；
 *  3. **真分享链接往返**：`shareLinkFor(...)` 的结果编码成矩阵后必须解回同一个字符串。
 */

// ---------- 规格级解码器（测试专用，只覆盖本编码器会产出的形状） ----------

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
}
const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]])

function ecPerBlock(version: number): number {
  // 与编码器同源的规格表；这里独立抄一份，改错一边就会让校验子非零
  const table = [
    7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26,
    28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ]
  return table[version - 1]
}
function blockCount(version: number): number {
  const table = [
    1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15,
    16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ]
  return table[version - 1]
}

/** 按规格读格式信息（两条副本必须一致，BCH 余数必须为零） */
function readFormat(m: boolean[][]): { ecl: number; mask: number } {
  const size = m.length
  let bits = 0
  for (let i = 0; i <= 5; i++) bits |= (m[i][8] ? 1 : 0) << i
  bits |= (m[7][8] ? 1 : 0) << 6
  bits |= (m[8][8] ? 1 : 0) << 7
  bits |= (m[8][7] ? 1 : 0) << 8
  for (let i = 9; i < 15; i++) bits |= (m[8][14 - i] ? 1 : 0) << i

  let second = 0
  for (let i = 0; i < 8; i++) second |= (m[8][size - 1 - i] ? 1 : 0) << i
  for (let i = 8; i < 15; i++) second |= (m[size - 15 + i][8] ? 1 : 0) << i
  expect(second).toBe(bits) // 两条副本不一致 = 扫描器会读到矛盾的信息

  const value = bits ^ 0x5412
  // BCH(15,5)：余数必须为零
  let rem = value
  for (let i = 14; i >= 10; i--) if (((rem >> i) & 1) === 1) rem ^= 0x537 << (i - 10)
  expect(rem).toBe(0)
  return { ecl: (value >> 13) & 0b11, mask: (value >> 10) & 0b111 }
}

/** 从矩阵取回码字（去掩码 + 反蛇形铺放） */
function readCodewords(qr: QrCode): number[] {
  const { size, version, mask } = qr
  const { isFn } = functionMap(version)
  const total = totalCodewords(version)
  const bits: number[] = []
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (isFn[y][x]) continue
        const raw = qr.modules[y][x]
        bits.push((raw !== maskFn(mask, x, y) ? 1 : 0) as number)
      }
    }
  }
  const out: number[] = []
  for (let i = 0; i + 8 <= Math.min(bits.length, total * 8); i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]
    out.push(byte)
  }
  return out.slice(0, total)
}

/** 按块校验 + 还原数据码字（交织的逆运算） */
function deinterleave(qr: QrCode): number[] {
  const version = qr.version
  const total = totalCodewords(version)
  const ec = ecPerBlock(version)
  const blocks = blockCount(version)
  const dataTotal = total - ec * blocks
  const shortLen = Math.floor(dataTotal / blocks)
  const longCount = dataTotal % blocks
  const codewords = readCodewords(qr)

  // 块序：**短块在前**（规格组 1/组 2 的顺序）。这一条是第三方扫描器抓出来的：
  // 反过来写时版本 1–9（块长相等）照样能读，版本 10 开始全废。
  const lengths: number[] = []
  for (let b = 0; b < blocks; b++) lengths.push(b < blocks - longCount ? shortLen : shortLen + 1)
  const dataBlocks: number[][] = lengths.map(() => [])
  const ecBlocks: number[][] = lengths.map(() => [])
  let idx = 0
  for (let i = 0; i <= shortLen; i++) {
    for (let b = 0; b < blocks; b++) if (i < lengths[b]) dataBlocks[b].push(codewords[idx++])
  }
  for (let i = 0; i < ec; i++) for (let b = 0; b < blocks; b++) ecBlocks[b].push(codewords[idx++])
  expect(idx).toBe(total)

  // 校验子：把 (数据 + 纠错) 当多项式求 α^0…α^(ec-1) 的取值，必须全为 0
  for (let b = 0; b < blocks; b++) {
    const poly = [...dataBlocks[b], ...ecBlocks[b]]
    for (let i = 0; i < ec; i++) {
      let acc = 0
      for (const coef of poly) acc = gfMul(acc, GF_EXP[i]) ^ coef
      expect(acc, `version ${version} block ${b} syndrome ${i}`).toBe(0)
    }
  }
  return dataBlocks.flat()
}

/** 字节模式解码：模式(4) + 长度(8/16) + UTF-8 字节 */
function decodeBytes(qr: QrCode): string {
  const data = deinterleave(qr)
  const bits: number[] = []
  for (const byte of data) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1)
  const take = (n: number, from: number) => {
    let value = 0
    for (let i = 0; i < n; i++) value = (value << 1) | bits[from + i]
    return value
  }
  expect(take(4, 0)).toBe(0b0100) // 字节模式
  const lenBits = qr.version < 10 ? 8 : 16
  const length = take(lenBits, 4)
  const start = 4 + lenBits
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) bytes[i] = take(8, start + i * 8)
  return new TextDecoder().decode(bytes)
}

/** 扫描器必须看得到的东西：三个定位图案 + 交替的 timing */
function expectFinderPatterns(qr: QrCode): void {
  const { size, modules } = qr
  const corners: Array<[number, number]> = [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ]
  for (const [ox, oy] of corners) {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const onRing = dx === 0 || dx === 6 || dy === 0 || dy === 6
        const inCore = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
        expect(modules[oy + dy][ox + dx], `finder (${ox},${oy}) +${dx},${dy}`).toBe(onRing || inCore)
      }
    }
  }
  for (let i = 8; i < size - 8; i++) {
    expect(modules[6][i]).toBe(i % 2 === 0) // 横向 timing
    expect(modules[i][6]).toBe(i % 2 === 0) // 纵向 timing
  }
}

// ---------- 几何锚点（已公布的规格数据） ----------

describe('qr geometry', () => {
  it('总码字数 = 数据模块数 / 8，且剩余位与规格一致', () => {
    // 规格里的「剩余位」：编码器多出来的 0–7 个模块，扫描器按码字读、余下的忽略
    const remainder = (v: number): number => {
      if (v === 1) return 0
      if (v <= 6) return 7
      if (v <= 13) return 0
      if (v <= 20) return 3
      if (v <= 27) return 4
      if (v <= 34) return 3
      return 0
    }
    for (let v = 1; v <= 40; v++) {
      expect(dataModuleCount(v) - totalCodewords(v) * 8, `version ${v}`).toBe(remainder(v))
    }
  })

  it('字节容量对上公布的表（等级 L）', () => {
    const capacity = (v: number) => Math.floor((dataCodewords(v) * 8 - (4 + (v < 10 ? 8 : 16))) / 8)
    expect(capacity(1)).toBe(17)
    expect(capacity(2)).toBe(32)
    expect(capacity(3)).toBe(53)
    expect(capacity(4)).toBe(78)
    expect(capacity(5)).toBe(106)
    expect(capacity(6)).toBe(134)
    expect(capacity(7)).toBe(154)
    expect(capacity(8)).toBe(192)
    expect(capacity(9)).toBe(230)
    expect(capacity(10)).toBe(271)
    expect(capacity(40)).toBe(2953)
  })

  it('块切分对上规格，且短块在前（版本 10 是第一个块长不等的版本）', () => {
    // 版本 10-L：4 块 → 2×68 + 2×69 数据码字，每块 18 个纠错码字
    expect(blockLayout(10)).toEqual([
      { data: 68, ec: 18 },
      { data: 68, ec: 18 },
      { data: 69, ec: 18 },
      { data: 69, ec: 18 },
    ])
    // 版本 1–9：块长要么只有一块，要么等长（所以写反块序也看不出来）
    expect(blockLayout(1)).toEqual([{ data: 19, ec: 7 }])
    expect(blockLayout(7)).toEqual([
      { data: 78, ec: 20 },
      { data: 78, ec: 20 },
    ])
    // 版本 40-L：25 块 → 19×118 + 6×119 数据码字，每块 30 个纠错码字
    // （2956 = 19×118 + 6×119；字节容量因此是 2953）
    const v40 = blockLayout(40)
    expect(v40).toHaveLength(25)
    expect(v40.filter((b) => b.data === 118)).toHaveLength(19)
    expect(v40.filter((b) => b.data === 119)).toHaveLength(6)
    expect(v40[18]).toEqual({ data: 118, ec: 30 })
    expect(v40[24]).toEqual({ data: 119, ec: 30 })
    for (const version of [10, 16, 25, 40]) {
      const total = blockLayout(version).reduce((n, b) => n + b.data + b.ec, 0)
      expect(total, `version ${version} block sum`).toBe(totalCodewords(version))
    }
  })

  it('校准图案坐标对上公布的表', () => {
    expect(alignmentPositions(1)).toEqual([])
    expect(alignmentPositions(2)).toEqual([6, 18])
    expect(alignmentPositions(7)).toEqual([6, 22, 38])
    expect(alignmentPositions(14)).toEqual([6, 26, 46, 66])
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138])
  })
})

// ---------- 往返：矩阵 → 原文 ----------

describe('qr round-trip', () => {
  const cases: Array<[string, string]> = [
    ['短文本', 'HELLO WORLD'],
    ['中文（UTF-8 多字节）', '课表分享 · 9月26日星期六'],
    ['问号与 & 等 URL 字符', 'https://example.com/x?y=1&z=%E4%B8%AD'],
    ['长文本（逼近高版本）', 'A'.repeat(1200)],
  ]

  it.each(cases)('%s 解回原文', (_label, text) => {
    const qr = encodeQr(text)
    expect(qr).not.toBeNull()
    expect(qr!.size).toBe(qr!.version * 4 + 17)
    expectFinderPatterns(qr!)
    const format = readFormat(qr!.modules)
    expect(format.ecl).toBe(0b01) // 等级 L
    expect(format.mask).toBe(qr!.mask)
    expect(decodeBytes(qr!)).toBe(text)
  })

  it('超出等级 L 容量（>2953 字节）时返回 null，而不是给个坏矩阵', () => {
    expect(encodeQr('A'.repeat(2954))).toBeNull()
    expect(encodeQr('A'.repeat(2953))).not.toBeNull()
  })

  it('版本随长度单调增长，且总是取最小可用版本', () => {
    const v1 = encodeQr('A'.repeat(17))!.version
    const v2 = encodeQr('A'.repeat(18))!.version
    const v10 = encodeQr('A'.repeat(240))!.version
    expect(v1).toBe(1)
    expect(v2).toBe(2)
    expect(v10).toBe(10)
  })
})

// ---------- 真实分享链接 ----------

describe('share link → qr → back', () => {
  const lesson = (i: number): Lesson => ({
    id: `l${i}`,
    code: `CT60A40${i}0`,
    title: `Course ${i}`,
    location: `R1${i}`,
    start: new Date(2026, 8, 28 + (i % 3), 8 + (i % 8), 0).toISOString(),
    end: new Date(2026, 8, 28 + (i % 3), 9 + (i % 8), 0).toISOString(),
    source: 'manual',
  })

  it('一周 12 节课的分享链接：扫码解出来的就是同一条链接', () => {
    const link = shareLinkFor(Array.from({ length: 12 }, (_, i) => lesson(i)), 'https://lut.example/app/')
    expect(link).not.toBeNull()
    const qr = encodeQr(link!)
    expect(qr).not.toBeNull()
    expect(decodeBytes(qr!)).toBe(link!)
    expect(encodeShare(Array.from({ length: 12 }, (_, i) => lesson(i)))).not.toBeNull()
  })

  it('链接长到 40 版也放不下时返回 null（界面得回退到「发链接」，不能给个坏码）', () => {
    // 单个二维码在等级 L 下的天花板是 2953 字节；而分享链接允许到 3500 字符，
    // 所以「太大扫不了码」是真实存在的分支，必须有明确行为。
    const big = `https://lut.example/app/#/import/v1.${'A'.repeat(3300)}`
    expect(encodeQr(big)).toBeNull()

    const fits = `https://lut.example/app/#/import/v1.${'A'.repeat(2900)}`
    const qr = encodeQr(fits)
    expect(qr).not.toBeNull()
    expect(decodeBytes(qr!)).toBe(fits)
  })
})
