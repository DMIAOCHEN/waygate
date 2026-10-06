import { describe, expect, test } from 'vitest'

import {
  CAPABILITIES,
  METHOD_CAPABILITY,
  capabilityOf,
  isKnownCapability,
  knownCapabilities,
} from './capability.ts'

describe('能力查表', () => {
  test('已绑定的方法返回对应能力', () => {
    expect(capabilityOf('file.pick')).toBe('file.pick')
    expect(capabilityOf('conversation.create')).toBe('conversation.create')
  })

  test('未绑定的方法是 undefined，而不是抛错', () => {
    expect(capabilityOf('conversation.list')).toBeUndefined()
    expect(capabilityOf('')).toBeUndefined()
  })
})

describe('防原型：外部输入不得命中 Object.prototype', () => {
  // 这是本文件里最重要的一组用例。能力 id 来自外部输入，若查表用的是对象字面量，
  // 下面每一个键都会返回一个继承来的函数，于是"未知能力"被误判为"已知能力"。
  const inherited = ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__'] as const

  test.each(inherited)('capabilityOf(%s) 不命中继承成员', (key) => {
    expect(capabilityOf(key)).toBeUndefined()
  })

  test.each(inherited)('isKnownCapability(%s) 为假', (key) => {
    expect(isKnownCapability(key)).toBe(false)
  })

  test.each(inherited)('knownCapabilities 丢弃 %s 且不抛错', (key) => {
    expect(knownCapabilities([key])).toStrictEqual([])
  })
})

describe('已知能力判定', () => {
  test('契约声明的能力都被认作已知', () => {
    for (const capability of CAPABILITIES) {
      expect(isKnownCapability(capability)).toBe(true)
    }
  })

  test('大小写不同即视为未知，不做归一', () => {
    expect(isKnownCapability('File.Pick')).toBe(false)
  })
})

describe('裁剪声明的能力集', () => {
  test('保留已知、丢弃未知，且保持顺序', () => {
    expect(knownCapabilities(['artifact.fetch', 'made.up', 'file.pick'])).toStrictEqual([
      'artifact.fetch',
      'file.pick',
    ])
  })

  test('空声明返回空', () => {
    expect(knownCapabilities([])).toStrictEqual([])
  })
})

describe('绑定表是单一事实来源', () => {
  test('每个能力都恰有一个方法绑定', () => {
    expect([...METHOD_CAPABILITY.values()].toSorted()).toStrictEqual([...CAPABILITIES].toSorted())
  })

  test('能力清单没有重复项', () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length)
  })
})
