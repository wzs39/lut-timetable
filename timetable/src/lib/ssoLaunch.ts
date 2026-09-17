import { KEYS, readString, writeString, removeKey } from './storage'

/**
 * Alur login SSO Moodle (dipakai aplikasi resmi saat MFA/SSO aktif):
 *
 *  1. Aplikasi membuat `passport` acak satu kali pakai.
 *  2. Browser membuka {WWWROOT}/admin/tool/mobile/launch.php
 *     ?service=moodle_mobile_app&passport=<passport>&urlscheme=<scheme>.
 *  3. Pengguna login di browser (SSO LUT + Duo MFA di sana).
 *  4. launch.php mengarahkan ke <scheme>://token=<base64> dengan isi
 *     base64( md5(wwwroot + passport) + ':::' + token ).
 *  5. Aplikasi memverifikasi md5 dengan passport miliknya sendiri —
 *     URL palsu tanpa passport yang cocok ditolak.
 *
 * Referensi: moodle/admin/tool/mobile/launch.php (MOODLE_400_STABLE).
 * Passport disimpan sementara di storage agar validasi bisa berjalan
 * setelah proses berpindah aplikasi/browser (app di-resume, bukan
 * memori yang sama). Dihapus setelah dipakai (satu kali pakai).
 */

export const MOBILE_SERVICE = 'moodle_mobile_app'
export const LAUNCH_PATH = '/admin/tool/mobile/launch.php'
export const WWWROOT = 'https://moodle.lut.fi'
/** Skema kustom aplikasi; terdaftar di AndroidManifest (Android) dan
 *  protokol di electron/main.cjs (desktop). */
export const URL_SCHEME = 'lut-timetable'

/* ------------------------------- md5 -------------------------------
 * Implementasi md5 mandiri (RFC 1321) — ~60 baris, tanpa dependensi.
 * Di sini md5 BUKAN untuk keamanan kriptografis, hanya sebagai checksum
 * pembuktian passport (persis seperti perilaku launch.php Moodle).
 * ------------------------------------------------------------------- */

function toUtf8Bytes(str: string): number[] {
  const out: number[] = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    } else if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
      const c2 = str.charCodeAt(++i)
      c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00)
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    }
  }
  return out
}

/** Diekspor untuk uji silang terhadap digest referensi Node (bukan bagian API publik). */
export function md5(message: string): string {
  const bytes = toUtf8Bytes(message)
  const origLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  // Perhatian: operator shift JavaScript bersifat mod-32 (a >>> 32 === a >>> 0),
  // jadi byte panjang i>=4 harus diekstrak dengan pembagian, bukan shift.
  for (let i = 0; i < 8; i++) bytes.push(Math.floor(origLen / 2 ** (8 * i)) & 0xff)

  const s = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]
  const K = new Array<number>(64)
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476

  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    const M = new Array<number>(16)
    for (let j = 0; j < 16; j++) {
      M[j] =
        bytes[chunk + j * 4] |
        (bytes[chunk + j * 4 + 1] << 8) |
        (bytes[chunk + j * 4 + 2] << 16) |
        (bytes[chunk + j * 4 + 3] << 24)
    }
    let A = a0, B = b0, C = c0, D = d0
    for (let i = 0; i < 64; i++) {
      let F: number, g: number
      if (i < 16) { F = (B & C) | (~B & D); g = i }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16 }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16 }
      else { F = C ^ (B | ~D); g = (7 * i) % 16 }
      F = (F + A + K[i] + M[g]) | 0
      A = D
      D = C
      C = B
      B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) | 0
    }
    a0 = (a0 + A) | 0
    b0 = (b0 + B) | 0
    c0 = (c0 + C) | 0
    d0 = (d0 + D) | 0
  }

  const hex = (n: number) => {
    let out = ''
    for (let i = 0; i < 4; i++) {
      out += ((n >>> (8 * i)) & 0xff).toString(16).padStart(2, '0')
    }
    return out
  }
  return hex(a0) + hex(b0) + hex(c0) + hex(d0)
}

/* ------------------------------ passport ------------------------------ */

const PASSPORT_KEY = 'tt_moodle_sso_passport'

/** Passport acak sekali pakai (hex 32). Disimpan untuk validasi nanti. */
export function newPassport(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const p = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  writeString(PASSPORT_KEY, p)
  return p
}

function peekPassport(): string | null {
  return readString(PASSPORT_KEY)
}

/** Buang passport (dipakai / kedaluwarsa). */
export function clearPassport(): void {
  removeKey(PASSPORT_KEY)
}

/** URL launch.php untuk memulai alur SSO di browser. */
export function buildLaunchUrl(passport: string, scheme: string = URL_SCHEME): string {
  return (
    `${WWWROOT}${LAUNCH_PATH}?service=${MOBILE_SERVICE}` +
    `&passport=${encodeURIComponent(passport)}&urlscheme=${encodeURIComponent(scheme)}`
  )
}

/* ------------------------------ decode ------------------------------ */

export interface LaunchToken {
  token: string
  /** Token privat bila Moodle menyertakannya (HTTPS + bukan admin). */
  privatenotoken?: string
}

function base64ToUtf8(b64: string): string {
  // URL di-decode sebagai UTF-8 agar token hex (ASCII) dan charset lain aman.
  const bin = atob(b64)
  const bytes = Array.from(bin, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/**
 * Verifikasi URL <scheme>://token=<b64> dari launch.php.
 * Menerima url pesan; passport dibaca dari penyimpanan (satu kali pakai,
 * lalu dibuang). Mengembalikan null bila format salah / passport tak cocok.
 */
export function decodeLaunchUrl(
  url: string,
  opts: { passport?: string; wwwroot?: string; scheme?: string } = {},
): LaunchToken | null {
  try {
    const scheme = opts.scheme ?? URL_SCHEME
    const prefix = `${scheme}://token=`
    if (!url.startsWith(prefix)) return null
    const b64 = url.slice(prefix.length).replace(/\/+$/, '')
    if (!b64) return null
    const payload = base64ToUtf8(b64)
    const parts = payload.split(':::')
    if (parts.length < 2) return null
    const [check, token, privatenotoken] = parts as [string, string, string?]
    if (!/^[0-9a-f]{32}$/.test(check) || !token) return null
    const passport = opts.passport ?? peekPassport()
    if (!passport) return null
    const wwwroot = opts.wwwroot ?? WWWROOT
    const expected = md5(wwwroot + passport)
    // Perbandingan konstanta-waktu ringan (panjang sama, XOR akumulator).
    let diff = 0
    for (let i = 0; i < 32; i++) diff |= check.charCodeAt(i) ^ expected.charCodeAt(i)
    if (diff !== 0) return null
    return privatenotoken ? { token, privatenotoken } : { token }
  } catch {
    return null
  } finally {
    if (!opts?.passport) clearPassport()
  }
}

/** Sisa waktu (ms) passport yang belum dipakai; null bila tidak ada. */
export function pendingPassportAgeMs(): number | null {
  // Passport tidak menyimpan timestamp; cukup keberadaannya sebagai penanda
  // alur berjalan (dibuat maksimal beberapa menit lalu secara praktis).
  return peekPassport() ? 0 : null
}

export const KEYS_REF = KEYS
