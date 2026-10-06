/**
 * `@waygate/crypto` —— 端到端加密。
 *
 * 本包在中转的运行时依赖闭包之外（R2）：中继看不到明文，也就不该有解密能力。
 *
 * 它只在**字节**层面工作：文本编码（UTF-8）是调用方的关注点，而且恰好是
 * `TextEncoder` 在部分目标运行时缺失的那个关注点。本包因此不引入它。
 */
export { base64ToBytes, bytesToBase64 } from './base64.ts'
export { asciiBytes, concatBytes } from './bytes.ts'
export type { Clock } from './clock.types.ts'
export { CryptoError } from './errors.ts'
export type { CryptoErrorCode } from './errors.ts'
export { deriveSessionKey, generateKeyPair, isSessionExpired } from './keys.ts'
export type { KeyPair, SessionKey, SessionOptions } from './keys.ts'
export { createSeqWindow } from './replay.ts'
export type { SeqWindow } from './replay.ts'
export { open, seal } from './seal.ts'
export type { Sealed } from './seal.ts'
export { requireWebCrypto } from './webcrypto.ts'
export type { WebCryptoSource } from './webcrypto.ts'
export type { WebCryptoKey, WebCryptoSubtle } from './webcrypto.types.ts'
