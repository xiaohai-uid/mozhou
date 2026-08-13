# oh-story vendor snapshot

This directory is a local vendor snapshot of the 13 installed oh-story skill
packages used as product reference material. It is intentionally kept
separate from application runtime code. Runtime behavior must go through the
native adapters in `app/lib/story/capabilities.ts` and the corresponding API
routes; a copied prompt or script is not evidence that a product capability is
available.

Source: `https://github.com/worldwonderer/oh-story-claudecode`

Pinned upstream commit: `1eae178058ce41962de0d465147965af891479dc`

Retrieved as a local snapshot on 2026-08-13. The upstream MIT license is
preserved in `LICENSE`.

The original local installation was `C:\Users\a1691\.agents\skills`.

Packages:

- story
- story-cover
- story-deslop
- story-import
- story-long-analyze
- story-long-scan
- story-long-write
- story-review
- story-setup
- story-short-analyze
- story-short-scan
- story-short-write
- storyrepo

The snapshot excludes interpreter caches and VCS metadata. Provider-dependent
and external-source-dependent features remain explicitly marked as such by the
capability registry and never fall back to invented production data.
