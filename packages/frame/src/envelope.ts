/**
 * 业务帧的统一信封。
 *
 * 中转**只看到这个结构**。`ciphertext` 与 `tag` 对它是不可读的字节 —— 平台没有
 * 会话密钥，也不该有（设计文档 §9.1）。`channel` 是路由键，中转需要它才能转发。
 *
 * 参见设计文档 §6.3。
 */
import { parseJsonObject, requireSequence, requireString } from './shape.ts'

/** 信封结构。字段全部必填，没有可选字段。 */
export type Envelope = {
  /** 路由键。中转据此把帧转发到配对的对端。 */
  readonly channel: string
  /** 每个 Endpoint 一条单调递增序列，是断连恢复的唯一基础。 */
  readonly seq: number
  /** AEAD 的初始向量，每帧唯一。 */
  readonly nonce: string
  /** 密文。中转不解析。 */
  readonly ciphertext: string
  /** AEAD 认证标签。中转不解析。 */
  readonly tag: string
}

/**
 * 把信封序列化成线格式。
 *
 * 逐字段显式列出，而不是 `JSON.stringify(envelope)`：这样内存对象上多出来的字段
 * 不会被顺手带上线。
 *
 * @param envelope - 待序列化的信封。
 * @returns JSON 文本。
 */
export function encodeEnvelope(envelope: Envelope): string {
  return JSON.stringify({
    channel: envelope.channel,
    seq: envelope.seq,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
    tag: envelope.tag,
  })
}

/**
 * 解析一个信封。
 *
 * 多余的字段被忽略而不是报错：这是版本演进能单向兼容的前提 —— 新版本加字段
 * 不应让旧版本解析失败。
 *
 * @param text - JSON 文本。
 * @returns 解析出的信封。
 * @throws FrameError 文本不合法，或任一必填字段缺失／类型不符。
 */
export function decodeEnvelope(text: string): Envelope {
  const record = parseJsonObject(text, 'envelope')
  return {
    channel: requireString(record, 'channel', 'envelope'),
    seq: requireSequence(record, 'seq', 'envelope'),
    nonce: requireString(record, 'nonce', 'envelope'),
    ciphertext: requireString(record, 'ciphertext', 'envelope'),
    tag: requireString(record, 'tag', 'envelope'),
  }
}
