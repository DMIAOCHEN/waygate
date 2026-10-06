/**
 * 一个合规实现对外暴露的能力表面。
 *
 * **这个类型为什么在 `contract` 而不在 `contract-assert`：** 它描述的是"一个实现必须
 * 提供什么" —— 那是契约的陈述，不是测试工具的陈述。放在这里有两个直接好处：
 *
 * 1. 接入方从**已经依赖的包**（`contract`，或门面 `sdk`）就能拿到它，不必为了给自己的
 *    实现标注类型，去 import 一个对他们是 devDependency 的测试包；
 * 2. 它断开了 `contract-assert` 与 `mock-endpoint` 之间的依赖环。那个环让"哪个是测试
 *    基础设施、哪个是被测对象"变得说不清，而本仓库的整套结构论证都建立在
 *    "谁可以依赖谁"之上。
 *
 * 它是**结构化类型**：接入方可以直接传一个形状相同的对象，不必显式 `implements` 它。
 *
 * 它是纯类型，因此 `contract` 的零运行时依赖（R1）不受影响。
 */

/** 能力开关的表面：声明、查表与裁剪。 */
export type CapabilitySurface = {
  /** 接入方声明的能力集，取值不可信。 */
  readonly declaredCapabilities: readonly string[]
  /**
   * 按方法名查所需的能力。
   *
   * @param method - 指令方法名，来自外部输入。
   * @returns 需要的能力；该方法不是可选指令时为 `undefined`。
   */
  capabilityOf(method: string): string | undefined
  /**
   * 把声明的能力集裁剪为契约已知的部分。
   *
   * @param declared - 能力 id 列表，取值不可信。
   * @returns 其中被契约认可的部分。
   */
  knownCapabilities(declared: readonly string[]): readonly string[]
}
