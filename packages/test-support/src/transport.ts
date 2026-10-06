/**
 * 内存传输。
 *
 * 中继的转发、背压丢弃与断线通知都要能在不碰真实 WebSocket 的前提下测（设计文档
 * §12.2 要求"传输必须可注入"）。这里给出一个成对的双工通道：一端 `send`，对端的
 * 处理器收到；任一端 `close` 之后两端都视为已关闭。
 */

/** 一端连接。 */
export type Transport = {
  /** 发送一帧。已关闭时丢弃并返回 `false`。 */
  send(text: string): boolean
  /**
   * 注册消息处理器。
   *
   * @param handler - 收到帧时调用。
   * @returns 取消注册的函数。
   */
  onMessage(handler: (text: string) => void): () => void
  /** 关闭连接。任一端关闭即两端关闭。 */
  close(): void
  /** 连接是否已关闭。 */
  readonly closed: boolean
}

/** 一对已互连的连接。 */
export type DuplexPair = {
  readonly a: Transport
  readonly b: Transport
}

/**
 * 造一对互连的内存连接。
 *
 * `a.send(x)` 会让 `b` 的处理器收到 `x`，反之亦然。任一端的 `close()` 会同时关闭
 * 两端 —— 真实连接里一端断开，对端也会收到断开通知。
 *
 * @returns 成对的连接。
 */
export function createDuplexPair(): DuplexPair {
  // 单一关闭状态：这一对连接是同一条链路的两个方向，不存在"半开"。
  let closed = false
  const handlersForA = new Set<(text: string) => void>()
  const handlersForB = new Set<(text: string) => void>()

  const makeEndpoint = (
    ownHandlers: Set<(text: string) => void>,
    peerHandlers: Set<(text: string) => void>,
  ): Transport => ({
    send: (text) => {
      if (closed) return false
      for (const handler of peerHandlers) handler(text)
      return true
    },
    onMessage: (handler) => {
      ownHandlers.add(handler)
      return () => ownHandlers.delete(handler)
    },
    close: () => {
      closed = true
    },
    // getter 必须是活的：写成普通属性会在构造时把当时的状态固定下来。
    get closed() {
      return closed
    },
  })

  return {
    a: makeEndpoint(handlersForA, handlersForB),
    b: makeEndpoint(handlersForB, handlersForA),
  }
}
