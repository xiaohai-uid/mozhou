# Feature Specification: Commercial-Grade Rich Text Editor & Inline AI Assistant (002-commercial-editor-experience)

**Feature Code**: `002-commercial-editor-experience`  
**Status**: Draft  
**Created**: 2026-09-03  

---

## 1. User Scenarios & Problems to Solve

### 1.1 Problems with Existing Systems
1. **Plain Textarea Limitation**: Traditional AI writing tools either use plain textareas (poor visual formatting, lack of paragraph typography) or rigid card streams that break creative immersion.
2. **Disconnected AI Actions**: In most tools, if an author wants to polish or expand a specific paragraph, they must copy-paste it into a separate chat box, wait for generation, and manually paste it back, losing formatting and context.
3. **Black-box Overwriting**: When AI rewrites text, authors have no clear visual diff (Ghost Text / Side-by-side Diff) to review changes before accepting, risking accidental loss of nuanced prose.

### 1.2 User Personas & Core Journeys
- **Web Novelist (Long-form Author)**: Needs distraction-free immersion (Zen mode), automatic Chinese paragraph indentation (2 em spaces), and instant inline AI assist (enrich sensory details, sharpen dialogue, escalate conflict) via a selection bubble menu.
- **Editor / Quality Reviewer**: Needs instant visual diff comparison (old vs new), block-level accept/reject, and automated 4-gram / De-AI quality telemetry visible in the editor margins.

---

## 2. Functional Requirements

### 2.1 Rich Text Editing Canvas (ProseMirror / TipTap / Slate-compatible)
- **FR-1.1 Paragraph Formatting**: Native Chinese web novel typography support: automatic paragraph indentation, smart smart-quotes pairing, and dialogue line normalization.
- **FR-1.2 Block Structure**: Heading tags for scene beats / POV markers, collapsible outline notes, and clean export to plain text / Markdown / Word (.docx).
- **FR-1.3 Track Changes & Edit Capture**: Capture user keystroke edits and cursor selections at block level, seamlessly feeding author correction signals to `@mozhou/flywheel` negative preference learner.

### 2.2 Inline AI Floating Bubble Toolbar (Selection Menu)
- **FR-2.1 Contextual Selection Trigger**: Selecting any text range (1 to 2000 characters) brings up a high-precision floating bubble menu positioned above/below the cursor.
- **FR-2.2 Four Presets of Web Novel AI Actions**:
  1. **【描写强化】(Sensory Expansion)**: Deepens visual, auditory, and visceral details without altering plot progression.
  2. **【情绪提纯】(De-AI / Sharpening)**: Removes filler words, clichés, and hollow parallels; heightens dramatic tension.
  3. **【对白调优】(Dialogue Polish)**: Adjusts character voice, subtext, and sharpness according to character canon profile.
  4. **【剧情反转】(Plot Twist / Branching)**: Generates 2-3 unexpected turn-of-events for the current beat.
- **FR-2.3 Custom Intent Input**: Author can type arbitrary natural language instructions (e.g. "让反派的语气更阴险一点").

### 2.3 Visual Review & Diff Confirmation (Ghost Text / Inline Diff)
- **FR-3.1 Ghost Text / Split Diff View**: Inline display of proposed changes with color-coded diff (green addition, red deletion).
- **FR-3.2 One-click Decision**: Keyboard shortcut or button to `Accept All` (`Enter` / `Cmd+Y`), `Reject` (`Esc`), or `Partial Select`.
- **FR-3.3 Quality Assertion Telemetry**: Before accepting, background `@mozhou/quality-engine` checks (4-gram repetition, AI redlines) run instantly and display a green/amber indicator.

### 2.4 Floating Inspiration / Dialogue Drawer
- **FR-4.1 Standalone Chat Route / Drawer**: Seamless slide-out panel for conversational worldbuilding, brainstorming, and character Q&A.
- **FR-4.2 One-Click Insert**: AI suggestions can be sent directly into the active editor cursor position or saved into `设定/` canon directory.

---

## 3. Success Criteria & Quality Gates

- **SC-1 (Latency)**: Selection bubble menu appears within **< 100ms** of mouse release / text selection.
- **SC-2 (Typography Consistency)**: 100% of copied or imported text automatically adopts standard web novel 2-character indentation without breaking markdown formatting.
- **SC-3 (Non-destructive Editing)**: Zero loss of author text during AI generation or cancellation; undo/redo stack (`Cmd+Z` / `Cmd+Shift+Z`) remains pristine.
- **SC-4 (Zero Circular Dependencies)**: GitNexus architecture validation passes with `status: clean, cycleCount: 0`.
- **SC-5 (Test Coverage)**: All newly introduced components and store hooks pass 100% unit tests.
