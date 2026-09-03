# Tasks: Commercial-Grade Novel OS Masterpiece (004-commercial-app-masterpiece)

## Phase 1: TipTap AST Block Editor Engine

- [x] T001 [P] Implement custom node schema in `apps/web/src/workbench/editor/customNodes.ts`
- [x] T002 [P] Implement `/` slash command popup in `apps/web/src/workbench/editor/SlashCommandMenu.tsx`
- [x] T003 Implement `apps/web/src/workbench/editor/BlockEditorEngine.tsx` integrating slash commands and custom typography

## Phase 2: Bidirectional Interactive Canon & Causal Matrix

- [x] T004 [P] Implement `apps/web/src/canon-graph/InteractiveCanvasOverlay.tsx` for drag-to-connect entity links
- [x] T005 [P] Implement `apps/web/src/canon-graph/CreateContractModal.tsx` for adding CausalContracts
- [x] T006 Implement bidirectional sync bridge in `apps/web/src/canon-graph/canonSyncBridge.ts`

## Phase 3: Web Novel Genre Kit Marketplace Hub

- [x] T007 [P] Create 8 comprehensive web novel genre packs in `apps/web/src/genre-kits/genrePresets.ts`
- [x] T008 [P] Implement `apps/web/src/genre-kits/GenreKitMarketplaceView.tsx` with one-click book scaffolding
- [x] T009 Register `genre-kits` route in `apps/web/src/shell/views.ts`

## Phase 4: Tauri 2.0 Native Desktop Shell Configuration

- [x] T010 [P] Create `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` with desktop bundle profiles
- [x] T011 [P] Implement native shell entrypoint in `src-tauri/src/main.rs`

## Phase 5: Verification & Monorepo Quality Gate

- [x] T012 Run `pnpm tsc --noEmit` and ensure 0 TypeScript compilation errors
- [x] T013 Run `pnpm test` and verify 100% test pass rate across all packages and apps
- [x] T014 Run `pnpm graph:check` and verify 0 circular dependencies
