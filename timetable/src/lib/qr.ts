/**
 * 二维码（QR Code Model 2）编码器 —— 只为「把分享链接显示成一张可扫的图」。
 *
 * 为什么不装库：本仓依赖表一直是最小集（Capacitor / React / Tailwind），而这里只需要
 * **字节模式 + 纠错等级 L** 这一条路径；一个通用二维码库会带进数字/字母数字/汉字模式、
 * 多段拼接、结构化追加等整套用不上的编码器。
 *
 * 只覆盖实际会遇到的形状：
 * - 字节模式（UTF-8）—— 链接是 ASCII，但被百分号编码的非 ASCII 也不该炸；
 * - 纠错等级 L（屏幕渲染清楚、容量最大，放得下最长的分享链接）；
 * - 版本 1–40 自动取最小可用；放不下返回 null，调用方回退到「发链接 / 导出」。
 *
 * 正确性由 `__tests__/qr.test.ts` 的规格级解码器证明：矩阵 → 格式信息 → 去掩码 →
 * 码字 → Reed-Solomon 校验子归零 → 字节模式解码 → 必须等于原文。
 */

/** 等级 L 在格式信息里的两位编码 */
const ECL_L_BITS = 0b01

/** 每个纠错块的纠错码字数（等级 L，版本 1–40） */
const EC_CODEWORDS_PER_BLOCK_L = [
  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26,
  28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
]

/** 纠错块数（等级 L，版本 1–40） */
const NUM_BLOCKS_L = [
  1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15,
  16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
]

export interface QrCode {
  /** 边长（模块数）= 4 × 版本 + 17 */
  size: number
  version: number
  mask: number
  /** modules[y][x] === true 表示深色 */
  modules: boolean[][]
}

// ---- GF(256)（本原多项式 0x11D） ----

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

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

/** 纠错码字 = 数据多项式除以生成多项式的余数 */
function rsRemainder(data: number[], degree: number): number[] {
  let gen = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(gen.length + 1).fill(0)
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j]
      next[j + 1] ^= gfMul(gen[j], GF_EXP[i])
    }
    gen = next
  }
  const rem = new Array<number>(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ rem[0]
    rem.shift()
    rem.push(0)
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i + 1], factor)
  }
  return rem
}

// ---- 版本几何 ----

/** 校准图案坐标（版本 1 没有；规律来自规格，测试里对过 [6,22,38]/[6,18]/[6,34,…] 等行） */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return []
  const num = Math.floor(version / 7) + 2
  const step = version === 32 ? 26 : Math.floor((version * 4 + num * 2 + 1) / (num * 2 - 2)) * 2
  const out = [6]
  for (let pos = version * 4 + 10; out.length < num; pos -= step) out.splice(1, 0, pos)
  return out
}

/** 版本信息（18 位，BCH(18,6)，版本 ≥ 7） */
function versionInfoBits(version: number): number {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25)
  return (version << 12) | rem
}

/** 格式信息（15 位，BCH(15,5)，再异或 0x5412 掩码） */
function formatBits(mask: number): number {
  const data = (ECL_L_BITS << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

export function maskFn(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0
    case 1:
      return y % 2 === 0
    case 2:
      return x % 3 === 0
    case 3:
      return (x + y) % 3 === 0
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  }
}

/**
 * 功能图案：`isFn[y][x]` 为 true 的位置不参与数据铺放。
 * 定位/分隔符/校正/timing 连深浅一起画好；格式信息与版本信息只占位（值按掩码后写）。
 */
export function functionMap(version: number): { isFn: boolean[][]; dark: boolean[][] } {
  const size = version * 4 + 17
  const isFn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const dark: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, value: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    isFn[y][x] = true
    dark[y][x] = value
  }

  // 三个定位图案（7×7）+ 一圈分隔符
  for (const [ox, oy] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ]) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const inner = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && !(dx === 0 || dx === 6 || dy === 0 || dy === 6)
        const onRing = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && (dx === 0 || dx === 6 || dy === 0 || dy === 6)
        const inCore = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
        set(ox + dx, oy + dy, onRing || (inner && inCore))
      }
    }
  }

  // timing（第 6 行 / 第 6 列）
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0)
    set(6, i, i % 2 === 0)
  }

  // 校正图案（5×5），与定位图案重叠的角跳过
  const pos = alignmentPositions(version)
  const last = pos[pos.length - 1]
  for (const cy of pos) {
    for (const cx of pos) {
      if ((cy === 6 && cx === 6) || (cy === 6 && cx === last) || (cy === last && cx === 6)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    }
  }

  // 格式信息占位（两条）。注意跳过 timing 的 (6,8) 与 (8,6) ——
  // 它们是 timing 图案的格子，写成浅色会把 timing 打断，扫描器就找不到网格了。
  for (let i = 0; i <= 8; i++) {
    if (i === 6) continue
    set(i, 8, false)
    set(8, i, false)
  }
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, false)
  for (let i = 0; i < 8; i++) set(8, size - 1 - i, false)

  // 版本信息（版本 ≥ 7，两块 3×6）
  if (version >= 7) {
    const bits = versionInfoBits(version)
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, bit)
      set(b, a, bit)
    }
  }

  // 固定深色模块（在格式信息写完后再确认一次，这里先标上）
  set(8, size - 8, true)
  return { isFn, dark }
}

/** 数据模块数（= 功能图案之外的全部格子） */
export function dataModuleCount(version: number): number {
  const size = version * 4 + 17
  const { isFn } = functionMap(version)
  let n = 0
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFn[y][x]) n++
  return n
}

/** 总码字数 = ⌊数据模块数 / 8⌋（规格里就是这么定的，不抄表） */
export function totalCodewords(version: number): number {
  return Math.floor(dataModuleCount(version) / 8)
}

/** 等级 L 下这个版本能装多少**数据**码字 */
export function dataCodewords(version: number): number {
  return totalCodewords(version) - EC_CODEWORDS_PER_BLOCK_L[version - 1] * NUM_BLOCKS_L[version - 1]
}

/**
 * 块切分（规格的组 1 / 组 2 顺序，**短块在前**）。
 *
 * 顺序**不是**无关紧要的实现细节：读取方按块顺序轮询分配码字，块序反了每个块
 * 拿到的都是别人的码字、Reed-Solomon 校验全挂。版本 10 是第一个块长不等的版本
 * （4 块：2×68 + 2×69），所以写反时 1–9 照样能读、10 起全废——这个 bug 是自己写
 * 的解码器看不见的（两边同错），是第三方扫描器扫出来的。
 */
export function blockLayout(version: number): { data: number; ec: number }[] {
  const ecPerBlock = EC_CODEWORDS_PER_BLOCK_L[version - 1]
  const blocks = NUM_BLOCKS_L[version - 1]
  const dataTotal = dataCodewords(version)
  const shortLen = Math.floor(dataTotal / blocks)
  const shortCount = blocks - (dataTotal % blocks)
  return Array.from({ length: blocks }, (_, b) => ({
    data: b < shortCount ? shortLen : shortLen + 1,
    ec: ecPerBlock,
  }))
}

function interleave(version: number, data: number[]): number[] {
  const layout = blockLayout(version)
  const ecPerBlock = layout[0].ec
  const dataBlocks: number[][] = []
  const ecBlocks: number[][] = []
  let offset = 0
  for (const { data: len } of layout) {
    const block = data.slice(offset, offset + len)
    offset += len
    dataBlocks.push(block)
    ecBlocks.push(rsRemainder(block, ecPerBlock))
  }
  const shortLen = layout[0].data
  const out: number[] = []
  for (let i = 0; i <= shortLen; i++) for (const block of dataBlocks) if (i < block.length) out.push(block[i])
  for (let i = 0; i < ecPerBlock; i++) for (const block of ecBlocks) out.push(block[i])
  return out
}

/** 把码字铺进矩阵（右下列起步、两列一组蛇形、跳过功能模块） */
function drawCodewords(version: number, codewords: number[], isFn: boolean[][]): boolean[][] {
  const size = version * 4 + 17
  const { dark } = functionMap(version)
  const m = dark.map((row) => row.slice())
  const totalBits = codewords.length * 8
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!isFn[y][x] && i < totalBits) {
          m[y][x] = ((codewords[i >> 3] >> (7 - (i & 7))) & 1) === 1
          i++
        }
      }
    }
  }
  return m
}

/** 写两条格式信息（含固定深色模块） */
function drawFormat(m: boolean[][], mask: number): void {
  const size = m.length
  const bits = formatBits(mask)
  const bit = (i: number) => ((bits >> i) & 1) === 1
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i)
  m[7][8] = bit(6)
  m[8][8] = bit(7)
  m[8][7] = bit(8)
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i)
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = bit(i)
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = bit(i)
  m[size - 8][8] = true
}

/** 规格里的四条掩码惩罚规则 */
function penaltyOf(m: boolean[][]): number {
  const size = m.length
  let score = 0
  const runScore = (get: (i: number) => boolean) => {
    let run = 1
    for (let i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) run++
      else {
        if (run >= 5) score += 3 + (run - 5)
        run = 1
      }
    }
    if (run >= 5) score += 3 + (run - 5)
  }
  for (let y = 0; y < size; y++) runScore((x) => m[y][x])
  for (let x = 0; x < size; x++) runScore((y) => m[y][x])

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x]
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3
    }
  }

  const finderLike = [true, false, true, true, true, false, true]
  const looksLikeFinder = (get: (i: number) => boolean, from: number) => {
    for (let i = 0; i < 7; i++) if (get(from + i) !== finderLike[i]) return false
    let before = true
    for (let i = 1; i <= 4; i++) if (from - i >= 0 && get(from - i)) before = false
    let after = true
    for (let i = 7; i <= 10; i++) if (from + i < size && get(from + i)) after = false
    return before || after
  }
  for (let y = 0; y < size; y++) for (let x = 0; x + 7 <= size; x++) if (looksLikeFinder((i) => m[y][i], x)) score += 40
  for (let x = 0; x < size; x++) for (let y = 0; y + 7 <= size; y++) if (looksLikeFinder((i) => m[i][x], y)) score += 40

  let darkCount = 0
  for (const row of m) for (const cell of row) if (cell) darkCount++
  score += Math.floor(Math.abs((darkCount * 100) / (size * size) - 50) / 5) * 10
  return score
}

/** 编码。文本超出 40 版容量（等级 L 约 2953 字节）→ null。 */
export function encodeQr(text: string): QrCode | null {
  const bytes = new TextEncoder().encode(text)
  let version = 0
  for (let v = 1; v <= 40; v++) {
    const headerBits = 4 + (v < 10 ? 8 : 16)
    if (headerBits + bytes.length * 8 <= dataCodewords(v) * 8) {
      version = v
      break
    }
  }
  if (version === 0) return null

  // 位串：模式(4) + 长度(8/16) + 数据 + 终止符 + 补齐 + 填充字节
  const capacityBits = dataCodewords(version) * 8
  const bits: number[] = []
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1)
  }
  push(0b0100, 4)
  push(bytes.length, version < 10 ? 8 : 16)
  for (const b of bytes) push(b, 8)
  push(0, Math.min(4, capacityBits - bits.length))
  push(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8)

  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]
    data.push(byte)
  }

  const codewords = interleave(version, data)
  const { isFn } = functionMap(version)
  const unmasked = drawCodewords(version, codewords, isFn)

  // 逐个掩码试，按规格惩罚取最低
  let best: QrCode | null = null
  let bestPenalty = Number.POSITIVE_INFINITY
  for (let mask = 0; mask < 8; mask++) {
    const size = version * 4 + 17
    const cand = unmasked.map((row) => row.slice())
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isFn[y][x] && maskFn(mask, x, y)) cand[y][x] = !cand[y][x]
      }
    }
    drawFormat(cand, mask)
    const penalty = penaltyOf(cand)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      best = { size, version, mask, modules: cand }
    }
  }
  return best
}
