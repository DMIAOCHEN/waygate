/**
 * 版本门禁。
 *
 * 两条规则（设计文档 §8）：
 * 1. **发布包使用同步版本组**：同一个版本号。接入方因此不会组合出无意义的版本矩阵。
 * 2. **`CONTRACT_VERSION` 与包版本不矛盾**：契约版本是单一事实来源（§5.7），
 *    它若与包版本各说各话，接入方就无法用包版本谈协商。
 *
 * 为什么手维护版本 + 一条门禁，而不是现在就引入 changesets：变更集工作流是为
 * 频繁发布设计的，而这个仓库还没有第一个外部接入方。门禁的成本是一条脚本，
 * changesets 的成本是一整套流程。触发条件是"出现第一个外部接入方且发布需要自动化"。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { realpathSync } from 'node:fs'

import ts from 'typescript'

import { readWorkspacePackages, type PackageManifest, type Violation } from './check-boundaries.ts'

/** 契约版本常量的名字。 */
export const CONTRACT_VERSION_CONSTANT = 'CONTRACT_VERSION'

/**
 * 从源码里读出一个导出的字符串常量。
 *
 * 用 AST 而不是正则：正则会在注释、字符串内容或同名局部变量上误判，而"版本号读错"
 * 是那种看起来一切正常、直到接入方协商失败才暴露的错误。
 *
 * @param filePath - 用于解析的路径。
 * @param text - 源码文本。
 * @param name - 常量名。
 * @returns 常量值；未找到或不是字符串字面量时为 `undefined`。
 */
export function readExportedStringConstant(
  filePath: string,
  text: string,
  name: string,
): string | undefined {
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.ESNext, true)

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue
      const initializer = declaration.initializer
      if (initializer !== undefined && ts.isStringLiteral(initializer)) return initializer.text
    }
  }

  return undefined
}

/** 发布包：未声明 `private: true` 的包。 */
export function publishablePackages(
  packages: readonly PackageManifest[],
): readonly PackageManifest[] {
  return packages.filter((manifest) => !manifest.private)
}

/**
 * 跑版本门禁。
 *
 * @param root - 仓库根目录的绝对路径。
 * @returns 全部违规；空数组表示通过。
 */
export function checkVersions(root: string): readonly Violation[] {
  const packages = readWorkspacePackages(root)
  const publishable = publishablePackages(packages)
  const violations: Violation[] = []

  const missingVersion = publishable.filter((manifest) => manifest.version === '')
  for (const manifest of missingVersion) {
    violations.push({
      rule: 'VERSION-SYNC',
      target: manifest.name,
      message: '发布包必须声明 version',
    })
  }

  const versions = new Set(
    publishable.map((manifest) => manifest.version).filter((version) => version !== ''),
  )
  if (versions.size > 1) {
    const detail = publishable
      .filter((manifest) => manifest.version !== '')
      .map((manifest) => `${manifest.name}@${manifest.version}`)
      .toSorted()
      .join('、')
    violations.push({
      rule: 'VERSION-SYNC',
      target: '发布包',
      message: `发布包必须使用同步版本组，当前版本不一致：${detail}`,
    })
  }

  const contract = packages.find((manifest) => manifest.name === '@waygate/contract')
  if (contract === undefined) {
    violations.push({
      rule: 'CONTRACT-VERSION',
      target: '@waygate/contract',
      message: '工作区里找不到 @waygate/contract，无法校验契约版本',
    })
    return violations
  }

  const versionFile = join(contract.dir, 'src', 'version.ts')
  let constant: string | undefined
  try {
    constant = readExportedStringConstant(
      versionFile,
      readFileSync(versionFile, 'utf8'),
      CONTRACT_VERSION_CONSTANT,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    violations.push({
      rule: 'CONTRACT-VERSION',
      target: '@waygate/contract',
      message: `读不到 ${CONTRACT_VERSION_CONSTANT}：${detail}`,
    })
    return violations
  }

  if (constant === undefined) {
    violations.push({
      rule: 'CONTRACT-VERSION',
      target: '@waygate/contract',
      message: `${versionFile} 里找不到字符串常量 ${CONTRACT_VERSION_CONSTANT}`,
    })
    return violations
  }

  if (contract.version !== '' && constant !== contract.version) {
    violations.push({
      rule: 'CONTRACT-VERSION',
      target: '@waygate/contract',
      message: `${CONTRACT_VERSION_CONSTANT} 为 ${constant}，与包版本 ${contract.version} 不一致`,
    })
  }

  return violations
}

/** 诊断输出的落点。 */
export type ReportSink = {
  readonly log: (message: string) => void
  readonly error: (message: string) => void
}

/**
 * 打印违规并返回进程退出码。
 *
 * @param violations - 待报告的违规。
 * @param sink - 输出落点。
 * @returns 有违规时为 1，否则为 0。
 */
export function report(violations: readonly Violation[], sink: ReportSink): number {
  if (violations.length === 0) {
    sink.log('check-versions: 通过（同步版本组与契约版本）')
    return 0
  }

  for (const violation of violations) {
    sink.error(`${violation.rule}  ${violation.target}  ${violation.message}`)
  }
  sink.error(`check-versions: ${violations.length} 条违规`)
  return 1
}

/**
 * 门禁的命令行入口逻辑。门禁自身出错必须是失败，不能算通过。
 *
 * @param root - 仓库根目录的绝对路径。
 * @param sink - 输出落点。
 * @returns 进程退出码。
 */
export function runCli(root: string, sink: ReportSink): number {
  try {
    return report(checkVersions(root), sink)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    sink.error(`check-versions 无法完成：${detail}`)
    return 1
  }
}

// 被当作脚本直接运行时才执行；被测试 import 时不执行。
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href

if (invokedDirectly) {
  process.exitCode = runCli(fileURLToPath(new URL('..', import.meta.url)), console)
}
