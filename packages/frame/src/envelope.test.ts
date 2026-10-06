import { describe, expect, test } from 'vitest'

import { FrameError } from './error.ts'
import { decodeEnvelope, encodeEnvelope, type Envelope } from './envelope.ts'

const valid: Envelope = {
  channel: 'route-1',
  seq: 7,
  nonce: 'bm9uY2U=',
  ciphertext: 'Y2lwaGVy',
  tag: 'dGFn',
}

/** 断言某个调用抛出带指定 code 的 FrameError。 */
function expectFrameError(run: () => unknown, code: string): FrameError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(FrameError)
    const frameError = error as FrameError
    expect(frameError.code).toBe(code)
    return frameError
  }
  throw new Error('预期抛出 FrameError，但没有抛')
}

describe('信封往返', () => {
  test('编解码保持全部字段', () => {
    expect(decodeEnvelope(encodeEnvelope(valid))).toStrictEqual(valid)
  })

  test('只序列化信封字段，内存对象上多出的字段不上线', () => {
    const withExtra = { ...valid, secret: '不该上线' }
    expect(JSON.parse(encodeEnvelope(withExtra))).toStrictEqual(valid)
  })

  test('忽略多余字段而不报错 —— 新版本加字段不能让旧版本解析失败', () => {
    const text = JSON.stringify({ ...valid, addedLater: true })
    expect(decodeEnvelope(text)).toStrictEqual(valid)
  })

  test('seq 为 0 合法', () => {
    expect(decodeEnvelope(JSON.stringify({ ...valid, seq: 0 })).seq).toBe(0)
  })
})

describe('信封解析失败', () => {
  test('非 JSON', () => {
    expectFrameError(() => decodeEnvelope('{'), 'not-json')
  })

  test('JSON 但不是对象', () => {
    expectFrameError(() => decodeEnvelope('[1,2]'), 'not-an-object')
    expectFrameError(() => decodeEnvelope('null'), 'not-an-object')
    expectFrameError(() => decodeEnvelope('"text"'), 'not-an-object')
  })

  test.each(['channel', 'seq', 'nonce', 'ciphertext', 'tag'])('缺字段 %s', (key) => {
    const partial: Record<string, unknown> = { ...valid }
    delete partial[key]
    expectFrameError(() => decodeEnvelope(JSON.stringify(partial)), 'missing-field')
  })

  test.each([
    ['channel', 1],
    ['nonce', null],
    ['ciphertext', {}],
    ['tag', []],
  ])('%s 类型不符', (key, value) => {
    expectFrameError(
      () => decodeEnvelope(JSON.stringify({ ...valid, [key]: value })),
      'invalid-field',
    )
  })

  test.each([
    ['负数', -1],
    ['浮点', 1.5],
    ['非安全整数', Number.MAX_SAFE_INTEGER + 2],
    ['字符串', '7'],
  ])('seq 是%s时报错', (_label, value) => {
    expectFrameError(
      () => decodeEnvelope(JSON.stringify({ ...valid, seq: value })),
      'invalid-field',
    )
  })

  test('报错信息指出是哪个字段', () => {
    const error = expectFrameError(
      () => decodeEnvelope(JSON.stringify({ ...valid, nonce: 1 })),
      'invalid-field',
    )
    expect(error.message).toContain('envelope.nonce')
  })
})
