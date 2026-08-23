# 0018. Two Hard Anti-Rework Gates: Requirement Fidelity and Real Stability

## Context

Audit of historical project iterations recorded in the Obsidian Knowledge Base (`10_Projects/墨舟/墨舟三轮重构返工根因核验 2026-08-21.md` and `10_Projects/墨舟/墨舟需求保真与稳定门禁失控核验 2026-08-21.md`) revealed two fundamental root causes for past repeated reworks:
1. **False Stability Gates**: Stacking complex runtimes on top of mock-only test suites. Thousands of unit tests passed, yet real model payloads were truncated, messages were missing, or SSE connections dropped.
2. **Requirement Fidelity Failure**: External reference implementations (OpenWrite, jarvis-write, 天命) were treated as "vague inspiration" rather than rigorously freezing exact behavior paths, schemas, must/must-not constraints, and proof of parity.

## Decision

We establish two mandatory, blocking engineering gates that must be satisfied before any phase is claimed complete:

### Gate A: Requirement Fidelity Gate
- **Verbatim Intent Anchoring**: User requirements and reference systems must be mapped to exact behaviors, inputs, outputs, and negative constraints (`must_not`).
- **Zero Vague Implementation**: No implementation can proceed based on assumptions. When referencing an external standard, document the exact contract difference and verify compliance item-by-item.

### Gate B: Real Stability Gate
- **Real Provider & Payload Verification**: Synthetic mock tests (L1) are required for CI speed, but a phase can *never* be closed without **Real Provider Golden Journey Smoke Tests (L2)**:
  - Real model invocation with complete inspection of outgoing prompt payload.
  - Full streaming SSE round-trip (start → delta → done).
  - Page refresh / session reload re-entry with zero state loss.
  - Error injection and graceful retry recovery.
- **Three Consecutive Clean Runs**: The core author journey (create → clarify → draft → edit → commit → reload) must execute 3 consecutive times with zero regression before moving to the next phase.

## Consequences

- Completely terminates the vicious cycle of "mock tests pass $\rightarrow$ user tries it and finds it broken $\rightarrow$ total rewrite".
- Ensures every layer of MoZhou Novel OS 2.0 is built on verified, rock-solid foundations.
