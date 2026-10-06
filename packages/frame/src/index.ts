/**
 * `@waygate/frame` —— 线格式层。
 *
 * 这一层是中转**唯一**需要理解的东西：加密信封（不可读）与明文控制帧（只有路由
 * 与状态）。它刻意不依赖 `@waygate/contract`，好让 R2／R3 在结构上成立 ——
 * 中转能 import 的东西里，本来就不存在业务模型。
 */
export { assertNever } from './assert-never.ts'

export { CONTROL_FRAME_KINDS, decodeControlFrame, encodeControlFrame } from './control.ts'
export type {
  ByeFrame,
  ControlFrame,
  ControlFrameKind,
  OfflineFrame,
  PairAckFrame,
  PairFrame,
  PingFrame,
  RegisterFrame,
} from './control.ts'

export { decodeEnvelope, encodeEnvelope } from './envelope.ts'
export type { Envelope } from './envelope.ts'

export { FrameError } from './error.ts'
export type { FrameErrorCode } from './error.ts'

export {
  asRecord,
  hasOwn,
  parseJsonObject,
  readOptionalField,
  requireBoolean,
  requireSequence,
  requireString,
} from './shape.ts'
