import { capabilityOf, knownCapabilities, type CapabilitySurface } from '@waygate/contract'
import { createMockCapabilitySurface } from '@waygate/mock-endpoint'
import { describe, expect, test } from 'vitest'

import {
  ContractAssertionError,
  PROTOTYPE_PROBE_NAMES,
  assertContractConformance,
  describeThrown,
  runContractAssertions,
} from './conformance.ts'

/** `@waygate/contract` 的参考实现，包装成被测表面。 */
function referenceSurface(declaredCapabilities: readonly string[]): CapabilitySurface {
  return {
    declaredCapabilities,
    capabilityOf: (method) => capabilityOf(method),
    knownCapabilities: (declared) => knownCapabilities(declared),
  }
}

const ALL_CAPABILITIES = [
  'conversation.create',
  'file.pick',
  'attachment.upload',
  'artifact.fetch',
] as const

describe('两个实现跑同一套断言', () => {
  // 设计文档 §12.4：契约断言必须至少跑在两个实现上，否则只能证明参考实现等于它自己。
  test.each([
    ['contract 参考实现', (): CapabilitySurface => referenceSurface(ALL_CAPABILITIES)],
    ['mock-endpoint 独立实现', (): CapabilitySurface => createMockCapabilitySurface()],
  ])('%s 全部通过', (_label, build) => {
    const outcomes = runContractAssertions(build())
    expect(outcomes.filter((outcome) => !outcome.ok)).toStrictEqual([])
  })

  test('两个实现都通过时，断言不是空转 —— 断言数量大于零', () => {
    expect(runContractAssertions(referenceSurface(ALL_CAPABILITIES)).length).toBeGreaterThan(0)
  })
})

describe('断言真的能发现违约', () => {
  test('查表不防原型时被抓到', () => {
    // 用对象字面量查表：`toString` 会命中 Object.prototype 并返回一个函数。
    const unsafe: CapabilitySurface = {
      declaredCapabilities: [],
      capabilityOf: (method) => (({}) as Record<string, string>)[method],
      knownCapabilities: (declared) => declared,
    }
    const failed = runContractAssertions(unsafe).filter((outcome) => !outcome.ok)
    expect(failed.map((outcome) => outcome.name)).toContain('prototype-safe-capability-lookup')
    expect(failed[0]?.detail).toContain('toString')
  })

  test('未知能力被当成已知时被抓到', () => {
    const permissive: CapabilitySurface = {
      declaredCapabilities: [],
      capabilityOf: () => undefined,
      knownCapabilities: (declared) => declared,
    }
    const failed = runContractAssertions(permissive).filter((outcome) => !outcome.ok)
    expect(failed.map((outcome) => outcome.name)).toContain('unknown-capability-ignored')
  })

  test('遇到未知能力就抛错时被抓到，且不带走其余断言', () => {
    const brittle: CapabilitySurface = {
      declaredCapabilities: [],
      capabilityOf: () => undefined,
      knownCapabilities: () => {
        throw new Error('不认识这个能力')
      },
    }

    const outcomes = runContractAssertions(brittle)
    const healthyCount = runContractAssertions(referenceSurface(ALL_CAPABILITIES)).length
    // 一条断言崩掉不能带走其余断言 —— 否则接入方拿到的是一个不透明的崩溃，
    // 而不是一张待修清单。
    expect(outcomes).toHaveLength(healthyCount)

    const outcome = outcomes.find((item) => item.name === 'unknown-capability-ignored')
    expect(outcome?.ok).toBe(false)
    expect(outcome?.detail).toContain('不认识这个能力')
  })

  test('声明的能力自己却不认时被抓到', () => {
    const inconsistent: CapabilitySurface = {
      declaredCapabilities: ['file.pick'],
      capabilityOf: () => undefined,
      knownCapabilities: () => [],
    }
    const failed = runContractAssertions(inconsistent).filter((outcome) => !outcome.ok)
    expect(failed.map((outcome) => outcome.name)).toContain('declared-capabilities-resolve')
  })

  test('核心指令被错误地绑上能力时被抓到', () => {
    const wrongBinding: CapabilitySurface = {
      declaredCapabilities: [],
      capabilityOf: (method) => (method === 'message.send' ? 'file.pick' : undefined),
      knownCapabilities: (declared) => declared,
    }
    const failed = runContractAssertions(wrongBinding).filter((outcome) => !outcome.ok)
    expect(failed.map((outcome) => outcome.name)).toContain('core-methods-have-no-capability')
  })
})

describe('assertContractConformance', () => {
  test('合规时静默返回', () => {
    expect(() => assertContractConformance(referenceSurface(ALL_CAPABILITIES))).not.toThrow()
  })

  test('不合规时抛错，并列出每条失败', () => {
    const broken: CapabilitySurface = {
      declaredCapabilities: [],
      capabilityOf: (method) => (({}) as Record<string, string>)[method],
      knownCapabilities: (declared) => declared,
    }

    try {
      assertContractConformance(broken)
      throw new Error('预期抛出 ContractAssertionError，但没有抛')
    } catch (error) {
      expect(error).toBeInstanceOf(ContractAssertionError)
      const assertionError = error as ContractAssertionError
      expect(assertionError.failures.length).toBeGreaterThan(0)
      expect(assertionError.message).toContain('契约一致性检查未通过')
    }
  })

  test('未通过的断言一定带说明 —— 否则接入方无从下手', () => {
    const broken: CapabilitySurface = {
      declaredCapabilities: [],
      capabilityOf: () => undefined,
      knownCapabilities: (declared) => declared,
    }
    const failed = runContractAssertions(broken).filter((outcome) => !outcome.ok)
    expect(failed.length).toBeGreaterThan(0)
    for (const outcome of failed) {
      expect(outcome.detail).toBeTypeOf('string')
    }
  })
})

describe('探测键', () => {
  test('覆盖了 Object.prototype 上的常见成员', () => {
    for (const name of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      expect(PROTOTYPE_PROBE_NAMES).toContain(name)
    }
  })
})

describe('describeThrown', () => {
  test('Error 取 message', () => {
    expect(describeThrown(new Error('boom'))).toBe('boom')
  })

  test('非 Error 转成字符串 —— catch 拿到的不保证是 Error', () => {
    expect(describeThrown('plain')).toBe('plain')
    expect(describeThrown(42)).toBe('42')
  })
})
