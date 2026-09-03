import { describe, expect, it, vi } from 'vitest'
import { createApiClient, MoZhouApiClient } from './client'
import * as postModule from '../lib/post'

describe('MoZhouApiClient', () => {
  it('instantiates cleanly with or without root', () => {
    const clientWithoutRoot = createApiClient()
    expect(clientWithoutRoot.root).toBeNull()

    const clientWithRoot = createApiClient('/test/book/root')
    expect(clientWithRoot.root).toBe('/test/book/root')
  });

  it('throws error when calling root-requiring methods without root', () => {
    const client = createApiClient(null)
    expect(() => client.getStoryBrainFacts()).toThrow(/root is required/)
    expect(() => client.getWorks()).toThrow(/root is required/)
    expect(() => client.getChangeMatrix()).toThrow(/root is required/)
  });


  it('delegates to post with correct endpoint and wrapped payload', async () => {
    const postSpy = vi.spyOn(postModule, 'post').mockResolvedValue({ ok: true })
    const client = new MoZhouApiClient({ root: '/mock/book' })

    await client.getStoryBrainFacts({ entityIds: ['char:lin'] })
    expect(postSpy).toHaveBeenCalledWith('/api/story-brain.facts', {
      root: '/mock/book',
      entityIds: ['char:lin'],
    })

    await client.getWorks()
    expect(postSpy).toHaveBeenCalledWith('/api/works', {
      root: '/mock/book',
    })

    await client.getCapabilities()
    expect(postSpy).toHaveBeenCalledWith('/api/capabilities', {})

    postSpy.mockRestore()
  });
});
