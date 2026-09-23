# 0013. Single-Stream Drafting and Localized Multi-Candidate Preference Sampling

## Context

Collecting author preference pairs (Option A vs. Option B vs. Option C) is essential for the Tier 1 Local Author Flywheel. However, defaulting to multi-candidate generation for full chapters would triple API token usage and introduce high latency under a Bring-Your-Own-Key (BYOK) model.

## Decision

We establish **Single-Stream Drafting with Localized Paragraph Branching**:

1. **Default Single-Stream Generation**: Full chapter drafting defaults to a single, high-throughput streaming response to minimize token cost and latency.
2. **Localized Multi-Candidate Branching**: Multi-candidate exploration (2-3 competing versions) is offered selectively when the author triggers paragraph-level rewrite, tone experimentation, or scene branching.
3. **Primary Preference Signal**: The Tier 1 Author Flywheel captures preference signals primarily from:
   - Paragraph-level candidate selections (`accepted_option`, `rejected_options`).
   - Character-level and sentence-level edit distance deltas between AI candidate prose and final author-committed prose.

## Consequences

- Token expenditure and API latency remain low for day-to-day drafting.
- The system captures high-resolution, targeted preference data without forcing full-chapter multi-model overhead.
