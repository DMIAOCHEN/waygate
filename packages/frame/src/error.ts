/**
 * 线格式解析错误。
 *
 * 未知取值分两类，处理方式刻意不同（设计文档 §5.7）：
 * - **未知内容块类型 → `unknown` 兜底**，不报错：否则接入方加一个新块类型就成了破坏性变更。
 * - **未知指令或控制帧 → 明确报错**，不静默忽略：静默忽略会让接入方以为指令生效了。
 *
 * 这个类型只承载后一类。
 */

/** 解析失败的分类。调用方据此决定重试、断开还是上报。 */
export type FrameErrorCode =
  | 'not-json'
  | 'not-an-object'
  | 'missing-field'
  | 'invalid-field'
  | 'unknown-control-frame'

/** 线格式不合法。 */
export class FrameError extends Error {
  /** 失败分类。 */
  readonly code: FrameErrorCode

  /**
   * @param code - 失败分类。
   * @param message - 面向排查者的说明，指明是哪个字段、为什么。
   */
  constructor(code: FrameErrorCode, message: string) {
    super(message)
    this.name = 'FrameError'
    this.code = code
  }
}
