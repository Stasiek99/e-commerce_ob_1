# E-Commerce Default Product Sorting — Research Findings

*Research date: 2026-05-14 | Sources: Baymard Institute, Notino, Sephora, Amazon, Zalando, Algolia, Practical Ecommerce, Shopify*

---

## TL;DR

Diversity-based relevance beats pure bestsellers as a default sort. The instinct behind category interleaving (Millesime → Luxury → Gels → Diffusers) is correct and aligns with Baymard's #1 UX finding. The problem was the `createdAt` tie-breaker being useless when all products were seeded at the same time. The industry solution for a cold-start store: **manual `sortOrder` field** — editorial control with zero algorithmic complexity.

---

## What the Research Says

### 1. "Newest First" is the worst default for first-time visitors
Every source agrees: newest signals "nobody bought this" and serves only returning customers. Sephora, Notino, ASOS — none use it as default. It should exist as a user-selectable option only.

### 2. Pure Bestsellers is better than Newest, but not ideal for a diverse catalog
Baymard's large-scale lab tests (3,000+ hours, 200+ top e-commerce sites) found that pure Bestsellers causes users to misjudge catalog breadth — they see 20 similar top-sellers and assume that's all you have. **24% of major sites fail this test.** Baymard's rule: every major product subtype that represents >10% of the catalog must appear in the first 20 results.

The category interleaving (5 Millesime → 5 Luxury → 5 Gels → 5 Diffusers) already implements this principle correctly.

### 3. Leaders use "Relevance/Recommended" as default
- **Notino:** "Relevance" default (popularity-based once data exists; manual curation at launch)
- **Sephora:** "Bestselling" / "Relevance" (with editorial overrides)
- **ASOS:** Multi-factor "Recommended" — sales volume + imagery quality + social reaction + search frequency
- **Amazon BSR:** Time-decay weighted sales velocity (last 1-3 hours weighted highest)
- **Shopify (April 2026):** Replaced "Best Selling" with "Most Relevant" — combines sales performance with real-time intent signals
- **Zalando:** Full ML-based ranking (Learning-to-Rank + GNNs) — CTR, views, basket adds, purchase conversion

### 4. Cold-start: manual `sortOrder` is the industry standard
Without sales data, a `sortOrder: Int` per product is the standard approach. Exposes as "Rekomendowane" in UI, trivially migrated, updated manually each season. Algolia calls it "custom ranking". Gives editorial control: promote high-margin items, surface photogenic anchors, deprioritize slow movers.

### 5. Fragrance-specific: diversity by scent family matters
Notino and Sephora treat **Gender** + **Scent Family** as primary filter axes. The correct default for a fragrance catalog ensures scent-family diversity in the first row, not just category diversity.

### 6. Ratings: use Bayesian average, not raw mean
For ratings (once they accumulate), use Bayesian average to avoid a single 5-star review boosting a product above a 200-review item:
```
bayesAvg = (avgRating * ratingCount + C * catalogMeanRating) / (ratingCount + C)
```
where `C` = 25th percentile of rating counts across the catalog. Recalculate weekly via batch job.

### 7. Popularity score formula (Phase 1+)
```
score = w1 * salesLast30d + w2 * pageViews + w3 * newBoost
newBoost = 1 / log(daysOnSite + e)  // natural log, e ≈ 2.718
```
Starting weights: sales = 1.2, recency = 1.5. Tune per category.

### 8. Fragrance-specific sort options (what Notino offers)
- Popularność (Bestsellers) — **default**
- Cena: rosnąco
- Cena: malejąco
- Ocena klientów (Customer Rating)
- Nowości (New Arrivals)

---

## Evolution Roadmap

| Phase | Trigger | Mechanism |
|---|---|---|
| **Phase 0 (now)** | Launch, no data | Manual `sortOrder: Int` on Product, UI label = "Polecane" |
| **Phase 1** | 500+ page views | Time-decayed view score: `score = views / log(daysLive + e)` |
| **Phase 2** | 50+ orders | RFM: `score = 1.2 * sales30d + 1.5 * views + recency_boost` |
| **Phase 3** | 100+ reviews | Bayesian average rating folded into composite score |
| **Phase 4** | 10k+ sessions/month | A/B test ML-derived ranking per category |

---

## Key Sources

1. [Baymard: Default Sort Type](https://baymard.com/blog/default-sort-type) — Diversity-based Relevance as gold standard; 24% of sites fail
2. [Baymard: Essential Sort Types](https://baymard.com/blog/essential-sort-types) — 4 essential sorts: Price, Rating, Bestselling, Newest
3. [Baymard: Product List & Filtering 2025](https://baymard.com/blog/current-state-product-list-and-filtering) — 58% desktop / 78% mobile sites mediocre or worse
4. [Baymard: Health & Beauty UX](https://baymard.com/blog/health-and-beauty-ux-research) — 3,000+ hours on 18 beauty sites including Sephora
5. [Practical Ecommerce: Default Sorts Harm Conversions](https://www.practicalecommerce.com/default-category-sorts-can-harm-conversions) — Why pure bestsellers can backfire
6. [Tagalys: Conversion-Optimised Sorting](https://www.tagalys.com/blog/conversion-optimised-sorting-for-magento-and-shopify-product-listing-pages) — 25%+ conversion lift from dynamic trending-score sorting
7. [Constructor.io: Cold-Start Products](https://constructor.com/blog/cold-start-products) — Attribute-based prior estimation without clickstream
8. [Algolia: Bayesian Average Custom Ranking](https://www.algolia.com/doc/guides/managing-results/must-do/custom-ranking/how-to/bayesian-average) — Concrete formula for rating-adjusted ranking
9. [Medium/AnkitG: Sort Order Algorithm](https://medium.com/@aankitgupta/easy-and-effective-way-to-improve-sort-order-algorithm-87a423118a28) — RFM-based popularity score; 30% bounce rate reduction reported
10. [Shopify "Most Relevant" sort](https://www.amwhiz.com/blog/the-most-relevant-sort-order-is-here-better-product-discovery-for-your-shopify-store) — Shopify replaced "Best Selling" with multi-signal sort, April 2026
11. [Splitbase: Beauty eCommerce Optimization](https://splitbase.com/blog/beauty-ecommerce-optimization) — 1,532% better conversion on filtered vs. unassisted browsing
12. [Scento: Perfume Mobile Trends 2025](https://www.scento.com/blog/perfume-ecommerce-mobile-trends-2025) — Fragrance 70% mobile purchase; app CVR 3.5% vs 2% mobile web

---

## What Was Implemented

### Phase 0 implementation (2026-05-14)
- Added `sortOrder Int @default(0)` to `Product` model in Prisma schema
- Updated seed to assign meaningful `sortOrder` values per product (lower = higher priority)
- Updated `findAll` in `products.service.ts` to use `[{ sortOrder: 'asc' }, { createdAt: 'desc' }]` as `orderBy` within each interleaving bucket
- The category interleaving (diversity across Millesime/Luxury/Gels/Diffusers) is preserved; `sortOrder` now controls ordering *within* each bucket
