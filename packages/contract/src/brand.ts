/**
 * 跨边界的不透明标识符一律使用 branded type，不用裸 `string`。
 *
 * 理由：`deviceId`、`conversationId`、`artifactId` 在协议里都是"不透明字符串"，
 * 但类型系统若把它们都当成 `string`，把 conversationId 传进需要 deviceId 的位置
 * 不会有任何报错 —— 而这类错误在运行时表现为"路由到错误的设备"，极难排查。
 */
declare const brand: unique symbol

/** 给底层类型打上不可伪造的名义标签。 */
export type Branded<T, B extends string> = T & { readonly [brand]: B }

/** 接入应用的稳定标识，由平台签发注册凭据时确定。 */
export type AppId = Branded<string, 'AppId'>

/** 一台物理机上的一次接入方实例。同一 `deviceId` 同时只允许一个活跃注册。 */
export type DeviceId = Branded<string, 'DeviceId'>

/** 接入方会话模型里的一次对话。 */
export type ConversationId = Branded<string, 'ConversationId'>

/** 一条消息。 */
export type MessageId = Branded<string, 'MessageId'>

/** 一次需要用户回答的请求：审批、提问或高危确认。 */
export type InteractionId = Branded<string, 'InteractionId'>

/** 一个二进制产物，经中转拉取。 */
export type ArtifactId = Branded<string, 'ArtifactId'>

/** 把一个普通字符串断言成指定品牌的标识符。仅在解析外部输入后使用。 */
export function brandId<B extends string>(value: string): Branded<string, B> {
  return value as Branded<string, B>
}
