import { describe, expect, test } from 'vitest'

import { brandId } from './brand.ts'

describe('标识符铸造', () => {
  test('不改写底层字符串', () => {
    // 这里刻意只断言"原样返回"：brandId 不做校验，它的用途是在已经校验过
    // 外部输入之后给它打上品牌。校验属于解析边界，不属于这里。
    expect(brandId<'DeviceId'>('device-1')).toBe('device-1')
  })
})
