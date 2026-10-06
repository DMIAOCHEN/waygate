import { describe, expect, test } from 'vitest'

import * as contract from '@waygate/contract'

/**
 * 公开面必须是**刻意维护**的，不是"编译出来什么就是什么"。
 *
 * 这份清单同时是契约的对外承诺：删掉一个导出、改一个名字，都必须是一次
 * 有意识的决定，而不是顺手重构的副作用。因此新增导出也要更新这里。
 */
const RUNTIME_EXPORTS = [
  'CAPABILITIES',
  'CONTRACT_VERSION',
  'METHOD_CAPABILITY',
  'brandId',
  'capabilityOf',
  'isKnownCapability',
  'knownCapabilities',
] as const

describe('包根公开面', () => {
  test('运行时导出与清单完全一致', () => {
    expect(Object.keys(contract).toSorted()).toStrictEqual([...RUNTIME_EXPORTS].toSorted())
  })

  test('包根可加载，且契约版本已经就位', () => {
    // 这条用例的价值在于"真的 import 一次包根"：barrel 写错（路径、名字、
    // 值/类型导出混淆）在只跑相对导入的测试里是发现不了的。
    expect(contract.CONTRACT_VERSION).toBeTypeOf('string')
  })
})
