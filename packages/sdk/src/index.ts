/**
 * `@waygate/sdk` —— 接入方门面。
 *
 * **零逻辑，只做 re-export。** 存在的理由：接入方实现契约需要契约、线格式与加密三块，
 * 没有门面就要装三个包并自己保证版本一致，而"契约版本"与"包版本"会变成两个概念 ——
 * 这与"契约版本是单一事实来源"（设计文档 §5.7）直接冲突。有了门面，接入方是
 * "一个依赖、一个版本谈协商"。
 *
 * 代价是门面会漂移，因此 `scripts/check-boundaries.ts` 强制它的公开面**等于**
 * 被 re-export 的三个包公开面的并集。
 */
export * from '@waygate/contract'
export * from '@waygate/crypto'
export * from '@waygate/frame'
