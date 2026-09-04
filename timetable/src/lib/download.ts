import { Capacitor } from '@capacitor/core'

/**
 * Simpan file dari Blob lintas platform:
 * - Android/iOS (Capacitor): tulis ke cache lalu buka share sheet, karena
 *   <a download> tidak berfungsi di WebView.
 * - Browser/Electron/Tauri: unduh lewat anchor biasa.
 * Return true bila ditangani lewat jalur native (share sheet).
 */
export async function downloadBlob(filename: string, blob: Blob): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem')
      const { Share } = await import('@capacitor/share')
      const base64 = await blobToBase64(blob)
      await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Cache,
        recursive: true,
      })
      const uri = (await Filesystem.getUri({ path: filename, directory: Directory.Cache })).uri
      await Share.share({ title: filename, files: [uri], dialogTitle: filename })
    } catch {
      // Pengguna menutup share sheet / gagal — tidak ada yang bisa dilakukan lagi.
    }
    return true
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return false
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(blob)
  })
}
