# Phase 2 Stream C — LLM Extraction Pilot Report
## For Expert Committee Review

**Date:** 2026-05-03
**Status:** Pilot attempted — blocked by hardware constraints
**Decision needed:** How to proceed given extraction speed vs committee's estimate

---

## 1. What We Attempted

Following the committee's Phase 2 spec (Section 4), we built the LLM extraction pipeline and ran the pre-flight pilot on medmcqa chunks using the 1B model.

### Pipeline Built

- `llm_extractor.py` — complete extraction module with:
  - Per-domain predicate vocabularies (medical, science, coding, default)
  - Per-domain entity type sets
  - Structured extraction prompt following committee's refined template (Section 4.3)
  - JSON parser with common LLM output fixing (trailing commas, stop tokens, embedded prose)
  - Entity/relation validation (name check, type check, relation endpoint check)
  - `run_pilot()` method with progress tracking and quality metrics
  - Decision gate logic (parse failure rate, avg entities/chunk)

### What We Tested

- 3 medmcqa chunks via the live API (`POST /v1/chat` with `use_rag=false, use_tools=false`)
- 500-chunk pilot via direct LLM loading (crashed — OOM with two Llama instances)
- 500-chunk pilot via API (blocked by speed)

---

## 2. Results

### Speed

| Method | Time per Chunk | 500-Chunk Pilot | Full Pack (6.6K) | Full Both Packs (13K) |
|---|---|---|---|---|
| **Committee estimate** | ~1s | ~8 min | ~1.8 hours | ~3.6 hours |
| **Actual (via API)** | **~200s** | **~28 hours** | **~15 days** | **~30 days** |
| **Actual (direct LLM)** | ~50s (estimated) | ~7 hours | ~4 days | ~8 days |

The 200s via API includes LLM lock contention (the API server serializes all LLM access through a global lock — other requests like health checks and notification polling acquire the lock between extraction calls). Direct LLM access would be ~50s but requires a separate process that competes for RAM.

### Why the Discrepancy with Committee's Estimate

The committee estimated "~1 second per chunk" (Section 4.4 of the implementation guide). This estimate was based on:

1. **Higher throughput models.** The estimate assumes 30B-70B class models on GPU, which process 500-token prompts + 300-token generations in ~1s. Our 1B model on CPU processes at ~15 tokens/second.

2. **Prompt length.** The structured extraction prompt (system instructions + predicate vocabulary + entity types + format instructions + chunk text) totals ~400-500 input tokens. At 15 t/s prompt processing, that's ~30s just to process the prompt before generation begins.

3. **Generation length.** A well-formed JSON extraction output with 3-8 entities and 2-5 relations is ~200-300 tokens. At 15 t/s generation, that's ~15-20s per chunk.

4. **Minimum theoretical time per chunk:** ~50s (30s prompt + 20s generation). The 200s observed via API includes lock contention overhead.

### Quality (from 1 successful extraction)

The single chunk that completed extraction produced:

```
Chunk: "n lipase is not an adipocyte enzyme..."
```

**Extracted:**
- Entity: `lipase` (type: DRUG) — **partially correct** (lipase is an enzyme, not a drug; type classification wrong)
- Relation: subject was the full sentence text instead of an entity name — **malformed**

**Assessment:** The 1B model can identify entities but struggles with:
- Correct entity typing (called an enzyme a "drug")
- Structured JSON output (relation format was wrong)
- Following the constrained predicate vocabulary (used "NOT" instead of a valid predicate)

This is a sample of 1 — insufficient for conclusions. But the pattern matches what the committee warned: "Expect 2-5% extraction failure rate with a 1B model." Our single observation suggests the failure rate may be higher, and the quality of successful extractions may be lower than needed.

---

## 3. Hardware Constraints

| Resource | Available | Used by Stack | Available for Extraction |
|---|---|---|---|
| RAM | 16 GB | ~4 GB (LLM + embeddings + FAISS + BM25 + graph) | ~10 GB free |
| CPU cores | 4C/8T | 4 threads (LLM) + 1 (API) | Shared — LLM extraction competes |
| LLM throughput | ~15 t/s (1B Q4) | Shared via global lock | Cannot parallelize |

The fundamental bottleneck is **LLM throughput on CPU**. The 1B model at 15 t/s cannot process the extraction prompt + generate structured JSON fast enough for practical batch processing.

### Two Llama Instances

We attempted loading a second Llama instance for dedicated extraction. This crashed — two Llama-3.2-1B instances require ~1.2 GB RAM each plus KV cache, which combined with the rest of the stack exceeded available memory.

---

## 4. Options We See

### Option A: Run Overnight (Accept the Time)

Run the 500-chunk pilot over 7-28 hours as a background job. Accept that full-pack extraction takes days.

- **Pro:** Gets real quality data for the decision gate
- **Pro:** One-time cost per pack (run once, use forever)
- **Con:** 8-30 days for full extraction of both packs
- **Con:** LLM is locked during extraction — chat is unavailable or severely degraded
- **Feasibility:** Possible but painful. Would need to run during off-hours when chat isn't needed.

### Option B: Shorter Prompt + Lower Tokens

Reduce the extraction prompt to bare minimum (~100 tokens) and cap generation at 150 tokens. Estimated 15-20s per chunk instead of 50-200s.

```
Extract entities and relations as JSON.
Entities: named things (drugs, conditions, etc.)
Relations: subject-predicate-object between entities.
JSON only. Text: "{chunk[:500]}"
```

- **Pro:** 3-5x faster (~15-20s/chunk → pilot in 2-3 hours)
- **Con:** Shorter prompt = less guidance = noisier extraction
- **Con:** Still 2-4 days for full pack extraction
- **Feasibility:** Worth testing. Could run pilot in 2-3 hours.

### Option C: Wait for 3B Model

The 3B model (currently downloading via CDN at ~300 KB/s) would provide:
- Better JSON compliance (larger models produce more reliable structured output)
- Same throughput bottleneck (~8 t/s on 3B vs ~15 t/s on 1B, so actually slower)
- Better entity typing and relation extraction quality

- **Pro:** Higher quality extraction
- **Con:** Slower per-chunk (8 t/s vs 15 t/s)
- **Con:** 3B download may still be incomplete
- **Feasibility:** Only if 3B quality justifies the even slower speed.

### Option D: External API for Extraction Only

Use a cloud LLM API (Claude, GPT-4, etc.) for the one-time extraction job only. The extracted graph runs locally forever.

- **Pro:** Fast (seconds per chunk), high quality
- **Pro:** One-time cost, extracted data is sovereign afterward
- **Con:** Violates the "no cloud dependency" architecture principle for the extraction step
- **Con:** API cost for 13K chunks × ~800 tokens each
- **Feasibility:** Architecturally clean if framed as "development-time tooling, not production dependency" — the committee's original spec noted: "This rules out OpenAI/Anthropic APIs in the production path but allows them in the development and evaluation path."

### Option E: Skip LLM Extraction

Ship with the current n-gram graph (Phase 1 Approach B).

- **Pro:** Already delivers +6.5 R@10 measured improvement
- **Pro:** Zero additional engineering cost
- **Con:** 22K noisy entities vs estimated 2K clean LLM-extracted entities
- **Con:** No typed relations — cannot do structured graph queries
- **Feasibility:** The honest baseline. If no other option is viable, this is what ships.

---

## 5. What the Current Architecture Already Delivers

For context on what we're optimizing beyond:

| Metric | Current (Phase 1) |
|---|---|
| Overall R@10 | 91.5% |
| Multi-hop R@10 | 95.0% |
| Cross-domain R@10 | 100.0% |
| Graph entities | 22K (n-gram, noisy) |
| Graph edges | 1.2M (co-occurrence, mostly weak) |
| Retrieval latency | ~50ms |

These are strong numbers. The question is whether LLM extraction's cleaner graph (estimated ~2K entities, ~5K typed edges) would lift R@10 further, improve R@5 (currently -2.2 vs baseline), or enable new capabilities (typed traversal) that justify the extraction cost.

---

## 6. Questions for the Committee

### Q1: Is Option B (shorter prompt) worth testing?

A 2-3 hour pilot with a minimal prompt would give us real quality data. If the 1B model can produce usable entities even with a short prompt, it changes the calculus. But if quality is poor with a short prompt, we've spent 3 hours confirming what one chunk already suggested.

### Q2: Does Option D (cloud API for extraction) violate the architecture's spirit?

The committee's spec (Section 4.9 of the hybrid reasoning stack) said cloud APIs are acceptable "in the development and evaluation path." Entity extraction is a one-time build step, not a production runtime dependency. The extracted graph is local and sovereign. Is this a defensible framing?

### Q3: Should we accept the time cost of Option A?

If quality is the priority and the team can tolerate 1-2 weeks of background extraction (with degraded chat during that period), the extraction produces the highest quality graph. The committee estimated 24-48 hours; our reality is 8-30 days. Is that acceptable for a one-time build step?

### Q4: Is the current +6.5 R@10 sufficient to skip LLM extraction?

91.5% R@10 and 95% multi-hop R@10 are strong absolute numbers. The committee's acceptance criterion for Phase 2 Stream C was "+3 percentage points over n-gram graph." At 91.5%, the ceiling is ~8.5 points. Is the potential 3-point lift worth days of extraction compute?

### Q5: Would batched extraction with a dedicated process help?

Instead of using the API (which has lock contention), we could:
1. Stop the API server
2. Run extraction as a dedicated process (no lock contention)
3. Restart the API when done

This eliminates the 200s→50s overhead. At 50s/chunk, the 500-chunk pilot takes ~7 hours. Still slow but more predictable. The trade-off: chat is completely unavailable during extraction.

### Q6: Hardware upgrade recommendation?

If the committee believes LLM extraction is essential for the product roadmap, what minimum hardware would make it practical? Our estimate:
- 32 cores + 64 GB RAM → 4x LLM throughput, extraction in ~2 days
- GPU (RTX 3060 12GB) → 100 t/s, extraction in ~4 hours
- Cloud GPU instance (one-time) → extraction in ~1 hour, $5-20 cost

---

## 7. Stream D.1 Results (R@5 Fix)

While investigating Stream C, we also completed Stream D.1:

| Metric | Before Fix | After Fix | Target |
|---|---|---|---|
| R@5 | 53.2% (-2.8 vs baseline) | 53.5% (-2.2 vs baseline) | Within 1pt |
| R@10 | 91.5% (+6.8) | 91.0% (+6.5) | Positive |

The position-aware blend (HYBRID_TOP_BOOST=500 for top-3 ranks) slightly improved R@5 but didn't fully close the gap. The -2.2 R@5 regression is a structural trade-off of adding graph expansion candidates — not fully fixable without removing the graph benefit at deeper ranks. R@10 preserved at +6.5.

---

## 8. Recommendation

Our honest recommendation is **Option E (ship current) + Option B (short pilot as low-cost experiment)**.

Run the shorter-prompt pilot overnight (2-3 hours). If quality is surprisingly good, it opens a path to practical LLM extraction. If quality is poor, we've confirmed that LLM extraction requires better hardware and ship with the current graph.

The current system at 91.5% R@10 is production-quality retrieval. Pursuing marginal improvements at enormous compute cost may not be the best use of engineering time when there are other high-impact features (vision models, 3B model activation, more knowledge packs) that deliver user-visible value.

---

*Awaiting committee guidance.*
