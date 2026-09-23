# 0009. Capability Registry Inspired by DeepSeek Harness Plugin Architecture

## Context

In naive implementations, agent skills (e.g., `story-deslop`, `story-long-write`, `story-review`) are treated as monolithic top-level products directly invoked by the UI or orchestrator. This leads to heavy vendor/prompt lock-in: if a skill implementation becomes obsolete, the entire calling stack must be rewritten. Furthermore, hardcoding skills prevents multi-provider routing (e.g., using a local regex/AST engine for simple de-AI passes vs. an LLM for nuanced stylistic rewrites).

DeepSeek Harness treats models, tools, skills, and schedulers as composable plugins orchestrated by an abstract runtime.

## Decision

We establish an abstract **Capability Registry** modeled after the Harness plugin architecture:

1. **Decoupling Capabilities from Providers**:
   The runtime and UI only interact with strongly-typed **Capabilities** (abstract task contracts), never concrete skill names:
   ```typescript
   // Example Abstract Capability Contracts
   enum CapabilityType {
     LONGFORM_PLANNING = 'LONGFORM_PLANNING',
     PROSE_DRAFTING = 'PROSE_DRAFTING',
     STYLE_REWRITE = 'STYLE_REWRITE',       // e.g., de-slop, de-AI
     ADVERSARIAL_REVIEW = 'ADVERSARIAL_REVIEW',
     STATE_EXTRACTION = 'STATE_EXTRACTION',
     MARKET_ANALYSIS = 'MARKET_ANALYSIS',
   }
   ```

2. **Pluggable Multi-Provider Registration**:
   Each capability can be fulfilled by multiple versioned providers (e.g., an LLM prompt skill, a native Rust/Node algorithm, or an external specialized API):
   - `Capability: STYLE_REWRITE` $\rightarrow$ `providers: [story-deslop-v1.4, native-deai-rules, external-polisher]`
   - `Capability: LONGFORM_PLANNING` $\rightarrow$ `providers: [story-long-write-v2, custom-outline-engine, human-template]`

3. **Dynamic Capability Routing & Versioning**:
   The runtime routes a capability request based on user preference, model tier, cost budget, and empirical performance metrics from the Data Flywheel (Tier 6).
   If a prompt skill fails or degrades, the registry can fallback to alternative providers without modifying the UI or Story Kernel.

## Consequences

- Completely protects existing skill assets (`story-*`) by packaging them as clean, standardized plugin providers.
- Enables seamless introduction of native, faster, or cheaper algorithms in future versions without breaking architectural stability.
- Allows A/B testing of prompt recipes and providers under identical Story Kernel states.
