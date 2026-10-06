/**
 * 会话密钥：X25519 密钥交换 + HKDF 派生 AES-GCM 密钥。
 *
 * 分工（设计文档 §8.1）：
 * - 每个客户端实例与每个 Endpoint 各持一对非对称密钥，**私钥不出端**。
 * - 平台只搬运公钥，从不算出会话密钥 —— 这是"平台被攻破也只见密文"的前提。
 *
 * 会话密钥有**短有效期**。这不是增强项而是必需项：Web 与小程序的本地存储都不是
 * 硬件保护的，在已越狱／已 root 的设备上私钥可能被复制，所以"短有效期 + 到期重新
 * 握手 + 接入方重新校验身份"是唯一可行的补救（设计文档 §9.2、§8.5）。
 */
import { base64ToBytes, bytesToBase64 } from './base64.ts'
import { asciiBytes } from './bytes.ts'
import type { Clock } from './clock.types.ts'
import { CryptoError } from './errors.ts'
import type { WebCryptoKey } from './webcrypto.types.ts'
import { requireWebCrypto } from './webcrypto.ts'

/** HKDF 的上下文串。两端必须一致，因此它是协议常量，不是可配置项。 */
const HKDF_INFO = asciiBytes('waygate/session/v1')

/** HKDF 盐。X25519 输出已是高熵共享秘密，这里用全零盐。 */
const HKDF_SALT = new Uint8Array(32)

/** 对称加密算法。 */
const AEAD = 'AES-GCM'

/** X25519 公钥的线格式长度，字节。 */
const X25519_PUBLIC_KEY_BYTES = 32

/** 一对本端密钥。 */
export type KeyPair = {
  /** 私钥。**永不离开本端**，也不应被序列化。 */
  readonly privateKey: WebCryptoKey
  /** 公钥，用于本地运算。 */
  readonly publicKey: WebCryptoKey
  /** 公钥的 Base64 线格式，用于经平台交换。 */
  readonly publicKeyBase64: string
}

/** 一次已派生的会话密钥。 */
export type SessionKey = {
  /** 对称密钥。 */
  readonly key: WebCryptoKey
  /**
   * 会话标识。由两端公钥派生，因此**两端算出同一个值** —— 它只含公开信息，
   * 可以安全地出现在日志与审计里，用于把两端记录的会话对上号。
   */
  readonly keyId: string
  /** 失效时刻，毫秒。 */
  readonly expiresAt: number
}

/** 派生会话密钥时的可注入参数。 */
export type SessionOptions = {
  /** 时钟。测试必须注入，不得读真实时间。 */
  readonly clock: Clock
  /** 会话密钥有效期，毫秒。 */
  readonly ttlMs: number
}

/**
 * 生成一对 X25519 密钥。
 *
 * @returns 新密钥对，含公钥的 Base64 线格式。
 * @throws CryptoError 运行时不具备 WebCrypto。
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const { subtle } = requireWebCrypto()
  const generated = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])
  // 收窄断言：X25519 是非对称算法，必然返回密钥对；而标准库把 `AlgorithmIdentifier`
  // 定义得很宽，所以静态类型只能给出 `CryptoKeyPair | CryptoKey` 的联合。
  // 这里选择断言而不是加一个永不可达的运行时分支 —— 后者的唯一作用是让覆盖率说谎。
  const pair = generated as { privateKey: WebCryptoKey; publicKey: WebCryptoKey }

  const rawPublic = await subtle.exportKey('raw', pair.publicKey)
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicKeyBase64: bytesToBase64(new Uint8Array(rawPublic)),
  }
}

/**
 * 用本端私钥与对端公钥派生会话密钥。
 *
 * @param own - 本端密钥对。
 * @param peerPublicKeyBase64 - 对端公钥的 Base64 线格式。
 * @param options - 时钟与有效期。
 * @returns 派生的会话密钥。
 * @throws CryptoError 运行时不具备 WebCrypto，或对端公钥不是合法 Base64／长度不对。
 */
export async function deriveSessionKey(
  own: KeyPair,
  peerPublicKeyBase64: string,
  options: SessionOptions,
): Promise<SessionKey> {
  const { subtle } = requireWebCrypto()

  const peerBytes = base64ToBytes(peerPublicKeyBase64)
  if (peerBytes.length !== X25519_PUBLIC_KEY_BYTES) {
    throw new CryptoError(
      'invalid-public-key',
      `X25519 公钥必须是 ${X25519_PUBLIC_KEY_BYTES} 字节，实际 ${peerBytes.length} 字节`,
    )
  }

  const peerKey = await subtle.importKey('raw', peerBytes, { name: 'X25519' }, false, [])
  const shared = await subtle.deriveBits({ name: 'X25519', public: peerKey }, own.privateKey, 256)

  const hkdfKey = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  const key = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
    hkdfKey,
    { name: AEAD, length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )

  // keyId 必须**与顺序无关**：两端各自把自己的公钥放在前面，所以按顺序拼接会算出
  // 两个不同的值。先排序再拼接，两端才独立算出同一个标识。
  const [first, second] = [own.publicKeyBase64, peerPublicKeyBase64].toSorted()
  const digest = await subtle.digest('SHA-256', asciiBytes(`${first}|${second}`))

  return {
    key,
    keyId: bytesToBase64(new Uint8Array(digest)),
    expiresAt: options.clock.now() + options.ttlMs,
  }
}

/**
 * 判断会话密钥是否已失效。
 *
 * @param session - 待判断的会话密钥。
 * @param clock - 时钟。
 * @returns 已到期（含恰好到期）时为真。
 */
export function isSessionExpired(session: SessionKey, clock: Clock): boolean {
  return clock.now() >= session.expiresAt
}
