/**
 * 后台宿主桥（Android 隐藏 WebView / iOS BGAppRefreshTask 里的隐藏 WKWebView）。
 *
 * 后台环境与 App 完全不同：没有 localStorage（不同 origin）、没有 Capacitor 插件、
 * 也不该有 CORS。宿主把三件事注入成函数——读写偏好（Capacitor Preferences 的同一份
 * 存储）、原生 HTTP、让小组件重画——JS 侧只认这一个接口，两端各自实现。
 *
 * 两个平台的注入形状不同，包装收在这里：
 *  - Android: `window.lutBg`（@JavascriptInterface，方法同步返回）
 *  - iOS: `window.webkit.messageHandlers.lutBg`（postMessage 单向）+ 回调
 *    `window.__lutBgResolve(id, json)`（宿主用 evaluateJavaScript 回来）
 */

export interface BgHost {
  prefGet: (key: string) => Promise<string | null>
  prefSet: (key: string, value: string) => Promise<void>
  fetchText: (url: string, accept: string) => Promise<string>
  refreshWidgets: () => Promise<void>
  /** 这一趟结束了（Android jobFinished / iOS setTaskCompleted） */
  done: (result: { ok: boolean; message?: string }) => void
}

type AndroidRaw = {
  prefGet?: (key: string) => string | null
  prefSet?: (key: string, value: string) => void
  fetchText?: (url: string, accept: string) => string
  refreshWidgets?: () => void
  done?: (json: string) => void
}

const RESOLVE_FN = '__lutBgResolve'

/** Android：@JavascriptInterface 的方法是同步的，这里只做 Promise 包装。 */
function wrapAndroid(raw: AndroidRaw): BgHost {
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  return {
    prefGet: async (key) => str(raw.prefGet?.(key)),
    prefSet: async (key, value) => {
      raw.prefSet?.(key, value)
    },
    fetchText: async (url, accept) => {
      const text = str(raw.fetchText?.(url, accept))
      if (text == null) throw new Error('bg fetch failed')
      return text
    },
    refreshWidgets: async () => {
      raw.refreshWidgets?.()
    },
    done: (result) => raw.done?.(JSON.stringify(result)),
  }
}

type IosRaw = {
  postMessage: (message: unknown) => void
}

let iosSeq = 0

/** iOS：请求/响应式消息桥（postMessage 出去，evaluateJavaScript 回来）。 */
function wrapIos(raw: IosRaw): BgHost {
  const pending = new Map<number, (value: string | null) => void>()
  const w = window as unknown as { [RESOLVE_FN]?: (id: number, json: unknown) => void }
  w[RESOLVE_FN] = (id, json) => {
    const resolve = pending.get(id)
    if (!resolve) return
    pending.delete(id)
    resolve(typeof json === 'string' ? json : json == null ? null : JSON.stringify(json))
  }
  const request = (op: string, args: Record<string, unknown>): Promise<string | null> =>
    new Promise((resolve) => {
      const id = ++iosSeq
      pending.set(id, resolve)
      raw.postMessage({ id, op, ...args })
    })

  return {
    prefGet: (key) => request('prefGet', { key }),
    prefSet: async (key, value) => {
      await request('prefSet', { key, value })
    },
    fetchText: async (url, accept) => {
      const text = await request('fetchText', { url, accept })
      if (text == null) throw new Error('bg fetch failed')
      return text
    },
    refreshWidgets: async () => {
      await request('refreshWidgets', {})
    },
    done: (result) => raw.postMessage({ op: 'done', ...result }),
  }
}

/** 有后台宿主吗？fetchIcs 用它决定走哪条网络分支（后台里 Capacitor 不存在）。 */
export function hasBgHost(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as { lutBg?: AndroidRaw; webkit?: { messageHandlers?: { lutBg?: IosRaw } } }
  if (w.lutBg?.fetchText) return true
  return !!w.webkit?.messageHandlers?.lutBg?.postMessage
}

export function bgHost(): BgHost | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { lutBg?: AndroidRaw; webkit?: { messageHandlers?: { lutBg?: IosRaw } } }
  if (w.lutBg?.fetchText) return wrapAndroid(w.lutBg)
  const ios = w.webkit?.messageHandlers?.lutBg
  if (ios?.postMessage) return wrapIos(ios)
  return null
}
