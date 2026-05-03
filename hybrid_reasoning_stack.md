# Hybrid Reasoning Stack — Engineering Spec v0.2

**Purpose.** Architect a reasoning system that matches frontier-model behavior on bounded, verifiable, knowledge-intensive tasks while running on smaller, controllable, sovereign models.

**Core thesis.** Frontier-model intelligence is mostly *crystallized* (recall + fluency) plus a thin layer of *fluid* reasoning. Crystallized intelligence can be externalized into retrieval, graph traversal, and verification components. The remaining job — proposing candidate reasoning steps in fluent natural language — does not require 600B parameters. It requires 30B–70B with the right scaffolding around it.

**What changed in v0.2.** Added Section 2 on graph-augmented retrieval as a first-class component, based on empirical testing showing 88% multi-hop recall vs 75% for high-k vector retrieval. Renumbered downstream sections.

---

## 1. Architectural Pattern: Generate → Retrieve → Verify → Critique → Loop

The system is not a pipeline. It is a controlled loop with four distinct components, each doing exactly one job, each measurable in isolation.

### 1.1 Generator (G)

A 30B–70B class open model. Below 30B, reasoning circuits are insufficient regardless of scaffolding. Candidates: Qwen 2.5 32B/72B, Llama 3.3 70B, DeepSeek V3 (MoE, 37B active), Mistral Large.

The generator's only job is to produce candidate outputs — answers, reasoning steps, plans, classifications, code. It is **not** trusted to be correct. It is trusted to be fluent and plausible.

Treat the generator as a stochastic proposer. Sample multiple candidates (n=3 to n=8 depending on task criticality) rather than relying on a single greedy decode.

### 1.2 Retriever (R)

Hybrid retrieval, not a single vector store. Three layers:

- **Dense semantic** — embedding-based vector search for fuzzy semantic matching.
- **Sparse lexical** — BM25 or equivalent for exact term matching, especially critical for proper nouns, product codes, regulatory citations.
- **Entity graph** — see Section 2. Critical for multi-hop reasoning where answer entities are not lexically close to query terms.

A learned reranker sits on top of the three retrievers. Fine-tune the reranker on your domain — this is where most production RAG systems leave performance on the table.

The retriever runs **before** the generator (to ground the prompt) and optionally **after** (to verify generated claims against source material).

### 1.3 Verifier (V)

The verifier is a deterministic, non-LLM component that returns hard pass/fail signals on candidate outputs. Verifiers are domain-specific by definition. Examples relevant to current work:

- **AlphaSwing.** The backtesting engine is the verifier. Every signal the generator proposes is run through the historical engine. No signal reaches a user without passing the engine's gates.
- **Aixgen Signals.** Classification rules + outcome tracking. A lead score is verified against signal-confidence thresholds and historical conversion data.
- **FSI / regulatory work.** SQL execution against the source-of-truth database, regulatory rule engines, calculation kernels for interest, fees, FX.
- **Code generation.** Compiler, type checker, unit tests, linter.

The rule is simple: if a verifier exists for the domain, it must be in the loop. If no verifier exists, you are operating in a domain where the hybrid stack will not match frontier performance — be honest about this and route those tasks elsewhere.

### 1.4 Critic (C)

A second LLM call — can be the same model as G, or a smaller, faster model — whose only job is evaluation, not generation. The critic takes the generator's candidate and the retrieved context and produces a structured judgment: is this answer grounded in the retrieved evidence, is the reasoning consistent, are there hallucinated entities, does it actually answer the question.

The critic is weaker than a verifier (it is still an LLM and can be wrong) but stronger than nothing. Use the critic for soft signals where no hard verifier exists.

### 1.5 Controller (loop)

The controller orchestrates the loop. Pseudocode:

```
def answer(query, max_iterations=3):
    context = retrieve(query)              # hybrid: dense + sparse + graph
    plan = decompose(query, context)
    state = {"query": query, "context": context, "history": []}

    for step in plan:
        candidates = generate_n(step, state, n=4)
        grounded = [c for c in candidates if retriever_grounds(c, context)]

        if verifier_exists(step):
            verified = [c for c in grounded if verify(c)]
            if not verified:
                state = repair(step, state, failure_mode="verification")
                continue
            best = select_best(verified)
        else:
            critiqued = [(c, critique(c, context)) for c in grounded]
            best = select_best_by_critique(critiqued)

        state["history"].append((step, best))

    return synthesize(state)
```

Two non-obvious points:

1. **Decomposition matters more than generation.** Most production failures are a single-shot prompt against a complex query. Breaking the query into a plan of verifiable sub-steps is where reasoning quality is won or lost.
2. **Repair is a first-class operation.** When verification fails, the system must know how to revise — fetch more context, reformulate, try a different decomposition — not just retry with higher temperature.

---

## 2. Graph-Augmented Retrieval

Pure vector retrieval finds lexically and semantically similar facts. It fails on multi-hop reasoning where the answer entity is not lexically close to the query — exactly the queries that matter most in enterprise FSI work.

**Empirical baseline (from v0.2 testing on a 34-fact synthetic FSI corpus):**

- Vector k=5: 42% multi-hop recall
- Vector k=10: 75% multi-hop recall (with significantly more noise)
- Graph 3-hop traversal: 88% multi-hop recall

The graph wins decisively on queries that require chaining facts through entities the vector retriever cannot bridge. This generalizes: as the corpus grows past a few thousand facts, the gap widens because high-k vector retrieval becomes too noisy to be useful.

### 2.1 What the graph is and is not

**Is.** A typed entity graph where nodes are domain concepts (companies, products, tickers, regulations, signals, people) and edges are typed relationships extracted from your source data. Edges encode logical structure that vector embeddings flatten away.

**Is not.** A replacement for the generator. The graph improves what the generator *sees*; it does not improve how the generator *thinks*. A 7B model reading a beautiful 10-hop reasoning chain still has 7B-model-quality compositional reasoning. The graph reduces what the generator needs to know — it does not eliminate the need for a competent generator.

### 2.2 Construction

Build edges from existing data sources. Concretely:

- **AlphaSwing.** Edges from co-occurrence in signals, sector relationships, event-timing windows, ticker-to-tribe membership, signal-to-outcome history.
- **Aixgen Signals.** Edges from intent signal types, technology stack co-occurrence, company-to-platform mentions, lead-to-conversion outcomes.
- **FSI knowledge work.** Edges from organizational hierarchy (parent-subsidiary), product-to-regulator, currency-to-zone, technology vendor relationships.

The extraction logic is where the differentiation lives. Generic graph schemas underperform domain-specific schemas built from data the team understands.

### 2.3 Traversal pattern: seed and expand

Free graph walking does not work. Use bounded, query-guided traversal:

1. **Seed** with top-2 or top-3 vector retrieval hits. These are the entry points to the graph.
2. **Expand** via graph edges for 2 to 3 hops, scoring each candidate neighbor by relevance to the query.
3. **Rerank** the union of seed and expanded entities by combined score (vector similarity + graph proximity + edge type weights).
4. **Return** the subgraph plus the facts that connect it, formatted as context for the generator.

Cap the per-hop expansion (typically 4 to 8 candidates kept per hop). Unbounded expansion floods the generator with irrelevant context and degrades performance.

### 2.4 Storage and latency

NVMe SSD storage with memory-mapped hot indexes. Practical numbers:

- KuzuDB embedded for simplicity (single-process, no server overhead).
- Neo4j when richer query patterns or multi-process access are required.
- 100M-edge graph fits on a 1TB NVMe.
- Single-hop traversal latency: ~50 microseconds with hot indexes, ~5 milliseconds cold.
- 3-hop traversal end-to-end: typically 5 to 15 milliseconds in production.

This is well within the latency budget of any system already paying 200+ milliseconds for LLM inference. SSD storage is the right choice — VRAM cannot accommodate the graph capacity that makes this approach valuable, and RAM is wasted on cold edges.

### 2.5 Honest limits

The graph helps where:
- Queries require multi-hop reasoning over entities and relationships.
- The domain has clean, extractable structure.
- Answer entities are not lexically close to query terms.

The graph does not help where:
- Queries are open-ended generation tasks (creative writing, summarization).
- The domain has weak relational structure (most pure NLP tasks).
- The reasoning required is novel pattern composition rather than fact chaining.

Build the graph for the first set of cases. Do not force it into the second.

---

## 3. Where This Wins, Where It Loses

**Wins.** Bounded domains with verifiers. Knowledge-intensive QA. Structured data reasoning. Code generation with tests. Classification with feedback loops. Trading signals with backtests. Regulatory compliance checks. Enterprise document QA with citation requirements. Multi-hop entity reasoning.

**Loses.** Open-ended creative work. Nuanced multi-stakeholder advisory where the answer is a judgment call. Genuinely novel cross-domain analogical reasoning. Long-horizon agentic tasks with no intermediate verifiers.

Build the hybrid stack for the first list. Route to frontier APIs (or human experts) for the second. This routing decision is itself part of the architecture — the controller should know which tasks it is competent to handle.

---

## 4. Recommendations to Level Up Current Architecture

These are concrete steps to move existing systems (MarineSnow, Aixgen Signals, AlphaSwing, Project Launchpad) toward the hybrid-stack pattern.

### 4.1 Upgrade the generator class

If any current system uses a 7B-class model for production reasoning, that is the bottleneck. Move to 32B class minimum for tasks that involve multi-step reasoning. For pure classification and extraction, 7B–13B with strong fine-tuning is acceptable; for synthesis and planning, it is not.

### 4.2 Replace single-vector RAG with hybrid retrieval

Most current "RAG" implementations are dense-only. Add BM25 as a parallel retriever and a learned reranker on top. Expected lift on enterprise QA: 15–30% on retrieval recall, which translates directly to answer quality.

### 4.3 Build the entity graph layer (highest-leverage upgrade)

For FSI and B2B intent work specifically, an entity graph (companies, products, people, regulations, relationships) outperforms vector retrieval on the queries that matter most — those involving named entities and their relationships. KuzuDB embedded or Neo4j; the value is in the schema, not the engine. See Section 2.

### 4.4 Identify and instrument verifiers

For each existing system, list the verifiers that already exist or could exist. AlphaSwing has the backtesting engine — wire it into the generation loop, not just into final reporting. Aixgen Signals has conversion tracking — close the feedback loop so verified outcomes update the classifier. MarineSnow has user engagement signals — these are noisy verifiers but still verifiers.

### 4.5 Separate generation from evaluation

Stop using the same prompt to both generate and self-evaluate. Two separate LLM calls — one to generate, one to critique — outperform a single combined call by a wide margin and cost roughly the same. The critic call can use a smaller model to control cost.

### 4.6 Sample multiple candidates

Replace temperature-0 single-sample generation with n=4 to n=8 sampling and selection. The cost is linear in n; the quality lift is significant for any task with verifiable outputs because verification filters bad samples cheaply.

### 4.7 Build evaluation harnesses before scaling

For each system, define a fixed eval set of 100–500 representative queries with ground-truth answers. **For graph-augmented systems, include a multi-hop subset with known answer entities** — this is the metric that proves the graph layer is earning its keep. Every architectural change is measured against this set. Without this, every "improvement" is a vibe.

### 4.8 Plan the routing layer

The controller should know when to handle a query in the hybrid stack and when to route elsewhere. This routing decision is itself a classification problem, solvable with a small fine-tuned model. Tasks below the system's competence floor get routed to a frontier API or flagged for human review. This honesty is what makes the architecture trustworthy in regulated environments.

### 4.9 Sovereign deployment as a feature, not a constraint

For West/Central African FSI clients, the entire stack running on-premise or in regional infrastructure is a strategic differentiator. Architect for this from day one — every component must run without external API dependencies. This rules out OpenAI/Anthropic APIs in the production path but allows them in the development and evaluation path.

### 4.10 Commercial positioning

Do not market this as "intelligence without large weights." Market it as *grounded, explainable, sovereign reasoning*. The selling point to a regional FSI buyer is not "we replaced the big model" — it is "every answer is traceable to specific facts in your data, the reasoning chain is auditable, and nothing leaves your infrastructure." That is a story regulators and risk officers will actually pay for, and it happens to be true. The other framing overpromises and creates buyer skepticism.

---

## 5. Build Sequence

A defensible implementation order for any new system in this paradigm:

1. **Eval set.** 100–500 queries with ground-truth answers for the target domain, including a multi-hop subset. Without this, nothing else can be measured.
2. **Hybrid retrieval layer.** Dense + sparse + reranker, evaluated on retrieval recall and precision against the eval set.
3. **Entity graph.** Domain-specific schema, edges extracted from existing data, seed-and-expand traversal, evaluated on the multi-hop subset.
4. **Generator integration.** 32B-class model wired to the retrieval layers, evaluated on end-to-end answer quality.
5. **Verifier integration.** Domain verifier in the loop, with explicit pass/fail logging.
6. **Planner and critic.** Decomposition and critique layers added, with measurable lift over the verifier-only baseline.
7. **Optimization.** Distillation, quantization, caching, batching. Only after correctness is established.

Resist the temptation to invert this order. Every team that starts with optimization ships fast and rebuilds within six months.

---

## 6. Closing Note

The hybrid stack is not a workaround for not having frontier models. It is the architecture that the frontier itself is converging toward — see AlphaProof, AlphaGeometry, agentic systems with tool use and verification. The difference is that the frontier labs hide the scaffolding behind an API. Building it explicitly gives you cost, sovereignty, customization, and — critically — the ability to extend the verifier set into domains the frontier does not cover.

The 600B-vs-30B+scaffolding question is, properly understood, a question about where you put your engineering effort: into bigger weights or into better composition. For bounded, verifiable, knowledge-intensive work, composition wins on every axis that matters in production.

The graph layer specifically is the upgrade that turns this from a theoretical position into a defensible product. Vector retrieval is a commodity. Domain-specific entity graphs with extracted edges from years of regional FSI data are not. That is where the moat lives.
