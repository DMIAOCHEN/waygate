/**
 * 密码学操作的失败分类。
 */

/** 失败分类。 */
export type CryptoErrorCode =
  | 'not-ascii'
  | 'invalid-base64'
  | 'invalid-window-size'
  | 'invalid-public-key'
  | 'no-webcrypto'
  | 'session-expired'
  | 'decrypt-failed'

/** 密码学操作失败。 */
export class CryptoError extends Error {
  /** 失败分类。 */
  readonly code: CryptoErrorCode

  /**
   * @param code - 失败分类。
   * @param message - 面向排查者的说明。
   */
  constructor(code: CryptoErrorCode, message: string) {
    super(message)
    this.name = 'CryptoError'
    this.code = code
  }
}

/**
 * 把任意抛出物转成可读说明。
 *
 * `catch` 拿到的不保证是 `Error`（可以是字符串、数字，甚至 `undefined`）。单独抽出来
 * 是因为这个分支在真实调用点无法触达 —— WebCrypto 只会抛 `Error` —— 而"无法触达的
 * 分支"不该靠忽略注释蒙过去，应该变成一个能被直接测的函数。
 *
 * @param error - `catch` 捕获到的任意值。
 * @returns 可读说明。
 */
export function describeThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
