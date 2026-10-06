import { describe, expect, test } from 'vitest'

import * as contract from '@waygate/contract'
import * as crypto from '@waygate/crypto'
import * as frame from '@waygate/frame'
import * as sdk from '@waygate/sdk'

describe('门面等于三个包的并集', () => {
  test('运行时公开面逐字等于并集', () => {
    // 这条用例是 check-boundaries 那条门禁的自测版本：门禁保证 CI 上不漂移，
    // 这里保证本地一跑就能看到差异。
    const union = [
      ...new Set([...Object.keys(contract), ...Object.keys(crypto), ...Object.keys(frame)]),
    ].toSorted()
    expect(Object.keys(sdk).toSorted()).toStrictEqual(union)
  })

  test('契约版本经门面可见', () => {
    expect(sdk.CONTRACT_VERSION).toBe(contract.CONTRACT_VERSION)
  })
})

describe('经门面完成一次端到端往返', () => {
  test('接入方只依赖 sdk 就能配对、加密与解帧', async () => {
    const clock = { now: () => 1_000 }
    const agentKeys = await sdk.generateKeyPair()
    const clientKeys = await sdk.generateKeyPair()

    const agent = await sdk.deriveSessionKey(agentKeys, clientKeys.publicKeyBase64, {
      clock,
      ttlMs: 1_000,
    })
    const client = await sdk.deriveSessionKey(clientKeys, agentKeys.publicKeyBase64, {
      clock,
      ttlMs: 1_000,
    })

    // 客户端加密 → 装进信封 → 接入方解信封 → 解密。
    const sealed = await sdk.seal(client, sdk.asciiBytes('conversation.list'), clock)
    const envelope: sdk.Envelope = {
      channel: 'route-1',
      seq: 1,
      nonce: sealed.nonce,
      ciphertext: sealed.ciphertext,
      tag: sealed.tag,
    }

    const decoded = sdk.decodeEnvelope(sdk.encodeEnvelope(envelope))
    const plaintext = await sdk.open(agent, decoded, clock)
    expect(Array.from(plaintext)).toStrictEqual(Array.from(sdk.asciiBytes('conversation.list')))
  })
})
