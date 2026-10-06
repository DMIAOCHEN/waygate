/**
 * WebCrypto 类型的本地入口。
 *
 * 为什么不直接写 `CryptoKey`：这个名字在只带 `es2024` 库的程序里不存在 —— 它属于
 * `lib.dom`（本项目不引入，否则 DOM 类型会渗进每个包，R6 就只剩门禁在守）或
 * `node:crypto` 的命名空间（本项目不能引用，否则浏览器侧消费者会被迫依赖
 * `@types/node`）。
 *
 * 因此从**环境声明**里推导它：不论宿主把它声明成哪一种，推导出来的都是同一个类型，
 * 而且本包的 `.d.ts` 不会把任何一个平台的类型强加给消费者。
 */

/** 一把 WebCrypto 密钥。 */
export type WebCryptoKey = Parameters<typeof globalThis.crypto.subtle.encrypt>[1]

/** WebCrypto 的 `subtle` 接口。 */
export type WebCryptoSubtle = typeof globalThis.crypto.subtle
