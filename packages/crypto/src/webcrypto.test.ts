import { describe, expect, test } from 'vitest'

import { CryptoError } from './errors.ts'
import { requireWebCrypto } from './webcrypto.ts'

describe('WebCrypto 可用性检查', () => {
  test('从全局对象取得接口', () => {
    expect(requireWebCrypto()).toBe(globalThis.crypto)
  })

  test('显式传入宿主也能取得', () => {
    expect(requireWebCrypto(globalThis)).toBe(globalThis.crypto)
  })

  test('宿主没有 crypto 时明确报错', () => {
    // 这就是设计文档 §11 风险一的形状：某个渠道的运行时根本没有 WebCrypto。
    // 它必须是一个明确的失败点，而不是深处的一句
    // "Cannot read property 'subtle' of undefined"。
    try {
      requireWebCrypto({})
      throw new Error('预期抛出 CryptoError，但没有抛')
    } catch (error) {
      expect(error).toBeInstanceOf(CryptoError)
      expect((error as CryptoError).code).toBe('no-webcrypto')
      expect((error as CryptoError).message).toContain('§9.4')
    }
  })

  test('有 crypto 但没有 subtle 时同样报错', () => {
    const withoutSubtle = { crypto: {} as typeof globalThis.crypto }
    try {
      requireWebCrypto(withoutSubtle)
      throw new Error('预期抛出 CryptoError，但没有抛')
    } catch (error) {
      expect((error as CryptoError).code).toBe('no-webcrypto')
    }
  })

  test('crypto 显式为 undefined 时报错', () => {
    expect(() => requireWebCrypto({ crypto: undefined })).toThrow(CryptoError)
  })
})
