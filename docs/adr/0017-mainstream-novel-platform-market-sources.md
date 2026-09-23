# 0017. Mainstream Novel Platform Market Sources and Strict Legitimate Indexing

## Context

Market intelligence (Tier 3 Market Flywheel) provides commercial insights on genre trends, pacing, and hooks. However, relying on ad-hoc pirate scrapers or obscure small websites produces noisy, distorted, and low-quality data. Network fiction trends are dictated strictly by mainstream, legitimate tier-1 literature platforms with verified reader traffic and commercial scale.

## Decision

We restrict the Market Brain (`story-long-scan` / `story-short-scan` / `MarketBrief`) data sources strictly to **Official Mainstream Fiction Platforms**:

1. **Approved Long-Form Platforms**:
   - **番茄小说 (Fanqie Novel)**: Top rank, read count, new release trending (都市脑洞, 玄幻, 悬疑, 系统).
   - **起点中文网 (Qidian / China Literature)**: 月票榜 (Monthly Ticket), 畅销榜 (Bestseller), 24小时热销榜, 签约新书榜.
   - **晋江文学城 (Jinjiang Literature)**: 霸王票榜, 积分榜, 言情/纯爱核心趋势.
   - **七猫中文网 (Qimao Novel)**: 免费网文头部畅销与飙升榜.
   - **纵横中文网 (Zongheng Chinese)**: 传统玄幻/仙侠/历史热销榜.

2. **Approved Short-Form / Salt-Story Platforms**:
   - **知乎盐言故事 (Zhihu Yanxuan Story)**: 盐选专栏热门榜, 完结高赞故事.
   - **黑岩 / 点众 (Heiyan / Dianzhong)**: 正规新媒体短篇故事榜.

3. **Strict Ban on Obscure & Illegitimate Scraping**:
   - Explicitly forbidden: Small content-farm aggregators, pirated novel scrapers, unverified crawler dumps.
   - All leaderboard ingestions must originate from compliant, stable, official-facing public ranking endpoints or verified curated benchmark datasets.

## Consequences

- The Market Brain reflects genuine market demand and legitimate commercial audience appetites.
- Eliminates data noise and low-grade web scraping legal/maintenance risks.
- Provides actionable, high-confidence guidance for genre formulas and opening chapter beats.
