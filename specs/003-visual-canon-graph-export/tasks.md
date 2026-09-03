# Tasks: Visual Canon Graph & Publication Export Suite (003-visual-canon-graph-export)

## Phase 1: Interactive Visual Canon Graph

- [x] T001 [P] Create graph & export directory structure in `apps/web/src/canon-graph/` and `apps/web/src/export-suite/`
- [x] T002 [P] Implement `apps/web/src/canon-graph/useCanonGraphData.ts` mapping entities & contracts into nodes and links
- [x] T003 Implement `apps/web/src/canon-graph/CanonGraphView.tsx` with pan, zoom, node selection, and faction filters
- [x] T004 Implement `apps/web/src/canon-graph/CanonNodeCard.tsx` showing character info & causal contracts

## Phase 2: Publication-Grade Multi-Format Exporters

- [x] T005 [P] Implement `apps/web/src/export-suite/txtCleanExporter.ts` (platform-ready Qidian/Fanqie plain text)
- [x] T006 [P] Implement `apps/web/src/export-suite/docxExporter.ts` (editor submission Word document builder)
- [x] T007 [P] Implement `apps/web/src/export-suite/epubExporter.ts` (e-reader EPUB packaging)
- [x] T008 Implement `apps/web/src/export-suite/PublicationExportModal.tsx` export dialog

## Phase 3: Shell Integration & Monorepo Verification

- [x] T009 Register `/canon-graph` route in `apps/web/src/shell/views.ts`
- [x] T010 Run `pnpm tsc --noEmit` and verify 0 type errors
- [x] T011 Run `pnpm graph:check` and verify 0 circular dependencies
