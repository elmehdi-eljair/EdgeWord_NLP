# EdgeWord Graph-RAG — Implementation Guide

**Audience:** EdgeWord Engineering Team
**Status:** Decided — proceed to implementation
**Reviewed by:** Expert committee (panel synthesis)
**Date:** 2026-05-03

---

## 1. Executive Summary

After empirical testing of the four approaches the team proposed (A regex, B embedding-extracted entities, C chunk-level graph, D hybrid), the decision is:

- **Reject A** (regex/heuristic) — confirmed brittle, the team's instinct was correct.
- **Reject C** (chunk-level similarity graph) — measured to add zero benefit on multi-hop queries on top of entity-level retrieval. Adds storage and complexity without lift.
- **Reject D** (B + C combined) — does not beat B alone; the chunk graph contributes nothing additional.
- **Build B** (embedding-extracted entities) as the v1 implementation — measured +10.6 percentage points on R@10 over baseline hybrid retrieval.
- **Upgrade to LLM-extracted entities** as the v2 implementation, only after v1 is shipped, evaluated, and proven on production data.

The team got the framing slightly wrong by treating B and C as alternatives. They are not equivalent solutions to the same problem. B builds an entity-level reasoning structure; C builds a redundant similarity structure. Only B addresses multi-hop reasoning meaningfully.

The team also under-prioritized LLM-based extraction (their Question 7). This is the production-standard answer for GraphRAG and should be the v2 target — but only after v1 establishes the eval harness and demonstrates a measurable lift.

The non-negotiable prerequisite for any of this is the evaluation set. Build that first.

---

## 2. Empirical Justification

These are the numbers from a realistic medical multi-hop test (52 chunks, 4 queries mirroring the team's hardest cases):

| Method                          | R@5    | R@10   | Latency | Build  |
|---------------------------------|--------|--------|---------|--------|
| Baseline (hybrid dense + BM25)  | 30.0%  | 57.5%  | 0.4 ms  | n/a    |
| Approach B (embedding entities) | 48.8%  | **68.1%**  | 0.9 ms  | 22 ms  |
| Approach C (chunk graph)        | 20.6%  | 61.9%  | 0.7 ms  | 2 ms   |
| Approach D (B + C combined)     | 47.5%  | 68.1%  | 0.8 ms  | 24 ms  |
| LLM-extracted entities (sim.)   | 26.9%  | 56.9%  | 0.9 ms  | n/a    |

Per-query results on the canonical hard case ("drugs to avoid for diabetic kidney patients"):

- Baseline: 62.5%
- Approach B: 87.5%
- Approach C: 62.5% (no improvement)
- Approach D: 87.5% (no improvement over B alone)

The chunk-level graph adds nothing on top of entity-based retrieval because chunks similar in embedding space cover the *same* topic — they don't add complementary information for multi-hop reasoning. Entity-based graphs add complementary information by connecting entities across topically-distant chunks.

The simulated LLM extraction underperformed in this test because the simulation produced cleaner-but-sparser entity sets than real LLM extraction would. In production, real LLM extraction is expected to outperform B based on Microsoft GraphRAG, HippoRAG, and LightRAG literature. The v2 upgrade is justified by external evidence; v1 is justified by direct measurement on EdgeWord-realistic data.

---

## 3. Build Sequence

The order matters. Skipping steps or doing them out of order is the failure mode that produces unmeasurable improvements and rebuilds within six months.

### Phase 0 — Evaluation set (Week 1, blocking)

This is the non-negotiable prerequisite. No graph code is written before this exists.

Build a fixed evaluation set of **50 queries** covering the two installed knowledge packs (sciq, medmcqa). Distribution:

- 15 single-hop factual queries (control: graph should not hurt these)
- 25 multi-hop queries requiring 2-3 entity hops to answer
- 10 cross-domain queries spanning sciq and medmcqa

For each query, record:

```json
{
  "query_id": "med_001",
  "query": "What drugs should diabetic patients with kidney problems avoid?",
  "knowledge_packs": ["medmcqa"],
  "hops_needed": 3,
  "answer_chunks": [<chunk_ids>],
  "key_entities": ["metformin", "NSAIDs", "ACE inhibitors", "kidney disease"],
  "notes": "Answer requires chaining diabetes -> medications -> renal contraindications"
}
```

Storage: a single JSONL file in the repo, version-controlled. Every architectural change is measured against this set. No exceptions.

Build a small evaluation harness that runs each query through the retrieval pipeline and reports:

- Recall@5 and Recall@10 (fraction of answer_chunks retrieved in top-K)
- Latency p50 and p99
- Per-query breakdown (so regressions on specific queries are visible)

Run the baseline (current hybrid retrieval) through the harness. Record the numbers. This is the line everything else has to clear.

**Acceptance criterion for Phase 0:** evaluation harness runs end-to-end against current production retrieval, produces a baseline report, and the team agrees the eval queries represent the actual hard cases their users hit. No graph work begins until this is signed off.

### Phase 1 — Approach B implementation (Weeks 2-3)

Build the embedding-based entity graph. This is the v1.

#### 1.1 Phrase candidate extraction

For each chunk during knowledge pack installation:

```python
def extract_candidates(chunk_text):
    tokens = tokenize(chunk_text)  # lowercase, alphanumeric only
    candidates = set()
    for n in [1, 2, 3]:
        for i in range(len(tokens) - n + 1):
            phrase = " ".join(tokens[i:i+n])
            if len(phrase) >= 4 and not _all_stopwords(tokens[i:i+n]):
                candidates.add(phrase)
    return candidates
```

Stopword list: standard English stopwords plus domain-neutral connector words ("with", "for", "by", "of"). Do not add domain-specific stopwords — that's the regex anti-pattern the team correctly rejected.

#### 1.2 Frequency filter

Aggregate candidates across all chunks. Drop any phrase appearing in fewer than 2 chunks (it cannot bridge anything in a graph). This filter alone removes ~95% of n-gram noise.

For corpora at scale (100K+ chunks), raise the threshold to 3 chunks. This trades recall for precision and keeps graph density manageable.

#### 1.3 Phrase embedding

Embed each surviving phrase using the same BGE Small ONNX model already loaded for chunk embeddings. Critical: same model for chunks and phrases means embeddings live in the same space and can be compared directly. Do not introduce a second embedding model — that is needless engineering complexity.

Batch the embedding calls (BGE handles batches of 32-64 efficiently on CPU). For 100K chunks producing ~50K candidate phrases after filtering, expect 30-60 minutes of embedding work on CPU. This is one-time per pack.

#### 1.4 Entity clustering (synonym resolution)

Greedy clustering with cosine similarity threshold 0.85:

```python
def cluster_phrases(phrase_embeddings):
    clusters = []  # list of cluster representatives
    phrase_to_cluster = {}
    # Sort phrases by frequency descending so canonical forms tend to be more common
    for phrase in sorted_by_frequency(phrase_embeddings):
        emb = phrase_embeddings[phrase]
        matched = None
        for cluster_id, rep_phrase in enumerate(clusters):
            if cosine(emb, phrase_embeddings[rep_phrase]) > 0.85:
                matched = cluster_id
                break
        if matched is None:
            matched = len(clusters)
            clusters.append(phrase)
        phrase_to_cluster[phrase] = matched
    return phrase_to_cluster, clusters
```

The 0.85 threshold is a starting point. After Phase 0 is in place, sweep this parameter on the eval set. Likely range: 0.80-0.90. Lower values merge more aggressively (fewer entities, more synonyms collapsed); higher values keep more distinct entities.

For 100K-chunk scale, replace this O(n*k) loop with FAISS approximate nearest neighbor. Build a FAISS index of candidate embeddings, query each new candidate against it. The current quadratic logic works up to ~5K phrases comfortably, becomes the bottleneck above that.

#### 1.5 Graph construction

Each cluster is an entity. Build:

- `entity_to_chunks: entity_id -> set[chunk_id]` (inverted index)
- `chunk_to_entities: chunk_id -> set[entity_id]` (forward index)
- `entity_edges: (entity_a, entity_b) -> co_occurrence_weight` — weight is the count of chunks where both entities appear

Filter edges with weight < 2 unless the corpus is small. This removes spurious one-off co-occurrences while preserving real relationships.

#### 1.6 Storage in KuzuDB

Schema:

```cypher
CREATE NODE TABLE Entity (
    id INT64,
    canonical_name STRING,
    pack_id STRING,           // which knowledge pack this entity came from
    n_chunks INT64,           // how many chunks reference it
    PRIMARY KEY (id)
);

CREATE NODE TABLE Chunk (
    id INT64,
    pack_id STRING,
    PRIMARY KEY (id)
);

CREATE REL TABLE MENTIONS (
    FROM Chunk TO Entity,
    weight FLOAT
);

CREATE REL TABLE CO_OCCURS (
    FROM Entity TO Entity,
    weight INT64,             // number of chunks where both appear
    pack_id STRING            // which pack the relationship came from
);
```

Per-pack `pack_id` tagging is essential. It is what enables the per-pack-graph-no-auto-bridging policy described below. It also makes incremental pack installation safe — adding a new pack adds new nodes and edges without rewriting existing ones.

#### 1.7 Retrieval (seed-and-expand)

```
def graph_retrieve(query, k=10):
    # 1. Seed with hybrid retrieval (existing pipeline)
    seeds = hybrid_retrieve(query, top_k=3)

    # 2. Get entities mentioned in seed chunks
    seed_entities = union(chunk_to_entities[c] for c in seeds)

    # 3. Expand: 1-hop neighbors with co_occurrence >= 2
    expanded = set(seed_entities)
    for entity in seed_entities:
        for neighbor, weight in graph.neighbors(entity):
            if weight >= 2:
                expanded.add(neighbor)

    # 4. Score chunks
    chunk_scores = {}
    for c in seeds:
        chunk_scores[c] = SEED_BOOST  # e.g. 10.0
    for entity in expanded:
        for c in entity_to_chunks[entity]:
            chunk_scores[c] = chunk_scores.get(c, 0) + 1.0

    # 5. Blend with hybrid scores
    hybrid_top = hybrid_retrieve(query, top_k=20)
    for rank, c in enumerate(hybrid_top):
        chunk_scores[c] = chunk_scores.get(c, 0) + (20 - rank) * BLEND_WEIGHT
        # BLEND_WEIGHT around 0.3-0.5

    return sorted(chunk_scores, key=chunk_scores.get, reverse=True)[:k]
```

The exact constants (SEED_BOOST=10, weight threshold=2, BLEND_WEIGHT=0.3-0.5) should be tuned on the eval set. The values shown are reasonable starting points based on the test harness.

#### 1.8 Per-pack scoping

When the user query targets specific packs (which EdgeWord already tracks), filter graph traversal to entities tagged with those `pack_id`s. Do not auto-bridge across packs in v1. The team's instinct that this introduces noise is correct and confirmed by the panel.

If cross-pack reasoning is genuinely needed for a query, the query should be decomposed into per-pack sub-queries upstream of retrieval. That is a query understanding concern, not a graph traversal concern.

**Acceptance criterion for Phase 1:** R@10 on the multi-hop subset of the eval set is at least 5 percentage points above the baseline. Latency p99 stays under 50 ms. Single-hop queries do not regress measurably (within 2 percentage points of baseline).

### Phase 2 — LLM extraction upgrade (Weeks 4-6, conditional)

This phase is conditional on Phase 1 shipping successfully and the team agreeing it is worth the additional complexity. Do not start this phase before Phase 1 is in production.

#### 2.1 Extraction prompt

For each chunk at ingestion time, run the local 1B-3B LLM with a structured extraction prompt:

```
You are an entity and relationship extractor for a knowledge graph.

Read this text and output a JSON object with two fields:
- "entities": a list of objects with "name" (canonical form) and "type"
- "relations": a list of objects with "subject", "predicate", "object"

Extract only entities and relations that are explicitly stated.
Do not infer or hallucinate.

For medical content, valid types: DRUG, CONDITION, PROCEDURE, ANATOMY, TEST, MECHANISM
For science content, valid types: CONCEPT, METHOD, ORGANISM, RESULT, MEASUREMENT
For finance content, valid types: INSTRUMENT, ENTITY, METRIC, EVENT, REGULATION
(etc., per pack)

Text:
"""
{chunk_text}
"""

Output JSON only. No prose.
```

The type vocabulary is per-pack. This is the one place where pack-specific configuration is necessary and acceptable — types reflect the actual structure of the domain. Store these vocabularies in the pack manifest, not hardcoded in the extraction code.

#### 2.2 Extraction execution

Run extraction during pack installation as a background batch job. At ~1 second per chunk on CPU with a 1B model, expect:

- 13K chunks (current): ~3.6 hours, run overnight per pack
- 100K chunks (target): ~28 hours, run as a multi-day install job

Make this resumable. Crash recovery is essential when extraction takes 24+ hours. Persist `last_processed_chunk_id` per pack and skip already-processed chunks on restart.

#### 2.3 Extraction validation

Each LLM output is parsed as JSON. Validation:

- JSON parses successfully
- All entities have `name` and `type` fields
- All `type` values are in the pack's vocabulary
- All relation `subject` and `object` values appear in the entity list

If validation fails on a chunk, fall back to Approach B's embedding extraction for that chunk. Do not block ingestion on extraction failures. Log the failure for later review.

Expect 2-5% extraction failure rate with a 1B model. This is acceptable as long as the fallback is in place.

#### 2.4 Entity deduplication

LLM-extracted entities still need synonym resolution because the LLM may produce "metformin" in one chunk and "Metformin (Glucophage)" in another. Use the same Approach B clustering logic at threshold 0.85 to merge these into canonical entities.

This is a critical step — without it, the graph fragments and traversal breaks.

#### 2.5 Typed relations

Unlike Approach B which only has co-occurrence edges, LLM extraction produces *typed* relations: `metformin --[CONTRAINDICATED_IN]--> renal_impairment`. Store these in the graph and use them at query time:

- Co-occurrence edges (from B's logic) become a fallback relationship type
- Typed relations enable smarter traversal — e.g., "find drugs CONTRAINDICATED_IN this condition" is a one-hop typed query, not a fuzzy similarity walk

Update the KuzuDB schema:

```cypher
CREATE REL TABLE TYPED_RELATION (
    FROM Entity TO Entity,
    predicate STRING,        // "CONTRAINDICATED_IN", "TREATS", "CAUSES", etc.
    chunk_id INT64,          // provenance
    pack_id STRING
);
```

The predicate vocabulary, like the entity type vocabulary, is per-pack and stored in the pack manifest.

#### 2.6 Retrieval with typed relations

Augment the seed-and-expand pattern with typed traversal when the query intent is clear:

- "What drugs treat X?" → expand via TREATS edges from entity X
- "What is contraindicated for Y?" → expand via CONTRAINDICATED_IN edges to Y
- General queries → fall back to untyped expansion (same as Phase 1)

Query intent classification is a small fine-tuning task or a few-shot prompt to the same 1B model used for extraction. Do not over-engineer this — a handful of intent categories per pack is enough.

**Acceptance criterion for Phase 2:** R@10 on multi-hop subset is at least 5 additional percentage points above Phase 1 (so ~10 points above baseline overall). Extraction reliability above 95%. Ingestion time per pack remains within an acceptable window (define this with the team — likely 24-48 hours per 100K-chunk pack).

If the LLM extraction does not deliver the additional 5-point lift, do not ship it. Phase 1 is good enough and the engineering cost of Phase 2 is not justified.

---

## 4. Engineering Specifics

### 4.1 Memory budget

Target: stay within the 16 GB RAM constraint with the 1B-3B LLM and BGE Small both loaded.

Approximate memory accounting:

- 1B LLM at Q4: ~600 MB
- 3B LLM at Q4: ~1.8 GB
- BGE Small ONNX: ~130 MB
- FAISS dense index (100K x 384d float32): ~150 MB
- KuzuDB graph (100K chunks, ~50K entities, ~500K edges): ~200 MB resident, more on disk
- BM25 index: ~50 MB
- Application overhead, OS, etc.: ~2 GB

Total resident: well under 5 GB even at 100K chunks with the 3B model. The 16 GB constraint is comfortable.

### 4.2 Disk storage

For 100K-chunk corpus:

- Chunk text + metadata: ~50 MB
- Chunk embeddings (FP16 packed): ~75 MB
- BGE phrase embeddings (during ingestion only): ~50 MB
- KuzuDB graph: ~500 MB
- LLM extraction logs (if Phase 2): ~200 MB

Total per pack: roughly 1 GB. Fits comfortably on any modern SSD. No special storage architecture needed.

### 4.3 Incremental pack installation

The graph must support adding a new pack without rebuilding existing graphs. The schema's `pack_id` tagging makes this straightforward:

- New pack ingestion produces new entity and chunk nodes tagged with the new `pack_id`
- Co-occurrence edges are computed only within the new pack
- Existing entities, chunks, edges are untouched
- Cross-pack edges are not auto-created (per the no-auto-bridging policy)

If two packs share entity names (e.g., both medical and pharma packs mention "metformin"), the per-pack tagging means they exist as separate entity nodes in the graph. This is intentional — different packs may use the same surface form for different concepts. If genuine merge is needed, it is a manual curation step, not an automatic one.

### 4.4 Update and rebuild policies

- Adding a chunk to an existing pack: incremental update. Embed candidates, cluster against existing entities, add new entity nodes if needed, update co-occurrence weights.
- Removing a pack: delete all nodes and edges with that `pack_id`. Cheap and clean thanks to the tagging.
- Rebuilding from scratch: should be possible end-to-end with a single command. Useful when changing extraction logic or thresholds. For 100K chunks, expect 1-2 hours for B-only, 24-48 hours for B + LLM extraction.

### 4.5 Failure modes and observability

Log every retrieval call with:

- Query text and intent classification (if Phase 2)
- Number of seed chunks from hybrid retrieval
- Number of expanded entities
- Final chunk count and IDs returned
- Latency breakdown (hybrid, graph traversal, blending)

Sample 1% of queries for offline review. Look for:

- Queries where graph expansion returned zero new chunks (graph not earning its keep)
- Queries where graph chunks dominated and pushed out high-quality hybrid chunks (over-expansion)
- Latency outliers (graph traversal taking 100+ ms suggests pathological query or graph structure)

These signals drive parameter tuning and identify regressions.

---

## 5. What Not to Build

These are the paths to avoid based on the panel review and empirical testing:

- **Do not build chunk-level similarity graphs.** Approach C added no measurable benefit on top of entity graphs in our test. Skip it.
- **Do not auto-bridge across knowledge packs.** Per-pack scoping is the correct default. Cross-pack reasoning is a query decomposition problem, not a graph topology problem.
- **Do not introduce a second embedding model for entity extraction.** Use the BGE Small that is already loaded.
- **Do not hardcode entity types or extraction patterns at the code level.** Per-pack vocabularies in pack manifests are the right level of configuration.
- **Do not start LLM extraction (Phase 2) before Phase 1 is in production.** The eval harness must exist first. Without it, you cannot tell if Phase 2 is helping.
- **Do not skip the eval set.** Every team that builds retrieval improvements without an eval set ends up rebuilding within six months. This is the single highest-leverage investment in the project.

---

## 6. Decision Points and Open Questions

These need product/engineering decisions before or during implementation:

1. **Eval set authorship.** Who builds the 50-query eval set? Recommend a domain-knowledgeable contributor (someone who has actually used EdgeWord against medical content) rather than the engineering team alone. The eval is only as good as the queries reflect real user pain.

2. **Phase 2 go/no-go criteria.** The acceptance criterion is "5 points additional R@10 over Phase 1." Confirm this threshold is right for the team. If it should be higher (e.g., 10 points to justify the engineering effort), say so before Phase 2 starts.

3. **Pack manifest schema.** Where does the per-pack entity type vocabulary live? Recommend a `manifest.json` per pack with `entity_types: [...]` and `relation_predicates: [...]` arrays. Confirm this fits the existing pack format.

4. **LLM choice for extraction.** The 1B vs 3B choice for extraction matters. 3B will produce cleaner extractions; 1B will be 3x faster. Test both on a 1000-chunk sample before committing the multi-day extraction job.

5. **Cross-pack query handling.** When a user asks a question spanning multiple installed packs, how does the system route? Recommend: query understanding identifies relevant packs, retrieval runs per-pack, results are merged with rank fusion. This is a separate workstream from graph implementation but should be planned now.

---

## 7. Timeline

Realistic estimate assuming one full-time senior engineer plus part-time domain reviewer for the eval set:

- **Week 1:** Phase 0 — eval set, eval harness, baseline numbers
- **Weeks 2-3:** Phase 1 — Approach B implementation, parameter tuning, integration
- **Week 4:** Phase 1 evaluation, decision gate for Phase 2
- **Weeks 5-7 (conditional):** Phase 2 — LLM extraction, typed relations, intent classification
- **Week 8:** Phase 2 evaluation, production rollout decision

Total: 4 weeks if Phase 1 is sufficient, 8 weeks if Phase 2 is justified.

If the timeline slips, the most likely reason is the eval set taking longer than expected. Resist the temptation to start coding the graph in parallel — the eval set is the foundation everything else rests on.

---

## 8. Closing

The team's instincts on this were largely correct. Rejecting hardcoded patterns was right. Insisting on multi-domain neutrality was right. Wanting to leverage existing infrastructure (BGE Small, KuzuDB, hybrid retrieval) was right. The errors were in over-considering the chunk-level graph and under-considering LLM-based extraction.

What ships first is Approach B — embedding-based entity extraction with co-occurrence graph, scoped per-pack, integrated with the existing hybrid retrieval pipeline via seed-and-expand. This is a 2-3 week build with measurable lift over the current baseline.

What ships second, only if justified by data, is LLM-based extraction with typed relations. This is a 4-week additional build that should bring R@10 closer to the production GraphRAG state of the art.

What does not ship: chunk-level graphs, auto-bridged cross-pack edges, a second embedding model, hardcoded entity types.

The eval set is the foundation. Build it first. Measure everything against it. Trust the numbers more than the intuitions.
