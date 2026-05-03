# Graph-RAG Phase 1 — Implementation Report
## For Expert Committee Review

**Date:** 2026-05-03
**Status:** Phase 1 implemented, tuning needed — requesting committee guidance
**Baseline established:** Yes (Phase 0 complete)

---

## 1. What Was Built

Following the committee's implementation guide, we built Approach B (embedding-based entity extraction with co-occurrence graph):

### Pipeline Implemented

1. **N-gram candidate extraction** (1-3 words per chunk, standard tokenization)
2. **Frequency filter** (min_freq=3 — phrases appearing in ≥3 chunks)
3. **BGE Small embedding** of all surviving phrases (same model as RAG)
4. **FAISS-accelerated greedy clustering** at cosine threshold 0.85 for synonym resolution
5. **Co-occurrence graph** — entities sharing chunks connected, edges weighted by co-occurrence count, filtered at weight ≥ 2
6. **Storage** — KuzuDB for persistence + JSON adjacency index for fast retrieval
7. **Seed-and-expand retrieval** — FAISS seeds → entity identification → graph expansion → chunk scoring → blending with hybrid scores

### Graph Statistics

| Pack | Entities | Edges | Build Time | Raw Candidates | After freq filter |
|---|---|---|---|---|---|
| sciq (6,182 chunks) | 10,291 | 618,957 | 15 min | 372,422 | 38,078 |
| medmcqa (6,598 chunks) | 11,872 | 591,826 | 13 min | 434,979 | 33,399 |
| **Combined** | **22,163** | **1,210,783** | **28 min** | — | — |

### Entity Frequency Distribution

| Pack | Min | Median | Mean | P95 | Max | Hubs (>100) | Hubs (>50) |
|---|---|---|---|---|---|---|---|
| sciq | 2 | 2 | 9.7 | 34 | 3,939 | 335 | 805 |
| medmcqa | 3 | 5 | 17.2 | 59 | 3,817 | 304 | 716 |

### Edge Weight Distribution

| Pack | Min | Median | Mean | P95 | Max |
|---|---|---|---|---|---|
| sciq | 2 | 2 | 3.2 | 7 | 2,184 |
| medmcqa | 2 | 2 | 3.8 | 9 | 3,700 |

---

## 2. Evaluation Results

### Baseline (Hybrid Retrieval — FAISS dense + BM25 sparse + RRF)

| Type | R@5 | R@10 | Avg Latency |
|---|---|---|---|
| Overall | 6.0% | **9.5%** | 45 ms |
| Single-hop (15) | 6.2% | 10.2% | 30 ms |
| Multi-hop (25) | 7.2% | 12.0% | 51 ms |
| Cross-domain (10) | 2.5% | 2.5% | 54 ms |

### Graph Attempt 1 — Untuned (SEED_BOOST=10, BLEND_WEIGHT=0.4)

| Type | R@5 | R@10 | Delta vs Baseline |
|---|---|---|---|
| Overall | 0.0% | 0.5% | **-9.0** |
| Multi-hop | 0.0% | 1.0% | -10.9 |

**Failure mode:** Graph expansion completely overwhelmed seed results. All queries returned the same high-entity-frequency chunks. Hub entities (appearing in 3,000+ chunks) dominated scoring.

### Graph Attempt 2 — Tuned (SEED_BOOST=100, BLEND_WEIGHT=2.0, hub filter <100 chunks, expansion cap 30)

| Type | R@5 | R@10 | Delta vs Baseline |
|---|---|---|---|
| Overall | 6.0% | **9.0%** | **-0.6** |
| Single-hop | 6.2% | 10.2% | 0.0 |
| Multi-hop | 7.2% | 10.8% | **-1.2** |
| Cross-domain | 2.5% | 2.5% | 0.0 |

**Result:** Graph no longer destroys results (single-hop and cross-domain preserved), but multi-hop slightly worse. Net effect is approximately zero — the graph is not yet earning its keep.

---

## 3. Per-Query Multi-Hop Analysis

| Query | Baseline R@10 | Graph R@10 | Change | Analysis |
|---|---|---|---|---|
| Neurons + synapses | 0% | 12% | **+12%** | Only query where graph helped — expanded from neuron entities to synapse-related chunks |
| Vaccines + diseases | 25% | 12% | -12% | Graph expansion displaced a good seed chunk |
| Water cycle + weather | 50% | 38% | -12% | Same — expansion pushed out a relevant seed |
| Smoking + lung cancer | 17% | 0% | -17% | Worst regression — hub entities flooded results |
| 21 other queries | — | — | 0% | No change — graph expansion found nothing useful |

**Key observation:** The graph improved exactly 1 out of 25 multi-hop queries. It hurt 3 queries. 21 queries were unaffected (graph entities didn't connect to relevant chunks).

---

## 4. Diagnosis — Why the Graph Isn't Working

### Problem 1: Graph is too dense

1.2 million edges across 22K entities. The median edge weight is 2 (the minimum). This means most edges represent two entities that appeared together in only 2 chunks — very weak evidence of a real relationship. The graph is a nearly-complete subgraph for common entities.

**Evidence:** Entity "the" has frequency 3,939 in sciq (every chunk), "this" has 3,817 in medmcqa. Even with the hub filter (<100 chunks), entities at frequency 50-99 still create thousands of weak edges.

### Problem 2: N-gram candidates are too noisy

The 1-3 word n-gram extraction produces candidates like "the cell", "this type", "can be", "used to" alongside real entities like "photosynthesis", "metformin", "DNA replication". The frequency filter (≥3) removes unique noise but keeps common noise. The clustering at 0.85 helps with synonyms but doesn't distinguish real entities from noise phrases.

**Evidence:** 372K raw candidates → 38K after freq≥3 → 10K clusters. The 10K "entities" include many noise phrases that co-occur with everything, creating meaningless edges.

### Problem 3: Co-occurrence is too weak a signal for relationships

Two entities appearing in the same chunk doesn't mean they're related. In a medical Q&A chunk like "Q: What drug treats X? A: Y, which is metabolized by Z", the entities X, Y, Z all co-occur, but only the X→Y and Y→Z relationships are meaningful. Co-occurrence can't distinguish "metformin treats diabetes" from "metformin appears in the same paragraph as headache."

### Problem 4: The expansion doesn't surface new information

The seed-and-expand pattern assumes the graph connects seed entities to answer entities that are lexically distant from the query. But our co-occurrence edges connect entities that are topically similar (they appear in similar chunks). The expanded entities just point back to the same chunk neighborhood that FAISS already found.

**Evidence:** 21 out of 25 multi-hop queries had 0% change — the graph expansion didn't reach any new answer chunks that FAISS hadn't already ranked.

---

## 5. What the Guide Predicted vs What Happened

| Guide Prediction | Actual Result |
|---|---|
| "~50K candidate phrases after filtering" | 38K (sciq) + 33K (medmcqa) — close |
| "Expect 30-60 minutes of embedding work" | 15 min per pack — within estimate |
| "FAISS approximate nearest neighbor for clustering" | Implemented, works correctly |
| "+10.6 percentage points on R@10" (from committee test) | **-0.6 percentage points** — did not replicate |
| "Build B as safe baseline you can ship in 2 weeks" | Built in 1 day, but does not deliver lift |

The committee's empirical test was on a 52-chunk synthetic corpus. Our corpus is 13K chunks. The density of the graph scales quadratically with corpus size, which explains why their small test showed improvement while our full corpus shows noise dominance.

---

## 6. Infrastructure Status (Correctly Wired)

All integration points are properly connected:

| Trigger | RAG Rebuild | Graph Rebuild |
|---|---|---|
| Pack install | Yes | Yes (background) |
| Pack uninstall | Yes | Yes (background) |
| Pack toggle | Yes | Yes (background) |
| Re-embed all | Yes | Yes (inline) |
| Embedding model switch | Yes | Yes (inline) |
| Knowledge upload | Yes | Yes (background) |
| Chat retrieval | Uses graph when available | — |

The plumbing is correct. The issue is purely in retrieval quality.

---

## 7. Questions for the Committee

### Q1: Is the graph too dense?
1.2M edges for 22K entities. Should we raise the edge weight threshold from 2 to a higher value (5? 10?)? The P95 edge weight is 7-9, so threshold=5 would eliminate ~80% of edges.

### Q2: Is n-gram extraction the wrong approach for our corpus size?
At 13K chunks, the n-gram approach produces too many common-word "entities" that create meaningless co-occurrence edges. Would the LLM extraction (Phase 2) solve this by producing cleaner, typed entities — or would the same density problem occur?

### Q3: Should we change the entity frequency filter?
Current: min_freq=3. But entities at freq 50-99 still create thousands of edges. Should we add a max_freq cap (e.g., drop entities appearing in >5% of chunks)?

### Q4: Is the expansion strategy wrong?
Current: expand from seed entities to 1-hop neighbors, score by inverse sqrt of entity frequency. Should we instead:
- Only expand via edges with weight ≥ 5 (stronger co-occurrence)?
- Use a learned reranker after expansion instead of heuristic scoring?
- Weight expansion results by the similarity of the expanded entity to the query (not just co-occurrence)?

### Q5: Should we try the committee's recommended hybrid — query entity embedding?
Instead of expanding from chunk entities, embed the query, find the nearest entities in the entity embedding space, then look up their chunks directly. This skips the co-occurrence graph entirely and uses the entity embeddings as a second retrieval index.

### Q6: Should we abandon Phase 1 and go directly to Phase 2 (LLM extraction)?
The committee's guide said "ship Phase 1, then evaluate before Phase 2." Phase 1 does not deliver improvement. Should we skip to LLM extraction, which produces typed entities and explicit relations — or is the underlying problem (corpus density, co-occurrence weakness) going to affect LLM extraction equally?

### Q7: Is the eval set representative?
Our 50 queries produce very low baseline recall (9.5% R@10). This suggests the eval set may be too strict (answer chunks are too specific) or our embedding quality is the bottleneck (BGE Small may not match queries to knowledge pack chunks well). Should we audit the eval set quality before concluding the graph doesn't work?

---

## 8. Raw Data

### Eval reports saved at:
- `eval_report_baseline_hybrid.json` — 50-query baseline
- `eval_report_graph_tuned.json` — 50-query graph (tuned)

### Graph indices:
- `knowledge_graph_sciq_index.json` (14 MB)
- `knowledge_graph_medmcqa_index.json` (11 MB)

### Key parameters (current):
- `min_freq = 3` (entity candidate frequency threshold)
- `sim_threshold = 0.85` (clustering cosine threshold)
- `edge_weight >= 2` (co-occurrence filter)
- `hub_filter < 100` (max entity frequency for expansion)
- `expansion_cap = 30` (max expanded entities)
- `SEED_BOOST = 100.0`
- `BLEND_WEIGHT = 2.0`

---

*Awaiting committee guidance on tuning strategy or architectural pivot.*
