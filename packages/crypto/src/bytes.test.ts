import { describe, expect, test } from 'vitest'

import { asciiBytes, concatBytes } from './bytes.ts'
import { CryptoError } from './errors.ts'

describe('拼接字节', () => {
  test('空列表得到空序列', () => {
    expect(concatBytes([])).toStrictEqual(new Uint8Array(0))
  })

  test('按顺序拼接', () => {
    const result = concatBytes([new Uint8Array([1, 2]), new Uint8Array([3])])
    expect(Array.from(result)).toStrictEqual([1, 2, 3])
  })

  test('含空段时不受影响', () => {
    const result = concatBytes([new Uint8Array(0), new Uint8Array([9]), new Uint8Array(0)])
    expect(Array.from(result)).toStrictEqual([9])
  })

  test('返回新序列，不共享底层缓冲', () => {
    const source = new Uint8Array([1, 2])
    const result = concatBytes([source])
    result[0] = 99
    expect(Array.from(source)).toStrictEqual([1, 2])
  })
})

describe('ASCII 转字节', () => {
  test('逐字符取码点', () => {
    expect(Array.from(asciiBytes('abc'))).toStrictEqual([97, 98, 99])
  })

  test('空串得到空序列', () => {
    expect(asciiBytes('')).toStrictEqual(new Uint8Array(0))
  })

  test('边界值 0x7f 通过', () => {
    expect(Array.from(asciiBytes('\u007f'))).toStrictEqual([0x7f])
  })

  test('非 ASCII 直接报错，而不是悄悄产生两端理解不同的字节', () => {
    // 这正是不能用 TextEncoder 的那类问题：不同运行时对编码的处理并不一致。
    const error = (() => {
      try {
        asciiBytes('中')
      } catch (caught) {
        return caught as CryptoError
      }
      throw new Error('预期抛出 CryptoError，但没有抛')
    })()
    expect(error).toBeInstanceOf(CryptoError)
    expect(error.code).toBe('not-ascii')
    expect(error.message).toContain('第 0 位')
  })

  test('非 ASCII 出现在中间时指出位置', () => {
    try {
      asciiBytes('ab\u00e9')
      throw new Error('预期抛出 CryptoError，但没有抛')
    } catch (error) {
      expect((error as CryptoError).message).toContain('第 2 位')
    }
  })
})
