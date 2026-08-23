# 0012. Scenario-Classified Style Evolution and Anti-Drift Algorithm

## Context

Online learning from author edits (Tier 1 Flywheel) risks catastrophic style drift. For example, if an author heavily edits an intense combat sequence with short, staccato 4-word sentences, naive global model updates would pollute subsequent romantic or expository chapters with inappropriate brevity and bluntness.

## Decision

We decouple style modeling into **Scenario-Classified Profiles** governed by **Exponential Moving Average (EMA) Decay**:

1. **Scenario Classification**:
   The Style Engine categorizes scenes and edits into distinct structural categories:
   - `action` (combat, pursuit, high-stakes crises)
   - `dialogue` (banter, negotiation, political intrigue)
   - `romance_emotion` (interpersonal tension, intimacy, emotional beats)
   - `exposition_worldbuilding` (lore delivery, environment setting, transitions)

2. **Decoupled Style Matrices**:
   Each category maintains an independent `StyleProfile` capturing sentence length distribution, sensory density, dialogue ratio, and vocabulary preferences.

3. **Anti-Drift EMA Learning**:
   Post-generation user edit deltas update the corresponding scenario profile using a low learning rate smoothing factor ($\alpha = 0.05$). Extreme single-chapter revisions cannot distort the author's established baseline.

## Consequences

- The AI adapts to the author's voice without cross-genre tone corruption.
- Combat scenes remain crisp while dialogue and romantic scenes maintain emotional depth.
