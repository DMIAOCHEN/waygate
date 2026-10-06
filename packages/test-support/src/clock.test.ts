import { describe, expect, test } from 'vitest'

import { createFixedClock } from './clock.ts'

describe('固定时钟', () => {
  test('从给定时刻开始', () => {
    expect(createFixedClock(1_000).now()).toBe(1_000)
  })

  test('不会自己走 —— 测试必须能完全掌控时间', () => {
    const clock = createFixedClock(1_000)
    expect(clock.now()).toBe(1_000)
    expect(clock.now()).toBe(1_000)
  })

  test('只能手动推进', () => {
    const clock = createFixedClock(1_000)
    clock.advance(500)
    expect(clock.now()).toBe(1_500)
    clock.advance(0)
    expect(clock.now()).toBe(1_500)
  })

  test('可以回退，用于构造乱序时间戳', () => {
    const clock = createFixedClock(1_000)
    clock.advance(-200)
    expect(clock.now()).toBe(800)
  })
})
