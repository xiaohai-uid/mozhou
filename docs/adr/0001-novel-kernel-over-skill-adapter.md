# 0001. Novel Kernel Architecture over Skill Adapters and Multi-Agent Panels

## Context

Previous iterations relied on mapping 14 isolated agent skills directly to UI actions via a runtime adapter (`14 Skills → RuntimeSkillAdapter → UI`), or considered an agent-centric pattern where multiple autonomous agents (Planner, Writer, Reviewer, Fact Agent, Style Agent) collaborate on each chapter. 

Comparative analysis across leading fiction writing platforms (OpenWrite, jarvis-write, 天命, AI-Novel-Writing-Assistant, InkFlow) reveals two critical failure modes:
1. **Skill-Centric fragility**: Direct UI-to-Skill coupling bypasses a unified story brain, resulting in fragmented state, ad-hoc context passing, and lack of transaction guarantees.
2. **Multi-Agent chaos**: Running 7-8 uncoordinated agents per generation drastically increases token costs, failure surfaces, latency, and creates a black-box experience for the user.

## Decision

We adopt a **Kernel-Centric Architecture** (`Story Kernel + Context Compiler + Durable Novel Runtime + Capability Registry + Local Data Plane + Data Flywheel`).

1. **Story Kernel as the True Center**: All narrative truth, outlines, temporal facts, knowledge states, and promises reside in the Story Kernel.
2. **Skills Demoted to Pluggable Capabilities**: Skills (e.g., `story-deslop`, `story-long-write`, `story-review`) are registered behind abstract `Capability` contracts in a `CapabilityRegistry`. The UI and application layers invoke abstract capabilities (e.g., `runCapability(PROSE_DEAI)`), never concrete skill names.
3. **Single Runtime Execution**: Generations execute via a durable workflow runtime with deterministic gates and checkpoints. Multi-agent execution is reserved exclusively for explicit adversarial reviews (`story-review`), never for routine drafting.

## Consequences

- The application layer interacts with a stable, transactional story domain rather than volatile agent scripts.
- Skill providers can be swapped, upgraded (v1 -> v2), or mocked without modifying UI or persistence layers.
- System complexity is shifted to the deterministic backend, maintaining a simple, responsive user interface.
