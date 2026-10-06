/**
 * Base64 编解码，纯 JS 实现。
 *
 * **刻意不用 `btoa` / `atob` / `Buffer`。** 这三个在目标运行时里并不都存在：
 * 浏览器有前两个，Node 有 `Buffer`，微信小程序两个都没有。设计文档 §5.8 记下的教训
 * 正是"依赖某个运行时恰好有的 API，会在另一个渠道上直接踩空"（那里的例子是
 * `TextEncoder`）。Base64 是协议的一部分，它必须到处都能跑。
 */
import { CryptoError } from './errors.ts'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const REVERSE: ReadonlyMap<string, number> = new Map(
  [...ALPHABET].map((character, index) => [character, index]),
)

/**
 * 读取一个字节，越界时报错。
 *
 * 存在的理由：`noUncheckedIndexedAccess` 让 `bytes[index]` 的类型带上 `undefined`，
 * 而循环边界已经保证了下标合法。若在读取处写 `?? 0`，那个兜底分支永远不可达，只会
 * 让覆盖率报告出现一个假缺口。抽成函数之后，越界分支可以被直接测到。
 *
 * @param bytes - 字节序列。
 * @param index - 下标。
 * @returns 该下标的字节值。
 * @throws RangeError 下标越界，说明调用方的边界计算有 bug。
 */
export function byteAt(bytes: Uint8Array, index: number): number {
  const value = bytes[index]
  if (value === undefined) {
    throw new RangeError(`字节下标 ${index} 越界（长度 ${bytes.length}）`)
  }
  return value
}

/**
 * 把字节序列编码成标准（带填充的）Base64。
 *
 * @param bytes - 待编码的字节。
 * @returns Base64 文本。
 * @throws RangeError 内部边界计算有误（不应发生）。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index
    const first = byteAt(bytes, index)
    // 余数决定这一组是 3 字节、2 字节还是 1 字节，也就决定补几个 '='。
    const second = remaining > 1 ? byteAt(bytes, index + 1) : undefined
    const third = remaining > 2 ? byteAt(bytes, index + 2) : undefined

    out += ALPHABET.charAt(first >> 2)
    out += ALPHABET.charAt(((first & 0b11) << 4) | ((second ?? 0) >> 4))
    out +=
      second === undefined ? '=' : ALPHABET.charAt(((second & 0b1111) << 2) | ((third ?? 0) >> 6))
    out += third === undefined ? '=' : ALPHABET.charAt(third & 0b111111)
  }
  return out
}

/** 解出一组 4 个字符对应的 6 位值。 */
function decodeGroup(
  text: string,
  group: number,
  dataLength: number,
): readonly [number, number, number, number] {
  const values: [number, number, number, number] = [0, 0, 0, 0]

  for (let offset = 0; offset < 4; offset += 1) {
    const position = group * 4 + offset
    const character = text.charAt(position)

    if (character === '=') {
      // 填充只允许出现在末尾，且必须正好覆盖剩余位置。
      if (position < dataLength) {
        throw new CryptoError('invalid-base64', `填充符出现在第 ${position} 位，位置非法`)
      }
      continue
    }

    const value = REVERSE.get(character)
    if (value === undefined) {
      throw new CryptoError('invalid-base64', `第 ${position} 位不是合法 Base64 字符`)
    }
    values[offset] = value
  }

  return values
}

/**
 * 解码标准 Base64。
 *
 * 严格拒绝非法输入：长度不是 4 的倍数、含字母表外字符、或填充位置不对，都报错。
 * 宽松解码会让"两端对同一段密文理解不一致"这类问题在很远的地方才暴露。
 *
 * @param text - Base64 文本。
 * @returns 解码出的字节。
 * @throws CryptoError 文本不是合法 Base64。
 */
export function base64ToBytes(text: string): Uint8Array {
  if (text.length % 4 !== 0) {
    throw new CryptoError('invalid-base64', `Base64 长度必须是 4 的倍数，实际 ${text.length}`)
  }

  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const dataLength = text.length - padding
  const groupCount = text.length / 4
  const out = new Uint8Array(groupCount * 3 - padding)

  for (let group = 0; group < groupCount; group += 1) {
    const [first, second, third, fourth] = decodeGroup(text, group, dataLength)
    const base = group * 3
    // 只有最后一组可能被填充截短，前面的组一定写满 3 字节。
    const bytesInGroup = group === groupCount - 1 ? 3 - padding : 3

    out[base] = (first << 2) | (second >> 4)
    if (bytesInGroup > 1) out[base + 1] = ((second & 0b1111) << 4) | (third >> 2)
    if (bytesInGroup > 2) out[base + 2] = ((third & 0b11) << 6) | fourth
  }

  return out
}
