import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, test } from 'vitest'

import {
  applyMutation,
  countOccurrences,
  report,
  runAll,
  runMutationCheck,
  type Mutation,
  type ReportSink,
  type TestRunner,
} from './mutation-check.ts'
import { MUTATIONS } from './mutations.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

const tempRoots: string[] = []

/** 造一个只含一个源文件的临时仓库。 */
function createTempRepo(content: string): { root: string; file: string } {
  const tempRoot = mkdtempSync(join(tmpdir(), 'waygate-mutation-'))
  tempRoots.push(tempRoot)
  const file = join(tempRoot, 'subject.ts')
  writeFileSync(file, content)
  return { root: tempRoot, file }
}

function recordingSink(): { logs: string[]; errors: string[]; sink: ReportSink } {
  const logs: string[] = []
  const errors: string[] = []
  return {
    logs,
    errors,
    sink: { log: (message) => logs.push(message), error: (message) => errors.push(message) },
  }
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const target = tempRoots.pop()
    if (target !== undefined) rmSync(target, { recursive: true, force: true })
  }
})

describe('countOccurrences', () => {
  test('数出 0、1、2 次', () => {
    expect(countOccurrences('abc', 'z')).toBe(0)
    expect(countOccurrences('abc', 'b')).toBe(1)
    expect(countOccurrences('abab', 'ab')).toBe(2)
  })

  test('空锚点返回 0 —— 否则会无限匹配', () => {
    expect(countOccurrences('abc', '')).toBe(0)
  })

  test('不重复计算重叠部分', () => {
    expect(countOccurrences('aaaa', 'aa')).toBe(2)
  })
})

describe('applyMutation', () => {
  test('命中一次时替换', () => {
    const result = applyMutation('const x = 1', 'const x = 1', 'const x = 2')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.text).toBe('const x = 2')
  })

  test('命中 0 次时判 anchor-missing', () => {
    const result = applyMutation('const x = 1', 'const y = 1', 'z')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe('anchor-missing')
      expect(result.detail).toContain('找不到')
    }
  })

  test('命中多次时判 anchor-ambiguous —— 改的可能不是你以为的那一处', () => {
    const result = applyMutation('a\na\n', 'a', 'b')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe('anchor-ambiguous')
      expect(result.detail).toContain('2 次')
    }
  })
})

describe('runMutationCheck', () => {
  const mutation: Mutation = {
    name: 'probe',
    file: 'subject.ts',
    anchor: 'return 1',
    replacement: 'return 2',
    testFile: 'subject.test.ts',
  }

  test('测试变红时报 killed，并还原文件', () => {
    const { root: tempRoot, file } = createTempRepo('export const f = () => {\n  return 1\n}\n')
    const outcome = runMutationCheck(tempRoot, mutation, () => ({ failed: true, output: '' }))

    expect(outcome.status).toBe('killed')
    expect(readFileSync(file, 'utf8')).toBe('export const f = () => {\n  return 1\n}\n')
  })

  test('测试仍然通过时报 survived —— 这条用例没测到它声称测的东西', () => {
    const { root: tempRoot } = createTempRepo('export const f = () => {\n  return 1\n}\n')
    const outcome = runMutationCheck(tempRoot, mutation, () => ({ failed: false, output: '' }))

    expect(outcome.status).toBe('survived')
    expect(outcome.detail).toContain('没有测到')
  })

  test('跑测试时抛错也要还原文件', () => {
    const { root: tempRoot, file } = createTempRepo('export const f = () => {\n  return 1\n}\n')
    const throwingRunner: TestRunner = () => {
      throw new Error('测试进程起不来')
    }

    const outcome = runMutationCheck(tempRoot, mutation, throwingRunner)
    expect(outcome.status).toBe('runner-failed')
    expect(outcome.detail).toContain('测试进程起不来')
    // 一个把变异体留在源码里的验证工具，比没有这个工具危险得多。
    expect(readFileSync(file, 'utf8')).toBe('export const f = () => {\n  return 1\n}\n')
  })

  test('锚点不合格时根本不写文件', () => {
    const original = 'export const f = () => {\n  return 1\n}\n'
    const { root: tempRoot, file } = createTempRepo(original)
    const outcome = runMutationCheck(tempRoot, { ...mutation, anchor: 'return 999' }, () => ({
      failed: true,
      output: '',
    }))

    expect(outcome.status).toBe('anchor-missing')
    expect(readFileSync(file, 'utf8')).toBe(original)
  })

  test('把测试文件路径传给 runner', () => {
    const { root: tempRoot } = createTempRepo('export const f = () => {\n  return 1\n}\n')
    const seen: string[] = []
    runMutationCheck(tempRoot, mutation, (testFile) => {
      seen.push(testFile)
      return { failed: true, output: '' }
    })
    expect(seen).toStrictEqual(['subject.test.ts'])
  })

  test('变异体真的被写进了文件 —— 否则测试红了也说明不了问题', () => {
    const { root: tempRoot } = createTempRepo('export const f = () => {\n  return 1\n}\n')
    let contentDuringRun = ''
    runMutationCheck(tempRoot, mutation, () => {
      contentDuringRun = readFileSync(join(tempRoot, 'subject.ts'), 'utf8')
      return { failed: true, output: '' }
    })
    expect(contentDuringRun).toContain('return 2')
  })
})

describe('report', () => {
  test('全部 killed 时退出码为 0', () => {
    const { logs, errors, sink } = recordingSink()
    expect(report([{ name: 'a', status: 'killed' }], sink)).toBe(0)
    expect(logs).toHaveLength(2)
    expect(errors).toStrictEqual([])
  })

  test('有非 killed 时退出码为 1，并逐条打印原因', () => {
    const { errors, sink } = recordingSink()
    const code = report(
      [
        { name: 'a', status: 'killed' },
        { name: 'b', status: 'survived', detail: '没测到' },
        { name: 'c', status: 'anchor-missing', detail: '找不到' },
      ],
      sink,
    )
    expect(code).toBe(1)
    expect(errors).toHaveLength(3)
    expect(errors[0]).toContain('没测到')
    expect(errors[1]).toContain('找不到')
    expect(errors[2]).toContain('2/3')
  })
})

describe('runAll', () => {
  test('汇总全部变异体', () => {
    const { root: tempRoot } = createTempRepo('export const f = () => {\n  return 1\n}\n')
    const { sink } = recordingSink()
    const mutations: readonly Mutation[] = [
      { name: 'a', file: 'subject.ts', anchor: 'return 1', replacement: 'return 2', testFile: 't' },
      {
        name: 'b',
        file: 'subject.ts',
        anchor: 'export const',
        replacement: 'export const',
        testFile: 't',
      },
    ]

    expect(runAll(tempRoot, mutations, () => ({ failed: true, output: '' }), sink)).toBe(0)
  })

  test('文件不存在时记成 runner-failed，而不是让整轮崩掉', () => {
    const { root: tempRoot } = createTempRepo('x')
    const { errors, sink } = recordingSink()
    const mutations: readonly Mutation[] = [
      { name: 'missing', file: 'nope.ts', anchor: 'a', replacement: 'b', testFile: 't' },
    ]

    expect(runAll(tempRoot, mutations, () => ({ failed: true, output: '' }), sink)).toBe(1)
    expect(errors[0]).toContain('runner-failed')
  })
})

describe('变异体清单', () => {
  test('至少有一条 —— 空清单会让门禁永远通过', () => {
    expect(MUTATIONS.length).toBeGreaterThan(0)
  })

  test('名字唯一', () => {
    const names = MUTATIONS.map((mutation) => mutation.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test.each(MUTATIONS)('$name 的锚点在文件里恰好命中一次', (mutation) => {
    // 锚点过期（命中 0 次）必须在这里就暴露：否则代码改完之后，变异验证会继续"通过"，
    // 而它验证的东西早已不存在。
    const text = readFileSync(join(root, mutation.file), 'utf8')
    expect(countOccurrences(text, mutation.anchor)).toBe(1)
  })

  test.each(MUTATIONS)('$name 引用的文件都存在', (mutation) => {
    expect(existsSync(join(root, mutation.file))).toBe(true)
    expect(existsSync(join(root, mutation.testFile))).toBe(true)
  })

  test.each(MUTATIONS)('$name 只改契约层的包', (mutation) => {
    // 设计文档 §7.2：变异验证只对契约层强制。
    expect(mutation.file).toMatch(/^packages\/(contract|frame|crypto)\//u)
  })
})
