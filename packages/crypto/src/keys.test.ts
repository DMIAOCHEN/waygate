import { createFixedClock } from '@waygate/test-support'
import { describe, expect, test } from 'vitest'

import { base64ToBytes, bytesToBase64 } from './base64.ts'
import { CryptoError } from './errors.ts'
import { deriveSessionKey, generateKeyPair, isSessionExpired } from './keys.ts'

const TTL_MS = 60_000

/** 造一对已经互相派生好会话密钥的两端。 */
async function pairedSessions(ttlMs = TTL_MS): Promise<{
  clock: ReturnType<typeof createFixedClock>
  alice: Awaited<ReturnType<typeof deriveSessionKey>>
  bob: Awaited<ReturnType<typeof deriveSessionKey>>
}> {
  const clock = createFixedClock(1_000_000)
  const aliceKeys = await generateKeyPair()
  const bobKeys = await generateKeyPair()

  const alice = await deriveSessionKey(aliceKeys, bobKeys.publicKeyBase64, { clock, ttlMs })
  const bob = await deriveSessionKey(bobKeys, aliceKeys.publicKeyBase64, { clock, ttlMs })
  return { clock, alice, bob }
}

describe('密钥生成', () => {
  test('公钥是 32 字节的 X25519 线格式', () => {
    return generateKeyPair().then((pair) => {
      expect(base64ToBytes(pair.publicKeyBase64)).toHaveLength(32)
    })
  })

  test('每次生成都不同', async () => {
    const first = await generateKeyPair()
    const second = await generateKeyPair()
    expect(first.publicKeyBase64).not.toBe(second.publicKeyBase64)
  })
})

describe('会话密钥派生', () => {
  test('两端独立算出同一个 keyId', async () => {
    // keyId 只由两个公钥决定，所以它能在两端对上号，且不泄露共享秘密。
    const { alice, bob } = await pairedSessions()
    expect(alice.keyId).toBe(bob.keyId)
  })

  test('对端不同则 keyId 不同', async () => {
    const clock = createFixedClock(0)
    const aliceKeys = await generateKeyPair()
    const bobKeys = await generateKeyPair()
    const carolKeys = await generateKeyPair()

    const withBob = await deriveSessionKey(aliceKeys, bobKeys.publicKeyBase64, {
      clock,
      ttlMs: TTL_MS,
    })
    const withCarol = await deriveSessionKey(aliceKeys, carolKeys.publicKeyBase64, {
      clock,
      ttlMs: TTL_MS,
    })
    expect(withBob.keyId).not.toBe(withCarol.keyId)
  })

  test('有效期等于当前时刻加 TTL', async () => {
    const clock = createFixedClock(5_000)
    const aliceKeys = await generateKeyPair()
    const bobKeys = await generateKeyPair()

    const session = await deriveSessionKey(aliceKeys, bobKeys.publicKeyBase64, {
      clock,
      ttlMs: 1_234,
    })
    expect(session.expiresAt).toBe(6_234)
  })

  test('公钥长度不对时报错', async () => {
    const clock = createFixedClock(0)
    const aliceKeys = await generateKeyPair()
    const shortKey = bytesToBase64(new Uint8Array(16))

    await expect(
      deriveSessionKey(aliceKeys, shortKey, { clock, ttlMs: TTL_MS }),
    ).rejects.toMatchObject({ code: 'invalid-public-key' })
  })

  test('公钥不是合法 Base64 时报错', async () => {
    const clock = createFixedClock(0)
    const aliceKeys = await generateKeyPair()

    await expect(
      deriveSessionKey(aliceKeys, 'not base64!!', { clock, ttlMs: TTL_MS }),
    ).rejects.toBeInstanceOf(CryptoError)
  })
})

describe('会话有效期', () => {
  test('到期前有效', async () => {
    const { clock, alice } = await pairedSessions()
    expect(isSessionExpired(alice, clock)).toBe(false)
    clock.advance(TTL_MS - 1)
    expect(isSessionExpired(alice, clock)).toBe(false)
  })

  test('恰好到期即视为失效', async () => {
    const { clock, alice } = await pairedSessions()
    clock.advance(TTL_MS)
    expect(isSessionExpired(alice, clock)).toBe(true)
  })

  test('到期后失效', async () => {
    const { clock, alice } = await pairedSessions()
    clock.advance(TTL_MS + 1)
    expect(isSessionExpired(alice, clock)).toBe(true)
  })
})
