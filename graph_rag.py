"""
EdgeWord NLP — Graph-Augmented RAG (Approach B)
Embedding-based entity extraction with co-occurrence graph.

Implementation follows the expert committee's guide:
  Phase 1: n-gram candidates → frequency filter → embed → cluster at 0.85
            → co-occurrence graph in KuzuDB → seed-and-expand retrieval

No hardcoded patterns. No domain-specific rules. The embedding model
does the heavy lifting for entity identification and synonym resolution.
"""

import re
import time
import json
import numpy as np
from pathlib import Path
from collections import defaultdict, Counter

# Standard English stopwords — only structural words, no domain terms
_STOPWORDS = set(
    "the a an is are was were be been being have has had do does did will would "
    "shall should may might can could of in to for on with at by from as into "
    "through during before after above below between among about against within "
    "without and or but not no nor so yet both either neither each every all any "
    "few more most other some such than too very also just only own same that "
    "this these those what which who whom how when where why if then else".split()
)


def _tokenize(text: str) -> list[str]:
    """Simple tokenization: lowercase, keep alphanumeric + hyphens."""
    return re.findall(r'[a-z][a-z0-9-]*(?:\'[a-z]+)?', text.lower())


def _all_stopwords(tokens: list[str]) -> bool:
    return all(t in _STOPWORDS for t in tokens)


# ── Phase 1.1: Candidate Extraction ──

def extract_candidates(chunk_text: str) -> set[str]:
    """Extract n-gram phrase candidates (1-3 words) from a chunk.
    No hardcoded entity patterns — just structural tokenization."""
    tokens = _tokenize(chunk_text)
    candidates = set()
    for n in [1, 2, 3]:
        for i in range(len(tokens) - n + 1):
            gram = tokens[i:i+n]
            phrase = " ".join(gram)
            # Minimum length, not all stopwords
            if len(phrase) >= 4 and not _all_stopwords(gram):
                candidates.add(phrase)
    return candidates


# ── Phase 1.2-1.4: Entity Graph Builder ──

class EntityGraphBuilder:
    """Builds the entity graph from knowledge pack chunks.

    Pipeline:
    1. Extract n-gram candidates from all chunks
    2. Filter by frequency (>= min_freq chunks)
    3. Embed surviving phrases with BGE Small
    4. Cluster by cosine similarity (0.85) for synonym resolution
    5. Build co-occurrence edges
    6. Store in KuzuDB
    """

    def __init__(self, embedder, db_path: str = "./knowledge_graph", min_freq: int = 2, sim_threshold: float = 0.85):
        self.embedder = embedder
        self.db_path = db_path
        self.min_freq = min_freq
        self.sim_threshold = sim_threshold

    def build_from_chunks(self, chunks: list[dict], pack_id: str = "default", on_progress=None) -> dict:
        """Full pipeline: candidates → filter → embed → cluster → graph."""
        t0 = time.time()

        # Step 1: Extract candidates from all chunks
        if on_progress: on_progress("extracting", 0, "Extracting phrase candidates...")
        chunk_candidates = []  # list of (chunk_source, set of candidates)
        phrase_chunk_count = Counter()  # phrase → number of chunks it appears in

        for i, chunk in enumerate(chunks):
            cands = extract_candidates(chunk["text"])
            chunk_candidates.append((chunk["source"], cands))
            for c in cands:
                phrase_chunk_count[c] += 1
            if on_progress and i % 500 == 0:
                on_progress("extracting", int(i/len(chunks)*20), f"Extracted from {i}/{len(chunks)} chunks...")

        total_raw = len(phrase_chunk_count)

        # Step 2: Frequency filter
        if on_progress: on_progress("filtering", 20, "Filtering by frequency...")
        frequent = {p for p, count in phrase_chunk_count.items() if count >= self.min_freq}

        if not frequent:
            return {"entities": 0, "edges": 0, "raw_candidates": total_raw, "elapsed_s": time.time()-t0}

        phrase_list = sorted(frequent)  # deterministic order
        if on_progress: on_progress("filtering", 25, f"{len(phrase_list)} phrases survive (from {total_raw} raw)")

        # Step 3: Embed phrases
        if on_progress: on_progress("embedding", 30, f"Embedding {len(phrase_list)} phrases...")
        batch_size = 64
        all_embs = []
        for i in range(0, len(phrase_list), batch_size):
            batch = phrase_list[i:i+batch_size]
            all_embs.append(self.embedder.embed(batch))
            if on_progress and i % 256 == 0:
                pct = 30 + int((i/len(phrase_list))*30)
                on_progress("embedding", pct, f"Embedded {i}/{len(phrase_list)} phrases...")

        embeddings = np.vstack(all_embs)  # (N, 384)
        phrase_to_idx = {p: i for i, p in enumerate(phrase_list)}

        # Step 4: FAISS-accelerated clustering (synonym resolution)
        if on_progress: on_progress("clustering", 60, "Clustering synonyms...")

        import faiss

        # Sort by frequency descending so canonical forms are more common
        freq_order = sorted(range(len(phrase_list)), key=lambda i: phrase_chunk_count[phrase_list[i]], reverse=True)

        clusters = []  # list of (canonical_phrase, embedding)
        phrase_to_cluster = {}  # phrase → cluster_id

        # Use FAISS index for fast nearest-neighbor lookup during clustering
        dim = embeddings.shape[1]
        cluster_index = faiss.IndexFlatIP(dim)  # inner product = cosine on L2-normalized vecs

        for count, idx in enumerate(freq_order):
            phrase = phrase_list[idx]
            emb = embeddings[idx:idx+1]  # (1, dim)

            matched = None
            if cluster_index.ntotal > 0:
                scores, indices = cluster_index.search(emb, 1)
                if scores[0][0] > self.sim_threshold:
                    matched = int(indices[0][0])

            if matched is None:
                matched = len(clusters)
                clusters.append((phrase, embeddings[idx]))
                cluster_index.add(emb)

            phrase_to_cluster[phrase] = matched

            if on_progress and count % 5000 == 0:
                on_progress("clustering", 60 + int((count/len(freq_order))*10), f"Clustered {count}/{len(phrase_list)} phrases → {len(clusters)} entities...")

        if on_progress: on_progress("clustering", 70, f"{len(clusters)} entities from {len(phrase_list)} phrases")

        # Step 5: Build entity-to-chunks and co-occurrence edges
        if on_progress: on_progress("building", 75, "Building co-occurrence graph...")

        entity_to_chunks = defaultdict(set)  # entity_id → set of chunk_sources
        chunk_to_entities = defaultdict(set)  # chunk_source → set of entity_ids

        for chunk_source, cands in chunk_candidates:
            for c in cands:
                if c in phrase_to_cluster:
                    eid = phrase_to_cluster[c]
                    entity_to_chunks[eid].add(chunk_source)
                    chunk_to_entities[chunk_source].add(eid)

        # Co-occurrence edges: entities appearing in the same chunk
        edge_weights = Counter()  # (eid_a, eid_b) → count
        for chunk_source, eids in chunk_to_entities.items():
            eids_list = sorted(eids)
            for i, a in enumerate(eids_list):
                for b in eids_list[i+1:]:
                    edge_weights[(a, b)] += 1

        # Filter edges with weight < 2 (per guide)
        edges = {k: v for k, v in edge_weights.items() if v >= 2}

        if on_progress: on_progress("storing", 85, "Storing in KuzuDB...")

        # Step 6: Store in KuzuDB
        stats = self._store_graph(clusters, entity_to_chunks, edges, pack_id)

        # Also save the lookup indices as JSON for fast retrieval
        index_data = {
            "entities": {str(eid): {"name": clusters[eid][0], "chunks": list(chunks_set)}
                        for eid, chunks_set in entity_to_chunks.items()},
            "chunk_to_entities": {src: list(eids) for src, eids in chunk_to_entities.items()},
            "edges": {f"{a},{b}": w for (a, b), w in edges.items()},
        }
        index_path = Path(self.db_path + f"_{pack_id}_index.json")
        with open(index_path, "w") as f:
            json.dump(index_data, f)

        elapsed = time.time() - t0
        result = {
            "entities": len(clusters),
            "edges": len(edges),
            "raw_candidates": total_raw,
            "frequent_phrases": len(phrase_list),
            "chunks_processed": len(chunks),
            "elapsed_s": round(elapsed, 1),
            "pack_id": pack_id,
        }

        if on_progress: on_progress("done", 100, f"Done: {len(clusters)} entities, {len(edges)} edges in {elapsed:.1f}s")
        return result

    def _store_graph(self, clusters, entity_to_chunks, edges, pack_id):
        """Store the graph in KuzuDB."""
        try:
            import kuzu
            db_path = Path(self.db_path)
            if db_path.exists() and db_path.is_dir() and not any(db_path.iterdir()):
                db_path.rmdir()
            db = kuzu.Database(str(db_path))
            conn = kuzu.Connection(db)

            # Create tables
            try:
                conn.execute("CREATE NODE TABLE IF NOT EXISTS Entity(id INT64, canonical_name STRING, pack_id STRING, n_chunks INT64, PRIMARY KEY(id))")
                conn.execute("CREATE REL TABLE IF NOT EXISTS CO_OCCURS(FROM Entity TO Entity, weight INT64, pack_id STRING)")
            except Exception:
                pass

            # Insert entities
            for eid, (name, _) in enumerate(clusters):
                n_chunks = len(entity_to_chunks.get(eid, set()))
                name_safe = name.replace("'", "''")
                pack_safe = pack_id.replace("'", "''")
                try:
                    conn.execute(f"MERGE (n:Entity {{id: {eid}}}) ON CREATE SET n.canonical_name = '{name_safe}', n.pack_id = '{pack_safe}', n.n_chunks = {n_chunks}")
                except Exception:
                    pass

            # Insert edges
            for (a, b), weight in edges.items():
                pack_safe = pack_id.replace("'", "''")
                try:
                    conn.execute(f"MATCH (a:Entity {{id: {a}}}), (b:Entity {{id: {b}}}) CREATE (a)-[:CO_OCCURS {{weight: {weight}, pack_id: '{pack_safe}'}}]->(b)")
                except Exception:
                    pass

            return {"stored": True}
        except Exception as e:
            return {"stored": False, "error": str(e)}


# ── Phase 1.7: Graph-Augmented Retrieval ──

class GraphRAG:
    """Seed-and-expand retrieval using the entity co-occurrence graph."""

    SEED_BOOST = 30.0
    HYBRID_TOP_BOOST = 500.0  # top-3 hybrid results get massive protection

    def __init__(self, rag_engine, graph_index_dir: str = "."):
        self.rag = rag_engine
        self.graph_dir = Path(graph_index_dir)
        self._entity_index = {}    # eid → {"name": str, "chunks": list}
        self._chunk_to_entities = {}  # chunk_source → set of eids
        self._edges = {}           # (a,b) → weight
        self._entity_name_to_id = {}  # name → eid
        self._load_indices()

    def _load_indices(self):
        """Load all pack indices and build adjacency list."""
        self._adj = defaultdict(list)  # eid → [(neighbor_eid, weight)]
        for idx_file in self.graph_dir.glob("*_index.json"):
            try:
                with open(idx_file) as f:
                    data = json.load(f)
                for eid_str, info in data.get("entities", {}).items():
                    eid = int(eid_str)
                    self._entity_index[eid] = info
                    self._entity_name_to_id[info["name"].lower()] = eid
                for src, eids in data.get("chunk_to_entities", {}).items():
                    self._chunk_to_entities[src] = set(eids)
                for key, weight in data.get("edges", {}).items():
                    a, b = key.split(",")
                    a, b, w = int(a), int(b), int(weight)
                    self._edges[(a, b)] = w
                    self._adj[a].append((b, w))
                    self._adj[b].append((a, w))
            except Exception:
                pass

    @property
    def has_graph(self) -> bool:
        return len(self._entity_index) > 0

    def get_stats(self) -> dict:
        return {
            "entities": len(self._entity_index),
            "edges": len(self._edges),
            "chunks_indexed": len(self._chunk_to_entities),
        }

    def retrieve(self, query: str, top_k: int = 10) -> list[dict]:
        """Graph-augmented retrieval following the seed-and-expand pattern."""
        if not self.has_graph:
            return self.rag.retrieve(query, top_k=top_k)

        # Step 1: Seed with hybrid retrieval
        seeds = self.rag.retrieve(query, top_k=3)

        # Step 2: Find entities in seed chunks
        seed_entities = set()
        for s in seeds:
            src = s["source"]
            if src in self._chunk_to_entities:
                seed_entities.update(self._chunk_to_entities[src])

        # Also find entities mentioned in the query itself
        query_tokens = set(re.findall(r'[a-z][a-z0-9-]+', query.lower()))
        for name, eid in self._entity_name_to_id.items():
            name_tokens = set(name.split())
            if name_tokens & query_tokens:  # any overlap
                seed_entities.add(eid)

        if not seed_entities:
            return seeds  # No graph expansion possible

        # Step 3: Expand 1-hop via adjacency list — skip hubs (>100 chunks)
        expanded = set(seed_entities)
        for se in seed_entities:
            for neighbor, weight in self._adj.get(se, []):
                if weight >= 2:
                    info = self._entity_index.get(neighbor)
                    if info and len(info["chunks"]) < 100:
                        expanded.add(neighbor)

        # Cap expansion to top 30 by edge weight
        if len(expanded) > 50:
            scored = [(eid, sum(w for ne, w in self._adj.get(eid, []) if ne in seed_entities)) for eid in expanded - seed_entities]
            scored.sort(key=lambda x: x[1], reverse=True)
            expanded = seed_entities | {eid for eid, _ in scored[:30]}

        # Step 4: Score chunks — seeds boosted, expansion weighted by inverse frequency
        chunk_scores = {}
        for s in seeds:
            chunk_scores[s["source"]] = self.SEED_BOOST

        for eid in expanded:
            info = self._entity_index.get(eid)
            if info:
                w = 1.0 / max(1, len(info["chunks"]) ** 0.5)
                for chunk_src in info["chunks"]:
                    chunk_scores[chunk_src] = chunk_scores.get(chunk_src, 0) + w

        # Step 5: Position-aware blend — protect top hybrid ranks, graph adds at deeper ranks
        hybrid_top = self.rag.retrieve(query, top_k=20)
        for rank, r in enumerate(hybrid_top):
            src = r["source"]
            if rank < 3:
                # Top-3 hybrid results are strongly protected
                chunk_scores[src] = chunk_scores.get(src, 0) + self.HYBRID_TOP_BOOST * (3 - rank)
            elif rank < 10:
                # Ranks 4-10: moderate hybrid signal, graph can influence
                chunk_scores[src] = chunk_scores.get(src, 0) + 20 - rank
            else:
                # Ranks 11-20: weak hybrid signal, graph dominates
                chunk_scores[src] = chunk_scores.get(src, 0) + (20 - rank) * 0.5

        # Step 6: Get top-K chunk sources, then retrieve full chunk data
        top_sources = sorted(chunk_scores, key=chunk_scores.get, reverse=True)[:top_k]

        # Map sources back to chunk data
        source_to_chunk = {r["source"]: r for r in hybrid_top}
        for s in seeds:
            source_to_chunk[s["source"]] = s

        results = []
        for src in top_sources:
            if src in source_to_chunk:
                chunk = source_to_chunk[src].copy()
                chunk["graph_score"] = chunk_scores[src]
                chunk["graph_expanded"] = src not in {s["source"] for s in seeds}
                results.append(chunk)
            else:
                # Chunk found via graph but not in hybrid results — retrieve by scanning
                for c in self.rag.chunks:
                    if c["source"] == src:
                        results.append({**c, "score": 0.0, "dense_score": 0.0, "graph_score": chunk_scores[src], "graph_expanded": True})
                        break

        return results
