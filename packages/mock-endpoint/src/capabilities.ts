/**
 * 最小 mock 接入方的能力开关实现。
 *
 * **刻意手写这张表，不引用 `@waygate/contract` 的实现。** 设计文档 §12.4 要求至少两个
 * 实现跑同一套契约断言；如果第二个实现直接调用参考实现，那套断言就只能证明
 * "参考实现等于它自己"，证明不了契约本身是清晰的。
 *
 * 它只实现契约的一小部分 —— 一个真实的接入方也是从一小部分开始的。
 */
import type { CapabilitySurface } from '@waygate/contract'

/** 这个接入方实际实现的能力。 */
const DECLARED_CAPABILITIES: readonly string[] = ['conversation.create', 'file.pick']

/** 它认识的全部能力（契约已知集合的一个独立副本）。 */
const METHOD_TO_CAPABILITY = new Map<string, string>([
  ['conversation.create', 'conversation.create'],
  ['file.pick', 'file.pick'],
  ['attachment.upload', 'attachment.upload'],
  ['artifact.fetch', 'artifact.fetch'],
])

const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set(METHOD_TO_CAPABILITY.values())

/**
 * 造一个最小 mock 接入方的能力表面。
 *
 * @returns 实现契约能力开关的独立实现。
 */
export function createMockCapabilitySurface(): CapabilitySurface {
  return {
    declaredCapabilities: DECLARED_CAPABILITIES,
    capabilityOf: (method) => METHOD_TO_CAPABILITY.get(method),
    // 用 Set 而不是对象字面量：能力 id 来自外部输入，字面量查表会让
    // `toString` 这类键命中 Object.prototype。
    knownCapabilities: (declared) => declared.filter((id) => KNOWN_CAPABILITIES.has(id)),
  }
}
