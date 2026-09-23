# Novel OS Design System

> Project scope: `/mnt/c/zcode/novel-ai/apps/web`
>
> Design language: Night Manuscript Studio / 夜墨创作台
>
> This document is the project-specific design contract for Novel OS 2.0. It is a design and agent specification, not a claim that every described component or state is already implemented.

## 2026-09-21 approved visual overlay

This section is the current visual baseline approved for the desktop product. It supersedes older visual-token and shell-geometry values later in this document where they conflict, while all domain, truthfulness, author-sovereignty, Candidate → Active Draft → Quality Gate → Chapter Commit, accessibility, and failure-state contracts remain in force.

- **Product posture:** a serious AI novel-production workbench, not a generic dashboard, chat app, or image-generation studio. Runtime image generation is not part of the writing UI.
- **Visual thesis:** deep night-ink surfaces, paper-white prose, champagne-gold author decisions, muted jade AI/system evidence, fine structural hairlines, and restrained atmospheric depth.
- **Hierarchy:** manuscript first, real chapter dock second, compact persistent AI production rail third, Inspector evidence always available. The AI rail uses the real flow: intent → candidate → author accept → quality/commit evidence.
- **Typography signature:** controls and navigation stay coherent sans; prose and chapter titles use serif; revisions/hashes/evidence use mono; a small number of literary signatures may use the local Kaiti stack `--literary-accent`. This selective mismatch is intentional and must remain rare.
- **Desktop shell:** default `184px minmax(700px, 1fr) 330px`, compact desktop `170px minmax(650px, 1fr) 300px`; the Workbench itself nests a 202px chapter dock, reduced to 184px in compact desktop.
- **Current live tokens:** `--background #080b11`, `--foreground #f1ede6`, `--accent #cda56d`, `--accent-strong #e8c58f`, `--surface #10151d`, `--surface-2 #151c26`, `--surface-3 #1a222e`, `--jade #7fb5b2`.
- **Cost rule:** atmosphere comes from CSS, typography, layout, and bundled/local assets. Do not add runtime image-generation calls merely for visual decoration.
- **Local code graph:** 工具箱 → 开发 · Local → 代码图谱 exposes a read-only GitNexus snapshot. Architecture/process browsing reuses the exported Community/Process data; the code-node view shows indexed file locations and directed, typed CodeRelation records with search, type filters, and incremental browsing. Aggregated community links mean shared execution flows, not direct calls. The UI explicitly labels this as a timestamped snapshot, not a live connection. Refresh using `node .gitnexus/run.cjs analyze --index-only` followed by `pnpm graph:snapshot`; the view is lazy-loaded and never shells out from the browser or gains repository write access. Node/relationship data is generated, never manually invented.
- **Density rule:** do not surface every capability simultaneously. Keep the primary writing decision visible and move secondary capabilities into existing Inspector/toolbox structures rather than adding dashboard cards.

## Source of truth and current boundary

When a design decision is made, use this order of authority:

1. Product vocabulary and domain rules in `/mnt/c/zcode/novel-ai/CONTEXT.md` and `/mnt/c/zcode/novel-ai/AGENTS.md`.
2. Accepted product baseline in `/mnt/c/zcode/novel-ai/docs/adr/0027-ui-baseline-ink-orbit.md`.
3. Live Ink Orbit tokens and component rules in `/mnt/c/zcode/novel-ai/apps/web/src/styles/globals.css` and `/mnt/c/zcode/novel-ai/apps/web/src/styles/ink-orbit.css`.
4. Real interaction and data semantics in the current React components.
5. The reference roles described in this document.

The current web surface is a Vite + React shell with a top bar, five channel groups, an eight-stage pipeline strip, a central Workbench, an Inspector Tower, an Ink background, and a real Quality Panel. The Workbench also exposes the current create-book, Story Brain entity, and ledger flows. Several channels and Inspector tabs are explicit placeholders. The design system must not make a placeholder look available or imply that a future T41/T42/T43/T44 slice has shipped.

The mainline UI is desktop-first and dark-only. The current shell uses view state and local storage rather than a route library. This document does not authorize a route migration, a mobile redesign, a component-library migration, a dependency install, or a source refactor.

## 1. Product Character

Novel OS is a writing instrument with an inspectable AI production system around it. Ink Orbit should feel like a quiet, precise night-work instrument: deep ink surfaces, a narrow purple energy line, paper-white text, controlled density, and enough technical evidence for an author to understand what the system did.

The product is not an admin dashboard, a generic chat shell, or a marketing landing page. The manuscript and the author's intent remain primary. Pipeline, Quality Gate, Story Brain, Context Receipt / 装配看板, and 变更矩阵 provide traceability around the work; they do not compete with or silently rewrite it.

The emotional balance is:

- literary enough for chapters, scenes, prose, and narrative promises;
- operational enough for stages, receipts, revisions, failures, and replay inputs;
- restrained enough that atmosphere never hides a state, action, or piece of author content.

## 2. Design Principles

1. **Author sovereignty first.** Protected author content is never silently overwritten. AI output is a candidate until the author explicitly accepts it, and acceptance is distinct from durable Chapter Commit.
2. **Content before chrome.** Writing, chapter context, and the next meaningful author decision receive the strongest hierarchy. Decorative atmosphere must yield to readable content.
3. **Evidence over implication.** Quality, provenance, current/stale status, revision, hash, blocking failures, and advisories are explicit. A successful request or a spinner is not proof of a committed result.
4. **One controlled visual language.** Use the existing Ink Orbit tokens and surface ladder. Do not introduce a second palette, radius family, shadow language, or typography system beside the live CSS.
5. **Dense, calm hierarchy.** The shell may be information-dense, but groups, separators, labels, and whitespace must make scan order obvious. Density is not visual noise.
6. **State is part of the product.** Idle, thinking, streaming, tool-running, waiting-for-user, candidate, accepted, rejected, failed, retryable, blocked, and committed are different states with different affordances.
7. **Progress must be reversible and legible.** Pipeline and AI actions are interruptible where possible, show their current stage, and never auto-promote a candidate or auto-apply rework without an explicit contract.
8. **Build from contracts.** UI consumes explicit typed contracts, preserves domain vocabulary, and makes unavailable capabilities visible instead of fabricating availability.

## 3. Visual Foundation

### 3.1 Color and surfaces

The following values are the existing Ink Orbit tokens from `/mnt/c/zcode/novel-ai/apps/web/src/styles/globals.css`. They are the current source of truth.

| Role | Existing token | Current value | Use |
| --- | --- | --- | --- |
| Canvas background | `--background` | `#0b0a0f` | Global ink canvas and page background |
| Primary text | `--foreground` | `#f4f1fa` | Paper-white content and high-priority labels |
| Purple accent | `--accent` | `#8b78ff` | Focus, energy line, selected emphasis, restrained action accent |
| Strong accent | `--accent-strong` | `#9d8eff` | Focus ring and high-contrast purple detail |
| Soft accent | `--accent-soft` | `rgba(139,120,255,0.12)` | Active/selected fill and low-noise emphasis |
| Base surface | `--surface` | `#15131a` | Shell panels and primary containers |
| Elevated surface | `--surface-2` | `#282330` | Controls, active tabs, and raised interaction surfaces |
| Alternate surface | `--surface-3` | `#1d1923` | Inputs and quiet controls |
| Raised card | `--surface-raised` | `#211c29` | Hover/raised state and focused secondary surfaces |
| Sunken surface | `--surface-sunken` | `#100e14` | Recessed regions and contrast against a panel |
| Hairline | `--hairline` | `rgba(244,241,250,0.1)` | Default separators and fine borders |
| Strong hairline | `--hairline-strong` | `rgba(244,241,250,0.16)` | Focused or emphasized boundaries |
| Muted text | `--text-muted` | `#aba4b8` | Secondary labels and supporting copy |
| Faint text | `--text-faint` | `#7c7487` | Tertiary metadata and quiet affordances |
| Danger | `--danger` | `#f28b9b` | Blocking failure, error, refusal |
| Success | `--success` | `#80d6b0` | Completed/pass/verified state |
| Warning | `--warning` | `#e4b875` | Advisory, stale, or needs-attention state |
| Ink shadow | `--shadow-ink` | `rgba(0,0,0,0.36)` | Existing restrained depth only |

Use the semantic color slots exposed by the existing Tailwind v4 theme mapping. Do not add arbitrary hex values or parallel `--color-*`, `--space-*`, or `--radius-*` systems to solve a local styling problem. Purple is an energy and focus signal, not the fill color for every button. The current `.btn-primary` is foreground on a light surface; preserve that behavior unless a later product decision changes the token contract.

Every semantic status must have a text label, icon/shape, or structural cue in addition to color. `PASS`, `NEEDS REWORK`, and `REFUSED` are product meanings, not merely color variants.

### 3.2 Typography

Novel OS uses a dual reading system with a technical third face:

| Context | Existing token | Current stack | Rule |
| --- | --- | --- | --- |
| Dense UI and operations | `--sans` / `--font-sans` | `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"`, `"PingFang SC"`, `"Microsoft YaHei"`, `"微软雅黑"`, sans-serif | Navigation, controls, metadata, pipeline, inspector, errors |
| Literary content | `--serif` / `--font-serif` | `"Songti SC"`, `"STSong"`, `"SimSun"`, serif | Chapter title, prose, scene text, narrative-facing reading |
| Technical evidence | `--mono` / `--font-mono` | `"SFMono-Regular"`, `Consolas`, `"Liberation Mono"`, monospace | Hashes, revisions, event IDs, logs, machine-readable values |

Do not replace the serif/sans distinction with one universal UI font. Do not use mono for ordinary prose. Font availability and final rendering are runtime concerns; this document records the existing stacks and requires visual verification when a browser is available.

### 3.3 Spacing and density

There is no standalone spacing-token variable family in the current CSS. Tailwind's existing 4px scale is the measurement reference, not permission to create new CSS variables:

| Reference unit | Pixel value |
| --- | ---: |
| `1` | 4px |
| `2` | 8px |
| `3` | 12px |
| `4` | 16px |
| `5` | 20px |
| `6` | 24px |
| `7` | 28px |
| `8` | 32px |

Current Ink Orbit geometry includes measured values such as 5px pipeline gaps, 7px/8px compact controls, 9px tab and button radii, 10px/14px/15px/16px/18px/19px/24px padding or shell values, and 1px grid gutters. When matching existing components, reuse their actual values instead of rounding everything into a new scale. A new recurring spacing value requires an explicit token decision and a corresponding source change in a later implementation phase.

### 3.4 Radius, borders, and depth

- Existing radius tokens are `--radius-sm: 0.5rem`, `--radius-md: 0.75rem`, and `--radius-lg: 1rem`.
- Existing controls and tabs use compact 8px/9px geometry; the composer uses a 19px outer shell and 15px inner control. These are component-specific current values, not a new radius scale.
- Use `--hairline` for normal separation and `--hairline-strong` for an emphasized boundary. Borders should clarify grouping, not outline every text block.
- Use the ink shadow sparingly. The current design is material and hairline-led; it is not a glassmorphism system. Avoid stacked shadows, glow halos, gradients, and blur that reduce text or state legibility.
- Raised surfaces come primarily from the surface ladder and a hairline. A nested rounded card inside a rounded card is an exception that needs a clear hierarchy reason.

### 3.5 Opacity, layering, and elevation

Existing atmospheric and state opacities are role-specific:

- top bar background uses a near-opaque black layer (`rgba(0,0,0,0.95)`);
- `.ink-canvas` is a background layer at `opacity: 0.74`;
- `.app-grain::after` is a non-interactive texture layer at `opacity: 0.045`;
- disabled controls use `opacity: 0.45`;
- reduced-motion mode lowers the ink canvas to `opacity: 0.55`.

Existing stacking evidence is `.ink-canvas` at `z-index: 0`, the application shell above it, and the grain layer at `z-index: 8` with `pointer-events: none`. Do not add a layer merely for visual drama. Future menus, popovers, sheets, and modals must declare an intentional overlay layer, preserve reading and keyboard order, and never let texture or atmosphere cover content.

## 4. Layout System

### 4.1 Shell anatomy

The current `.app` grid is the canonical desktop shell:

```text
columns: 228px minmax(610px, 1fr) 356px
rows:    62px 54px minmax(0, 1fr)
gap:     1px
minimum: 1180px wide, 100dvh tall
```

The regions are:

1. **TopBar.** Brand seal, `墨舟 NOVEL OS 2.0`, book switch, capability registry/search/command affordances, and local-ready status. Disabled capabilities must remain visibly and semantically disabled.
2. **Left channel rail.** Five groups and their 17 current navigation items: 创作, 检视 · Novel OS, 工作流, 资源, and 账户. The rail is a work context switcher, not a decorative sidebar.
3. **Pipeline strip.** Eight stages: `prepare`, `compile`, `draft`, `review`, `extract`, `continuity`, `proposal`, and `commit`. It provides position and status, not a promise that every stage is executable.
4. **Workbench.** The central chapter/work area. Current flows include create book, Story Brain entity grid, ledger refresh, explicit empty/error states, and an honest disabled composer placeholder.
5. **Inspector Tower.** Four tabs: Quality Gate, Story Brain, 装配看板 / Context Receipt, and 变更矩阵. Quality Gate is real in the current shell; the other views remain explicit placeholders until their contracts exist.

Use direct alignment between the pipeline, Workbench, and Inspector. The 1px gutters and hairlines are structural; do not replace them with ornamental separators.

### 4.2 Viewports and density

- **1440px and above:** default acceptance viewport. Keep the three-column shell visible, maintain a readable Workbench, and preserve the Inspector's evidence hierarchy.
- **1280px:** current fallback is `208px minmax(590px, 1fr) 330px`; pipeline labels hide while the stage strip remains. Message bubbles may use the current `84%` maximum at this breakpoint.
- **Below the current desktop contract:** the source defines a minimum shell width of 1180px and no mobile media query. Behavior below that range is `UNKNOWN` and is not an acceptance target in ADR-0027.

The current product is desktop-first. Do not fake a mobile layout by squeezing or clipping the three-column shell. A mobile or narrow-window contract must be separately designed, approved, and tested; it is not implied by this document.

### 4.3 Navigation and availability

The current navigation is a view-state model backed by local storage, not a route-library contract. The full channel taxonomy is visible so the product's scope is legible, but unimplemented items must use the existing explicit placeholder language (`未实现 · 显式占位`) and must not simulate results, editors, AI agents, or cloud availability.

## 5. Component Language

### 5.1 Shared state contract

Unless a component row below overrides it, every interactive component must define these states:

| State | Visual behavior | Semantic behavior |
| --- | --- | --- |
| Default | Quiet surface/hairline hierarchy; readable label | Available and idle |
| Hover | Small surface or hairline lift; no glow or layout jump | Pointer affordance only; never the sole access path |
| Active/pressed | Clear pressed surface or one-pixel movement consistent with current `.btn` behavior | Action is being invoked |
| Selected | `--accent-soft`, active surface, label, or structural marker | Persistent view/filter/tab choice |
| Focus | Existing 2px `--accent-strong` outline with 2px offset | Keyboard focus is visible and retained |
| Disabled | Existing lower-emphasis treatment, currently `opacity: 0.45` where applicable | Not actionable; explain unavailable capability when useful |
| Loading | In-place progress/state label; preserve context and dimensions | Action is pending; prevent duplicate invocation when required |
| Error | Danger token plus explicit message and recovery affordance | Failure is actionable or clearly terminal; do not silently fall back |

States must not rely on hover, color, or animation alone. A state change must remain understandable to keyboard users, screen readers, reduced-motion users, and users who cannot distinguish the semantic colors.

### 5.2 Component rules

All rows inherit the shared state contract above. Components marked “future” are design rules for later slices, not evidence that the component exists today.

| Component | Default and interaction language | Selected/focus/disabled/loading/error rules |
| --- | --- | --- |
| **Button** | Use the existing `.btn` for secondary actions and `.btn-primary` only for the highest-priority action in a region. Hover may raise the surface by 1px as current CSS does. | Keep the visible focus ring; preserve disabled semantics; loading keeps the label context and prevents accidental duplicate action; errors belong next to the action, not only in a toast. |
| **Icon Button** | Quiet control with a single, meaningful icon. Current icon strategy is not a dependency-backed library. | Every action icon needs an accessible name; selected state needs a persistent marker; disabled and loading states need accessible text/state, not a disappearing glyph. |
| **Input** | Use `.control` geometry and the existing surface-3/hairline language. Labels and supporting text stay associated. | Focus uses the current ring; disabled is truly inert; loading preserves typed input; error adds text and `aria-invalid`/described-by semantics where applicable. |
| **Textarea** | Use the current composer/control treatment for writing input. Preserve user text during pending work. | A disabled composer must say why it is unavailable; streaming or tool-running must not erase text; errors offer a retry or recovery path. |
| **Select** | Use a labeled control with an explicit current value; do not create a custom menu only for decoration. | Selected value is text-readable; focus/keyboard behavior is native or equivalently complete; loading and error states retain the field label. |
| **Search** | Search is a distinct input purpose with a clear label and result status. Current TopBar search is disabled and must remain honest. | Empty, active, loading, no-result, and error messages are explicit; do not show fake search results for an unavailable capability. |
| **Card** | Use a surface and hairline to group related evidence or an action. Prefer one meaningful level of containment. | Selected cards need a structural mark; focusable cards use the same ring; loading/error occupies the same region and does not become a blank skeleton with no explanation. |
| **Panel** | Panels form the shell's stable regions. Use the surface ladder, direct alignment, and a clear heading. | Active panel/tab is visible; disabled future panel is an explicit placeholder; loading/error stays within the panel so the Inspector does not lose context. |
| **Badge** | Compact text label for category, count, or provenance; use the current tag language. | A status badge includes its meaning in text; selected/active badges remain distinct from success; loading/error never become color-only dots. |
| **Status** | Status is a semantic statement such as local-ready, current, stale, pass, or refused. | Pair color with label and shape/icon; status updates are announced when important; unavailable is not styled as success. |
| **Tabs** | Use the current four-tab Inspector structure. Active tab uses the active surface and an explicit selected state. | Preserve `role=tablist`, `role=tab`, `aria-selected`, and `role=tabpanel`; keyboard arrows/Home/End must work in future complete tab sets; inactive content is not presented as active. |
| **Popover** | Future anchored, lightweight context surface using an ink surface and hairline. | Opens from a focused control, supports Escape and outside dismissal where appropriate, returns focus, and never uses blur as its only separation. Loading/error is inside the popover when the action owns the state. |
| **Sheet** | Future side/bottom contextual surface for a focused task, not a replacement for the whole desktop shell. | Has a labeled region, scrim only when needed, focus containment, Escape, close control, and reduced-motion behavior. Never hide unsaved author content behind an unexplained sheet. |
| **Modal** | Future blocking confirmation or focused decision. Use only when the task cannot be safely inline. | Trap focus, label the dialog, provide explicit cancel/confirm, distinguish destructive/error decisions, and do not auto-confirm because a request succeeded. |
| **Tooltip** | Future short explanation for unfamiliar controls, never the only label or instruction. | Keyboard focus can reveal it; it is not interactive content; disabled controls need an alternate explanation if the reason matters. |
| **Menu** | Future command/action list with text, grouping, and keyboard navigation. | Selected item is marked; focus is roved or otherwise managed; unavailable items are disabled with honest semantics; menu errors do not silently close the invoking context. |
| **Table/List** | Use dense rows, hairlines, clear columns, and mono only for technical identifiers. Avoid turning every row into a rounded card. | Selected/current rows get a structural marker; loading preserves column context; empty and error states belong to the table/list region; keyboard navigation is specified when rows are actionable. |
| **Empty State** | Explain what is absent, why it is absent, and the one valid next action if one exists. Use the existing honest placeholder tone. | Never imply that a future capability has data; loading and empty are distinct; blocked empty states explain the missing prerequisite. |
| **Loading** | Use progress language appropriate to the operation. A small spinner is allowed for a short indeterminate wait, but not as the product's only state model. | Preserve the user's context and input; name the stage/tool when known; do not present skeleton data as real data. |
| **Error** | Inline danger treatment with a concise cause and next step. Current `.wb-error`, QualityPanel alert, and explicit refusal semantics are the baseline. | Use `role=alert` for urgent inline errors; distinguish failed, refused, blocked, and retryable; keep the original author content and evidence visible. |
| **Toast** | Future transient confirmation for low-risk, non-blocking feedback only. Do not use it for Quality Gate failures or important author decisions. | Include text and semantic role; allow dismissal; do not vanish before the user can understand a critical result; reduced motion removes movement, not meaning. |
| **Command** | Future keyboard command surface. Current TopBar command panel is disabled. | Must have discoverable keyboard access, search/no-result/loading/error states, focus management, and honest unavailable commands; do not advertise commands that have no implementation contract. |

## 6. AI Interaction States

AI state is a product contract. It is not a generic spinner with a changing label.

| State | Meaning | Required presentation and action |
| --- | --- | --- |
| **Idle** | No AI work is running | Show the available next action and the current context; do not imply a hidden task. |
| **Thinking** | Model is reasoning without a user-visible stream | Use a restrained in-place progress indicator and a clear operation label; preserve the Workbench and author input. |
| **Streaming** | Partial text or structured output is arriving | Show live output with a stable insertion point/caret and a streaming label; do not replace the state with an indeterminate spinner. |
| **Tool-running** | An external/local tool or pipeline stage is executing | Name the tool/stage where known, show progress or pending status, and expose cancellation/retry only when the contract supports it. |
| **Waiting-for-user** | The system needs author input or approval | Make the question and the required choice prominent; pause progress rather than pretending to be busy. |
| **Candidate** | AI output exists but is not canonical | Separate it from committed prose, label it as candidate/proposal, show provenance/context, and provide explicit accept/reject/revise actions. |
| **Accepted** | The author accepted a candidate into the active working state | Show acceptance as a state transition, but do not call it committed until Chapter Commit succeeds. |
| **Rejected** | The author declined a candidate | Preserve the decision/history where the contract supports it; do not silently regenerate or overwrite author text. |
| **Failed** | The operation ended unsuccessfully | Show cause/evidence if available, preserve input, and give a specific recovery action or terminal explanation. |
| **Retryable** | Failure may be retried without changing author intent | Make retry explicit, keep the failed evidence visible, prevent duplicate attempts while retrying, and distinguish retry from automatic looping. |
| **Blocked** | A prerequisite, provider, contract, permission, or safety rule prevents progress | State the blocker and missing prerequisite; do not present a disabled action as an active capability or fabricate a result. |
| **Committed** | Chapter Commit or another durable domain commit succeeded | Show the durable revision/state clearly, with verification metadata when available. Committed is stronger than accepted and must not be inferred from UI optimism. |

The domain transition remains `Candidate → Approval → Commit`. Author sovereignty rules from the current QualityPanel remain binding: pass does not auto-act, rework is applied only explicitly, corrections are recorded explicitly, and no automatic rework loop is implied.

## 7. Pipeline / Quality Semantics

### 7.1 Pipeline stages

The visible pipeline order is fixed by the accepted baseline:

`prepare → compile → draft → review → extract → continuity → proposal → commit`

The strip communicates where the active work is and what has been completed. It must not imply that a stage is executable when the corresponding view or contract is a placeholder.

### 7.2 Stage status language

| Status | Meaning | Visual language |
| --- | --- | --- |
| **Completed** | Stage finished and its result is available/verified | Existing success treatment and a readable completed marker; do not hide the result behind animation. |
| **Active** | Stage is currently processing or selected as current | Existing accent-soft/foreground treatment; show the stage name and current operation. |
| **Warning** | Stage completed with advisory, stale, or needs-attention information | Warning color plus text and the affected evidence. |
| **Failed** | Stage attempted and ended unsuccessfully | Danger treatment, explicit cause, and retry/recovery when valid. |
| **Blocked** | Stage cannot start or continue because a prerequisite is absent | Explicit blocker and prerequisite; do not style it as merely idle or completed. |

### 7.3 Quality and Inspector priority

The Inspector display priority is:

1. Blocking or critical Quality Gate failure.
2. Failed operation or stage.
3. Waiting-for-user decision or candidate approval.
4. Stale/current warning and advisories.
5. Active tool/stage progress.
6. Pass, accepted, and committed confirmation.

Quality Gate is the first Inspector tab because it answers whether the current output can proceed. It must not bury blocking failures under a passive success banner. `QualityPanel` currently distinguishes `PASS`, `NEEDS REWORK`, and `REFUSED`, tracks current/stale information, rework count, hash/revision, blocking failures, advisories, and explicit actions. Preserve those meanings.

Use the domain term **Context Receipt** and the Chinese label **装配看板**. Do not rename it to “Context Viewer” in UI copy or agent instructions. If there is no book or no receipt contract, show the existing empty/placeholder state rather than a fabricated context graph.

## 8. Writing Experience

- Prose is not dashboard data. Give actual chapter and scene text the serif treatment; keep controls, navigation, status, and evidence in sans; keep hashes and IDs in mono.
- The intended reading measure for a future dedicated editor is approximately 60–75 characters (`ch`) per line, subject to Chinese typography and actual viewport validation. The current Workbench does not yet constitute a full prose editor, so this is a design target, not a runtime claim.
- Use generous line height for prose. The current message/prose treatment is approximately `1.72`, while the composer is approximately `1.55`; preserve the distinction and do not globally compress literary text to dashboard density.
- Paragraphs need rhythm through line height and measured vertical spacing, not a card around every paragraph. Avoid a stack of nested rounded containers around a chapter.
- Selection and insertion must remain visible against the ink surfaces. Never use purple glow or animation as the only indication of an AI insertion.
- AI proposals are separate from committed prose: label them as candidate/proposal, give them a hairline or surface distinction, and expose accept/reject/revise actions.
- Changes and diffs need semantic text such as added, removed, changed, stale, or impacted. Use color plus markers/labels/structure; do not encode additions or removals by color alone.
- Accepted content may enter the active draft, but it is not durable until Chapter Commit is verified. A commit confirmation should be calm, explicit, and stronger than an optimistic local state.
- Protected Author Content, replay inputs, stale markers, Context Receipt, and Write Verification are part of the writing experience's trust model. Do not hide them merely to make the screen look cleaner.

## 9. Motion

The current motion foundation is `--ease: cubic-bezier(0.16, 1, 0.3, 1)`, with existing transition/animation values around `.26s`, `.28s`, `.4s`, `.55s`, and `.7s`. Reuse these rhythms before adding new ones.

- Micro interactions should normally land in roughly 180–280ms and remain interruptible.
- Pipeline/status changes may use a restrained short transition; the status label and structural marker must update without waiting for the animation.
- Panel entry may use the existing `panelin` treatment. Existing `rise`/`panelin` animations are for controlled entry, not perpetual ambience.
- Future sheets and popovers should use opacity/transform with clear origin and focus management. Modals need a readable scrim and no dependency on backdrop blur.
- Streaming uses an insertion caret/live text treatment; tool-running may use progress; neither should be represented only by a generic spinner.
- Do not use layout-shifting animation for hover. Do not animate protected prose or critical error text in a way that makes it hard to inspect or copy.
- Users must be able to interrupt or supersede nonessential transitions. Motion must never be required to understand Quality Gate, pipeline, candidate, blocked, or committed state.
- The existing reduced-motion rule disables animation/transition by reducing them to `0.001ms`, sets scroll behavior to `auto`, and reduces ink canvas opacity to `.55`. Preserve that intent for all future motion; remove movement, not semantic feedback.

## 10. Icons

There is no icon-library dependency in `/mnt/c/zcode/novel-ai/apps/web/package.json`. Do not install one during design-system work.

The current shell uses compact mono codes for navigation and existing semantic symbols/labels. Preserve that honest baseline. A future icon strategy may select one maintained library only after a separate dependency and accessibility decision. Do not mix multiple icon families, use emoji as product UI, or imitate a reference brand's glyphs.

Decorative icons are `aria-hidden`; action icons have an accessible name; status icons accompany status text. An icon is never the only carrier of a Quality Gate, pipeline, AI, or error meaning.

## 11. Responsive

Novel OS is desktop-first. The committed acceptance targets are 1440px and 1280px. At 1280px, use the existing compact column widths and hide pipeline labels as already defined by Ink Orbit CSS. Preserve the Workbench's readable minimum and the Inspector's priority.

There is no current mobile media query and mobile is outside the ADR-0027 acceptance scope. Do not add a fake mobile layout, arbitrary breakpoint behavior, clipped three-column content, or a “responsive” claim based only on CSS wrapping. If mobile becomes a product requirement, it needs a new interaction model, content-priority decision, and real browser verification.

## 12. Accessibility

- Use semantic HTML and the existing roles. The Inspector already establishes `tablist`, `tab`, `tabpanel`, and `aria-selected`; preserve the relationship.
- All keyboard-operable actions need a visible focus state. The current baseline is a 2px `--accent-strong` outline with a 2px offset.
- Focus order follows the task: book/context selection → navigation → pipeline/context → Workbench author content → Inspector evidence → secondary actions. Do not place a decorative layer in the keyboard order.
- Every form control has a visible or programmatically associated label. Every icon-only action has an accessible name.
- Error regions use semantic announcement where urgent; current Workbench and QualityPanel error patterns are the baseline. Do not announce every streaming token as an interruptive alert.
- Status, stage, candidate, accepted, rejected, blocked, and committed states must be represented with text and/or structure in addition to color.
- Check contrast against the actual dark surfaces, especially `--text-muted`, `--text-faint`, accent-soft fills, disabled controls, and danger/warning copy. Static source evidence does not substitute for rendered verification.
- Preserve user text, selection, and focus through loading, error, retry, and panel changes whenever the interaction contract permits it.
- Future modal, sheet, popover, and menu patterns must define Escape behavior, focus return, focus containment where needed, and outside-click semantics.
- Respect reduced motion and avoid hover-only or motion-only feedback.
- Compact desktop controls may use the current 36–38px geometry, but future touch targets and any mobile contract require an explicit target-size review rather than assuming desktop compactness is sufficient.

## 13. Do / Don't agent rules

### Do

- Read this file, `/mnt/c/zcode/novel-ai/AGENTS.md`, `/mnt/c/zcode/novel-ai/CONTEXT.md`, ADR-0027, and the relevant live component/style files before changing UI.
- Reuse the existing `globals.css` and `ink-orbit.css` tokens, class language, layout regions, and state semantics.
- Preserve the domain terms Author Intent, Active Draft, Candidate, Approval, Chapter Commit, Context Receipt / 装配看板, Quality Gate, Story Brain, Change Impact, Stale Marker, Protected Author Content, and Write Verification.
- Make unavailable, placeholder, stale, failed, refused, and blocked states explicit and honest.
- Use purple selectively for energy, focus, selection, and meaningful system emphasis.
- Keep the writing surface legible before optimizing decorative atmosphere.
- Implement one observable vertical slice at a time with its real typed contract and real states.
- Verify in a real browser at 1440px and 1280px, including keyboard focus and reduced motion, when the runtime is available.
- Keep unrelated dirty work intact and report evidence, unknowns, and rollback scope.

### Don't

- Do not copy Apple.com marketing layouts, hero sections, large empty whitespace, glass, gradients, or glow into the product UI.
- Do not copy Linear, Notion, Vercel, or Apple branding, palette, typography, or component source wholesale.
- Do not add a parallel token system, random hex colors, arbitrary radius/shadow families, or a second component language.
- Do not make every button purple or every surface a floating card.
- Do not turn every pending operation into a spinner or report success before verification.
- Do not make a placeholder look like a working editor, agent, search, cloud service, or command palette.
- Do not call the Context Receipt / 装配看板 “Context Viewer”.
- Do not auto-apply rework, auto-commit a candidate, or silently overwrite Protected Author Content.
- Do not use `any` to make UI state fit an unclear contract.
- Do not install dependencies, edit package manifests, modify the legacy `/mnt/c/zcode/novel-ai/app`, or expand scope without a separate authorization.

## 14. Brand Reference Boundary

The external collection at [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) is a reference catalog and an agent-oriented format, not a source of identity to copy. Its `DESIGN.md` files are public-site analyses, not complete application design specifications for Novel OS. The examples are used by role:

| Reference | Use as a limited reference for | Do not import |
| --- | --- | --- |
| [Linear analysis](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md) | **Linear-inspired reference / inferred interaction quality:** surface hierarchy, hairline, restrained accent, compact technical presentation, and status clarity | It is not a complete application Sidebar or Workbench specification; do not import Linear brand, exact colors, logo, or product shell |
| [Notion analysis](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/notion/DESIGN.md) | Content-priority inspiration only; long text, prose, serif, line length, paragraph rhythm, and chapter reading remain **Novel OS-defined Writing Experience rules** in §8 | Notion's source analysis covers public marketing/product surfaces, not a complete editor specification; do not import its hero, pastel card palette, broad marketing whitespace, or identity |
| [Vercel analysis](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/vercel/DESIGN.md) | A limited reference for technical feedback, Quality Gate, pipeline/status, logs/results, errors, and precise data surfaces | Black/white brand system, gradient language, or Vercel navigation clone |
| [Apple analysis](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/apple/DESIGN.md) | Interaction-quality reference only: focus/press quality, spacing discipline, sheet/popover behavior, transition restraint, and reduced-motion care | Apple.com marketing layouts, hero photography, oversized whitespace, glass, brand blue, or Apple UI clone |

The final product remains its own Ink Orbit system. When a reference conflicts with domain vocabulary, ADR-0027, or the live tokens, the local product constraint wins.

## 15. Agent Implementation Contract

Any future agent implementing UI in this project must:

1. Read this `DESIGN.md` completely before proposing or writing UI changes.
2. Read the relevant source components and styles, not just this document, and treat live source plus typed contracts as the implementation truth.
3. Work only within `/mnt/c/zcode/novel-ai/apps/web` unless a separate request explicitly expands the scope. The legacy `/mnt/c/zcode/novel-ai/app` is out of scope.
4. Reuse existing Ink Orbit tokens, classes, layout regions, and component semantics. Do not introduce parallel tokens or a new UI library as a shortcut.
5. Preserve the current domain vocabulary, author-sovereignty rules, explicit placeholders, and Candidate → Approval → Commit semantics.
6. Build one vertical slice with one observable behavior and its default, hover/active, selected, focus, disabled, loading, error, and relevant AI/pipeline states. Do not create speculative screens.
7. Keep UI contracts explicit and typed. Do not use `any`, silently coerce unknown data, or replace real failure handling with mock success.
8. Verify the slice in a real browser at 1440px and 1280px, including keyboard focus, error/blocked behavior, and reduced motion. If the runtime or browser is unavailable, report `BLOCKED` and do not install or repair dependencies without authorization.
9. Stop and ask for a decision when a proposed change conflicts with product domain rules, ADR-0027, author sovereignty, or this token contract. Do not resolve a conflict by silently copying a reference brand.
10. Report the exact files changed, validation evidence, remaining unknowns, and rollback scope. Do not commit or push unless separately authorized.
