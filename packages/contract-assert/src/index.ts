/**
 * `@waygate/contract-assert` —— 契约一致性套件。
 *
 * 接入方在自己的 CI 里运行它（设计文档 §12.4）。因此它**不依赖任何测试框架**：
 * 接入方用什么框架不该由平台决定。它只导出断言函数与结果类型，跑法由调用方决定。
 *
 * `CapabilitySurface` 是结构化类型，接入方可以直接传一个形状相同的对象，
 * 不必为了用上断言而把这个包变成运行时依赖。
 */
export {
  ContractAssertionError,
  PROTOTYPE_PROBE_NAMES,
  assertContractConformance,
  runContractAssertions,
} from './conformance.ts'
export type { AssertionOutcome, CapabilitySurface } from './conformance.ts'
