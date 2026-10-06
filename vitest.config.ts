import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * 平台核心测试入口。渠道客户端（apps/web）使用独立的 vitest.web.config.ts，
 * 两者绝不互相覆盖 —— 见设计文档 §7.1。
 */
export default defineConfig({
  resolve: {
    alias: [
      // 门禁平面：一律解析到 packages/*/src，绝不读产物目录。
      {
        find: /^@waygate\/([^/]+)$/u,
        replacement: `${root}packages/$1/src/index.ts`,
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['packages/*/src/**/*.ts', 'scripts/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        // `*.types.ts` 只包含类型，`index.ts` 只做 re-export，两者编译后都没有
        // 可执行语句，纳入覆盖率只会得到恒为 0 的假缺口。两条约定都由
        // scripts/check-boundaries.ts 强制，所以排除它们是安全的。
        '**/*.types.ts',
        '**/index.ts',
      ],
      thresholds: {
        // 契约层最严：逐文件 100%（设计文档 §7.2）。
        // 其余层不设逐文件门槛，但覆盖率报告仍然产出，供评审时查看。
        perFile: true,
        'packages/{contract,frame,crypto}/src/**/*.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
})
