# Issue tracker: split by concern

Decided 2026-10-01. This repo runs **two** backends and they do different jobs. Before this decision, `AGENTS.md` contained two contradictory `### Issue tracker` blocks — one pointing here for local markdown, one for GitHub — while this file backed only the second, so the local convention was documented nowhere.

| Concern | Home | Authority |
|---|---|---|
| **Execution tracking** — what is open, who owns it, what blocks what | **GitHub Issues**, via `gh` CLI | The single source of truth for status |
| **Specification & decisions** — specs, contracts, local design records | **Local markdown** under `.scratch/<feature-slug>/` and `docs/` | The single source of truth for what things *are* |

Neither is a fallback for the other. If they disagree about whether something is done, **GitHub wins on status**, and the local doc must be corrected.

## Identifier scheme

There is exactly **one** identifier scheme in this repo: the GitHub issue number, written `#31`.

Two legacy schemes still appear in historical files and are **read-only**:

| Legacy form | Where | Status |
|---|---|---|
| `NN-<slug>.md` | `.scratch/<feature-slug>/issues/` | historical local spec docs; **never cite as a work item** |
| `[ID] [P?] [Story]` | `.specify/templates/tasks-template.md`, `specs/00N/` | frozen product directory; never produces new work items |

See `GLOSSARY.md` Part 2 §2.1 for the term definitions (Issue / Ticket / Local Spec Doc).

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Triage labels live here, not in local frontmatter

The five canonical labels are **GitHub labels**. 74 files under `.scratch/*/issues/` carry a `status: ready-for-agent`-style frontmatter field; that field is **legacy and carries no authority** — no tool reads it, and it must not be used to decide whether work is ready. Read the GitHub label instead.

New local spec docs must **not** carry a triage status in frontmatter.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(`/triage` reads this flag.)_

If this ever flips to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a **GitHub issue**. Publishing a *specification* means creating a local markdown doc under `docs/`, not an issue — say which one you mean.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`. A ticket is a GitHub issue; there is no other meaning.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
