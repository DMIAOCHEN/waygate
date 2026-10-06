import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, test } from 'vitest'

import {
  DOM_GLOBALS,
  SDK_FACADE_MEMBERS,
  checkSdkSurface,
  collectRuntimeExports,
  findBarrelStatements,
  findGlobalReferences,
  findRuntimeValueDeclarations,
  readWorkspacePackages,
  report,
  runChecks,
  runCli,
  toRepoRelativePath,
  transitiveRuntimeDependencies,
  type PackageManifest,
  type ReportSink,
} from './check-boundaries.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

describe('*.types.ts 只包含类型', () => {
  test('纯类型文件没有运行时值声明', () => {
    const source = `
      export type Block = { readonly type: 'text' }
      export interface Endpoint { readonly id: string }
      declare const brand: unique symbol
      export type Branded<T> = T & { readonly [brand]: true }
    `
    expect(findRuntimeValueDeclarations('model.types.ts', source)).toStrictEqual([])
  })

  test.each([
    ['export const', 'export const X = 1'],
    ['export function', 'export function f(): void {}'],
    ['export class', 'export class C {}'],
    ['export enum', 'export enum E { A }'],
    ['export namespace', 'export namespace N { export const y = 1 }'],
    ['无导出修饰的 const', 'const hidden = 1'],
  ])('抓到 %s', (_label, declaration) => {
    expect(findRuntimeValueDeclarations('model.types.ts', declaration)).toHaveLength(1)
  })

  test('declare 修饰的声明不算运行时值（会被完全擦除）', () => {
    expect(
      findRuntimeValueDeclarations('model.types.ts', 'declare function g(): void'),
    ).toStrictEqual([])
  })

  test('诊断里带的是源码里的名字，不是 SyntaxKind 反查结果', () => {
    // 回归：反查 SyntaxKind 会得到 `FirstStatement`，既不是源码名字也无法定位。
    const found = findRuntimeValueDeclarations('model.types.ts', 'export const leaked = 1')
    expect(found[0]).toContain('leaked')
  })

  test('一条语句声明多个名字时全部报出', () => {
    const found = findRuntimeValueDeclarations('model.types.ts', 'export const a = 1, b = 2')
    expect(found[0]).toContain('a')
    expect(found[0]).toContain('b')
  })
})

describe('诊断路径', () => {
  test('相对仓库根，且一律正斜杠', () => {
    const path = toRepoRelativePath(root, `${root}\\packages\\contract\\src\\index.ts`)
    expect(path).toBe('packages/contract/src/index.ts')
  })

  test('不会吞掉路径首字符', () => {
    // 回归：按 root.length + 1 截断会把 `packages` 打成 `ackages`。
    const path = toRepoRelativePath(root, `${root}/packages/contract/src/index.ts`)
    expect(path.startsWith('packages/')).toBe(true)
  })
})

describe('index.ts 只做 re-export', () => {
  test('导入与导出语句被放行', () => {
    const source = `
      export { a } from './a.ts'
      export type { B } from './b.ts'
      import { c } from './c.ts'
      export default c
    `
    expect(findBarrelStatements('index.ts', source)).toStrictEqual([])
  })

  test('抓到 barrel 里混进的逻辑', () => {
    expect(findBarrelStatements('index.ts', 'export const helper = 1')).toHaveLength(1)
  })

  test('抓到非声明类语句，并给出可读描述', () => {
    // 非声明语句（if／for／表达式语句）走 describeDeclaration 的兜底分支。
    expect(findBarrelStatements('index.ts', 'if (x) { y() }')[0]).toBe('其他语句')
    expect(findBarrelStatements('index.ts', 'y()')[0]).toBe('其他语句')
  })
})

describe('全局引用检测', () => {
  const names = new Set(['document', 'Node', 'TextEncoder'])

  test('抓到真实的全局引用', () => {
    expect(findGlobalReferences('a.ts', 'const el = document.body', names)).toHaveLength(1)
  })

  test('不把属性名当引用', () => {
    expect(findGlobalReferences('a.ts', 'const el = frame.document', names)).toStrictEqual([])
  })

  test('不把类型声明名当引用', () => {
    expect(findGlobalReferences('a.ts', 'type Node = { id: string }', names)).toStrictEqual([])
  })

  test('不把类型位置当引用', () => {
    // `: Node`、`extends Node`、`as Node` 都不是运行时引用。
    expect(findGlobalReferences('a.ts', 'function f(x: Node): void {}', names)).toStrictEqual([])
    expect(findGlobalReferences('a.ts', 'interface A extends Node {}', names)).toStrictEqual([])
    expect(findGlobalReferences('a.ts', 'const x = y as Node', names)).toStrictEqual([])
  })

  test('本地变量遮蔽同名全局时不算引用', () => {
    // 回归：测试里写 `const window = createSeqWindow(8)` 曾被误报成 DOM 全局引用。
    // 一个经常误报的门禁会被整体关掉，比没有门禁更糟。
    const source = 'const window = makeWindow()\nwindow.accept(1)'
    expect(findGlobalReferences('a.ts', source, new Set(['window']))).toStrictEqual([])
  })

  test('函数参数与解构绑定同样算本地名字', () => {
    expect(
      findGlobalReferences('a.ts', 'function f(document: string) { return document }', names),
    ).toStrictEqual([])
    expect(
      findGlobalReferences('a.ts', 'const { document } = source\nuse(document)', names),
    ).toStrictEqual([])
  })

  test('import 进来的名字仍然算引用 —— 运行时并不因此就有它', () => {
    // `import { TextEncoder } from 'node:util'` 不能豁免：微信小程序运行时没有它，
    // 换一个导入来源并不会让它出现。
    const source = "import { TextEncoder } from 'node:util'\nexport const e = new TextEncoder()"
    expect(findGlobalReferences('a.ts', source, names)).toHaveLength(1)
  })

  test('报出所在行号', () => {
    const hits = findGlobalReferences('a.ts', '\n\nconst el = document.body', names)
    expect(hits[0]).toContain('第 3 行')
  })
})

describe('运行时传递依赖闭包', () => {
  const manifest = (
    name: string,
    runtimeDependencies: readonly string[],
    devDependencies: readonly string[] = [],
  ): PackageManifest => ({
    name,
    dir: '',
    version: '0.1.0',
    private: false,
    runtimeDependencies,
    devDependencies,
  })

  const packages = [
    manifest('a', ['b'], ['z']),
    manifest('b', ['c']),
    manifest('c', []),
    manifest('z', []),
  ]

  test('沿 dependencies 展开到闭包', () => {
    expect([...transitiveRuntimeDependencies(packages, 'a')].toSorted()).toStrictEqual([
      'a',
      'b',
      'c',
    ])
  })

  test('devDependencies 不进闭包 —— 它不随部署存在', () => {
    expect(transitiveRuntimeDependencies(packages, 'a').has('z')).toBe(false)
  })

  test('循环依赖不会死循环', () => {
    const cyclic = [manifest('x', ['y']), manifest('y', ['x'])]
    expect([...transitiveRuntimeDependencies(cyclic, 'x')].toSorted()).toStrictEqual(['x', 'y'])
  })
})

describe('工作区清单读取', () => {
  test('读到 contract 且其运行时依赖为空（R1）', () => {
    const contract = readWorkspacePackages(root).find((item) => item.name === '@waygate/contract')
    expect(contract).toBeDefined()
    expect(contract?.runtimeDependencies).toStrictEqual([])
  })

  test('包名排序稳定', () => {
    const names = readWorkspacePackages(root).map((item) => item.name)
    expect(names).toStrictEqual([...names].toSorted((left, right) => left.localeCompare(right)))
  })
})

describe('DOM 全局清单', () => {
  test('覆盖了常见的浏览器入口', () => {
    for (const name of ['document', 'window', 'localStorage', 'WebSocket']) {
      expect(DOM_GLOBALS).toContain(name)
    }
  })
})

describe('在本仓库上运行', () => {
  test('当前仓库无违规', () => {
    expect(runChecks(root)).toStrictEqual([])
  })
})

/**
 * 合成工作区测试。
 *
 * 存在的理由：真实仓库当前没有违规，所以 runChecks 里"发现违规"的那些分支在真实
 * 仓库上永远跑不到 —— 而它们恰恰是这个门禁唯一有用的部分。这里为每条规则造一个
 * 最小反例，证明它真的会红。
 */
type FixturePackage = {
  readonly name: string
  readonly version?: string
  readonly private?: boolean
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
  readonly files?: Record<string, string>
  /** 造一个没有 src 目录的包，用于覆盖"该包没有源码"的分支。 */
  readonly skipSourceDir?: boolean
}

const tempRoots: string[] = []

function createWorkspace(packages: readonly FixturePackage[]): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'waygate-gate-'))
  tempRoots.push(workspaceRoot)

  for (const pkg of packages) {
    const dir = join(workspaceRoot, 'packages', pkg.name.replace('@waygate/', ''))
    mkdirSync(dir, { recursive: true })
    if (pkg.skipSourceDir !== true) mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: pkg.name,
        version: pkg.version ?? '0.1.0',
        private: pkg.private ?? false,
        dependencies: pkg.dependencies ?? {},
        devDependencies: pkg.devDependencies ?? {},
      }),
    )
    for (const [relativePath, content] of Object.entries(pkg.files ?? {})) {
      const full = join(dir, relativePath)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
  }

  return workspaceRoot
}

/** 跑门禁，只取规则编号，便于断言"哪条规则红了"。 */
function rulesFor(workspaceRoot: string): readonly string[] {
  return runChecks(workspaceRoot).map((violation) => violation.rule)
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const target = tempRoots.pop()
    if (target !== undefined) rmSync(target, { recursive: true, force: true })
  }
})

describe('合成工作区：每条规则都会被触发', () => {
  test('干净工作区没有违规', () => {
    expect(rulesFor(createWorkspace([{ name: '@waygate/contract' }]))).toStrictEqual([])
  })

  test('递归扫描子目录里的源码', () => {
    const workspaceRoot = createWorkspace([
      {
        name: '@waygate/contract',
        files: { 'src/nested/deep/dom.ts': 'export const el = document.body' },
      },
    ])
    const violation = runChecks(workspaceRoot).find((item) => item.rule === 'R6')
    expect(violation?.target).toBe('packages/contract/src/nested/deep/dom.ts')
  })

  test('没有 src 目录的包被跳过，不算违规', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract' },
      { name: '@waygate/empty', skipSourceDir: true },
    ])
    expect(rulesFor(workspaceRoot)).toStrictEqual([])
  })

  test('package.json 形状不对时门禁自己报错，而不是当成通过', () => {
    const workspaceRoot = createWorkspace([{ name: '@waygate/contract' }])
    writeFileSync(join(workspaceRoot, 'packages', 'contract', 'package.json'), '"not an object"')
    expect(() => runChecks(workspaceRoot)).toThrow(/不是一个 JSON 对象/u)
  })

  test('package.json 缺 name 时门禁自己报错', () => {
    const workspaceRoot = createWorkspace([{ name: '@waygate/contract' }])
    writeFileSync(join(workspaceRoot, 'packages', 'contract', 'package.json'), '{}')
    expect(() => runChecks(workspaceRoot)).toThrow(/缺少 name/u)
  })

  test('R1：contract 有运行时依赖', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract', dependencies: { 'some-lib': '^1.0.0' } },
    ])
    expect(rulesFor(workspaceRoot)).toContain('R1')
  })

  test('R2：relay 直接依赖 crypto', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract' },
      { name: '@waygate/crypto' },
      { name: '@waygate/relay', dependencies: { '@waygate/crypto': 'workspace:*' } },
    ])
    expect(rulesFor(workspaceRoot)).toContain('R2')
  })

  test('R2：relay 经 frame 间接依赖 crypto', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract' },
      { name: '@waygate/crypto' },
      { name: '@waygate/frame', dependencies: { '@waygate/crypto': 'workspace:*' } },
      { name: '@waygate/relay', dependencies: { '@waygate/frame': 'workspace:*' } },
    ])
    expect(rulesFor(workspaceRoot)).toContain('R2')
  })

  test('R2 不看 devDependencies —— 它不随部署存在', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract' },
      { name: '@waygate/crypto' },
      { name: '@waygate/relay', devDependencies: { '@waygate/crypto': 'workspace:*' } },
    ])
    expect(rulesFor(workspaceRoot)).not.toContain('R2')
  })

  test('R3：relay 依赖业务模型', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract' },
      { name: '@waygate/relay', dependencies: { '@waygate/contract': 'workspace:*' } },
    ])
    expect(rulesFor(workspaceRoot)).toContain('R3')
  })

  test('R4：contract 依赖渠道包', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract', dependencies: { '@waygate/channel-web': 'workspace:*' } },
    ])
    expect(rulesFor(workspaceRoot)).toContain('R4')
  })

  test('R5：contract 源码里用了 TextEncoder', () => {
    const workspaceRoot = createWorkspace([
      {
        name: '@waygate/contract',
        files: { 'src/measure.ts': 'export const n = new TextEncoder().encode("x").length' },
      },
    ])
    expect(rulesFor(workspaceRoot)).toContain('R5')
  })

  test('R6：packages/* 里引用了 DOM 全局', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract', files: { 'src/dom.ts': 'export const el = document.body' } },
    ])
    expect(rulesFor(workspaceRoot)).toContain('R6')
  })

  test('TYPES-ONLY：*.types.ts 里放了运行时值', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract', files: { 'src/leak.types.ts': 'export const leaked = 1' } },
    ])
    expect(rulesFor(workspaceRoot)).toContain('TYPES-ONLY')
  })

  test('BARREL-ONLY：index.ts 里放了逻辑', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract', files: { 'src/index.ts': 'export const helper = 1' } },
    ])
    expect(rulesFor(workspaceRoot)).toContain('BARREL-ONLY')
  })

  test('违规里带上可定位的相对路径', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract', files: { 'src/dom.ts': 'export const el = document.body' } },
    ])
    const violation = runChecks(workspaceRoot).find((item) => item.rule === 'R6')
    expect(violation?.target).toBe('packages/contract/src/dom.ts')
  })

  test('SDK-SURFACE：门面漏掉成员包的导出', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract', files: { 'src/index.ts': "export { alpha } from './a.ts'" } },
      { name: '@waygate/crypto', files: { 'src/index.ts': "export { beta } from './b.ts'" } },
      { name: '@waygate/frame', files: { 'src/index.ts': "export { gamma } from './c.ts'" } },
      {
        name: '@waygate/sdk',
        dependencies: {
          '@waygate/contract': 'workspace:*',
          '@waygate/crypto': 'workspace:*',
          '@waygate/frame': 'workspace:*',
        },
        files: {
          'src/index.ts': "export * from '@waygate/contract'\nexport * from '@waygate/frame'",
        },
      },
    ])

    const violation = runChecks(workspaceRoot).find((item) => item.rule === 'SDK-SURFACE')
    expect(violation?.message).toContain('beta')
  })

  test('SDK-SURFACE：门面多出不属于并集的导出', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract', files: { 'src/index.ts': "export { alpha } from './a.ts'" } },
      { name: '@waygate/crypto', files: { 'src/index.ts': "export { beta } from './b.ts'" } },
      { name: '@waygate/frame', files: { 'src/index.ts': "export { gamma } from './c.ts'" } },
      {
        name: '@waygate/sdk',
        files: {
          'src/index.ts':
            "export * from '@waygate/contract'\nexport * from '@waygate/crypto'\nexport * from '@waygate/frame'\nexport { oops } from './oops.ts'",
        },
      },
    ])

    const violation = runChecks(workspaceRoot).find((item) => item.rule === 'SDK-SURFACE')
    expect(violation?.message).toContain('oops')
  })

  test('SDK-SURFACE：门面与并集一致时通过', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract', files: { 'src/index.ts': "export { alpha } from './a.ts'" } },
      { name: '@waygate/crypto', files: { 'src/index.ts': "export { beta } from './b.ts'" } },
      { name: '@waygate/frame', files: { 'src/index.ts': "export { gamma } from './c.ts'" } },
      {
        name: '@waygate/sdk',
        files: {
          'src/index.ts':
            "export * from '@waygate/contract'\nexport * from '@waygate/crypto'\nexport * from '@waygate/frame'",
        },
      },
    ])

    expect(rulesFor(workspaceRoot)).not.toContain('SDK-SURFACE')
  })
})

describe('barrel 运行时导出收集', () => {
  const noResolver = (): undefined => undefined

  test('收集命名导出', () => {
    const names = collectRuntimeExports('index.ts', "export { a, b } from './x.ts'", noResolver)
    expect([...names].toSorted()).toStrictEqual(['a', 'b'])
  })

  test('跳过 export type', () => {
    const names = collectRuntimeExports(
      'index.ts',
      "export type { A } from './x.ts'\nexport { b } from './y.ts'",
      noResolver,
    )
    expect([...names]).toStrictEqual(['b'])
  })

  test('跳过行内 type 修饰符', () => {
    const names = collectRuntimeExports(
      'index.ts',
      "export { type A, b } from './x.ts'",
      noResolver,
    )
    expect([...names]).toStrictEqual(['b'])
  })

  test('export * 递归到目标 barrel', () => {
    const resolver = (specifier: string): readonly [string, string] | undefined =>
      specifier === '@waygate/base'
        ? (['base.ts', "export { x } from './x.ts'"] as const)
        : undefined
    const names = collectRuntimeExports('index.ts', "export * from '@waygate/base'", resolver)
    expect([...names]).toStrictEqual(['x'])
  })

  test('无法解析的 export * 被忽略，而不是抛错', () => {
    const names = collectRuntimeExports('index.ts', "export * from 'external-pkg'", noResolver)
    expect([...names]).toStrictEqual([])
  })

  test('export * as ns 计入命名空间名', () => {
    const names = collectRuntimeExports('index.ts', "export * as ns from './x.ts'", noResolver)
    expect([...names]).toStrictEqual(['ns'])
  })

  test('默认导出被计入', () => {
    const names = collectRuntimeExports('index.ts', 'export default 1', noResolver)
    expect([...names]).toStrictEqual(['default'])
  })

  test('没有导出时为空', () => {
    expect([...collectRuntimeExports('index.ts', '// 空', noResolver)]).toStrictEqual([])
  })
})

describe('门面公开面', () => {
  test('成员清单与设计文档一致', () => {
    expect([...SDK_FACADE_MEMBERS]).toStrictEqual([
      '@waygate/contract',
      '@waygate/crypto',
      '@waygate/frame',
    ])
  })

  test('没有 sdk 包时跳过', () => {
    expect(
      checkSdkSurface([
        {
          name: '@waygate/contract',
          dir: '/x',
          version: '0.1.0',
          private: false,
          runtimeDependencies: [],
          devDependencies: [],
        },
      ]),
    ).toStrictEqual([])
  })
})

describe('报告与退出码', () => {
  function recordingSink(): { logs: string[]; errors: string[]; sink: ReportSink } {
    const logs: string[] = []
    const errors: string[] = []
    return {
      logs,
      errors,
      sink: { log: (message) => logs.push(message), error: (message) => errors.push(message) },
    }
  }

  test('无违规时退出码为 0，且报告通过', () => {
    const { logs, errors, sink } = recordingSink()
    expect(report([], sink)).toBe(0)
    expect(logs).toHaveLength(1)
    expect(errors).toStrictEqual([])
  })

  test('有违规时退出码为 1，且逐条打印', () => {
    const { errors, sink } = recordingSink()
    const violations = [
      { rule: 'R1', target: 'a', message: '第一条' },
      { rule: 'R6', target: 'b', message: '第二条' },
    ]
    expect(report(violations, sink)).toBe(1)
    expect(errors).toHaveLength(3)
    expect(errors[0]).toContain('第一条')
    expect(errors[2]).toContain('2 条违规')
  })

  test('门禁自身出错算失败，不能算通过', () => {
    // 一个因为读不到目录而"通过"的检查，比没有检查更危险。
    const { errors, sink } = recordingSink()
    expect(runCli(join(root, '不存在的目录'), sink)).toBe(1)
    expect(errors[0]).toContain('无法完成')
  })

  test('真实仓库经 runCli 通过', () => {
    const { sink } = recordingSink()
    expect(runCli(root, sink)).toBe(0)
  })
})
