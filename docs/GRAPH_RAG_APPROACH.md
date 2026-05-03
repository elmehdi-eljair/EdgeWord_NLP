# Graph-Augmented RAG — Approach Document
## For Expert Committee Review

**Date:** 2026-05-03
**Author:** EdgeWord Engineering
**Status:** Draft — awaiting expert review
**Context:** EdgeWord runs 1B-3B LLMs on CPU with ONNX embeddings (BGE Small, 384d) and FAISS hybrid retrieval (dense + BM25). We need a graph layer to improve multi-hop reasoning over installed knowledge packs (medical, science, coding, finance, legal, etc.).

---

## 1. The Problem

Current retrieval is flat — FAISS finds chunks semantically similar to the query. This fails when the answer requires chaining facts through entities that aren't lexically close to the query.

**Example:** "What drugs should a diabetic patient with kidney problems avoid?"
- FAISS finds chunks about diabetes and chunks about kidney disease separately
- But the answer lives in the *relationship* between metformin → kidney contraindications → NSAID interactions
- No single chunk contains the full chain
- The user gets a partial answer or the model hallucinates the connection

**What we need:** A graph that connects entities across chunks so we can traverse from "diabetes" → "metformin" → "renal toxicity" → "NSAIDs to avoid" in 2-3 hops.

---

## 2. Current Architecture (What We Have)

```
User Query
    ↓
BGE Small Embedding (384d)
    ↓
Hybrid Retrieval: FAISS (dense) + BM25 (sparse) → RRF Fusion
    ↓
Top-K chunks → injected into LLM prompt
    ↓
LLM generates response
```

**Assets available:**
- BGE Small ONNX embedder (already loaded, shared across RAG + Skills)
- ~13K embedded chunks across 2 knowledge packs (sciq, medmcqa)
- All chunks stored as JSONL with pre-computed 384d embeddings as .npy
- 16 GB RAM, CPU only, no GPU
- KuzuDB installed (embedded graph database)

---

## 3. Approaches Under Consideration

### Approach A: Regex + Heuristic Entity Extraction (Rejected)

Hardcoded patterns like `r'[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}'` to find capitalised noun phrases, plus signal-word patterns for relationships.

**Why rejected:** Brittle, domain-specific, produces noise ("in patients with" extracted as entity), doesn't scale across knowledge domains, requires manual tuning per domain.

### Approach B: Embedding-Based Key Phrase Extraction + Similarity Graph

Use the embedding model to identify meaningful phrases and build a graph from embedding similarity.

**How it works:**

1. **Candidate extraction:** For each chunk, extract candidate phrases using lightweight NLP:
   - Noun phrases via POS-like heuristics (or simply n-grams of 1-4 words)
   - Filter by minimum length and basic frequency

2. **Candidate embedding:** Embed each candidate phrase using BGE Small (same model, already loaded)

3. **Entity resolution:** Cluster candidates across all chunks by embedding similarity:
   - Candidates with cosine similarity > 0.85 are the same entity (e.g., "type 2 diabetes" ≈ "diabetes mellitus type 2")
   - Select the most frequent surface form as canonical name
   - This handles synonyms, abbreviations, and spelling variations automatically

4. **Edge construction:** Two entities are connected if:
   - They co-occur in the same chunk (proximity edge, weighted by chunk count)
   - Their embeddings are similar but not identical (semantic edge, weighted by cosine score)

5. **Graph storage:** KuzuDB with nodes = entities, edges = typed relationships

6. **Retrieval:** Seed-and-expand pattern from the hybrid reasoning spec

**Pros:** Domain-agnostic, leverages existing embedding model, handles synonyms, no hardcoded rules
**Cons:** Computationally expensive (embed all n-grams), may extract too many candidates

### Approach C: Chunk-Level Graph (No Entity Extraction)

Skip entity extraction entirely. Build the graph at the chunk level.

**How it works:**

1. **Nodes = chunks** (we already have ~13K chunks with embeddings)

2. **Edges between chunks** based on:
   - **Embedding similarity:** chunks with cosine > 0.7 are linked (semantic neighbors)
   - **Lexical overlap:** chunks sharing rare terms (TF-IDF weighted) are linked
   - **Source proximity:** chunks from the same knowledge pack row are linked
   - **Cross-pack bridges:** chunks from different packs that are semantically similar (enables cross-domain reasoning)

3. **Retrieval:** 
   - FAISS returns top-3 seed chunks
   - Graph traversal follows edges to find related chunks (1-2 hops)
   - These are chunks that wouldn't be found by direct query similarity but are reachable through the graph

4. **Graph construction:** Pre-compute edges during knowledge pack installation (one-time cost). Store as adjacency list or in KuzuDB.

**Pros:** No entity extraction needed, leverages existing embeddings directly, guaranteed to work across all domains, simple to implement, edges are meaningful (chunk similarity is well-defined)
**Cons:** Graph is large (13K nodes × potential edges), no explicit entity names for traversal, harder to explain "why" a chunk was retrieved

### Approach D: Hybrid — Embedding Entities + Chunk Graph

Combine Approaches B and C:

1. **Chunk-level graph** for multi-hop traversal (Approach C)
2. **Lightweight entity extraction** using the embedding model to identify "anchor terms" — words/phrases whose embeddings are most distinctive (highest cosine distance from the chunk's mean embedding = most informative terms)
3. **Entity index** maps entity names → chunks they appear in (inverted index)
4. **Retrieval:** Query entities are matched to the entity index, then the chunk graph is traversed from those entry points

**Pros:** Best of both worlds — entity-level precision + chunk-level coverage
**Cons:** Most complex to implement

---

## 4. Constraints

| Constraint | Impact |
|---|---|
| CPU only, 16 GB RAM | Can't run NER models (SpaCy, BERT-NER) — too slow. Must use existing BGE Small. |
| ~13K chunks now, scaling to ~100K+ | Graph construction must be O(n log n) or better, not O(n²) |
| Multi-domain (medical, science, coding, finance, legal) | No domain-specific rules. Must work for any installed knowledge pack. |
| Real-time retrieval | Graph traversal must complete in < 50ms (spec says 5-15ms for 3-hop) |
| Knowledge packs are installed incrementally | Graph must support incremental updates (add new pack without rebuilding entire graph) |

---

## 5. Questions for the Committee

1. **Approach selection:** Which approach (B, C, or D) best balances quality, performance, and implementation complexity for our constraints?

2. **Entity extraction quality:** Is embedding-based key phrase extraction (Approach B) reliable enough without a proper NER model? Or should we skip entities and go chunk-level (Approach C)?

3. **Edge construction:** For chunk-level graphs, what similarity threshold should we use? Too low = noisy graph, too high = sparse graph. Is 0.7 cosine a good starting point?

4. **Scalability:** With 100K+ chunks, pre-computing all pairwise similarities is O(n²). Should we use approximate nearest neighbors (FAISS already supports this) to find edges efficiently?

5. **Cross-domain reasoning:** Should we build one unified graph or per-pack graphs that are merged? A medical-to-science bridge could enable "How does photosynthesis relate to cellular glucose metabolism in diabetes?" but might also introduce noise.

6. **Evaluation:** How should we measure graph quality? The spec suggests a multi-hop eval set with known answer entities. Should we build this before implementing the graph?

7. **LLM-assisted extraction:** Should we use the 1B LLM itself to extract entities and relationships from chunks? It's slow (~1s per chunk) but would be truly domain-agnostic. Could run as a background processing job during pack installation.

---

## 6. Recommended Implementation Sequence

Regardless of approach chosen:

1. **Build evaluation set first** (spec Section 5, step 1) — 50 multi-hop queries with known answers across installed knowledge packs
2. **Implement chosen approach** with measurable retrieval recall
3. **Compare against baseline** (current FAISS-only retrieval) on the eval set
4. **Iterate on edge thresholds and traversal parameters** based on eval results
5. **Wire into live chat** only after demonstrating improvement on eval set

---

## 7. Current Baseline Performance

For reference, current hybrid retrieval (FAISS + BM25) on representative queries:

| Query Type | Sources Retrieved | Quality |
|---|---|---|
| Single-hop factual ("symptoms of diabetes") | 3 chunks from medmcqa | Good |
| Multi-hop with conjunction ("diabetes and kidney risks") | 6 chunks via decomposition | Decent — decomposition helps |
| Multi-hop requiring entity chain ("drugs interacting with metformin for kidney patients") | 3-6 chunks | Weak — missing the entity chain |
| Cross-domain ("how does exercise affect blood glucose at the cellular level") | Mixed science + medical | Poor — no cross-pack bridging |

The graph layer should specifically improve the last two categories.

---

## 8. Resources

- [Hybrid Reasoning Stack spec](/home/e-eljair/edgeword_nlp/hybrid_reasoning_stack.md) — Section 2: Graph-Augmented Retrieval
- Current embeddings: BGE Small EN v1.5 (384d, ONNX)
- Graph DB: KuzuDB 0.11.3 (embedded, installed)
- Knowledge packs: sciq (6,182 chunks), medmcqa (6,598 chunks)

---

*Awaiting committee review and direction.*
