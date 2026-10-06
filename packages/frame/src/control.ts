/**
 * 明文控制帧。
 *
 * 中转必须理解这一组帧，否则无法完成配对与转发。代价是它对**这一层**是明文的，
 * 因此有一条硬约束：
 *
 * > **控制帧只含路由与状态信息，不得包含业务内容。**
 *
 * 这条约束由类型执行 —— 下面每个成员只有标识、状态与时间字段，没有任何可以塞进
 * 消息正文、会话标题或工作区路径的位置。
 *
 * 参见设计文档 §6.3。
 */
import { assertNever } from './assert-never.ts'
import { FrameError } from './error.ts'
import {
  parseJsonObject,
  readOptionalField,
  requireBoolean,
  requireSequence,
  requireString,
} from './shape.ts'

/** 全部控制帧种类。 */
export const CONTROL_FRAME_KINDS = [
  'register',
  'pair',
  'pair.ack',
  'ping',
  'offline',
  'bye',
] as const

/** 一种控制帧的种类。 */
export type ControlFrameKind = (typeof CONTROL_FRAME_KINDS)[number]

/** 接入方注册自己的长连接。 */
export type RegisterFrame = {
  readonly kind: 'register'
  readonly appId: string
  readonly deviceId: string
  readonly contractVersion: string
}

/** 客户端请求与某个 Endpoint 配对。 */
export type PairFrame = {
  readonly kind: 'pair'
  readonly appId: string
  readonly deviceId: string
  readonly pairToken: string
  readonly clientPublicKey: string
}

/** 接入方对配对请求的回答。 */
export type PairAckFrame = {
  readonly kind: 'pair.ack'
  readonly accepted: boolean
  /** 接受时携带接入方公钥。拒绝时**省略这个键**，不写 `undefined`。 */
  readonly agentPublicKey?: string
}

/** 保活。 */
export type PingFrame = {
  readonly kind: 'ping'
  readonly at: number
}

/** 接入方离线，通知已配对的对端。 */
export type OfflineFrame = {
  readonly kind: 'offline'
  readonly deviceId: string
}

/** 主动断开。 */
export type ByeFrame = {
  readonly kind: 'bye'
  readonly reason?: string
}

/** 中转与两端之间的控制帧。 */
export type ControlFrame =
  | RegisterFrame
  | PairFrame
  | PairAckFrame
  | PingFrame
  | OfflineFrame
  | ByeFrame

/**
 * 把控制帧序列化成线格式。
 *
 * 用 `switch` 做穷尽性检查：新增一种控制帧时这里会编译失败，而不是静默漏掉。
 * 序列化本身交给 `JSON.stringify` —— `exactOptionalPropertyTypes` 已经保证可选
 * 字段要么有值要么键不存在，而 `JSON.stringify` 恰好省略值为 `undefined` 的键，
 * 两者正好对应设计文档 §5.7 的"字段缺失要省略键"。
 *
 * @param frame - 待序列化的控制帧。
 * @returns JSON 文本。
 */
export function encodeControlFrame(frame: ControlFrame): string {
  assertKnownKind(frame)
  return JSON.stringify(frame)
}

/**
 * 穷尽性检查：漏掉任何一个控制帧种类都会在这里编译失败。
 *
 * 导出是为了可测 —— 它的 `default` 分支在类型系统看来不可达，只能靠强制转换触达，
 * 而那正是它存在的意义：类型系统认为不可达、运行时却真的到了，此时必须拒绝，
 * 而不是把一个未知种类的帧原样发出去。
 *
 * @param frame - 待检查的控制帧。
 * @throws 未知种类时抛出。
 */
export function assertKnownKind(frame: ControlFrame): void {
  switch (frame.kind) {
    case 'register':
    case 'pair':
    case 'pair.ack':
    case 'ping':
    case 'offline':
    case 'bye':
      return
    default:
      assertNever(frame)
  }
}

/**
 * 解析一个控制帧。
 *
 * 未知种类**明确报错**，不静默忽略 —— 静默忽略会让发送方以为指令生效了。
 * 这与内容块的未知类型处理刻意不同：块类型有 `unknown` 兜底，因为块类型会随契约
 * 演进而增加；控制帧种类是中转自己的指令集，增加它意味着两端都要升级。
 *
 * @param text - JSON 文本。
 * @returns 解析出的控制帧。
 * @throws FrameError 文本不合法、字段缺失／类型不符，或种类未知。
 */
export function decodeControlFrame(text: string): ControlFrame {
  const record = parseJsonObject(text, 'control frame')
  const kind = requireString(record, 'kind', 'control frame')

  switch (kind) {
    case 'register':
      return {
        kind,
        appId: requireString(record, 'appId', 'register'),
        deviceId: requireString(record, 'deviceId', 'register'),
        contractVersion: requireString(record, 'contractVersion', 'register'),
      }
    case 'pair':
      return {
        kind,
        appId: requireString(record, 'appId', 'pair'),
        deviceId: requireString(record, 'deviceId', 'pair'),
        pairToken: requireString(record, 'pairToken', 'pair'),
        clientPublicKey: requireString(record, 'clientPublicKey', 'pair'),
      }
    case 'pair.ack': {
      const accepted = requireBoolean(record, 'accepted', 'pair.ack')
      const agentPublicKey = readOptionalField(record, 'agentPublicKey')
      if (agentPublicKey === null) {
        throw new FrameError('invalid-field', 'pair.ack.agentPublicKey 必须是字符串')
      }
      // 键缺失时构造不带该键的对象，而不是把 undefined 写进去。
      return agentPublicKey === undefined ? { kind, accepted } : { kind, accepted, agentPublicKey }
    }
    case 'ping':
      return { kind, at: requireSequence(record, 'at', 'ping') }
    case 'offline':
      return { kind, deviceId: requireString(record, 'deviceId', 'offline') }
    case 'bye': {
      const reason = readOptionalField(record, 'reason')
      if (reason === null) throw new FrameError('invalid-field', 'bye.reason 必须是字符串')
      return reason === undefined ? { kind } : { kind, reason }
    }
    default:
      throw new FrameError(
        'unknown-control-frame',
        `未知控制帧 kind=${kind}；已知取值：${CONTROL_FRAME_KINDS.join('、')}`,
      )
  }
}
