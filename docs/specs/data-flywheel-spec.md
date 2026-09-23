# MoZhou Novel OS 2.0: Data Flywheel & Privacy Specification

## 1. Core Philosophy: Policy Flywheel over Model Training

MoZhou operates under a Local-First + BYOK paradigm. The Data Flywheel does not collect private manuscript text to fine-tune foundation models. Instead, it continuously refines **Author Models, Capability Evolution, and Market Intelligence**.

---

## 2. Privacy Tiers & Boundary Enforcement

| Tier | Classification | Content | Storage & Sync Policy |
| :--- | :--- | :--- | :--- |
| **P0** | `PRIVATE_TEXT` | Full manuscript prose, outlines, setting lore, chat transcripts | **Strictly Local Only**. Never uploaded under any circumstances. |
| **P1** | `PRIVATE_DERIVED` | Author preference profiles, style matrices, local embeddings | **Local by Default**. Encrypted cloud sync only if user explicitly enables multi-device sync. |
| **P2** | `ANONYMOUS_METRICS` | Model ID, recipe version, latency, accept/reject booleans, edit distance ratio, error codes | **Opt-in Anonymized Telemetry**. Used to evaluate aggregate skill and model performance across all users. |
| **P3** | `CONTRIBUTED_DATA` | Open benchmark test cases, community prompt recipes, public web analysis datasets | **Public / Explicit Consent**. Sanitized and voluntarily shared by authors. |

---

## 3. The Three-Tier Flywheel Architecture

```mermaid
flowchart TD
    subgraph Tier1 [Tier 1: User Flywheel (Author Model)]
        T1A[Author Preference Learner (Rejections/Acceptances)]
        T1B[Revision & Style Evolution (Edit Deltas)]
        T1C[Long-term Text Survival Tracker]
    end

    subgraph Tier2 [Tier 2: Engineering Flywheel (Capability Evolution)]
        T2A[Recipe & Prompt Versioning]
        T2B[Context Policy Debugger & Regression Cases]
        T2C[Task-Model Router]
    end

    subgraph Tier3 [Tier 3: Market Flywheel (Market Intelligence)]
        T3A[Genre Structure & Hook Extraction]
        T3B[Mainstream Leaderboard Ingestion]
        T3C[Market Brief & Pacing Analysis]
    end

    UserEdits[User Selection / Rejection / Text Edits] --> Tier1
    GenerationLogs[Event Ledger & Latency / Tokens / Quality] --> Tier2
    PublicMarket[Mainstream Fiction Leaderboards] --> Tier3

    Tier1 --> NextGeneration[Optimized Next Generation]
    Tier2 --> NextGeneration
    Tier3 --> NextGeneration
```

### 3.1 Tier 1: User Flywheel (Author Model)
- **Goal**: Continually adapt to the author's unique voice, narrative pacing, and habits without requiring manual prompt writing.
- **Data Source**: User choices (accepting Option B over A/C), post-generation manual edits, and prose deletions.
- **Mechanism**:
  - *Preference Inference*: Identifies behavioral traits (e.g., favoring physical action cues over abstract psychological musings, dialogue-driven pacing vs. descriptive exposition).
  - *Style Evolution*: Continuously refines `StyleProfile vN` based on edit deltas.
  - *Survival Tracking*: Analyzes whether accepted generations remain intact after 30+ days of subsequent writing.

### 3.2 Tier 2: Engineering Flywheel (Capability Evolution)
- **Goal**: Empirically prove whether a prompt, recipe, or context policy upgrade is genuinely superior.
- **Data Source**: Event ledger metrics (`edit_distance_ratio`, acceptance rates, token latency, continuity error frequency).
- **Mechanism**:
  - *Recipe Benchmarking*: Verifies whether `story-deslop v1.4` reduces user edit distance compared to `v1.3`.
  - *Context Policy Debugging*: Translates continuity bugs (e.g., forgotten item ownership) into permanent automated test cases (`CASE-NNNN`).
  - *Task-Model Routing*: Quantitatively evaluates which BYOK model excels at drafting, review, extraction, or brainstorming.

### 3.3 Tier 3: Market Flywheel (Market Intelligence)
- **Goal**: Ground novel planning and volume arcs in real-time commercial market reality.
- **Data Sources (Strictly Mainstream & Legitimate Platforms Only)**:
  - **番茄小说 (Fanqie)**: 热门榜, 读完率风向, 完结榜 (都市脑洞, 玄幻, 悬疑).
  - **起点中文网 (Qidian)**: 月票榜, 24小时畅销榜, 签约新书榜, 完本经典榜.
  - **晋江文学城 (Jinjiang)**: 霸王票榜, 积分总榜, 言情/纯爱热门趋势.
  - **七猫中文网 (Qimao)**: 免费新媒体长篇榜单.
  - **纵横中文网 (Zongheng)**: 传统玄幻/仙侠热销榜.
  - **知乎盐言故事 (Zhihu Yanxuan)**: 盐选高赞专栏与短篇榜.
  - *Strict Ban*: Small pirate scrapers, unverified aggregators, and spam farms are completely forbidden.
- **Mechanism**:
  - Ingests public, official rank lists into structured `MarketBrief` objects detailing prevailing market trends, high-retention golden-three-chapter pacing, hook placement frequency, and anti-patterns by genre and platform.

---

## 4. Telemetry Event Schema (`EventLedger`)

Every discrete event is appended to `.mozhou/events.jsonl` with strict schema:

```json
{
  "event_id": "evt_983f2a1b",
  "timestamp": "2026-08-23T14:00:00Z",
  "privacy_tier": "P2",
  "event_type": "GENERATION_EVAL",
  "task_type": "CHAPTER_DRAFTING",
  "model_provider": "deepseek",
  "model_name": "deepseek-chat",
  "recipe_version": "long-write-v2.1",
  "context_policy_version": "ctx-policy-v4",
  "tokens_in": 3842,
  "tokens_out": 2150,
  "latency_ms": 4200,
  "user_action": "ACCEPTED_WITH_EDITS",
  "edit_distance_ratio": 0.12,
  "survival_verified": null
}
```
