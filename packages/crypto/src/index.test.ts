import { describe, expect, test } from 'vitest'

import * as crypto from '@waygate/crypto'

/** 公开面刻意维护：这是发布包，增删都是一次对外承诺的变化。 */
const RUNTIME_EXPORTS = [
  'CryptoError',
  'asciiBytes',
  'base64ToBytes',
  'bytesToBase64',
  'concatBytes',
  'createSeqWindow',
  'deriveSessionKey',
  'generateKeyPair',
  'isSessionExpired',
  'open',
  'requireWebCrypto',
  'seal',
] as const

describe('包根公开面', () => {
  test('运行时导出与清单完全一致', () => {
    expect(Object.keys(crypto).toSorted()).toStrictEqual([...RUNTIME_EXPORTS].toSorted())
  })

  test('可以经包根完成一次完整往返', async () => {
    const clock = { now: () => 1_000 }
    const aliceKeys = await crypto.generateKeyPair()
    const bobKeys = await crypto.generateKeyPair()
    const alice = await crypto.deriveSessionKey(aliceKeys, bobKeys.publicKeyBase64, {
      clock,
      ttlMs: 1_000,
    })
    const bob = await crypto.deriveSessionKey(bobKeys, aliceKeys.publicKeyBase64, {
      clock,
      ttlMs: 1_000,
    })

    const sealed = await crypto.seal(alice, crypto.asciiBytes('ping'), clock)
    expect(Array.from(await crypto.open(bob, sealed, clock))).toStrictEqual([112, 105, 110, 103])
  })
})
