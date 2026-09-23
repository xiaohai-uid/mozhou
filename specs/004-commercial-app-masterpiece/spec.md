# Feature Specification: Commercial-Grade Novel OS Masterpiece (004-commercial-app-masterpiece)

**Feature Code**: `004-commercial-app-masterpiece`  
**Status**: Ready for Implementation  
**Created**: 2026-09-03  
**Target Release**: MoZhou Novel OS v1.0.0 Commercial Desktop & Web Release  

---

## 1. Executive Summary & Vision

To establish **MoZhou Novel OS** as the premier end-to-end commercial AI novel writing application (desktop and web), bridging the gap between deep deterministic narrative integrity (causal state machines, 11 mechanical gates, De-AI 4-gram filters) and commercial-grade user delight (TipTap AST block editor, Tauri 2.0 cross-platform shell, bidirectional interactive canon matrices, and 1-click web novel genre style kits).

---

## 2. User Scenarios & Core Problems Solved

### 2.1 Problem 1: Textarea Latency & Lack of AST Structure
- **Current Limitation**: Raw textareas lack AST node blocks, making slash commands (`/`), inline annotations, and block-level dragging impossible.
- **Commercial Solution**: Integrate a TipTap/ProseMirror block-level AST editor with custom Chinese typography nodes, slash command menus, and real-time paragraph word count gutters.

### 2.2 Problem 2: Desktop Packaging Bloat & Memory Overhead
- **Current Limitation**: Bundling Node.js/Electron consumes 200MB+ installer size and 300MB RAM.
- **Commercial Solution**: Provide a Tauri 2.0 Rust desktop scaffold (`apps/desktop` or root Tauri binding) reducing binary footprint to <15MB with <40MB idle RAM and native WebView2 integration.

### 2.3 Problem 3: Static Visual Graph without Author Modification
- **Current Limitation**: `CanonGraphView` is read-only; authors cannot directly drag links between characters or click to add a new `CausalContract`.
- **Commercial Solution**: Upgrade the graph to bidirectional interaction, allowing authors to connect two entities, select contract templates (e.g. "生死之约", "师徒羁绊"), and automatically write back to local `设定/` Markdown directory cards.

### 2.4 Problem 4: Cold-Start Creative Friction
- **Current Limitation**: Writers have to manually configure genres and prompt rules.
- **Commercial Solution**: Deploy a **Genre Style Kit Hub** with 8 pre-loaded popular Chinese web novel presets (e.g. "番茄脑洞爆笑流", "传统修仙问心流", "灵异复苏伪装神明", "快穿系统反套路", "都市异能打脸流"), featuring one-click seed generation.

---

## 3. Functional Requirements

### 3.1 Module 1: TipTap/ProseMirror AST Block Editor Engine
- **FR-1.1 Slash Commands (`/`)**: Typing `/` at the start of any block pops up an inline action menu:
  - `/scene` (插入场景切分标记)
  - `/character` (插入/提及正典角色卡)
  - `/beat` (插入大纲节拍引导)
  - `/rewrite` (AI 智能扩写与润色)
- **FR-1.2 Paragraph Typography Node**: Custom NodeView ensuring automatic Chinese full-width 2-em indentation without breaking Markdown tags.
- **FR-1.3 Block-Level Drag & Outline Folding**: Sections delineated by `##` or Scene breaks can be folded or dragged in the sidebar outline.

### 3.2 Module 2: Tauri 2.0 Cross-Platform Desktop Architecture
- **FR-2.1 Rust Desktop Shell Configuration**: `src-tauri` directory with `tauri.conf.json` specifying Windows MSI/NSIS, macOS DMG, and Linux AppImage bundle profiles.
- **FR-2.2 Native System Capabilities**:
  - Native File System Dialogs for direct zero-latency project folder selection.
  - Native System Tray with background auto-save and daily typing goal tracker.
  - Offline-first execution with zero cloud dependency.

### 3.3 Module 3: Bidirectional Interactive Canon & Causal Matrix Canvas
- **FR-3.1 Visual Link Creation**: Dragging a connection line between two nodes opens a modal to create a new relationship or `CausalContract` (with obligations, deadlines, and breach penalties).
- **FR-3.2 Automatic Markdown Sync**: Newly created entities and relations instantly sync to `.mozhou/` and `设定/<type>/<name>.md`.

### 3.4 Module 4: Commercial Web Novel Genre Kit Hub
- **FR-4.1 Preset Kits**: 8 built-in genre packs containing:
  - Core worldbuilding laws (天道规则)
  - Golden finger templates (金手指模板)
  - Banned cliches & negative word filters (流派避雷词库)
  - Opening chapter beat outlines (黄金三章节拍器)
- **FR-4.2 One-Click Book Ingestion**: Selecting a genre kit automatically scaffolds a complete book structure.

### 3.5 Module 5: Legacy Next.js Deprecation & Monorepo Cleansing
- **FR-5.1 Prune `app/` Legacy Artifacts**: Safely deprecate and cleanly isolate old Next.js 1.0 files to ensure zero build confusion.
- **FR-5.2 Unified Pnpm Scripts**: Standardize `pnpm dev`, `pnpm build`, `pnpm desktop:build`, and `pnpm test`.

---

## 4. Success Criteria & Release Gates

- **SC-1 (Zero TypeScript / Linter Errors)**: `pnpm tsc --noEmit` passes with 0 errors across packages and apps.
- **SC-2 (Zero Circular Dependencies)**: GitNexus architecture validation passes with `status: clean, cycleCount: 0`.
- **SC-3 (Test Suite Integrity)**: 100% of existing 882 tests + new component tests pass.
- **SC-4 (Desktop Build Readiness)**: Tauri configuration validates successfully against Tauri CLI v2 schema.
