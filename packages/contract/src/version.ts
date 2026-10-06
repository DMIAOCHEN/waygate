/**
 * 契约版本的单一事实来源，只在 `@waygate/contract` 定义一次。
 *
 * 必须与 `@waygate/contract` 的包版本逐字相等 —— `scripts/check-versions.ts` 强制。
 * 发布包使用同步版本组，因此这个值同时也是接入方依赖的其余包的版本号。
 *
 * 参见设计文档 §5.7（版本协商）与 §8（版本与发布）。
 */
export const CONTRACT_VERSION = '0.1.0'
