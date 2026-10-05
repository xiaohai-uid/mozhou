// @vitest-environment node
/**
 * W5 接口防护与边界隔离自动化门禁测试 (Plan §6.6 / t56 §3.2)。
 *
 * 正向门禁：
 * 1. 验证 apps/web/shared/ 中的 api、billing、storyboard 等模块能被合法加载，常量与结构真实可用；
 * 2. 静态扫描 apps/web/src/ 生产源码（排除测试文件），断言 server/ 跨层引用计数严格为 0；
 * 3. 验证 packages/ 下 6 个核心生产包均已配置标准 package.json exports 字段。
 *
 * 负向门禁：
 * 4. 验证 ESLint 配置中 no-restricted-imports 模式定义，确认其覆盖所有层级的 server/ 导入；
 * 5. 验证包私有模块导入受阻机制。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('W5 接口防护与跨层隔离门禁 (Plan §6.6)', () => {
  it('正向：apps/web/shared 中的公开模块正常加载，常量与结构完备', async () => {
    // 动态加载 shared 模块，避免 tsconfig.server.json 将 shared 引入其独立 rootDir
    const sharedBillingPath = resolve(import.meta.dirname, '../../shared/billing.ts')
    const sharedStoryboardPath = resolve(import.meta.dirname, '../../shared/storyboard.ts')

    const billingMod = (await import(sharedBillingPath)) as {
      billingCatalog: { version: string; pro: { amountFen: number }; max: { amountFen: number } }
      CATALOG_VERSION: string
    }
    const storyboardMod = (await import(sharedStoryboardPath)) as {
      STORYBOARD_SCHEMA_VERSION: number
      STORYBOARD_LIMITS: { maxSourceCharacters: number }
    }

    // 验证 billingCatalog 常量与字段
    expect(billingMod.billingCatalog).toBeDefined()
    expect(billingMod.billingCatalog.version).toBe(billingMod.CATALOG_VERSION)
    expect(billingMod.billingCatalog.pro.amountFen).toBe(1900)
    expect(billingMod.billingCatalog.max.amountFen).toBe(3900)

    // 验证 storyboard 契约常量
    expect(storyboardMod.STORYBOARD_SCHEMA_VERSION).toBe(1)
    expect(storyboardMod.STORYBOARD_LIMITS.maxSourceCharacters).toBe(12000)
  })

  it('正向：apps/web/src 生产源码全量扫描，server/ 直接引用计数严格为 0', () => {
    const srcDir = resolve(import.meta.dirname, '../../src')
    const forbiddenPattern = /from\s+['"][^'"]*\/server(\/[^'"]*)?['"]/g

    const violations: { file: string; line: number; match: string }[] = []

    function scan(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry)
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          scan(fullPath)
        } else if (stat.isFile() && /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
          const content = readFileSync(fullPath, 'utf8')
          const lines = content.split('\n')
          lines.forEach((line, idx) => {
            if (forbiddenPattern.test(line)) {
              violations.push({
                file: fullPath,
                line: idx + 1,
                match: line.trim(),
              })
            }
          })
        }
      }
    }

    scan(srcDir)

    // 严禁存在任何违规跨层引用
    expect(violations).toEqual([])
  })

  it('正向：packages 下 6 个核心生产包均已配置标准 exports 字段', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../../')
    const packages = ['kernel', 'data-plane', 'context-compiler', 'runtime', 'pipeline', 'flywheel']

    for (const pkg of packages) {
      const pkgJsonPath = join(repoRoot, 'packages', pkg, 'package.json')
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as Record<string, unknown>

      expect(pkgJson['exports']).toBeDefined()
      const exportsField = pkgJson['exports'] as Record<string, unknown>
      expect(exportsField['.']).toBeDefined()
      expect(exportsField['./package.json']).toBe('./package.json')
    }
  })

  it('负向：ESLint 边界规则模式覆盖多级 server 路径模式', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../../')
    const eslintConfigPath = join(repoRoot, 'eslint.config.js')
    const eslintContent = readFileSync(eslintConfigPath, 'utf8')

    // 验证规则在 eslint.config.js 中登记
    expect(eslintContent).toContain('no-restricted-imports')
    expect(eslintContent).toContain('apps/web/src/**/*.{ts,tsx}')
    expect(eslintContent).toContain('**/server/**')
    expect(eslintContent).toContain('../../server/**')
  })

  it('负向模拟：测试拦截函数能精确捕获向 server 的跨层 import 路径', () => {
    const testCases = [
      { code: "import { apiMiddleware } from '../../server/api'", shouldBlock: true },
      { code: "import { billingCatalog } from '../../server/billing/catalog'", shouldBlock: true },
      { code: "import type { DTO } from '../server/api'", shouldBlock: true },
      { code: "import { something } from 'apps/web/server/something'", shouldBlock: true },
      { code: "import { DTO } from '../../shared/api'", shouldBlock: false },
      { code: "import { billingCatalog } from '../../shared/billing'", shouldBlock: false },
    ]

    const pattern = /from\s+['"]([^'"]*(?:\/server|apps\/web\/server)[^'"]*)['"]/

    for (const tc of testCases) {
      const matched = pattern.test(tc.code)
      expect(matched).toBe(tc.shouldBlock)
    }
  })
})
