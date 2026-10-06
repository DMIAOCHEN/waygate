/**
 * 结构不变量门禁：R1–R6，外加两条让覆盖率报告保持诚实的命名约定。
 *
 * 这个脚本存在的理由：设计文档里"中转是哑管道""契约渠道无关"这类话，如果只写在
 * 文档里，几个月后 `relay` 就会 import 业务模型。把每条边界做成可执行检查，它才是
 * 结构性的，而不是靠 review 记忆。
 *
 * 检查项与设计文档 §4.3 的编号一一对应。用法：`pnpm check:boundaries`。
 */
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import ts from 'typescript'

/** 一条门禁违规。 */
export type Violation = {
  readonly rule: string
  readonly target: string
  readonly message: string
}

/** 一个工作区包的清单摘要。 */
export type PackageManifest = {
  readonly name: string
  readonly dir: string
  /** 包版本。清单缺 `version` 时为空串，由 check-versions 判为违规。 */
  readonly version: string
  /** 是否声明为私有。发布包不允许为真。 */
  readonly private: boolean
  readonly runtimeDependencies: readonly string[]
  readonly devDependencies: readonly string[]
  readonly peerDependencies: readonly string[]
}

/** 浏览器／DOM 全局名。`packages/*` 必须保持 Node 可测（R6）。 */
export const DOM_GLOBALS: readonly string[] = [
  'document',
  'window',
  'navigator',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'Element',
  'Node',
  'WebSocket',
  'XMLHttpRequest',
  'requestAnimationFrame',
]

/**
 * 读取工作区里所有包的清单。
 *
 * 只读取，不做类型断言：`package.json` 是外部输入，字段缺失要按缺失处理。
 *
 * @param root - 仓库根目录的绝对路径。
 * @returns 按包名排序的清单列表。
 */
export function readWorkspacePackages(root: string): readonly PackageManifest[] {
  const packagesDir = join(root, 'packages')
  const manifests: PackageManifest[] = []

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(packagesDir, entry.name)
    const manifestPath = join(dir, 'package.json')
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`${manifestPath} 不是一个 JSON 对象`)
    }
    const record = parsed as Record<string, unknown>
    const name = record['name']
    if (typeof name !== 'string') {
      throw new Error(`${manifestPath} 缺少 name 字段`)
    }
    const version = record['version']
    manifests.push({
      name,
      dir,
      version: typeof version === 'string' ? version : '',
      private: record['private'] === true,
      runtimeDependencies: dependencyNames(record['dependencies']),
      devDependencies: dependencyNames(record['devDependencies']),
      peerDependencies: dependencyNames(record['peerDependencies']),
    })
  }

  return manifests.toSorted((left, right) => left.name.localeCompare(right.name))
}

/** 取依赖段里的包名。依赖段缺失或形状不对时返回空列表。 */
function dependencyNames(section: unknown): readonly string[] {
  if (typeof section !== 'object' || section === null) return []
  return Object.keys(section as Record<string, unknown>)
}

/**
 * 计算一个包的运行时传递依赖闭包（含自身）。
 *
 * 只看 `dependencies`：R2／R3 要保证的是**部署出去的中转进程**不具备解密与
 * 理解业务模型的能力，而 `devDependencies` 只在开发与测试时存在。
 *
 * @param packages - 工作区全部包的清单。
 * @param rootName - 起点包名。
 * @returns 闭包内所有包名。
 */
export function transitiveRuntimeDependencies(
  packages: readonly PackageManifest[],
  rootName: string,
): ReadonlySet<string> {
  const byName = new Map(packages.map((manifest) => [manifest.name, manifest]))
  const seen = new Set<string>()
  const queue = [rootName]

  while (queue.length > 0) {
    const current = queue.pop()
    if (current === undefined || seen.has(current)) continue
    seen.add(current)
    const manifest = byName.get(current)
    if (manifest === undefined) continue
    queue.push(...manifest.runtimeDependencies)
  }

  return seen
}

/**
 * 找出工作区依赖图里的环。
 *
 * 图包含 `dependencies`、`devDependencies` 与 `peerDependencies`。环的危害不在于运行时
 * —— 它通常不报错 —— 而在于**层次**：两个包互指的时候，"哪个是测试基础设施、哪个是
 * 被测对象"就说不清了，而本仓库的整套结构论证都建立在"谁可以依赖谁"之上。
 *
 * 这个检查是补上去的：`contract-assert` 与 `mock-endpoint` 曾经互指，没有任何门禁发现。
 *
 * @param packages - 工作区全部包的清单。
 * @returns 每个环的可读描述，已去重并按字典序排序；无环时为空。
 */
export function findDependencyCycles(packages: readonly PackageManifest[]): readonly string[] {
  const byName = new Map(packages.map((manifest) => [manifest.name, manifest]))

  const edgesOf = (name: string): readonly string[] => {
    const manifest = byName.get(name)
    if (manifest === undefined) return []
    return [
      ...manifest.runtimeDependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    ].filter((dependency) => byName.has(dependency))
  }

  const cycles = new Set<string>()
  const settled = new Set<string>()
  const stack: string[] = []

  const visit = (name: string): void => {
    const start = stack.indexOf(name)
    if (start !== -1) {
      cycles.add(canonicalCycle([...stack.slice(start), name]))
      return
    }
    if (settled.has(name)) return

    settled.add(name)
    stack.push(name)
    for (const next of edgesOf(name)) visit(next)
    stack.pop()
  }

  for (const manifest of packages) visit(manifest.name)
  return [...cycles].toSorted()
}

/**
 * 把环旋转到从字典序最小的成员开始。
 *
 * 同一个环从不同入口会被发现多次，规范化之后才能只报一次。
 *
 * @param cycle - 形如 `[a, b, a]` 的环路径。
 * @returns 可读的环描述。
 */
function canonicalCycle(cycle: readonly string[]): string {
  const members = cycle.slice(0, -1)
  let startIndex = 0
  for (let index = 1; index < members.length; index += 1) {
    if ((members[index] ?? '') < (members[startIndex] ?? '')) startIndex = index
  }
  const rotated = [...members.slice(startIndex), ...members.slice(0, startIndex)]
  return [...rotated, rotated[0] ?? ''].join(' -> ')
}

/** 解析一份 TypeScript 源码。 */
function parseSource(filePath: string, text: string): ts.SourceFile {
  return ts.createSourceFile(filePath, text, ts.ScriptTarget.ESNext, true)
}

/**
 * 找出源码顶层的运行时值声明。
 *
 * 用于强制 `*.types.ts` 只包含类型：这类文件编译后没有可执行代码，一旦混进
 * 运行时值，它就会从覆盖率里静默消失。
 *
 * @param filePath - 用于诊断的文件路径。
 * @param text - 源码文本。
 * @returns 每个运行时值声明的可读描述。
 */
export function findRuntimeValueDeclarations(filePath: string, text: string): readonly string[] {
  const source = parseSource(filePath, text)
  const found: string[] = []

  for (const statement of source.statements) {
    if (hasDeclareModifier(statement)) continue
    if (
      ts.isVariableStatement(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    ) {
      found.push(describeDeclaration(statement))
    }
  }

  return found
}

/** 判断一个语句是否带 `declare` 修饰符（`declare` 会被完全擦除，不是运行时值）。 */
function hasDeclareModifier(statement: ts.Statement): boolean {
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword) ?? false
}

/**
 * 给一个声明起一个用于报错的可读名字。
 *
 * 刻意不使用 `ts.SyntaxKind[kind]` 反查枚举名：TS 6 的 SyntaxKind 有别名，
 * 反查会给出 `FirstStatement` 这种既不是源码名字、也帮不上定位的结果。
 */
function describeDeclaration(statement: ts.Statement): string {
  if (ts.isVariableStatement(statement)) {
    const names = statement.declarationList.declarations
      .map((declaration) => (ts.isIdentifier(declaration.name) ? declaration.name.text : undefined))
      .filter((name): name is string => name !== undefined)
    return names.length > 0 ? `变量 ${names.join(', ')}` : '变量声明'
  }
  if (ts.isFunctionDeclaration(statement)) return `函数 ${statement.name?.text ?? '(匿名)'}`
  if (ts.isClassDeclaration(statement)) return `类 ${statement.name?.text ?? '(匿名)'}`
  if (ts.isEnumDeclaration(statement)) return `枚举 ${statement.name.text}`
  if (ts.isModuleDeclaration(statement)) return `命名空间 ${statement.name.getText()}`
  return '其他语句'
}

/**
 * 收集文件里由**本地值声明**绑定的名字。
 *
 * 用来消除假阳性：`const window = createSeqWindow(8)` 里的 `window` 是本地的，
 * 不是 DOM 全局。只看语法的检查分不清两者，于是会把正常代码报成违规 ——
 * 一个经常误报的门禁比没有门禁更糟，因为它会被绕过或被整体关掉。
 *
 * **刻意不包含 import 绑定**：`import { TextEncoder } from 'node:util'` 依然是违规
 * （运行时根本没有它），而 `import type { Node } from './x'` 这类会由类型位置排除。
 *
 * 已知局限：文件里声明了同名的本地变量、同时又真的引用了全局，这种情况会被漏掉。
 * 这是刻意的取舍 —— 漏报一个罕见写法，换掉每次命名都要踩的假阳性。
 */
export function collectLocalValueNames(filePath: string, text: string): ReadonlySet<string> {
  const source = parseSource(filePath, text)
  const names = new Set<string>()

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) names.add(node.name.text)
    else if (ts.isParameter(node) && ts.isIdentifier(node.name)) names.add(node.name.text)
    else if (ts.isFunctionDeclaration(node) && node.name !== undefined) names.add(node.name.text)
    else if (ts.isClassDeclaration(node) && node.name !== undefined) names.add(node.name.text)
    else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) names.add(node.name.text)
    ts.forEachChild(node, visit)
  }
  visit(source)

  return names
}

/**
 * 判断一个标识符是否位于**类型位置**。
 *
 * `type Node = ...`、`: Node`、`extends Node` 都不是运行时引用，不该被当成"使用了
 * DOM 全局"。
 */
function isInTypePosition(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isTypeNode(current)) return true
    current = current.parent
  }
  return false
}

/**
 * 找出源码里对指定全局名的**运行时引用**。
 *
 * 排除三类：属性名（`obj.document`）、声明名（`type Node = ...` 的 `Node`）、
 * 本地值绑定的名字（`const window = ...`）。
 *
 * @param filePath - 用于诊断的文件路径。
 * @param text - 源码文本。
 * @param names - 要检查的全局名集合。
 * @returns 每个命中位置的可读描述（含行号）。
 */
export function findGlobalReferences(
  filePath: string,
  text: string,
  names: ReadonlySet<string>,
): readonly string[] {
  const source = parseSource(filePath, text)
  const localNames = collectLocalValueNames(filePath, text)
  const found: string[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      names.has(node.text) &&
      !localNames.has(node.text) &&
      !isInTypePosition(node) &&
      isReference(node)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
      found.push(`${node.text} (第 ${line + 1} 行)`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  return found
}

/** 判断一个标识符是不是"被引用"，而不是属性名或声明名。 */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent

  const isPropertyName =
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isQualifiedName(parent) && parent.right === node) ||
    (ts.isPropertySignature(parent) && parent.name === node)

  const isDeclarationName =
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isTypeAliasDeclaration(parent) && parent.name === node) ||
    (ts.isInterfaceDeclaration(parent) && parent.name === node) ||
    (ts.isImportSpecifier(parent) && parent.name === node)

  return !isPropertyName && !isDeclarationName
}

/**
 * 找出 `index.ts` 里除导入导出之外的语句。
 *
 * 强制 `index.ts` 只做 re-export：barrel 一旦开始累积逻辑，它就会成为所有人
 * 都依赖、谁都不敢改的枢纽，而且它的逻辑在覆盖率里是隐形的（barrel 自身没有
 * 可执行语句）。想放逻辑就放进有名字的模块。
 *
 * @param filePath - 用于诊断的文件路径。
 * @param text - 源码文本。
 * @returns 每个越界语句的可读描述。
 */
export function findBarrelStatements(filePath: string, text: string): readonly string[] {
  const source = parseSource(filePath, text)
  const found: string[] = []

  for (const statement of source.statements) {
    const allowed =
      ts.isImportDeclaration(statement) ||
      ts.isExportDeclaration(statement) ||
      ts.isExportAssignment(statement)
    if (!allowed) found.push(describeDeclaration(statement))
  }

  return found
}

/**
 * 把一个 barrel 的**运行时**导出名列出来。
 *
 * 跳过 `export type` —— 类型不占运行时导出位。遇到 `export * from 'pkg'` 时递归到目标
 * barrel，这样门面才能写成一行 `export *`，而不必手抄几十个名字（手抄正是漂移的来源）。
 *
 * @param filePath - barrel 的路径，仅用于诊断。
 * @param text - barrel 的源码。
 * @param resolve - 把模块说明符解析成目标 barrel 的路径与源码。
 * @returns 运行时导出名集合。
 */
export function collectRuntimeExports(
  filePath: string,
  text: string,
  resolve: (specifier: string) => readonly [string, string] | undefined,
): ReadonlySet<string> {
  const source = parseSource(filePath, text)
  const names = new Set<string>()

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue
      const clause = statement.exportClause
      const specifier = statement.moduleSpecifier

      if (clause === undefined) {
        // `export * from 'specifier'`
        if (specifier !== undefined && ts.isStringLiteral(specifier)) {
          const target = resolve(specifier.text)
          if (target !== undefined) {
            for (const name of collectRuntimeExports(target[0], target[1], resolve)) names.add(name)
          }
        }
        continue
      }

      if (ts.isNamespaceExport(clause)) {
        names.add(clause.name.text)
        continue
      }

      for (const element of clause.elements) {
        if (element.isTypeOnly) continue
        names.add(element.name.text)
      }
      continue
    }

    if (ts.isExportAssignment(statement) && !statement.isExportEquals) names.add('default')
  }

  return names
}

/** 递归列出目录下的全部 `.ts` 文件。 */ export function listSourceFiles(
  dir: string,
): readonly string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...listSourceFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      found.push(full)
    }
  }
  return found
}

/**
 * 把绝对路径转成相对仓库根的稳定诊断路径（一律正斜杠）。
 *
 * 导出是为了可测：路径截断曾经把 `packages/...` 打成 `ackages/...`，
 * 让报错难以定位。
 */
export function toRepoRelativePath(root: string, path: string): string {
  return relative(root, path).replaceAll('\\', '/')
}

/** 门面包 `@waygate/sdk` 必须汇总的成员包。 */
export const SDK_FACADE_MEMBERS: readonly string[] = [
  '@waygate/contract',
  '@waygate/crypto',
  '@waygate/frame',
]

/**
 * 检查门面的公开面是否等于成员包公开面的并集。
 *
 * 门面本身零逻辑，它的风险不是写错，而是**悄悄落后**：某个包新增了导出，门面没跟上，
 * 接入方就会在"契约里明明有"的地方拿不到东西 —— 而这种缺失没有任何编译错误会提示。
 *
 * @param packages - 工作区全部包的清单。
 * @returns 违规列表。
 */
export function checkSdkSurface(packages: readonly PackageManifest[]): readonly Violation[] {
  const sdk = packages.find((manifest) => manifest.name === '@waygate/sdk')
  if (sdk === undefined) return []

  const readBarrel = (dir: string): ReadonlySet<string> | undefined => {
    const barrelPath = join(dir, 'src', 'index.ts')
    try {
      return collectRuntimeExports(barrelPath, readFileSync(barrelPath, 'utf8'), (specifier) => {
        const target = packages.find((manifest) => manifest.name === specifier)
        if (target === undefined) return undefined
        const targetBarrel = join(target.dir, 'src', 'index.ts')
        try {
          return [targetBarrel, readFileSync(targetBarrel, 'utf8')] as const
        } catch {
          // 目标包没有 barrel：交给 TYPES-ONLY／BARREL-ONLY 之外的检查处理，
          // 不属于本规则的范围。
          return undefined
        }
      })
    } catch {
      return undefined
    }
  }

  const facade = readBarrel(sdk.dir)
  if (facade === undefined) return []

  const expected = new Set<string>()
  for (const member of SDK_FACADE_MEMBERS) {
    const target = packages.find((manifest) => manifest.name === member)
    if (target === undefined) continue
    const exported = readBarrel(target.dir)
    if (exported === undefined) continue
    for (const name of exported) expected.add(name)
  }

  const violations: Violation[] = []
  const missing = [...expected].filter((name) => !facade.has(name))
  const extra = [...facade].filter((name) => !expected.has(name))

  if (missing.length > 0) {
    violations.push({
      rule: 'SDK-SURFACE',
      target: sdk.name,
      message: `门面漏掉了这些导出：${missing.toSorted().join('、')}`,
    })
  }
  if (extra.length > 0) {
    violations.push({
      rule: 'SDK-SURFACE',
      target: sdk.name,
      message: `门面多出了不属于并集的导出：${extra.toSorted().join('、')}`,
    })
  }

  return violations
}

/**
 * 跑完全部门禁检查。
 *
 * @param root - 仓库根目录的绝对路径。
 * @returns 全部违规；空数组表示通过。
 */
export function runChecks(root: string): readonly Violation[] {
  const packages = readWorkspacePackages(root)
  const byName = new Map(packages.map((manifest) => [manifest.name, manifest]))
  const violations: Violation[] = []

  const requirePackage = (name: string): PackageManifest => {
    const manifest = byName.get(name)
    if (manifest === undefined) throw new Error(`工作区里找不到包 ${name}`)
    return manifest
  }

  // R1：contract 零运行时依赖 —— 它要能在浏览器、Node、小程序三种运行时里加载。
  const contract = requirePackage('@waygate/contract')
  for (const dependency of contract.runtimeDependencies) {
    violations.push({
      rule: 'R1',
      target: contract.name,
      message: `contract 必须零运行时依赖，但依赖了 ${dependency}`,
    })
  }

  // R2／R3：中转不得具备解密能力，也不得理解业务模型。
  if (byName.has('@waygate/relay')) {
    const closure = transitiveRuntimeDependencies(packages, '@waygate/relay')
    for (const forbidden of ['@waygate/crypto', '@waygate/contract']) {
      if (closure.has(forbidden)) {
        violations.push({
          rule: forbidden === '@waygate/crypto' ? 'R2' : 'R3',
          target: '@waygate/relay',
          message: `中转的运行时传递依赖不得包含 ${forbidden}（平台只见密文、不理解会话语义）`,
        })
      }
    }
  }

  // R4：契约不得依赖任何渠道相关的东西。
  for (const dependency of contract.runtimeDependencies) {
    if (dependency.startsWith('@waygate/channel')) {
      violations.push({
        rule: 'R4',
        target: contract.name,
        message: `契约不得依赖渠道包 ${dependency}（渠道无关性不变量）`,
      })
    }
  }

  // SDK-SURFACE：门面的公开面必须等于被 re-export 包公开面的并集。
  // 门面本身零逻辑，它的风险不是写错，而是**悄悄落后** —— 某个包新增了一个导出，
  // 门面却没跟上，接入方就会在"明明契约里有"的地方拿不到东西。
  violations.push(...checkSdkSurface(packages))

  // ACYCLIC：工作区依赖图不得有环。
  for (const cycle of findDependencyCycles(packages)) {
    violations.push({
      rule: 'ACYCLIC',
      target: '工作区依赖图',
      message: `存在依赖环：${cycle}`,
    })
  }

  const textEncoder = new Set(['TextEncoder'])
  const domGlobals = new Set(DOM_GLOBALS)

  for (const manifest of packages) {
    const sourceDir = join(manifest.dir, 'src')
    let files: readonly string[]
    try {
      if (!statSync(sourceDir).isDirectory()) continue
      files = listSourceFiles(sourceDir)
    } catch {
      continue
    }

    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const target = toRepoRelativePath(root, file)

      // R5：内容块度量不得依赖 TextEncoder —— 微信小程序运行时没有它。
      if (manifest.name === '@waygate/contract' || manifest.name === '@waygate/frame') {
        for (const hit of findGlobalReferences(file, text, textEncoder)) {
          violations.push({
            rule: 'R5',
            target,
            message: `不得使用 TextEncoder（微信小程序运行时没有它）：${hit}`,
          })
        }
      }

      // R6：浏览器／DOM 代码只能出现在 apps/web，packages/* 必须保持 Node 可测。
      for (const hit of findGlobalReferences(file, text, domGlobals)) {
        violations.push({
          rule: 'R6',
          target,
          message: `packages/* 不得引用 DOM 全局：${hit}`,
        })
      }

      // 约定：*.types.ts 只包含类型。
      if (file.endsWith('.types.ts')) {
        for (const declaration of findRuntimeValueDeclarations(file, text)) {
          violations.push({
            rule: 'TYPES-ONLY',
            target,
            message: `*.types.ts 不得包含运行时值声明：${declaration}`,
          })
        }
      }

      // 约定：index.ts 只做 re-export。
      if (file.endsWith('index.ts')) {
        for (const statement of findBarrelStatements(file, text)) {
          violations.push({
            rule: 'BARREL-ONLY',
            target,
            message: `index.ts 只允许 re-export，不得包含：${statement}`,
          })
        }
      }
    }
  }

  return violations
}

/** 诊断输出的落点。抽成参数是为了让测试能断言输出，而不是只能看退出码。 */
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
    sink.log('check-boundaries: 通过（R1–R6 与两条命名约定）')
    return 0
  }

  for (const violation of violations) {
    sink.error(`${violation.rule}  ${violation.target}  ${violation.message}`)
  }
  sink.error(`check-boundaries: ${violations.length} 条违规`)
  return 1
}

/**
 * 门禁的命令行入口逻辑。
 *
 * 门禁**自身出错必须是失败**，不能被当成"没有违规"—— 一个因为读不到目录而通过
 * 的检查，比没有检查更危险。
 *
 * @param root - 仓库根目录的绝对路径。
 * @param sink - 输出落点。
 * @returns 进程退出码。
 */
export function runCli(root: string, sink: ReportSink): number {
  try {
    return report(runChecks(root), sink)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    sink.error(`check-boundaries 无法完成：${detail}`)
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
