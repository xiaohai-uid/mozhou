# Domain Docs

How the engineering skills consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root — the single terminology authority.
- **`docs/architecture.md`** — the ordered map: composition, core packages, dependency cycles, seams, extension points. **Generated, do not hand-edit.**
- **`docs/adr/`** — read the ADRs that touch the area you're about to work in. Start at `docs/adr/INDEX.md`; note the `K-` / `A-` series prefixes, which disambiguate the two lineages that were merged in 2026-09.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

> **Historical note**: this repo is **single-context**. `GLOSSARY-MAP.md`, `CONTEXT-MAP.md`, and per-context `src/<context>/docs/adr/` do not exist and are not expected. This repo previously used `CONTEXT.md`; it was superseded by `GLOSSARY.md` on 2026-10-01. References to `CONTEXT.md` in files written before that date mean `GLOSSARY.md`.

## File structure

```
/
├── GLOSSARY.md                  ← terminology authority
├── docs/
│   ├── architecture.md          ← ordered map (generated)
│   └── adr/
│       ├── INDEX.md             ← decision map: what was decided, what is still open
│       └── NNNN-<slug>.md       ← one decision each
└── apps/ , packages/
```

## Use the glossary's vocabulary

When your output names a domain concept — in an issue title, a refactor proposal, a hypothesis, a test name, a commit message — use the term **as defined in `GLOSSARY.md`**, with its canonical Chinese name. Don't drift to synonyms the glossary explicitly lists under `_Avoid_`.

Two rules that are easy to get wrong:

- **A term without its qualifier is a defect.** The glossary registers several words that carry more than one meaning in this repo (gate, contract, task, slice, workbench). Every one of them must be written with its qualifier — `Continuity Gate` not `gate`, `BFF contract` not `contract`, `Vertical Slice` not `slice`. See `GLOSSARY.md` Part 2.
- **A word the glossary doesn't define may not carry a project-specific meaning.** If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an accepted ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-NNNN (<title>) — but worth reopening because…_

Quote the real title. Never cite a number you haven't opened; the `0001`–`0007` range exists in two lineages (`K-` and `A-`) and a bare number is ambiguous. See `docs/adr/INDEX.md`.
