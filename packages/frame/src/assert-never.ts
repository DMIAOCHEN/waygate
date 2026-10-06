/**
 * 判别联合的穷尽性收口。
 *
 * 新增一个联合成员时，所有 `switch` 都会在这里编译失败，而不是在运行时静默漏掉
 * 一个分支。这是本项目对判别联合的统一要求。
 *
 * 注意：`contract` 包零运行时依赖（R1），所以它需要时自带一份，不从别处引。
 * 这是零依赖规则的代价，刻意接受。
 *
 * @param value - 按类型推断本应不可达的值。
 * @throws 永远抛出，且带上被漏掉的值。
 */
export function assertNever(value: never): never {
  throw new Error(`未处理的联合成员：${JSON.stringify(value)}`)
}
