/**
 * `@waygate/contract` —— Waygate 接入契约。
 *
 * 本包**零运行时依赖**：它必须能在浏览器、Node 与微信小程序三种运行时里加载
 * （设计文档 R1）。因此它不做 IO、不读时钟、不引密码学。
 */
export { brandId } from './brand.ts'
export type {
  AppId,
  ArtifactId,
  Branded,
  ConversationId,
  DeviceId,
  InteractionId,
  MessageId,
} from './brand.ts'

export {
  CAPABILITIES,
  METHOD_CAPABILITY,
  capabilityOf,
  isKnownCapability,
  knownCapabilities,
} from './capability.ts'
export type { Capability } from './capability.ts'

export type { CapabilitySurface } from './capability-surface.types.ts'

export type {
  Block,
  Conversation,
  Endpoint,
  FileBlock,
  ImageBlock,
  Interaction,
  InteractionKind,
  InteractionStatus,
  KnownBlock,
  Message,
  MessageRole,
  NoticeBlock,
  NoticeLevel,
  ReasoningBlock,
  TextBlock,
  ToolBlock,
  ToolStatus,
  UnknownBlock,
} from './model.types.ts'

export { CONTRACT_VERSION } from './version.ts'
