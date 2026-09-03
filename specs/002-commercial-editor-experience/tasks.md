# Tasks: Commercial-Grade Rich Text Editor & Inline AI Assistant (002-commercial-editor-experience)

## Phase 1: Setup & Foundational Components

- [x] T001 Create editor feature directory structure in `apps/web/src/workbench/editor/` and `apps/web/src/workbench/dialogue/`
- [x] T002 Implement selection & cursor coordinates tracker hook in `apps/web/src/workbench/editor/useEditorSelection.ts`
- [x] T003 Implement client-side 4-gram and redline telemetry runner in `apps/web/src/workbench/editor/EditorQualityTelemetry.tsx`

## Phase 2: User Story 1 - 沉浸式网文富文本画布 (Editor Canvas & Typography)

- [x] T004 [US1] Create `apps/web/src/workbench/editor/NovelEditorCanvas.tsx` with 2-em auto-indent, line normalization, and shortcut key bindings
- [x] T005 [US1] Support block-level cursor tracking and user edit stream forwarding in `NovelEditorCanvas.tsx`

## Phase 3: User Story 2 - 划词 AI 浮动气泡工具箱 (Floating AI Selection Menu)

- [x] T006 [P] [US2] Implement `apps/web/src/workbench/editor/FloatingBubbleMenu.tsx` with 4 presets (描写强化/情绪提纯/对白调优/剧情反转) + custom input
- [x] T007 [P] [US2] Add backend route in `apps/web/server/routes/inlineAiRoutes.ts` to execute streaming inline AI actions

## Phase 4: User Story 3 - 行内 Diff 审阅与 Ghost Text 对比 (Inline Diff & Ghost Text)

- [x] T008 [US3] Implement `apps/web/src/workbench/editor/InlineDiffViewer.tsx` for green/red visual diff comparison
- [x] T009 [US3] Wire one-click Accept/Reject/Escape keyboard and click handlers with zero raw text loss

## Phase 5: User Story 4 - 独立灵感/设定对话抽屉 (Inspiration Chat Drawer)

- [x] T010 [US4] Implement slide-out inspiration drawer in `apps/web/src/workbench/dialogue/FloatingInspirationDrawer.tsx`
- [x] T011 [US4] Add "Insert into Editor Cursor" and "Save to Canon" action handlers

## Phase 6: Polish & Integration

- [x] T012 Integrate `NovelEditorCanvas` into `apps/web/src/workbench/WorkbenchView.tsx` replacing legacy raw textareas
- [x] T013 Run `pnpm tsc --noEmit` and verify 0 type errors across monorepo
- [x] T014 Run `pnpm graph:check` and verify 0 circular dependencies
