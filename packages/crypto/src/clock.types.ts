/**
 * 时钟的形状。
 *
 * 定义在使用方而不是测试包里：这样发布包不必依赖私有的测试包，只需要一个形状
 * 相同的对象。测试用 `@waygate/test-support` 的 `createFixedClock` 实现它。
 */

/** 可注入时钟。 */
export type Clock = {
  /** 当前时刻，毫秒。 */
  now(): number
}
