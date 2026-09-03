# Implementation Plan: Commercial-Grade Novel OS Masterpiece (004-commercial-app-masterpiece)

**Feature Code**: `004-commercial-app-masterpiece`  
**Goal**: Transform MoZhou into a release-ready, commercial-grade desktop & web novel writing application featuring TipTap AST block editing, Tauri 2.0 native packaging, bidirectional interactive canon matrices, and web novel genre kit market.  
**Tech Stack**: React 18, TypeScript, Tailwind CSS, TipTap/ProseMirror, Tauri 2.0 (Rust), Vite, `@mozhou/kernel`, `@mozhou/quality-engine`.  

---

## 1. Component Architecture & File Plan

```text
apps/web/src/
├── workbench/
│   └── editor/
│       ├── BlockEditorEngine.tsx         # TipTap AST block editor with Slash Commands
│       ├── SlashCommandMenu.tsx          # Inline '/' command palette popup
│       └── customNodes.ts                # Custom NovelParagraph node (2-em indent)
├── canon-graph/
│   ├── InteractiveCanvasOverlay.tsx      # Drag-to-connect line creation interface
│   ├── CreateContractModal.tsx           # Modal for creating visual CausalContract
│   └── canonSyncBridge.ts                # Translates graph mutations to local files
├── genre-kits/
│   ├── GenreKitMarketplaceView.tsx       # Genre preset hub view (8 built-in genres)
│   ├── genrePresets.ts                   # Concrete world/golden-finger/cliche kits
│   └── useGenreScaffold.ts               # Applies kit to active book project
└── shell/
    └── views.ts                          # Exposes 'genre-kits' in NAV_GROUPS

src-tauri/                                # Tauri 2.0 Native Desktop Shell
├── Cargo.toml                            # Tauri dependencies & metadata
├── tauri.conf.json                       # Windows/macOS/Linux bundle profiles
└── src/
    └── main.rs                           # Native entrypoint & menu bindings
```

---

## 2. Phase Breakdown & Tasks

- [ ] **Phase 1: TipTap AST Block Editor Engine**
  - Implement `customNodes.ts` with custom paragraph and scene break schemas.
  - Implement `SlashCommandMenu.tsx` supporting `/scene`, `/character`, `/beat`, `/rewrite`.
  - Implement `BlockEditorEngine.tsx` and integrate with `NovelEditorCanvas.tsx`.
- [ ] **Phase 2: Bidirectional Interactive Canon Graph**
  - Implement `InteractiveCanvasOverlay.tsx` allowing mouse-drag linking between entities.
  - Implement `CreateContractModal.tsx` for adding `CausalContract` promises.
  - Connect mutations to update local graph state and project files.
- [ ] **Phase 3: Web Novel Genre Kit Marketplace**
  - Define `genrePresets.ts` with 8 distinct web novel templates (灵异复苏, 传统修仙, 系统流, etc.).
  - Implement `GenreKitMarketplaceView.tsx` with one-click preview and apply actions.
  - Register route in `views.ts`.
- [ ] **Phase 4: Tauri 2.0 Desktop Packaging Scaffold**
  - Create `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` configured for Windows NSIS/MSI.
  - Add native menu and file-dialog IPC bindings in `src-tauri/src/main.rs`.
- [ ] **Phase 5: Verification & Quality Gate**
  - Run `pnpm tsc --noEmit`.
  - Run full test suite (`pnpm test`).
  - Run GitNexus cycle gate (`pnpm graph:check`).
