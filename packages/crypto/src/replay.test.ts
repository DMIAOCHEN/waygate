import { describe, expect, test } from 'vitest'

import { CryptoError } from './errors.ts'
import { createSeqWindow } from './replay.ts'

describe('滑窗接受序号', () => {
  test('起始状态没有接受过任何帧', () => {
    expect(createSeqWindow(8).highest).toBe(-1)
  })

  test('递增序号全部接受', () => {
    const window = createSeqWindow(8)
    for (const seq of [0, 1, 2, 3]) {
      expect(window.accept(seq)).toBe(true)
    }
    expect(window.highest).toBe(3)
  })

  test('重复序号被拒绝', () => {
    const window = createSeqWindow(8)
    expect(window.accept(5)).toBe(true)
    expect(window.accept(5)).toBe(false)
    expect(window.accept(5)).toBe(false)
  })

  test('窗口内的乱序帧被接受', () => {
    // 中继在背压下会主动丢帧，所以乱序是正常路径而不是异常。
    const window = createSeqWindow(4)
    expect(window.accept(10)).toBe(true)
    expect(window.accept(8)).toBe(true)
    expect(window.accept(9)).toBe(true)
    expect(window.accept(7)).toBe(true)
    expect(window.highest).toBe(10)
  })

  test('落在窗口下沿之外的旧帧被拒绝', () => {
    const window = createSeqWindow(3)
    expect(window.accept(10)).toBe(true)
    // 窗口覆盖 (10-3, 10] = {8,9,10}，因此 7 及以下一律拒绝。
    expect(window.accept(7)).toBe(false)
    expect(window.accept(6)).toBe(false)
  })

  test('序号被清理后重放仍然被拒绝', () => {
    const window = createSeqWindow(3)
    for (const seq of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) window.accept(seq)
    // 1 早已滑出窗口。它既不在集合里，也被下沿挡住 —— 两条路都必须挡住它。
    expect(window.accept(1)).toBe(false)
  })

  test('窗口下沿是开区间，恰好落在下沿的序号被拒绝', () => {
    const window = createSeqWindow(3)
    window.accept(10)
    expect(window.accept(7)).toBe(false)
    expect(window.accept(8)).toBe(true)
  })
})

describe('非法输入', () => {
  test.each([
    ['负数', -1],
    ['浮点', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['超出安全整数', Number.MAX_SAFE_INTEGER + 2],
  ])('序号为%s时拒绝，而不是抛错', (_label, seq) => {
    const window = createSeqWindow(8)
    expect(window.accept(seq)).toBe(false)
    expect(window.highest).toBe(-1)
  })

  test.each([
    ['零', 0],
    ['负数', -1],
    ['浮点', 1.5],
    ['NaN', Number.NaN],
  ])('窗口宽度为%s时报错', (_label, windowSize) => {
    try {
      createSeqWindow(windowSize)
      throw new Error('预期抛出 CryptoError，但没有抛')
    } catch (error) {
      expect(error).toBeInstanceOf(CryptoError)
      expect((error as CryptoError).code).toBe('invalid-window-size')
    }
  })

  test('窗口宽度为 1 时只接受严格递增的序号', () => {
    const window = createSeqWindow(1)
    expect(window.accept(1)).toBe(true)
    expect(window.accept(1)).toBe(false)
    expect(window.accept(2)).toBe(true)
    expect(window.accept(1)).toBe(false)
  })
})

describe('highest 是活值', () => {
  test('随接受而更新', () => {
    // 回归：写成普通属性会把构造时的状态固定下来，窗口就永远停在 -1。
    const window = createSeqWindow(8)
    expect(window.highest).toBe(-1)
    window.accept(4)
    expect(window.highest).toBe(4)
    window.accept(9)
    expect(window.highest).toBe(9)
  })

  test('拒绝旧帧不会让 highest 回退', () => {
    const window = createSeqWindow(8)
    window.accept(10)
    window.accept(3)
    expect(window.highest).toBe(10)
  })
})
