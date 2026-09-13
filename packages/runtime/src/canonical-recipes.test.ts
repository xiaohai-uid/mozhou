import { describe, expect, it } from 'vitest'
import { createDraftRecipe } from './canonical-recipes.js'

describe('createDraftRecipe', () => {
  it('uses the caller-supplied canonical prose path as the authority state', () => {
    const recipe = createDraftRecipe({ proseRelPath: '正文/第一卷/第0007章.md' })
    expect(recipe.id).toBe('chapter-drafting')
    expect(recipe.recipeVersion).toBe('0.1.1')
    expect(recipe.source).toMatchObject({ repo: 'original', license: 'original' })
    expect(recipe.taskType).toBe('CHAPTER_DRAFTING')
    expect(recipe.trackingGate.authorityState).toBe('正文/第一卷/第0007章.md')
    expect(recipe.contextBudget.hotContextBytes).toBe(48_000)
  })

  it('rejects an empty prose path instead of inventing a second path convention', () => {
    expect(() => createDraftRecipe({ proseRelPath: '' })).toThrow(/proseRelPath/)
  })
})
