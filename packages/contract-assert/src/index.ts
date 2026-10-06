/**
 * `@waygate/contract-assert` —— 契约一致性套件。
 *
 * 接入方在自己的 CI 里运行它（设计文档 §12.4）。因此它**不依赖任何测试框架**：
 * 接入方用什么框架不该由平台决定。它只导出断言函数与结果类型，跑法由调用方决定。
 *
 * 被测表面的类型（`CapabilitySurface`）来自 `@waygate/contract`，不在这里转发 ——
 * 一份事实只有一个家，而它描述的是"实现必须提供什么"，属于契约。接入方从已经依赖的
 * `contract`（或门面 `sdk`）就能拿到它。
 */
export {
  ContractAssertionError,
  PROTOTYPE_PROBE_NAMES,
  assertContractConformance,
  runContractAssertions,
} from './conformance.ts'
export type { AssertionOutcome } from './conformance.ts'
