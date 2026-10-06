/**
 * 契约的固定核心模型。每个接入方把自己的业务概念映射到这套模型上。
 *
 * 文件名的 `.types.ts` 后缀是约定：**只允许包含类型，不允许包含任何运行时值。**
 * 覆盖率门槛据此排除这类文件 —— 它们编译后不产生可执行代码，"被覆盖"对它们
 * 没有意义，留在覆盖率里只会制造一个永远为 0 的假缺口。
 * `scripts/check-boundaries.ts` 强制这个约定。
 *
 * 这些类型描述的是**线格式**，因此有两条硬约束，都由编译器执行：
 * 1. 可选字段的含义是"键缺失"，不是"值为 undefined" —— `exactOptionalPropertyTypes`
 *    让 `{ detail: undefined }` 无法通过类型检查（设计文档 §5.7）。
 * 2. 未知取值绝不导致解析失败：块类型有 `unknown` 兜底，枚举有默认归一。
 *
 * 参见设计文档 §5.2。
 */
import type {
  AppId,
  ArtifactId,
  ConversationId,
  DeviceId,
  InteractionId,
  MessageId,
} from './brand.ts'

/** 一个接入应用实例。 */
export type Endpoint = {
  readonly appId: AppId
  readonly deviceId: DeviceId
  readonly displayName: string
  /** 接入方声明的能力集。取值是外部输入，必须按未知取值处理。 */
  readonly capabilities: readonly string[]
  readonly contractVersion: string
}

/** 一次对话。`active` 为真表示正在执行，决定"能否中断"。 */
export type Conversation = {
  readonly id: ConversationId
  readonly title: string
  readonly updatedAt: number
  readonly active: boolean
}

/** 消息作者。未知取值归一为 `system`，不判为错误。 */
export type MessageRole = 'user' | 'assistant' | 'system'

/** 一条消息。 */
export type Message = {
  readonly id: MessageId
  readonly role: MessageRole
  readonly createdAt: number
  readonly blocks: readonly Block[]
}

/** 需要用户回答的请求种类。 */
export type InteractionKind = 'approval' | 'input' | 'confirm'

/** 交互请求的状态。 */
export type InteractionStatus = 'pending' | 'answered' | 'expired'

/**
 * 需要用户回答的请求：审批、提问、高危确认。
 *
 * 高危确认**不新增协议机制** —— 它就是 `kind: 'confirm'`（设计文档 §5.6）。
 */
export type Interaction = {
  readonly id: InteractionId
  readonly kind: InteractionKind
  readonly title: string
  readonly detail?: string
  /** 接入方期望的回答结构。形状由接入方定义，平台不解析。 */
  readonly responseSchema: unknown
  readonly status: InteractionStatus
  readonly createdAt: number
}

/** 工具调用的状态。 */
export type ToolStatus = 'running' | 'succeeded' | 'failed'

/** 系统提示的严重级别。 */
export type NoticeLevel = 'info' | 'warning' | 'error'

/** 纯文本，支持流式增量。 */
export type TextBlock = {
  readonly type: 'text'
  readonly text: string
}

/** 思考过程，客户端默认折叠。 */
export type ReasoningBlock = {
  readonly type: 'reasoning'
  readonly text: string
}

/** 工具调用。 */
export type ToolBlock = {
  readonly type: 'tool'
  readonly name: string
  readonly status: ToolStatus
  readonly summary: string
  /** 受限的声明式节点子集，形状见设计文档 §5.8。 */
  readonly detail?: unknown
}

/** 文件卡片，不预览。 */
export type FileBlock = {
  readonly type: 'file'
  readonly name: string
  readonly size?: number
  readonly mime?: string
}

/** 图片，经中转拉取缩略图（设计文档 §7.3）。 */
export type ImageBlock = {
  readonly type: 'image'
  readonly artifactId: ArtifactId
  readonly mime?: string
}

/** 错误与系统提示。 */
export type NoticeBlock = {
  readonly type: 'notice'
  readonly level: NoticeLevel
  readonly text: string
}

/**
 * 未知块类型的兜底。**这是强制项，不是可选项。**
 *
 * 没有它，接入方升级契约后老客户端会直接白屏（设计文档 §5.2）。
 */
export type UnknownBlock = {
  readonly type: 'unknown'
  readonly raw: unknown
}

/** 全部已定义的块类型。 */
export type KnownBlock =
  | TextBlock
  | ReasoningBlock
  | ToolBlock
  | FileBlock
  | ImageBlock
  | NoticeBlock

/** 以 `type` 判别的多态内容块。 */
export type Block = KnownBlock | UnknownBlock
