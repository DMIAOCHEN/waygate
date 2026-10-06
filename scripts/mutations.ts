/**
 * 变异体清单。
 *
 * 每一条都对应一个**契约层**用例（设计文档 §7.2：契约层必须做变异验证）。加新用例时
 * 在这里补一条，`pnpm test:mutation` 会验证它确实能被打红。
 *
 * 锚点必须满足两个条件：在文件里**恰好命中一次**；替换后**必然**让指定的测试文件失败。
 * 锚点过期（命中 0 次）会被判为失败而不是静默跳过 —— 否则代码改完之后，变异验证会
 * 继续"通过"，而它验证的东西早已不存在。
 */
import type { Mutation } from './mutation-check.ts'

/** 全部变异体。 */
export const MUTATIONS: readonly Mutation[] = [
  {
    name: 'contract: 能力查表不再防原型',
    file: 'packages/contract/src/capability.ts',
    anchor: 'return KNOWN_CAPABILITIES.has(id)',
    replacement: 'return true',
    testFile: 'packages/contract/src/capability.test.ts',
  },
  {
    name: 'contract: 未知能力不再被丢弃',
    file: 'packages/contract/src/capability.ts',
    anchor: 'return declared.filter(isKnownCapability)',
    replacement: 'return [...declared]',
    testFile: 'packages/contract/src/capability.test.ts',
  },
  {
    name: 'frame: 信封 seq 不再校验，直接归零',
    file: 'packages/frame/src/envelope.ts',
    anchor: "seq: requireSequence(record, 'seq', 'envelope'),",
    replacement: 'seq: 0,',
    testFile: 'packages/frame/src/envelope.test.ts',
  },
  {
    name: 'frame: 未知控制帧被静默忽略',
    file: 'packages/frame/src/control.ts',
    anchor: "        `未知控制帧 kind=${kind}；已知取值：${CONTROL_FRAME_KINDS.join('、')}`,",
    replacement: '        `未知控制帧 kind=${kind}`,',
    testFile: 'packages/frame/src/control.test.ts',
  },
  {
    name: 'crypto: 防重放滑窗不再拒绝过旧序号',
    file: 'packages/crypto/src/replay.ts',
    anchor: 'if (highest >= 0 && seq <= highest - windowSize) return false',
    replacement: 'if (false) return false',
    testFile: 'packages/crypto/src/replay.test.ts',
  },
  {
    name: 'crypto: 会话到期不再判定为失效',
    file: 'packages/crypto/src/keys.ts',
    anchor: 'return clock.now() >= session.expiresAt',
    replacement: 'return false',
    testFile: 'packages/crypto/src/keys.test.ts',
  },
]
