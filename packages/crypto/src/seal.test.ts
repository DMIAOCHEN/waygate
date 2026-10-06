import { createFixedClock } from '@waygate/test-support'
import { describe, expect, test } from 'vitest'

import { asciiBytes } from './bytes.ts'
import { deriveSessionKey, generateKeyPair, type SessionKey } from './keys.ts'
import { open, seal } from './seal.ts'

const TTL_MS = 60_000

/** 造一对已经互相派生好会话密钥的两端，以及一个可手动推进的时钟。 */
async function pairedSessions(ttlMs = TTL_MS): Promise<{
  clock: ReturnType<typeof createFixedClock>
  alice: SessionKey
  bob: SessionKey
}> {
  const clock = createFixedClock(1_000_000)
  const aliceKeys = await generateKeyPair()
  const bobKeys = await generateKeyPair()

  const alice = await deriveSessionKey(aliceKeys, bobKeys.publicKeyBase64, { clock, ttlMs })
  const bob = await deriveSessionKey(bobKeys, aliceKeys.publicKeyBase64, { clock, ttlMs })
  return { clock, alice, bob }
}

describe('封装往返', () => {
  test('一端封装，另一端解开', async () => {
    const { clock, alice, bob } = await pairedSessions()
    const plaintext = asciiBytes('{"type":"text","text":"hello"}')

    const sealed = await seal(alice, plaintext, clock)
    const opened = await open(bob, sealed, clock)

    expect(Array.from(opened)).toStrictEqual(Array.from(plaintext))
  })

  test('空明文可以往返', async () => {
    const { clock, alice, bob } = await pairedSessions()
    const sealed = await seal(alice, new Uint8Array(0), clock)
    expect(Array.from(await open(bob, sealed, clock))).toStrictEqual([])
  })

  test('每次封装都用新的 nonce', async () => {
    // GCM 在同一密钥下重用 nonce 会同时毁掉机密性与完整性，这是最典型的误用。
    const { clock, alice } = await pairedSessions()
    const first = await seal(alice, asciiBytes('same'), clock)
    const second = await seal(alice, asciiBytes('same'), clock)

    expect(first.nonce).not.toBe(second.nonce)
    expect(first.ciphertext).not.toBe(second.ciphertext)
  })

  test('相同明文与不同 nonce 得到不同密文', async () => {
    const { clock, alice } = await pairedSessions()
    const a = await seal(alice, asciiBytes('x'), clock)
    const b = await seal(alice, asciiBytes('x'), clock)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })
})

describe('会话到期', () => {
  test('封装的到期检查', async () => {
    const { clock, alice } = await pairedSessions()
    clock.advance(TTL_MS)
    await expect(seal(alice, asciiBytes('x'), clock)).rejects.toMatchObject({
      code: 'session-expired',
    })
  })

  test('解开的到期检查', async () => {
    const { clock, alice, bob } = await pairedSessions()
    const sealed = await seal(alice, asciiBytes('x'), clock)

    clock.advance(TTL_MS)
    // 到期必须在解密之前拦住：否则会先做一次无意义的密码学运算。
    await expect(open(bob, sealed, clock)).rejects.toMatchObject({ code: 'session-expired' })
  })
})

describe('认证失败', () => {
  test('密文被篡改', async () => {
    const { clock, alice, bob } = await pairedSessions()
    const sealed = await seal(alice, asciiBytes('secret'), clock)

    const tampered = { ...sealed, ciphertext: `${sealed.ciphertext.slice(0, -2)}AA` }
    await expect(open(bob, tampered, clock)).rejects.toMatchObject({ code: 'decrypt-failed' })
  })

  test('认证标签被篡改', async () => {
    const { clock, alice, bob } = await pairedSessions()
    const sealed = await seal(alice, asciiBytes('secret'), clock)

    const tampered = { ...sealed, tag: `${sealed.tag.slice(0, -2)}AA` }
    await expect(open(bob, tampered, clock)).rejects.toMatchObject({ code: 'decrypt-failed' })
  })

  test('nonce 被替换', async () => {
    const { clock, alice, bob } = await pairedSessions()
    const sealed = await seal(alice, asciiBytes('secret'), clock)

    const other = await seal(alice, asciiBytes('other'), clock)
    await expect(open(bob, { ...sealed, nonce: other.nonce }, clock)).rejects.toMatchObject({
      code: 'decrypt-failed',
    })
  })

  test('用另一组会话的密钥解不开', async () => {
    const { clock, alice } = await pairedSessions()
    const otherPair = await pairedSessions()
    const sealed = await seal(alice, asciiBytes('secret'), clock)

    await expect(open(otherPair.alice, sealed, clock)).rejects.toMatchObject({
      code: 'decrypt-failed',
    })
  })

  test('认证失败报错而不是返回空数据 —— 篡改与"恰好是空内容"必须可区分', async () => {
    const { clock, alice, bob } = await pairedSessions()
    const sealed = await seal(alice, asciiBytes('secret'), clock)
    const tampered = { ...sealed, tag: `${sealed.tag.slice(0, -2)}AA` }

    await expect(open(bob, tampered, clock)).rejects.toThrow(/认证失败/u)
  })
})
