import { describe, expect, test } from 'vitest'

import { CONTRACT_VERSION } from './version.ts'

describe('契约版本', () => {
  test('是可用于比较的语义化版本', () => {
    // 版本协商要求这个值可比较，因此它必须是 semver，而不是任意标记。
    expect(CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
  })
})
