# 0016. Two-Tier Evaluation Harness: Fast Deterministic Mock vs. Live Model Benchmark

## Context

Executing a 50-chapter long-novel benchmark against external LLMs on every continuous integration (CI) run or code commit is cost-prohibitive, slow (tens of minutes), and introduces non-deterministic test flakiness.

## Decision

We establish a **Two-Tier Evaluation Execution Harness**:

1. **L1 Fast Deterministic Gate (CI & Local Development)**:
   - Utilizes a `DeterministicMockProvider` with recorded state transitions, mock extractions, and preset text fixtures.
   - Verifies the full 50-chapter state machine, temporal fact intervals, dependency graph traversals, conflict gates, and SQLite rebuilding in $< 5$ seconds with zero external API costs.
   - Mandatory passing gate for all pull requests and unit test runs.

2. **L2 Live Model Benchmark (Release & Recipe Upgrades)**:
   - Runs the 50-chapter synthetic scenario against real commercial LLMs (via BYOK).
   - Measures genuine prose quality, semantic change impact recall, prompt token budgeting, and continuity adherence.
   - Mandatory validation gate prior to versioned recipe/prompt releases.

## Consequences

- Daily development benefits from sub-second feedback loops and deterministic regression checks.
- Formal release gates rigorously evaluate real-world LLM capabilities against standard baselines.
