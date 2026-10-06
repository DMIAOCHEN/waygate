import { describe, expect, test } from 'vitest'

import { FrameError } from './error.ts'
import {
  asRecord,
  describeError,
  hasOwn,
  parseJsonObject,
  readOptionalField,
  requireBoolean,
  requireSequence,
  requireString,
} from './shape.ts'

/** 断言某个调用抛出带指定 code 的 FrameError。 */
function expectFrameError(run: () => unknown, code: string): FrameError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(FrameError)
    const frameError = error as FrameError
    expect(frameError.code).toBe(code)
    return frameError
  }
  throw new Error('预期抛出 FrameError，但没有抛')
}

describe('asRecord', () => {
  test('普通对象通过', () => {
    expect(asRecord({ a: 1 })).toStrictEqual({ a: 1 })
  })

  test.each([
    ['null', null],
    ['数组', [1, 2]],
    ['字符串', 'x'],
    ['数字', 1],
    ['布尔', true],
    ['undefined', undefined],
  ])('%s 不通过', (_label, value) => {
    expect(asRecord(value)).toBeUndefined()
  })
})

describe('hasOwn 防原型', () => {
  test('自有字段为真', () => {
    expect(hasOwn({ a: 1 }, 'a')).toBe(true)
  })

  test('继承成员为假 —— 这是不用 `in` 的理由', () => {
    // `'toString' in {}` 为真，`Object.hasOwn({}, 'toString')` 为假。
    // 用 `in` 判断字段存在，会让 {"constructor": ...} 这类输入被误判为"字段已提供"。
    expect(hasOwn({}, 'toString')).toBe(false)
    expect(hasOwn({}, 'constructor')).toBe(false)
    expect(hasOwn({}, '__proto__')).toBe(false)
  })

  test('自有字段遮蔽原型成员时仍为真', () => {
    expect(hasOwn({ toString: 1 }, 'toString')).toBe(true)
  })

  test('JSON 里的 __proto__ 是自有字段', () => {
    expect(hasOwn(parseJsonObject('{"__proto__":1}', 'x'), '__proto__')).toBe(true)
  })
})

describe('describeError', () => {
  test('Error 取 message', () => {
    expect(describeError(new Error('boom'))).toBe('boom')
  })

  test.each([
    ['字符串', 'plain', 'plain'],
    ['数字', 42, '42'],
    ['undefined', undefined, 'undefined'],
    ['对象', { a: 1 }, '[object Object]'],
  ])('非 Error（%s）转成字符串', (_label, value, expected) => {
    // catch 拿到的不保证是 Error，这个分支在真实调用点触达不到。
    expect(describeError(value)).toBe(expected)
  })
})

describe('parseJsonObject', () => {
  test('解析对象', () => {
    expect(parseJsonObject('{"a":1}', 'x')).toStrictEqual({ a: 1 })
  })

  test('非法 JSON 报 not-json，并带上原始原因', () => {
    const error = expectFrameError(() => parseJsonObject('{', 'envelope'), 'not-json')
    expect(error.message).toContain('envelope')
  })

  test('合法 JSON 但不是对象报 not-an-object', () => {
    expectFrameError(() => parseJsonObject('[]', 'x'), 'not-an-object')
    expectFrameError(() => parseJsonObject('null', 'x'), 'not-an-object')
  })
})

describe('readOptionalField 的三态', () => {
  test('键缺失返回 undefined', () => {
    expect(readOptionalField({}, 'k')).toBeUndefined()
  })

  test('字符串返回其值', () => {
    expect(readOptionalField({ k: 'v' }, 'k')).toBe('v')
  })

  test.each([7, null, {}, [], true])('类型不符返回 null（值为 %s）', (value) => {
    expect(readOptionalField({ k: value }, 'k')).toBeNull()
  })
})

describe('requireString', () => {
  test('返回字符串', () => {
    expect(requireString({ k: 'v' }, 'k', 'owner')).toBe('v')
  })

  test('缺失报 missing-field，信息含所属帧与字段名', () => {
    const error = expectFrameError(() => requireString({}, 'k', 'owner'), 'missing-field')
    expect(error.message).toContain('owner.k')
  })

  test('类型不符报 invalid-field', () => {
    expectFrameError(() => requireString({ k: 1 }, 'k', 'owner'), 'invalid-field')
  })
})

describe('requireSequence', () => {
  test('接受 0 与正整数', () => {
    expect(requireSequence({ k: 0 }, 'k', 'o')).toBe(0)
    expect(requireSequence({ k: 42 }, 'k', 'o')).toBe(42)
  })

  test('缺失报 missing-field', () => {
    expectFrameError(() => requireSequence({}, 'k', 'o'), 'missing-field')
  })

  test.each([
    ['负数', -1],
    ['浮点', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['超出安全整数', Number.MAX_SAFE_INTEGER + 2],
    ['字符串', '1'],
    ['null', null],
  ])('%s 报 invalid-field', (_label, value) => {
    expectFrameError(() => requireSequence({ k: value }, 'k', 'o'), 'invalid-field')
  })
})

describe('requireBoolean', () => {
  test('接受真假', () => {
    expect(requireBoolean({ k: true }, 'k', 'o')).toBe(true)
    expect(requireBoolean({ k: false }, 'k', 'o')).toBe(false)
  })

  test('缺失报 missing-field', () => {
    expectFrameError(() => requireBoolean({}, 'k', 'o'), 'missing-field')
  })

  test('类型不符报 invalid-field', () => {
    expectFrameError(() => requireBoolean({ k: 'true' }, 'k', 'o'), 'invalid-field')
  })
})
