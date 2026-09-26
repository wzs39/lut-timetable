// 应用图标解析：托盘与跳转列表共用一份。
//
// 打包后图标落在 resources/（见 package.json 的 extraResources），dev 直接读
// build/icon.ico。以前这两处各写一份路径判断，结果打包后 resources/icon.ico
// 根本不存在，图标静默缺失——所以这里既解析也留痕（空图标是最难查的一类问题）。
const path = require('node:path')
const fs = require('node:fs')
const { nativeImage } = require('electron')

/** 图标路径；两处候选都找不到时返回 null 并警告。 */
function appIconPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'icon.ico'),
    path.join(__dirname, '..', 'build', 'icon.ico'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch { /* 试下一个候选 */ }
  }
  console.warn('[desktop] icon.ico not found in: ' + candidates.join(' | '))
  return null
}

/** 可直接交给 Tray 的图像；找不到 / 读坏了就返回空图，由调用方（setupTray）判定降级。
 *  启动路径上的 try 留着：这里抛一下就是应用起不来。 */
function appIcon() {
  const p = appIconPath()
  if (!p) return nativeImage.createEmpty()
  try {
    return nativeImage.createFromPath(p)
  } catch {
    return nativeImage.createEmpty()
  }
}

module.exports = { appIconPath, appIcon }
