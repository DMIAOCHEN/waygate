import { describe, expect, test } from 'vitest'

import { assertNever } from './assert-never.ts'

describe('assertNever', () => {
  test('抛出并带上被漏掉的值', () => {
    // 这个函数只在"类型系统认为不可达、运行时却真的到了"时执行，所以只能靠
    // 强制转换来触达。它的价值正是这种情况下不静默通过。
    expect(() => assertNever('意外取值' as never)).toThrow(/意外取值/u)
  })
})
