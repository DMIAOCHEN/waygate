/**
 * 可注入时钟。
 *
 * 中继与渠道的测试**不得读真实时钟**：一旦读真实时间，涉及有效期、重连退避、心跳
 * 超时的用例就会变成慢测或偶发失败。时钟必须由外部注入（设计文档 §12.2）。
 *
 * `Clock` 是一个结构化类型，刻意定义在使用方（`@waygate/crypto` 等）而不是这里 ——
 * 这样发布包不必依赖这个私有测试包，只需要一个形状相同的对象。
 */

/** 一个固定起点、可手动推进的时钟。 */
export type FixedClock = {
  /** 当前时刻，毫秒。 */
  now(): number
  /** 把时钟向前推进指定毫秒数。 */
  advance(ms: number): void
}

/**
 * 造一个从指定时刻开始、只能手动推进的时钟。
 *
 * @param startMs - 起始时刻，毫秒。
 * @returns 固定时钟。
 */
export function createFixedClock(startMs: number): FixedClock {
  let current = startMs
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}
