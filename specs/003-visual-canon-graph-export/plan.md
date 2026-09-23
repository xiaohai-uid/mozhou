# Implementation Plan: Visual Canon Graph & Publication Export Suite (003-visual-canon-graph-export)

**Feature Code**: `003-visual-canon-graph-export`  
**Goal**: Implement interactive SVG/Canvas-based Canon Relationship Graph in `apps/web` and multi-format export pipeline (Docx / Clean TXT / EPUB).  
**Tech Stack**: React 18, TypeScript, Tailwind CSS, Canvas/SVG Force-Directed Layout, client-side Docx generator, `@mozhou/kernel` entities.  

---

## 1. Architecture & File Structure

```text
apps/web/src/
├── canon-graph/
│   ├── CanonGraphView.tsx           # Interactive visual node graph canvas
│   ├── CanonNodeCard.tsx            # Node detail card & contract indicator
│   └── useCanonGraphData.ts         # Maps @mozhou/kernel entities & contracts to graph nodes/links
├── export-suite/
│   ├── PublicationExportModal.tsx   # Comprehensive export configuration modal
│   ├── docxExporter.ts              # Publication-grade Word docx builder
│   ├── txtCleanExporter.ts          # Qidian/Fanqie platform-ready plain text builder
│   └── epubExporter.ts              # E-reader compliant EPUB structure compiler
└── shell/
    └── views.ts                     # Registers /canon-graph route in AppShell
```

---

## 2. Phase Breakdown

- [ ] **Phase 1: Interactive Canon Relationship Graph**
  - Implement `useCanonGraphData.ts` extracting characters, factions, and relationships.
  - Implement `CanonGraphView.tsx` with zoom, pan, node dragging, and filter toggles.
- [ ] **Phase 2: Causal Contract Timeline Layer**
  - Project `CausalContract` promises and deadlines onto character nodes.
- [ ] **Phase 3: Publication-Grade Multi-Format Export Suite**
  - Implement `docxExporter.ts`, `txtCleanExporter.ts`, and `epubExporter.ts`.
  - Implement `PublicationExportModal.tsx` for easy single-chapter or whole-book export.
- [ ] **Phase 4: Verification & Monorepo Gate**
  - Type-check with `pnpm tsc --noEmit`.
  - Architecture cycle check with `pnpm graph:check`.
