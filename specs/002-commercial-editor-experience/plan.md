# Implementation Plan: Commercial-Grade Rich Text Editor & Inline AI Assistant (002-commercial-editor-experience)

**Feature Code**: `002-commercial-editor-experience`  
**Goal**: Build a commercial-grade rich text editing canvas in `apps/web` with inline floating AI selection tools, Ghost Text / Diff review, and inspiration drawer.  
**Tech Stack**: React 18, TypeScript, Tailwind CSS, TipTap/ProseMirror or lightweight block model, Vite, `@mozhou/quality-engine`, `@mozhou/runtime`.  

---

## 1. Technical Context & Decisions

- **Editor Engine Selection**:
  - *Decision*: Adopt a decoupled Block/Rich-text Component architecture inside `apps/web/src/workbench/editor/` supporting rich paragraph types, 2-em indent rules, and custom Selection floating overlay.
  - *Rationale*: Keeps bundle size lightweight while providing exact cursor coordinates for the floating bubble menu without complex heavy external dependencies.
- **Inline AI Protocol**:
  - *Decision*: Use `/api/chat.stream` or dedicated `/api/inline-ai.action` endpoint with predefined action verbs (`sensory_expansion`, `deslop_sharpen`, `dialogue_polish`, `plot_twist`, `custom_prompt`).
  - *Rationale*: Integrates directly with existing `@mozhou/runtime` capability registry and streaming protocol.
- **Diff & Ghost Text Mechanics**:
  - *Decision*: Store pending replacement in a local `StagedChange` state (`range: [start, end]`, `originalText`, `proposedText`, `status: pending|accepted|rejected`).
  - *Rationale*: 100% non-destructive. User can cancel or hit `Esc` at any moment to restore raw text cleanly.

---

## 2. Architecture & File Structure

```text
apps/web/src/
├── workbench/
│   ├── editor/
│   │   ├── NovelEditorCanvas.tsx         # Modern rich text editing canvas
│   │   ├── FloatingBubbleMenu.tsx        # Selection floating AI toolbar
│   │   ├── InlineDiffViewer.tsx          # Ghost text & side-by-side diff overlay
│   │   ├── EditorQualityTelemetry.tsx    # Live 4-gram & de-slop badge in editor gutter
│   │   └── useEditorSelection.ts         # Hook tracking precise cursor & selection rects
│   ├── dialogue/
│   │   ├── FloatingInspirationDrawer.tsx # Slide-out creative & worldbuilding chat drawer
│   │   └── useInspirationChat.ts         # Multi-turn streaming chat hook
│   └── WorkbenchView.tsx                 # Integrates NovelEditorCanvas with project state
└── server/
    └── routes/
        └── inlineAiRoutes.ts             # Backend endpoint for selection AI presets
```

---

## 3. Data Model & Contracts

### 3.1 Inline Action Contract (`contracts/inline-ai.json`)
```typescript
export interface InlineAiRequest {
  action: 'sensory_expansion' | 'deslop_sharpen' | 'dialogue_polish' | 'plot_twist' | 'custom';
  selectedText: string;
  surroundingContext?: {
    beforeText: string;
    afterText: string;
    chapterTitle?: string;
  };
  customInstruction?: string;
  modelId?: string;
}

export interface StagedEdit {
  id: string;
  rangeStart: number;
  rangeEnd: number;
  originalText: string;
  proposedText: string;
  action: string;
  qualityCheck: {
    passed: boolean;
    fourGramRepetitionCount: number;
    redlineMatches: string[];
  };
}
```

---

## 4. Phase Breakdown & Tasks

- [ ] **Phase 1: Editor Canvas & Selection Engine**
  - Implement `useEditorSelection.ts` to compute screen coordinates (`top, left`) from text selection.
  - Build `NovelEditorCanvas.tsx` with standard web novel 2-character indent rules and keyboard shortcuts.
- [ ] **Phase 2: Floating AI Bubble Toolbar & Inline Diff**
  - Implement `FloatingBubbleMenu.tsx` supporting the 4 classic web novel actions + custom prompt input.
  - Implement `InlineDiffViewer.tsx` for visual ghost text / diff accept-reject workflow.
- [ ] **Phase 3: Quality Telemetry & Inspiration Drawer**
  - Connect `@mozhou/quality-engine` to run client-side 4-gram and redline check on proposed diffs.
  - Implement `FloatingInspirationDrawer.tsx` with one-click insertion to editor cursor.
- [ ] **Phase 4: Full Monorepo Integration & Verification**
  - Mount new editor into `WorkbenchView.tsx`.
  - Verify 0 TypeScript errors and run `pnpm graph:check` to ensure 0 cycles.
