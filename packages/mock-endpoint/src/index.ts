/**
 * `@waygate/mock-endpoint` —— 最小 mock 接入方。
 *
 * 私有包，不发布。它存在的唯一目的是充当契约一致性套件的**第二个实现**
 * （设计文档 §12.4）。它不实现界面、不连中转、不落存储。
 */
export { createMockCapabilitySurface } from './capabilities.ts'
