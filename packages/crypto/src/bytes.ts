/**
 * 字节工具。
 *
 * **刻意不用 `TextEncoder` / `Buffer`。** 微信小程序运行时没有 `TextEncoder`，浏览器
 * 没有 `Buffer`。设计文档 §5.8 记下的教训正是"依赖某个运行时恰好有的 API，会在另一个
 * 渠道上直接踩空"，所以这里只做最小、可移植的字节操作。
 */
import { CryptoError } from './errors.ts'

/**
 * 拼接多段字节。
 *
 * @param parts - 待拼接的字节段，按顺序。
 * @returns 新的连续字节序列。
 */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/**
 * 把纯 ASCII 文本转成字节。
 *
 * 不做 UTF-8 编码：UTF-8 编码器是另一个关注点，而且恰好是 `TextEncoder` 缺失的那个
 * 关注点。这个函数只用于协议常量（如 HKDF 的 `info`），遇到非 ASCII 直接报错，
 * 而不是悄悄产生一段两端理解不同的字节。
 *
 * @param text - 纯 ASCII 文本。
 * @returns 对应字节。
 * @throws CryptoError 文本含非 ASCII 字符。
 */
export function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code > 0x7f) {
      throw new CryptoError('not-ascii', `第 ${index} 位不是 ASCII 字符（码点 ${code}）`)
    }
    bytes[index] = code
  }
  return bytes
}
