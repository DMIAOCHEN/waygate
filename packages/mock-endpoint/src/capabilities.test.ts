import { describe, expect, test } from 'vitest'

import { createMockCapabilitySurface } from './capabilities.ts'

describe('mock 接入方的能力表面', () => {
  test('声明的是它实际实现的那部分', () => {
    expect(createMockCapabilitySurface().declaredCapabilities).toStrictEqual([
      'conversation.create',
      'file.pick',
    ])
  })

  test('认识契约里的可选指令', () => {
    const surface = createMockCapabilitySurface()
    expect(surface.capabilityOf('artifact.fetch')).toBe('artifact.fetch')
  })

  test('核心指令不绑定能力', () => {
    expect(createMockCapabilitySurface().capabilityOf('message.send')).toBeUndefined()
  })

  test('防原型：继承成员不被当成能力', () => {
    const surface = createMockCapabilitySurface()
    for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      expect(surface.capabilityOf(key)).toBeUndefined()
      expect(surface.knownCapabilities([key])).toStrictEqual([])
    }
  })

  test('每次调用返回新的表面对象，互不共享状态', () => {
    expect(createMockCapabilitySurface()).not.toBe(createMockCapabilitySurface())
  })
})
