import { describe, expect, test } from 'vitest'

import * as frame from '@waygate/frame'

/**
 * 公开面必须是刻意维护的。`@waygate/frame` 是发布包，任何增删都是一次对外承诺的
 * 变化，不应该由重构顺带完成。
 */
const RUNTIME_EXPORTS = [
  'CONTROL_FRAME_KINDS',
  'FrameError',
  'asRecord',
  'assertNever',
  'decodeControlFrame',
  'decodeEnvelope',
  'encodeControlFrame',
  'encodeEnvelope',
  'hasOwn',
  'parseJsonObject',
  'readOptionalField',
  'requireBoolean',
  'requireSequence',
  'requireString',
] as const

describe('包根公开面', () => {
  test('运行时导出与清单完全一致', () => {
    expect(Object.keys(frame).toSorted()).toStrictEqual([...RUNTIME_EXPORTS].toSorted())
  })

  test('信封与控制帧可以经包根往返', () => {
    const envelope = { channel: 'c', seq: 1, nonce: 'n', ciphertext: 'x', tag: 't' }
    expect(frame.decodeEnvelope(frame.encodeEnvelope(envelope))).toStrictEqual(envelope)
    expect(frame.decodeControlFrame(frame.encodeControlFrame({ kind: 'bye' }))).toStrictEqual({
      kind: 'bye',
    })
  })
})
