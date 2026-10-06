import { describe, expect, test } from 'vitest'

import { CryptoError, describeThrown } from './errors.ts'

describe('CryptoError', () => {
  test('带上分类与名称', () => {
    const error = new CryptoError('decrypt-failed', '解不开')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('CryptoError')
    expect(error.code).toBe('decrypt-failed')
    expect(error.message).toBe('解不开')
  })
})

describe('describeThrown', () => {
  test('Error 取 message', () => {
    expect(describeThrown(new Error('boom'))).toBe('boom')
  })

  test.each([
    ['字符串', 'plain', 'plain'],
    ['数字', 42, '42'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
  ])('非 Error（%s）转成字符串', (_label, value, expected) => {
    // catch 拿到的不保证是 Error，这个分支在真实调用点触达不到。
    expect(describeThrown(value)).toBe(expected)
  })
})
