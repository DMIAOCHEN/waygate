import { describe, expect, test, vi } from 'vitest'

import { createDuplexPair } from './transport.ts'

describe('内存双工通道', () => {
  test('a 发 b 收', () => {
    const { a, b } = createDuplexPair()
    const received: string[] = []
    b.onMessage((text) => received.push(text))

    expect(a.send('hello')).toBe(true)
    expect(received).toStrictEqual(['hello'])
  })

  test('b 发 a 收', () => {
    const { a, b } = createDuplexPair()
    const received: string[] = []
    a.onMessage((text) => received.push(text))

    b.send('reply')
    expect(received).toStrictEqual(['reply'])
  })

  test('多个处理器都收到', () => {
    const { a, b } = createDuplexPair()
    const first = vi.fn()
    const second = vi.fn()
    b.onMessage(first)
    b.onMessage(second)

    a.send('x')
    expect(first).toHaveBeenCalledWith('x')
    expect(second).toHaveBeenCalledWith('x')
  })

  test('取消注册后不再收到', () => {
    const { a, b } = createDuplexPair()
    const handler = vi.fn()
    const unsubscribe = b.onMessage(handler)

    unsubscribe()
    a.send('x')
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('关闭语义', () => {
  test('任一端关闭后两端都视为已关闭', () => {
    // 回归：`closed` 必须是活 getter。若用普通属性，关闭状态会在构造时被固定下来，
    // 于是"断线通知对端"这类用例永远测不出问题。
    const { a, b } = createDuplexPair()
    expect(a.closed).toBe(false)
    expect(b.closed).toBe(false)

    a.close()
    expect(a.closed).toBe(true)
    expect(b.closed).toBe(true)
  })

  test('关闭后发送被丢弃并返回 false', () => {
    const { a, b } = createDuplexPair()
    const handler = vi.fn()
    b.onMessage(handler)

    a.close()
    expect(a.send('x')).toBe(false)
    expect(b.send('y')).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })
})
