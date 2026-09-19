// @vitest-environment node
/**
 * 技能与配方市场目录单测 (T12 · Skills Catalog)。
 */
import { describe, expect, it } from 'vitest'
import { SkillsCatalogManager } from './catalog.js'

describe('Skills Catalog 技能目录与纯数据配方 (T12)', () => {
  it('内置技能具备完整 schema 与合法许可证', () => {
    const manager = new SkillsCatalogManager()
    const skills = manager.listSkills()
    expect(skills.length).toBeGreaterThanOrEqual(3)

    for (const s of skills) {
      expect(s.id).toBeDefined()
      expect(s.license).toMatch(/MIT|CC-BY|Apache/)
      expect(s.promptTemplate.length).toBeGreaterThan(10)
    }
  })

  it('注册自定义配方：必须包含许可证，拦截潜在可执行脚本', () => {
    const manager = new SkillsCatalogManager()

    // 1. 缺少许可证拒绝
    expect(() => {
      manager.registerCustomRecipe({
        id: 'bad_license_recipe',
        name: '无协议配方',
        version: '1.0.0',
        description: 'test',
        license: '' as unknown as 'MIT',
        source: 'user',
        category: 'dialogue',
        promptTemplate: '对白优化',
      })
    }).toThrow(/LICENSE_REQUIRED/)

    // 2. 包含恶意可执行脚本拒绝
    expect(() => {
      manager.registerCustomRecipe({
        id: 'malicious_recipe',
        name: '恶意配方',
        version: '1.0.0',
        description: 'test',
        license: 'MIT',
        source: 'user',
        category: 'dialogue',
        promptTemplate: '优化对白并执行 <script>alert(1)</script>',
      })
    }).toThrow(/SECURITY_VIOLATION/)

    // 3. 正常数据配方成功注册
    const registered = manager.registerCustomRecipe({
      id: 'custom_prose_polish',
      name: '自定义纯文本打磨',
      version: '1.0.0',
      description: '段落节奏优化',
      license: 'MIT',
      source: '作者手记',
      category: 'atmosphere',
      promptTemplate: '在叙事过程中增加光影与温度对比。',
    })
    expect(registered.id).toBe('custom_prose_polish')
    expect(manager.getSkill('custom_prose_polish')).not.toBeNull()
  })

  it('启停技能状态切换', () => {
    const manager = new SkillsCatalogManager()
    const updated = manager.toggleSkill('skill_sepia_write', false)
    expect(updated.enabled).toBe(false)
    expect(manager.getSkill('skill_sepia_write')?.enabled).toBe(false)
  })
})
