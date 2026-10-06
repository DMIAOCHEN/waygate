/**
 * 防重放滑窗。
 *
 * 每帧带单调递增的 `seq`，接收端用一个滑窗拒绝重复与过旧的帧（设计文档 §9.1）。
 *
 * 为什么必须有窗口而不是只记住"见过的最大 seq"：只比大小会让**乱序到达**的合法帧
 * 被丢弃，而中继在背压下会主动丢帧（§6.5），乱序是正常路径而非异常。
 */
import { CryptoError } from './errors.ts'

/** 接收端的防重放滑窗。 */
export type SeqWindow = {
  /**
   * 尝试接受一个序号。
   *
   * @param seq - 收到的序号。
   * @returns 首次接受返回 `true`；重复、过旧或非法返回 `false`。
   */
  accept(seq: number): boolean
  /** 已接受过的最大序号；尚未接受任何帧时为 `-1`。 */
  readonly highest: number
}

/**
 * 造一个防重放滑窗。
 *
 * @param windowSize - 窗口宽度，即允许的最大乱序跨度。必须是不小于 1 的安全整数。
 * @returns 新的滑窗。
 * @throws CryptoError 窗口宽度非法。
 */
export function createSeqWindow(windowSize: number): SeqWindow {
  if (!Number.isSafeInteger(windowSize) || windowSize < 1) {
    throw new CryptoError(
      'invalid-window-size',
      `窗口宽度必须是不小于 1 的安全整数，实际 ${String(windowSize)}`,
    )
  }

  const accepted = new Set<number>()
  let highest = -1

  return {
    accept: (seq) => {
      if (!Number.isSafeInteger(seq) || seq < 0) return false
      if (accepted.has(seq)) return false
      // 落在窗口下沿之外的帧一律拒绝：它可能是一个被重放的旧帧。
      if (highest >= 0 && seq <= highest - windowSize) return false

      accepted.add(seq)
      if (seq > highest) highest = seq

      const floor = highest - windowSize
      for (const value of accepted) {
        if (value <= floor) accepted.delete(value)
      }
      return true
    },
    // getter 必须是活的：写成普通属性会把构造时的状态固定下来。
    get highest() {
      return highest
    },
  }
}
