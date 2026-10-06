/**
 * `@waygate/test-support` —— 测试基础设施。
 *
 * 私有包，不发布。它只提供**注入用的替身**：固定时钟与内存传输。刻意不提供断言
 * 辅助或夹具工厂 —— 那些放进各自包的测试里更清楚。
 */
export { createFixedClock } from './clock.ts'
export type { FixedClock } from './clock.ts'

export { createDuplexPair } from './transport.ts'
export type { DuplexPair, Transport } from './transport.ts'
