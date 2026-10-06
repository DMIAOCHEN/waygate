/**
 * AEAD 封装：把一段明文变成线格式上的三段 `{ nonce, ciphertext, tag }`。
 *
 * 用 AES-GCM。**每次封装都必须用新的随机 nonce** —— GCM 在同一密钥下重用 nonce
 * 会同时毁掉机密性与完整性，这是这类算法最典型的误用。
 *
 * 到期检查放在这里，而不是交给调用方：会话密钥的短有效期是安全要求（设计文档
 * §9.2），不该依赖每个调用点都记得先查一次。
 */
import { base64ToBytes, bytesToBase64 } from './base64.ts'
import { concatBytes } from './bytes.ts'
import type { Clock } from './clock.types.ts'
import { CryptoError, describeThrown } from './errors.ts'
import { isSessionExpired, type SessionKey } from './keys.ts'
import { requireWebCrypto } from './webcrypto.ts'

const AEAD = 'AES-GCM'

/** GCM 的认证标签长度，位。 */
const TAG_LENGTH_BITS = 128

/** GCM 的认证标签长度，字节。WebCrypto 把标签附在密文尾部返回。 */
const TAG_BYTES = TAG_LENGTH_BITS / 8

/** GCM 推荐的 nonce 长度，字节。 */
const NONCE_BYTES = 12

/** 线格式上的密文三段。 */
export type Sealed = {
  /** 初始向量，Base64。每帧唯一。 */
  readonly nonce: string
  /** 密文，Base64。不含认证标签。 */
  readonly ciphertext: string
  /** 认证标签，Base64。 */
  readonly tag: string
}

/**
 * 加密一段明文。
 *
 * @param session - 会话密钥。
 * @param plaintext - 待加密的字节。
 * @param clock - 时钟，用于判定会话是否已到期。
 * @returns 线格式的密文三段。
 * @throws CryptoError 会话密钥已到期，或运行时不具备 WebCrypto。
 */
export async function seal(
  session: SessionKey,
  plaintext: Uint8Array,
  clock: Clock,
): Promise<Sealed> {
  if (isSessionExpired(session, clock)) {
    throw new CryptoError('session-expired', '会话密钥已到期，必须先重新握手并重新校验身份')
  }

  // 注意：不能把 `getRandomValues` 解构出来单独调用 —— 它要求 `this` 是 Crypto 实例，
  // 解构会丢掉绑定并抛 "Value of \"this\" must be of type Crypto"。
  const api = requireWebCrypto()
  const nonce = api.getRandomValues(new Uint8Array(NONCE_BYTES))
  const combined = new Uint8Array(
    await api.subtle.encrypt(
      { name: AEAD, iv: nonce, tagLength: TAG_LENGTH_BITS },
      session.key,
      plaintext,
    ),
  )

  const tagStart = combined.length - TAG_BYTES
  return {
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(combined.subarray(0, tagStart)),
    tag: bytesToBase64(combined.subarray(tagStart)),
  }
}

/**
 * 解密一段密文。
 *
 * 认证失败**必须**报错而不是返回空数据：篡改过的密文与"恰好解出空内容"在调用方
 * 看来必须可区分。
 *
 * @param session - 会话密钥。
 * @param sealed - 线格式的密文三段。
 * @param clock - 时钟，用于判定会话是否已到期。
 * @returns 明文字节。
 * @throws CryptoError 会话密钥已到期、认证失败，或运行时不具备 WebCrypto。
 */
export async function open(session: SessionKey, sealed: Sealed, clock: Clock): Promise<Uint8Array> {
  if (isSessionExpired(session, clock)) {
    throw new CryptoError('session-expired', '会话密钥已到期，必须先重新握手并重新校验身份')
  }

  const { subtle } = requireWebCrypto()
  const nonce = base64ToBytes(sealed.nonce)
  const combined = concatBytes([base64ToBytes(sealed.ciphertext), base64ToBytes(sealed.tag)])

  try {
    const plaintext = await subtle.decrypt(
      { name: AEAD, iv: nonce, tagLength: TAG_LENGTH_BITS },
      session.key,
      combined,
    )
    return new Uint8Array(plaintext)
  } catch (error) {
    throw new CryptoError(
      'decrypt-failed',
      `认证失败：密文被篡改、密钥不符或 nonce 错误（${describeThrown(error)}）`,
    )
  }
}
