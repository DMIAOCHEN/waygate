/**
 * 能力开关：方法到能力的绑定，以及防原型的查表。
 *
 * 两条硬约束（设计文档 §5.5）：
 * 1. **方法到能力的绑定只有一处** —— 就是下面这张表，是单一事实来源。
 * 2. **查表一律防原型** —— 能力 id 来自外部输入。若用对象字面量查表，
 *    `toString`、`constructor`、`hasOwnProperty` 这类键会命中 `Object.prototype`
 *    并返回一个函数，于是"未知能力"被误判为"已知能力"。因此这里只用
 *    `Map` 与 `Set`，它们的查找不经过原型链。
 */

/** 契约定义的全部能力。 */
export const CAPABILITIES = [
  'conversation.create',
  'file.pick',
  'attachment.upload',
  'artifact.fetch',
] as const

/** 一个契约能力标识。 */
export type Capability = (typeof CAPABILITIES)[number]

/**
 * 方法名到能力的绑定。可选指令只有在对应能力被声明时才可用。
 *
 * 这是唯一一处绑定；`KNOWN_CAPABILITIES` 由它派生，避免两份清单漂移。
 */
export const METHOD_CAPABILITY: ReadonlyMap<string, Capability> = new Map<string, Capability>([
  ['conversation.create', 'conversation.create'],
  ['file.pick', 'file.pick'],
  ['attachment.upload', 'attachment.upload'],
  ['artifact.fetch', 'artifact.fetch'],
])

const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set<string>(METHOD_CAPABILITY.values())

/**
 * 判断一个外部输入的能力 id 是否是契约已知的能力。
 *
 * @param id - 来自外部输入的任意字符串。
 * @returns 是已知能力时为真，并把类型收窄为 `Capability`。
 */
export function isKnownCapability(id: string): id is Capability {
  return KNOWN_CAPABILITIES.has(id)
}

/**
 * 查一个方法所需的能力。
 *
 * @param method - 指令方法名，来自外部输入。
 * @returns 需要的能力；该方法不是可选指令时为 `undefined`。
 */
export function capabilityOf(method: string): Capability | undefined {
  return METHOD_CAPABILITY.get(method)
}

/**
 * 把接入方声明的能力集裁剪为契约已知的能力。
 *
 * 客户端**不得**因为遇到未知能力而失败，只忽略 —— 这是版本演进能单向兼容的前提。
 * 接入方升级并声明了更新的能力时，老客户端靠这个函数安静地降级。
 *
 * @param declared - 接入方声明的能力 id 列表，取值不可信。
 * @returns 其中被契约认可的部分，顺序保持不变。
 */
export function knownCapabilities(declared: readonly string[]): readonly Capability[] {
  return declared.filter(isKnownCapability)
}
