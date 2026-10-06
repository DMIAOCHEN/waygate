/**
 * 取得当前运行时的 WebCrypto 接口。
 *
 * 这一层检查直接对应设计文档 §11 的风险一：**微信小程序运行时没有 WebCrypto**
 * （没有 `crypto.subtle`）。在那里做端到端加密只有两条路 —— 纯 JS 库或
 * `WXWebAssembly` —— 而无论走哪条，都必须先有一个**明确的失败点**，而不是在某个
 * 深处抛出 `Cannot read property 'subtle' of undefined`。
 *
 * 可注入是为了可测：`globalThis.crypto` 在 Node 里不易安全替换，而把来源作为参数
 * 就能直接构造"没有 WebCrypto 的运行时"这一情形。
 */
import { CryptoError } from './errors.ts'

/** 一个可能提供 WebCrypto 的宿主。默认是全局对象。 */
export type WebCryptoSource = {
  readonly crypto?: typeof globalThis.crypto | undefined
}

/**
 * 取得 WebCrypto 接口，或在运行时不具备它时明确报错。
 *
 * @param source - 提供 `crypto` 的宿主，默认 `globalThis`。
 * @returns 该宿主的 WebCrypto 接口。
 * @throws CryptoError 运行时没有 `crypto` 或没有 `crypto.subtle`。
 */
export function requireWebCrypto(source: WebCryptoSource = globalThis): typeof globalThis.crypto {
  const api = source.crypto
  if (api === undefined || api.subtle === undefined) {
    throw new CryptoError(
      'no-webcrypto',
      '当前运行时没有 WebCrypto（crypto.subtle），无法进行端到端加密；该渠道必须显式声明降级（设计文档 §9.4）',
    )
  }
  return api
}
