import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, test } from 'vitest'

import {
  CONTRACT_VERSION_CONSTANT,
  checkVersions,
  publishablePackages,
  readExportedStringConstant,
  report,
  runCli,
  type ReportSink,
} from './check-versions.ts'
import type { PackageManifest } from './check-boundaries.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

const tempRoots: string[] = []

type FixturePackage = {
  readonly name: string
  readonly version?: string
  readonly private?: boolean
  readonly files?: Record<string, string>
}

function createWorkspace(packages: readonly FixturePackage[]): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'waygate-version-'))
  tempRoots.push(workspaceRoot)

  for (const pkg of packages) {
    const dir = join(workspaceRoot, 'packages', pkg.name.replace('@waygate/', ''))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: pkg.name,
        ...(pkg.version === undefined ? {} : { version: pkg.version }),
        private: pkg.private ?? false,
      }),
    )
    for (const [relativePath, content] of Object.entries(pkg.files ?? {})) {
      const full = join(dir, relativePath)
      mkdirSync(join(full, '..'), { recursive: true })
      writeFileSync(full, content)
    }
  }

  return workspaceRoot
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

describe('读取导出的字符串常量', () => {
  test('读到值', () => {
    expect(
      readExportedStringConstant(
        'v.ts',
        "export const CONTRACT_VERSION = '1.2.3'",
        'CONTRACT_VERSION',
      ),
    ).toBe('1.2.3')
  })

  test('名字不匹配时返回 undefined', () => {
    expect(
      readExportedStringConstant('v.ts', "export const OTHER = '1.2.3'", 'CONTRACT_VERSION'),
    ).toBeUndefined()
  })

  test('不是字符串字面量时返回 undefined', () => {
    expect(
      readExportedStringConstant('v.ts', 'export const CONTRACT_VERSION = 1', 'CONTRACT_VERSION'),
    ).toBeUndefined()
  })

  test('注释里的同名文本不算 —— 这正是用 AST 而不是正则的理由', () => {
    const source =
      "// export const CONTRACT_VERSION = '9.9.9'\nexport const CONTRACT_VERSION = '1.0.0'"
    expect(readExportedStringConstant('v.ts', source, 'CONTRACT_VERSION')).toBe('1.0.0')
  })

  test('没有该常量时返回 undefined', () => {
    expect(
      readExportedStringConstant('v.ts', 'export const A = 1', 'CONTRACT_VERSION'),
    ).toBeUndefined()
  })
})

describe('发布包筛选', () => {
  test('私有包不算发布包', () => {
    const packages: readonly PackageManifest[] = [
      {
        name: 'a',
        dir: '',
        version: '1.0.0',
        private: false,
        runtimeDependencies: [],
        devDependencies: [],
        peerDependencies: [],
      },
      {
        name: 'b',
        dir: '',
        version: '0.0.0',
        private: true,
        runtimeDependencies: [],
        devDependencies: [],
        peerDependencies: [],
      },
    ]
    expect(publishablePackages(packages).map((item) => item.name)).toStrictEqual(['a'])
  })
})

describe('版本一致性', () => {
  const contractFiles = { 'src/version.ts': "export const CONTRACT_VERSION = '0.1.0'" }

  test('同步版本组通过', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract', version: '0.1.0', files: contractFiles },
      { name: '@waygate/frame', version: '0.1.0' },
      { name: '@waygate/private-thing', version: '9.9.9', private: true },
    ])
    expect(checkVersions(workspaceRoot)).toStrictEqual([])
  })

  test('发布包版本不一致时报错，并列出各自版本', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract', version: '0.1.0', files: contractFiles },
      { name: '@waygate/frame', version: '0.2.0' },
    ])
    const violation = checkVersions(workspaceRoot).find((item) => item.rule === 'VERSION-SYNC')
    expect(violation?.message).toContain('@waygate/frame@0.2.0')
  })

  test('私有包的版本不参与同步版本组', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract', version: '0.1.0', files: contractFiles },
      { name: '@waygate/frame', version: '0.1.0' },
      { name: '@waygate/tool', version: '3.0.0', private: true },
    ])
    expect(checkVersions(workspaceRoot)).toStrictEqual([])
  })

  test('发布包缺 version 时报错', () => {
    const workspaceRoot = createWorkspace([
      { name: '@waygate/contract', files: contractFiles },
      { name: '@waygate/frame' },
    ])
    const violations = checkVersions(workspaceRoot).filter((item) => item.rule === 'VERSION-SYNC')
    expect(violations).toHaveLength(2)
  })
})

describe('契约版本', () => {
  test('与包版本一致时通过', () => {
    const workspaceRoot = createWorkspace([
      {
        name: '@waygate/contract',
        version: '1.2.3',
        files: { 'src/version.ts': "export const CONTRACT_VERSION = '1.2.3'" },
      },
    ])
    expect(checkVersions(workspaceRoot)).toStrictEqual([])
  })

  test('与包版本不一致时报错', () => {
    const workspaceRoot = createWorkspace([
      {
        name: '@waygate/contract',
        version: '1.2.3',
        files: { 'src/version.ts': "export const CONTRACT_VERSION = '1.0.0'" },
      },
    ])
    const violation = checkVersions(workspaceRoot).find((item) => item.rule === 'CONTRACT-VERSION')
    expect(violation?.message).toContain('与包版本 1.2.3 不一致')
  })

  test('常量缺失时报错', () => {
    const workspaceRoot = createWorkspace([
      {
        name: '@waygate/contract',
        version: '0.1.0',
        files: { 'src/version.ts': 'export const OTHER = 1' },
      },
    ])
    const violation = checkVersions(workspaceRoot).find((item) => item.rule === 'CONTRACT-VERSION')
    expect(violation?.message).toContain(CONTRACT_VERSION_CONSTANT)
  })

  test('版本文件读不到时报错，而不是当成通过', () => {
    const workspaceRoot = createWorkspace([{ name: '@waygate/contract', version: '0.1.0' }])
    const violation = checkVersions(workspaceRoot).find((item) => item.rule === 'CONTRACT-VERSION')
    expect(violation?.message).toContain('读不到')
  })

  test('找不到 contract 包时报错', () => {
    const workspaceRoot = createWorkspace([{ name: '@waygate/frame', version: '0.1.0' }])
    const violation = checkVersions(workspaceRoot).find((item) => item.rule === 'CONTRACT-VERSION')
    expect(violation?.message).toContain('找不到 @waygate/contract')
  })
})

describe('报告与退出码', () => {
  test('无违规时退出码为 0', () => {
    const { logs, errors, sink } = recordingSink()
    expect(report([], sink)).toBe(0)
    expect(logs).toHaveLength(1)
    expect(errors).toStrictEqual([])
  })

  test('有违规时退出码为 1', () => {
    const { errors, sink } = recordingSink()
    expect(report([{ rule: 'VERSION-SYNC', target: 'x', message: '不一致' }], sink)).toBe(1)
    expect(errors[1]).toContain('1 条违规')
  })

  test('门禁自身出错算失败', () => {
    const { errors, sink } = recordingSink()
    expect(runCli(join(root, '不存在的目录'), sink)).toBe(1)
    expect(errors[0]).toContain('无法完成')
  })

  test('真实仓库通过', () => {
    const { sink } = recordingSink()
    expect(runCli(root, sink)).toBe(0)
  })
})

describe('真实仓库的契约版本', () => {
  test('常量与包版本一致', () => {
    const contractVersion = readExportedStringConstant(
      'packages/contract/src/version.ts',
      readFileSync(join(root, 'packages', 'contract', 'src', 'version.ts'), 'utf8'),
      CONTRACT_VERSION_CONSTANT,
    )
    const manifest: unknown = JSON.parse(
      readFileSync(join(root, 'packages', 'contract', 'package.json'), 'utf8'),
    )
    expect(contractVersion).toBe((manifest as { version: string }).version)
  })
})
