/**
 * 解析外部 JSON 时的形状读取工具。
 *
 * 两条纪律：
 * 1. **一律用 `Object.hasOwn` 判断字段存在**，不用 `key in record`。`in` 会沿原型链
 *    查找，于是 `{"constructor": ...}` 这类输入会让 `'constructor' in record` 为真。
 * 2. **判别用形状，不用 `instanceof`**（设计文档 §5.7）。从 JSON 解析出来的东西
 *    永远不是任何类的实例，`instanceof` 在跨模块边界会静默失效。
 */
import { FrameError } from './error.ts'

/** 把外部值收窄为一个普通对象；数组与 `null` 都不算。 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** 判断字段是否由该对象自己持有。 */
export function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key)
}

/**
 * 把任意抛出物转成可读说明。
 *
 * `catch` 拿到的不保证是 `Error`（可以是字符串、数字，甚至是 `undefined`）。
 * 单独抽出来是因为这个分支在真实调用点无法触达 —— `JSON.parse` 只会抛 `Error` ——
 * 而"无法触达的分支"不该靠忽略注释蒙过去，应该变成一个能被直接测的函数。
 *
 * @param error - `catch` 捕获到的任意值。
 * @returns 可读说明。
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 把一段文本解析成 JSON 对象。
 *
 * @param text - 待解析的文本。
 * @param owner - 出错信息里用的所属帧名。
 * @returns 解析出的普通对象。
 * @throws FrameError 不是合法 JSON，或解析结果不是普通对象。
 */
export function parseJsonObject(text: string, owner: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new FrameError('not-json', `${owner} 不是合法 JSON：${describeError(error)}`)
  }

  const record = asRecord(parsed)
  if (record === undefined) throw new FrameError('not-an-object', `${owner} 必须是一个 JSON 对象`)
  return record
}

/**
 * 读取一个可选字段，区分三种结果。
 *
 * 返回 `undefined` 表示键缺失（合法，含义是"没有这个字段"）；返回 `null` 表示键
 * 存在但不是字符串（非法，由调用方报错）。这样"缺失"与"写错"不会被混为一谈 ——
 * 设计文档 §5.7 要求字段缺失时**省略键**，而不是写 `undefined`。
 *
 * @param record - 待读取的对象。
 * @param key - 字段名。
 * @returns 字符串、`undefined`（缺失）或 `null`（类型不符）。
 */
export function readOptionalField(
  record: Record<string, unknown>,
  key: string,
): string | undefined | null {
  if (!hasOwn(record, key)) return undefined
  const value = record[key]
  return typeof value === 'string' ? value : null
}

/**
 * 读取一个必填字符串字段。
 *
 * 区分"缺失"与"类型不符"两种失败：排查方向完全不同 —— 前者通常是协议版本不匹配，
 * 后者是发送方实现有 bug。
 *
 * @param record - 待读取的对象。
 * @param key - 字段名。
 * @param owner - 出错信息里用的所属帧名。
 * @returns 字段值。
 * @throws FrameError 字段缺失或不是字符串。
 */
export function requireString(record: Record<string, unknown>, key: string, owner: string): string {
  if (!hasOwn(record, key)) throw new FrameError('missing-field', `${owner}.${key} 缺失`)
  const value = record[key]
  if (typeof value !== 'string') {
    throw new FrameError('invalid-field', `${owner}.${key} 必须是字符串`)
  }
  return value
}

/**
 * 读取一个必填的非负安全整数字段。
 *
 * `seq` 走这条路径：它必须是可比较、可持久化的整数。浮点或 `NaN` 会让断连恢复的
 * "按 lastSeq 补发"失去意义。
 *
 * @param record - 待读取的对象。
 * @param key - 字段名。
 * @param owner - 出错信息里用的所属帧名。
 * @returns 字段值。
 * @throws FrameError 字段缺失、不是数字或不是非负安全整数。
 */
export function requireSequence(
  record: Record<string, unknown>,
  key: string,
  owner: string,
): number {
  if (!hasOwn(record, key)) throw new FrameError('missing-field', `${owner}.${key} 缺失`)
  const value = record[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new FrameError('invalid-field', `${owner}.${key} 必须是非负安全整数`)
  }
  return value
}

/**
 * 读取一个必填布尔字段。
 *
 * @param record - 待读取的对象。
 * @param key - 字段名。
 * @param owner - 出错信息里用的所属帧名。
 * @returns 字段值。
 * @throws FrameError 字段缺失或不是布尔值。
 */
export function requireBoolean(
  record: Record<string, unknown>,
  key: string,
  owner: string,
): boolean {
  if (!hasOwn(record, key)) throw new FrameError('missing-field', `${owner}.${key} 缺失`)
  const value = record[key]
  if (typeof value !== 'boolean') {
    throw new FrameError('invalid-field', `${owner}.${key} 必须是布尔值`)
  }
  return value
}
