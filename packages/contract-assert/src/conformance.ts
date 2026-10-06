/**
 * 契约一致性套件。
 *
 * 这是接入方 CI 的**唯一**对齐手段（设计文档 §12.4）。它必须：
 * - 不依赖任何测试框架 —— 接入方用的是什么框架不该由平台决定；
 * - 同时跑在**至少两个实现**上（本项目内是 `contract` 的参考实现与 `mock-endpoint`
 *   的独立实现），否则断言只会证明"参考实现等于它自己"；
 * - **一条断言崩掉不能带走其余断言** —— 否则接入方拿到的是一个不透明的崩溃，
 *   而不是一张待修清单。
 *
 * 被测表面的类型来自 `@waygate/contract`，不在这里定义：它描述的是"实现必须提供
 * 什么"，那是契约的陈述。接入方从已经依赖的包就能拿到它，不必为了标注自己的实现
 * 去 import 一个对他们是 devDependency 的测试包。这里用 `import type`，因此本包
 * 在运行时仍然没有任何依赖。
 */
import type { CapabilitySurface } from '@waygate/contract'

/** 一条断言的结果。 */
export type AssertionOutcome = {
  /** 断言名，用于在接入方 CI 里定位。 */
  readonly name: string
  /** 是否通过。 */
  readonly ok: boolean
  /** 未通过时的说明。 */
  readonly detail?: string
}

/** 一条断言的内部结果，名字由登记表提供。 */
type CheckResult = {
  readonly ok: boolean
  readonly detail?: string
}

/** 一条已登记的断言。 */
type Check = {
  readonly name: string
  readonly run: (subject: CapabilitySurface) => CheckResult
}

/**
 * 用来探测原型链的键。
 *
 * 这些名字都能在 `Object.prototype` 上查到。若实现用对象字面量做能力查表，
 * 它们会返回一个继承来的函数，于是"未知能力"被误判为"已知能力"。
 */
export const PROTOTYPE_PROBE_NAMES: readonly string[] = [
  'toString',
  'constructor',
  'hasOwnProperty',
  'valueOf',
  '__proto__',
  'isPrototypeOf',
]

/** 原型链上的键不得被当作能力。 */
function checkPrototypeSafeLookup(subject: CapabilitySurface): CheckResult {
  const leaked = PROTOTYPE_PROBE_NAMES.filter((name) => subject.capabilityOf(name) !== undefined)
  if (leaked.length === 0) return { ok: true }
  return {
    ok: false,
    detail: `以下原型键被误判为能力：${leaked.join('、')}（查表必须防原型）`,
  }
}

/** 未知能力必须被忽略，而不是导致失败。 */
function checkUnknownCapabilityIgnored(subject: CapabilitySurface): CheckResult {
  const probe = 'waygate.assert.definitely-not-a-capability'
  const kept = subject.knownCapabilities([probe])
  if (!kept.includes(probe)) return { ok: true }
  return { ok: false, detail: `未知能力 ${probe} 被当成了已知能力` }
}

/** 接入方声明的能力必须都能被自己的查表认可。 */
function checkDeclaredCapabilitiesResolve(subject: CapabilitySurface): CheckResult {
  const kept = subject.knownCapabilities(subject.declaredCapabilities)
  const missing = subject.declaredCapabilities.filter((capability) => !kept.includes(capability))
  if (missing.length === 0) return { ok: true }
  return { ok: false, detail: `以下已声明的能力未被自身认可：${missing.join('、')}` }
}

/** 能力查表对核心必备指令返回 `undefined`，而不是抛错或乱给。 */
function checkCoreMethodsHaveNoCapability(subject: CapabilitySurface): CheckResult {
  // 这些是核心必备指令，它们不对应任何能力开关。
  const coreMethods = ['conversation.list', 'message.send', 'conversation.interrupt']
  const wrong = coreMethods.filter((method) => subject.capabilityOf(method) !== undefined)
  if (wrong.length === 0) return { ok: true }
  return { ok: false, detail: `以下核心指令不应绑定能力：${wrong.join('、')}` }
}

/** 已登记的断言，顺序稳定。 */
const CHECKS: readonly Check[] = [
  { name: 'prototype-safe-capability-lookup', run: checkPrototypeSafeLookup },
  { name: 'unknown-capability-ignored', run: checkUnknownCapabilityIgnored },
  { name: 'declared-capabilities-resolve', run: checkDeclaredCapabilitiesResolve },
  { name: 'core-methods-have-no-capability', run: checkCoreMethodsHaveNoCapability },
]

/**
 * 跑完全部契约断言。
 *
 * 每条断言单独兜错：实现里的一个意外异常会被记成这条断言失败，而不是中断整轮检查。
 *
 * @param subject - 被测的契约表面。
 * @returns 每条断言的结果，顺序稳定。
 */
export function runContractAssertions(subject: CapabilitySurface): readonly AssertionOutcome[] {
  return CHECKS.map((check) => {
    try {
      const result = check.run(subject)
      return result.detail === undefined
        ? { name: check.name, ok: result.ok }
        : { name: check.name, ok: result.ok, detail: result.detail }
    } catch (error) {
      return { name: check.name, ok: false, detail: `断言执行时抛错：${describeThrown(error)}` }
    }
  })
}

/**
 * 把任意抛出物转成可读说明。
 *
 * `catch` 拿到的不保证是 `Error`。与 `frame`、`crypto` 各自持有一份同样的三行实现是
 * 刻意的：这三个包都能被单独发布与单独使用，为一个三行函数引入共享包会让每个包多一条
 * 依赖边，而 `contract` 还必须保持零运行时依赖。
 *
 * 导出是为了可测：`String(error)` 那个分支在真实调用点触达不到。
 *
 * @param error - `catch` 捕获到的任意值。
 * @returns 可读说明。
 */
export function describeThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 契约一致性失败。 */
export class ContractAssertionError extends Error {
  /** 未通过的断言。 */
  readonly failures: readonly AssertionOutcome[]

  /**
   * @param failures - 未通过的断言。
   */
  constructor(failures: readonly AssertionOutcome[]) {
    const lines = failures.map((failure) => `  - ${failure.name}: ${failure.detail ?? '未通过'}`)
    super(`契约一致性检查未通过（${failures.length} 条）：\n${lines.join('\n')}`)
    this.name = 'ContractAssertionError'
    this.failures = failures
  }
}

/**
 * 跑断言并在有失败时抛错。接入方 CI 直接调用这个即可。
 *
 * @param subject - 被测的契约表面。
 * @throws ContractAssertionError 存在未通过的断言。
 */
export function assertContractConformance(subject: CapabilitySurface): void {
  const failures = runContractAssertions(subject).filter((outcome) => !outcome.ok)
  if (failures.length > 0) throw new ContractAssertionError(failures)
}
