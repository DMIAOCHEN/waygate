/**
 * 变异验证。
 *
 * 设计文档 §12.6 要求"新增用例需要能被一条对应的代码变异打红，锚点恰好命中一次、
 * 还原后文件逐字节一致"。这句话如果没有工具落地，就是一句无法执行的纪律 —— 而
 * "测试写了但根本没测到"恰恰是覆盖率数字看不出来的那类问题。
 *
 * 用法：在 `scripts/mutations.ts` 里声明变异体，跑 `pnpm test:mutation`。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 一个变异体：把某处锚点替换成变异体，并指定应当因此变红的测试文件。 */
export type Mutation = {
  /** 变异体名，用于报告。 */
  readonly name: string
  /** 被变异的文件，相对仓库根。 */
  readonly file: string
  /** 锚点文本。必须在文件里**恰好命中一次**。 */
  readonly anchor: string
  /** 替换成什么。 */
  readonly replacement: string
  /** 期望因此失败的测试文件，相对仓库根。 */
  readonly testFile: string
}

/** 一条变异验证的结果。 */
export type MutationStatus =
  | 'killed'
  | 'survived'
  | 'anchor-missing'
  | 'anchor-ambiguous'
  | 'restore-mismatch'
  | 'runner-failed'

/** 一条变异验证的结果。 */
export type MutationOutcome = {
  readonly name: string
  readonly status: MutationStatus
  readonly detail?: string
}

/** 一次测试运行的结果。 */
export type TestRunResult = {
  /** 是否失败（非零退出码）。 */
  readonly failed: boolean
  /** 合并后的输出，用于诊断。 */
  readonly output: string
}

/** 跑一个测试文件。抽成参数是为了让变异验证本身可测。 */
export type TestRunner = (testFile: string) => TestRunResult

/**
 * 数一个子串在文本里出现几次。
 *
 * 锚点命中 0 次或多次都必须判失败：0 次说明锚点已经过期（代码改了，变异验证还在
 * 假装有效）；多次说明替换位置有歧义，改的可能不是你以为的那一处。
 *
 * @param haystack - 被搜索的文本。
 * @param needle - 锚点文本。
 * @returns 出现次数；锚点为空串时返回 0。
 */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0

  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/** 应用变异的结果。 */
export type MutationApplication =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false
      readonly status: 'anchor-missing' | 'anchor-ambiguous'
      readonly detail: string
    }

/**
 * 把锚点替换成变异体。
 *
 * @param text - 原文本。
 * @param anchor - 锚点文本。
 * @param replacement - 替换文本。
 * @returns 替换结果，或锚点不合格的说明。
 */
export function applyMutation(
  text: string,
  anchor: string,
  replacement: string,
): MutationApplication {
  const occurrences = countOccurrences(text, anchor)

  if (occurrences === 0) {
    return { ok: false, status: 'anchor-missing', detail: `锚点在文件里找不到：${anchor}` }
  }
  if (occurrences > 1) {
    return {
      ok: false,
      status: 'anchor-ambiguous',
      detail: `锚点在文件里命中 ${occurrences} 次，必须是 1 次：${anchor}`,
    }
  }

  return { ok: true, text: text.replace(anchor, replacement) }
}

/** 把任意抛出物转成可读说明。 */
function describeThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 验证一个变异体。
 *
 * 流程：锚点检查 → 记录字节快照 → 写入变异体 → 跑测试（必须红）→ 还原 →
 * 断言与原文件逐字节一致。
 *
 * 无论测试跑成什么样都会还原：一个把变异体留在源码里的验证工具，比没有这个工具危险
 * 得多。
 *
 * @param root - 仓库根目录的绝对路径。
 * @param mutation - 待验证的变异体。
 * @param runTest - 跑测试的方式。
 * @returns 该变异体的结果。
 */
export function runMutationCheck(
  root: string,
  mutation: Mutation,
  runTest: TestRunner,
): MutationOutcome {
  const filePath = join(root, mutation.file)
  const originalBytes = readFileSync(filePath)

  const application = applyMutation(
    originalBytes.toString('utf8'),
    mutation.anchor,
    mutation.replacement,
  )
  if (!application.ok) {
    return { name: mutation.name, status: application.status, detail: application.detail }
  }

  let outcome: MutationOutcome
  try {
    writeFileSync(filePath, application.text)
    const result = runTest(mutation.testFile)
    outcome = result.failed
      ? { name: mutation.name, status: 'killed' }
      : {
          name: mutation.name,
          status: 'survived',
          detail: '变异体没有被任何用例打红 —— 这条用例没有测到它声称测的东西',
        }
  } catch (error) {
    outcome = { name: mutation.name, status: 'runner-failed', detail: describeThrown(error) }
  } finally {
    writeFileSync(filePath, originalBytes)
  }

  const restoredBytes = readFileSync(filePath)
  if (!restoredBytes.equals(originalBytes)) {
    return {
      name: mutation.name,
      status: 'restore-mismatch',
      detail: '还原后文件与原文件不是逐字节一致，必须手工检查',
    }
  }

  return outcome
}

/** 诊断输出的落点。 */
export type ReportSink = {
  readonly log: (message: string) => void
  readonly error: (message: string) => void
}

/**
 * 打印结果并返回进程退出码。
 *
 * @param outcomes - 全部变异体的结果。
 * @param sink - 输出落点。
 * @returns 全部 killed 时为 0，否则为 1。
 */
export function report(outcomes: readonly MutationOutcome[], sink: ReportSink): number {
  const notKilled = outcomes.filter((outcome) => outcome.status !== 'killed')

  for (const outcome of outcomes) {
    const line = `${outcome.status}  ${outcome.name}${outcome.detail === undefined ? '' : `  ${outcome.detail}`}`
    if (outcome.status === 'killed') sink.log(line)
    else sink.error(line)
  }

  if (notKilled.length === 0) {
    sink.log(`mutation-check: 通过（${outcomes.length} 个变异体全部被打红）`)
    return 0
  }

  sink.error(`mutation-check: ${notKilled.length}/${outcomes.length} 个变异体没有被正确打红`)
  return 1
}

/**
 * 跑完全部变异体。
 *
 * @param root - 仓库根目录的绝对路径。
 * @param mutations - 变异体清单。
 * @param runTest - 跑测试的方式。
 * @param sink - 输出落点。
 * @returns 进程退出码。
 */
export function runAll(
  root: string,
  mutations: readonly Mutation[],
  runTest: TestRunner,
  sink: ReportSink,
): number {
  const outcomes: MutationOutcome[] = []
  for (const mutation of mutations) {
    try {
      outcomes.push(runMutationCheck(root, mutation, runTest))
    } catch (error) {
      outcomes.push({
        name: mutation.name,
        status: 'runner-failed',
        detail: describeThrown(error),
      })
    }
  }
  return report(outcomes, sink)
}

/** 用真实的 vitest 进程跑一个测试文件。 */
function spawnVitest(root: string): TestRunner {
  return (testFile) => {
    const result = spawnSync('pnpm', ['exec', 'vitest', 'run', testFile], {
      cwd: root,
      encoding: 'utf8',
      shell: true,
    })
    return {
      failed: (result.status ?? 1) !== 0,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    }
  }
}

// 被当作脚本直接运行时才执行；被测试 import 时不执行。
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href

if (invokedDirectly) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  // 动态 import：清单里引用了本模块的类型，静态 import 会形成循环。
  const { MUTATIONS } = await import('./mutations.ts')
  process.exitCode = runAll(root, MUTATIONS, spawnVitest(root), console)
}
