import { describe, expect, test } from 'vitest'

import {
  CONTROL_FRAME_KINDS,
  assertKnownKind,
  decodeControlFrame,
  encodeControlFrame,
  type ControlFrame,
} from './control.ts'
import { FrameError } from './error.ts'

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

const frames: readonly ControlFrame[] = [
  { kind: 'register', appId: 'app-1', deviceId: 'dev-1', contractVersion: '0.1.0' },
  {
    kind: 'pair',
    appId: 'app-1',
    deviceId: 'dev-1',
    pairToken: 'token',
    clientPublicKey: 'client-pub',
  },
  { kind: 'pair.ack', accepted: true, agentPublicKey: 'agent-pub' },
  { kind: 'pair.ack', accepted: false },
  { kind: 'ping', at: 1_700_000_000_000 },
  { kind: 'offline', deviceId: 'dev-1' },
  { kind: 'bye', reason: 'client closing' },
  { kind: 'bye' },
]

describe('控制帧往返', () => {
  test.each(frames)('$kind 编解码保持字段', (frame) => {
    expect(decodeControlFrame(encodeControlFrame(frame))).toStrictEqual(frame)
  })

  test('每种控制帧都能编码 —— 穷尽性检查不挡合法成员', () => {
    for (const kind of CONTROL_FRAME_KINDS) {
      expect(CONTROL_FRAME_KINDS).toContain(kind)
    }
    expect(new Set(frames.map((frame) => frame.kind))).toStrictEqual(new Set(CONTROL_FRAME_KINDS))
  })
})

describe('字段缺失时省略键，而不是写 undefined', () => {
  // 这是设计文档 §5.7 的核心要求。把它做成断言，是因为它极易在重构中悄悄退化：
  // 写 `{ agentPublicKey: undefined }` 在 JSON 里同样表现为键缺失，看起来"没坏"，
  // 但它会让"键存在"这一信息在内存与线上不一致。
  test('编码时拒绝的 pair.ack 不含 agentPublicKey 键', () => {
    const parsed: unknown = JSON.parse(encodeControlFrame({ kind: 'pair.ack', accepted: false }))
    expect(Object.hasOwn(parsed as object, 'agentPublicKey')).toBe(false)
  })

  test('解码时缺失的 agentPublicKey 不产生该键', () => {
    const decoded = decodeControlFrame('{"kind":"pair.ack","accepted":true}')
    expect(Object.hasOwn(decoded, 'agentPublicKey')).toBe(false)
  })

  test('解码时缺失的 reason 不产生该键', () => {
    const decoded = decodeControlFrame('{"kind":"bye"}')
    expect(Object.hasOwn(decoded, 'reason')).toBe(false)
  })

  test('存在则保留', () => {
    const decoded = decodeControlFrame('{"kind":"bye","reason":"done"}')
    expect(Object.hasOwn(decoded, 'reason')).toBe(true)
  })
})

describe('未知控制帧种类', () => {
  test('明确报错，而不是静默忽略', () => {
    const error = expectFrameError(
      () => decodeControlFrame('{"kind":"future.frame"}'),
      'unknown-control-frame',
    )
    expect(error.message).toContain('future.frame')
    expect(error.message).toContain('register')
  })

  test('编码端也拒绝未知种类，不把它原样发出去', () => {
    // 类型系统认为这个分支不可达，所以只能靠强制转换触达。这正是它存在的意义。
    expect(() => assertKnownKind({ kind: 'future.frame' } as unknown as ControlFrame)).toThrow(
      /未处理的联合成员/u,
    )
  })

  test('编码端放行全部已知种类', () => {
    for (const frame of frames) {
      expect(() => assertKnownKind(frame)).not.toThrow()
    }
  })

  test('缺少 kind 字段时按缺字段报错', () => {
    expectFrameError(() => decodeControlFrame('{}'), 'missing-field')
  })

  test('kind 不是字符串时报类型错', () => {
    expectFrameError(() => decodeControlFrame('{"kind":1}'), 'invalid-field')
  })
})

describe('各控制帧的字段校验', () => {
  test.each([
    ['register 缺 appId', '{"kind":"register","deviceId":"d","contractVersion":"0.1.0"}'],
    ['register 缺 deviceId', '{"kind":"register","appId":"a","contractVersion":"0.1.0"}'],
    ['register 缺 contractVersion', '{"kind":"register","appId":"a","deviceId":"d"}'],
    ['pair 缺 pairToken', '{"kind":"pair","appId":"a","deviceId":"d","clientPublicKey":"k"}'],
    ['pair 缺 clientPublicKey', '{"kind":"pair","appId":"a","deviceId":"d","pairToken":"t"}'],
    ['pair.ack 缺 accepted', '{"kind":"pair.ack"}'],
    ['offline 缺 deviceId', '{"kind":"offline"}'],
    ['ping 缺 at', '{"kind":"ping"}'],
  ])('%s', (_label, text) => {
    expectFrameError(() => decodeControlFrame(text), 'missing-field')
  })

  test.each([
    ['accepted 不是布尔', '{"kind":"pair.ack","accepted":"yes"}'],
    ['agentPublicKey 类型不符', '{"kind":"pair.ack","accepted":true,"agentPublicKey":7}'],
    ['reason 类型不符', '{"kind":"bye","reason":7}'],
    ['at 是负数', '{"kind":"ping","at":-1}'],
    ['at 是浮点', '{"kind":"ping","at":1.5}'],
    ['deviceId 不是字符串', '{"kind":"offline","deviceId":9}'],
  ])('%s', (_label, text) => {
    expectFrameError(() => decodeControlFrame(text), 'invalid-field')
  })

  test('非 JSON 与非对象输入', () => {
    expectFrameError(() => decodeControlFrame('{'), 'not-json')
    expectFrameError(() => decodeControlFrame('[]'), 'not-an-object')
  })
})
