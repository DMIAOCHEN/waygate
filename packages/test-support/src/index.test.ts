import { describe, expect, test } from 'vitest'

import * as testSupport from '@waygate/test-support'

/** 公开面刻意维护，避免测试基础设施悄悄长出一堆只有个别用例用的辅助函数。 */
const RUNTIME_EXPORTS = ['createDuplexPair', 'createFixedClock'] as const

describe('包根公开面', () => {
  test('运行时导出与清单完全一致', () => {
    expect(Object.keys(testSupport).toSorted()).toStrictEqual([...RUNTIME_EXPORTS].toSorted())
  })
})
