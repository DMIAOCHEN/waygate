import { describe, expect, test } from 'vitest'

import { base64ToBytes, byteAt, bytesToBase64 } from './base64.ts'
import { CryptoError } from './errors.ts'

/** 断言某个调用抛出带指定 code 的 CryptoError。 */
function expectCryptoError(run: () => unknown, code: string): CryptoError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(CryptoError)
    const cryptoError = error as CryptoError
    expect(cryptoError.code).toBe(code)
    return cryptoError
  }
  throw new Error('预期抛出 CryptoError，但没有抛')
}

describe('编码', () => {
  // 标准测试向量。用外部已知值而不是"自己编自己解"，否则编码和解码可以一起错。
  test.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('%s 编码为 %s', (plain, encoded) => {
    const bytes = new Uint8Array([...plain].map((character) => character.charCodeAt(0)))
    expect(bytesToBase64(bytes)).toBe(encoded)
  })

  test('空输入编码为空串', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('')
  })

  test('覆盖全部 256 种字节值', () => {
    const all = new Uint8Array(256).map((_, index) => index)
    expect(base64ToBytes(bytesToBase64(all))).toStrictEqual(all)
  })
})

describe('越界读取', () => {
  test('读合法下标', () => {
    expect(byteAt(new Uint8Array([7, 8, 9]), 1)).toBe(8)
  })

  test.each([
    ['等于长度', 3],
    ['超过长度', 99],
    ['负数', -1],
  ])('下标%s时报错', (_label, index) => {
    // 这个分支在编码循环里不可达（边界已经保证合法），所以直接测函数本身，
    // 而不是在读取处写一个永远不执行的 `?? 0`。
    expect(() => byteAt(new Uint8Array([7, 8, 9]), index)).toThrow(RangeError)
  })
})

describe('解码', () => {
  test.each([
    ['', ''],
    ['Zg==', 'f'],
    ['Zm8=', 'fo'],
    ['Zm9v', 'foo'],
    ['Zm9vYg==', 'foob'],
    ['Zm9vYmE=', 'fooba'],
    ['Zm9vYmFy', 'foobar'],
  ])('%s 解码为 %s', (encoded, plain) => {
    expect(Array.from(base64ToBytes(encoded))).toStrictEqual(
      [...plain].map((character) => character.charCodeAt(0)),
    )
  })

  test('长度不是 4 的倍数时报错', () => {
    const error = expectCryptoError(() => base64ToBytes('Zg='), 'invalid-base64')
    expect(error.message).toContain('4 的倍数')
  })

  test('含字母表外字符时报错，并指出位置', () => {
    const error = expectCryptoError(() => base64ToBytes('Zg*='), 'invalid-base64')
    expect(error.message).toContain('第 2 位')
  })

  test('填充符出现在中间时报错', () => {
    // 'Zg=a' 不以 '=' 结尾，因此 dataLength 覆盖到 '='，位置非法。
    const error = expectCryptoError(() => base64ToBytes('Zg=a'), 'invalid-base64')
    expect(error.message).toContain('填充符')
  })

  test('开头就是填充符时报错', () => {
    expectCryptoError(() => base64ToBytes('=abc'), 'invalid-base64')
  })

  test('填充过多时报错', () => {
    expectCryptoError(() => base64ToBytes('a==='), 'invalid-base64')
  })

  test('URL-safe 变体不被接受 —— 协议只认一种字母表', () => {
    expectCryptoError(() => base64ToBytes('Zm9v_g=='), 'invalid-base64')
  })
})
