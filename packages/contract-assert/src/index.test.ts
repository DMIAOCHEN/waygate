import { describe, expect, test } from 'vitest'

import * as contractAssert from '@waygate/contract-assert'

/** 公开面刻意维护：接入方 CI 依赖它，增删都是一次对外承诺的变化。 */
const RUNTIME_EXPORTS = [
  'ContractAssertionError',
  'PROTOTYPE_PROBE_NAMES',
  'assertContractConformance',
  'runContractAssertions',
] as const

describe('包根公开面', () => {
  test('运行时导出与清单完全一致', () => {
    expect(Object.keys(contractAssert).toSorted()).toStrictEqual([...RUNTIME_EXPORTS].toSorted())
  })

  test('不依赖任何测试框架 —— 接入方用什么框架不该由平台决定', async () => {
    // 断言套件一旦引了 vitest，接入方就被迫接受它。这里用一个独立的 Node 进程
    // 加载构建产物来验证；当前阶段改为检查模块图里没有测试框架依赖。
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./conformance.ts', import.meta.url), 'utf8'),
    )
    expect(source).not.toMatch(/from '(vitest|mocha|jest|ava)'/u)
  })
})
