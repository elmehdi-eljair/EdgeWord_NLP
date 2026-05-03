"""
EdgeWord NLP — RAG Module
ONNX-based embeddings + FAISS vector store.
Supports multiple embedding models — configurable at runtime.
No PyTorch dependency — pure ONNX Runtime.

Usage:
    rag = RAGEngine(model_id="bge-small")
    rag.load_directory("./docs")
    context = rag.retrieve("What is quantization?", top_k=3)
"""

import os
import json
import time
import numpy as np
import onnxruntime as ort
from pathlib import Path
from transformers import AutoTokenizer
from huggingface_hub import snapshot_download

# --- Available embedding models ---
EMBEDDING_MODELS = {
    "minilm-l6": {
        "name": "MiniLM-L6-v2",
        "hf_id": "Xenova/all-MiniLM-L6-v2",
        "dims": 384,
        "description": "Fast general-purpose. Good baseline, low resource usage.",
        "size": "~90 MB",
        "quality": "Baseline",
        "speed": "Fast",
        "available": True,
    },
    "bge-small": {
        "name": "BGE Small EN v1.5",
        "hf_id": "Xenova/bge-small-en-v1.5",
        "dims": 384,
        "description": "Retrieval-optimized. +24% better retrieval vs MiniLM, same speed.",
        "size": "~130 MB",
        "quality": "High",
        "speed": "Fast",
        "available": True,
    },
    "bge-base": {
        "name": "BGE Base EN v1.5",
        "hf_id": "Xenova/bge-base-en-v1.5",
        "dims": 768,
        "description": "Best retrieval quality. 2x memory, ~2.5x slower embedding.",
        "size": "~440 MB",
        "quality": "Highest",
        "speed": "Moderate",
        "available": False,  # Coming soon
    },
}

DEFAULT_EMBEDDING_MODEL = "bge-small"
_CONFIG_PATH = Path(__file__).parent / ".embedding_config.json"


def get_configured_model() -> str:
    """Read persisted embedding model selection."""
    if _CONFIG_PATH.exists():
        try:
            return json.loads(_CONFIG_PATH.read_text()).get("model_id", DEFAULT_EMBEDDING_MODEL)
        except Exception:
            pass
    return DEFAULT_EMBEDDING_MODEL


def set_configured_model(model_id: str):
    """Persist embedding model selection."""
    _CONFIG_PATH.write_text(json.dumps({"model_id": model_id}))


# --- Colours ---
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RESET = "\033[0m"


class ONNXEmbedder:
    """Lightweight ONNX-based sentence embedder — no PyTorch."""

    def __init__(self, model_id: str | None = None):
        self.model_id = model_id or get_configured_model()
        if self.model_id not in EMBEDDING_MODELS:
            self.model_id = DEFAULT_EMBEDDING_MODEL

        info = EMBEDDING_MODELS[self.model_id]
        self.dims = info["dims"]

        print(f"{DIM}Loading embedding model ({info['name']})...{RESET}", end=" ", flush=True)
        t0 = time.perf_counter()

        model_dir = self._ensure_model_cached(self.model_id, info)

        # Find the ONNX file
        onnx_path = None
        for candidate in ["onnx/model.onnx", "model.onnx"]:
            full = os.path.join(model_dir, candidate)
            if os.path.exists(full):
                onnx_path = full
                break
        if onnx_path is None:
            raise FileNotFoundError(f"No ONNX model found in {model_dir}")

        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(
            onnx_path, opts, providers=["CPUExecutionProvider"]
        )
        self.tokenizer = AutoTokenizer.from_pretrained(model_dir)
        self.input_names = {inp.name for inp in self.session.get_inputs()}

        # Warmup
        self.embed(["warmup"])
        elapsed = time.perf_counter() - t0
        print(f"{GREEN}ready{RESET} {DIM}({elapsed:.1f}s, {info['dims']}d){RESET}")

        # Persist selection
        set_configured_model(self.model_id)

    @staticmethod
    def _ensure_model_cached(model_id: str, info: dict) -> str:
        """Ensure model files are in local cache. Download via HTTP if needed (no xet)."""
        import requests as _req

        hf_id = info["hf_id"]
        cache_dir = Path.home() / ".cache" / "edgeword_embeddings" / model_id
        onnx_dir = cache_dir / "onnx"
        onnx_dir.mkdir(parents=True, exist_ok=True)

        needed_files = {
            "onnx/model.onnx": onnx_dir / "model.onnx",
            "tokenizer.json": cache_dir / "tokenizer.json",
            "tokenizer_config.json": cache_dir / "tokenizer_config.json",
            "special_tokens_map.json": cache_dir / "special_tokens_map.json",
            "config.json": cache_dir / "config.json",
        }

        base_url = f"https://huggingface.co/{hf_id}/resolve/main"
        all_present = all(p.exists() and p.stat().st_size > 50 for p in needed_files.values())

        if not all_present:
            for remote, local in needed_files.items():
                if local.exists() and local.stat().st_size > 50:
                    continue
                print(f"\n    {DIM}Downloading {remote}...{RESET}", end=" ", flush=True)
                r = _req.get(f"{base_url}/{remote}", allow_redirects=True, stream=True, timeout=60)
                r.raise_for_status()
                tmp = local.with_suffix(".part")
                dl = 0
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(256 * 1024):
                        f.write(chunk)
                        dl += len(chunk)
                tmp.rename(local)
                print(f"{GREEN}{dl/1024/1024:.1f} MB{RESET}", end=" ", flush=True)
            print()  # newline after downloads

        return str(cache_dir)

    def embed(self, texts: list[str]) -> np.ndarray:
        """Embed a list of texts, returns (N, dim) float32 array."""
        enc = self.tokenizer(
            texts, return_tensors="np", truncation=True,
            max_length=128, padding=True,
        )
        inputs = {k: v for k, v in enc.items() if k in self.input_names}
        outputs = self.session.run(None, inputs)

        # Mean pooling over token embeddings (output 0 = token embeddings)
        token_embeddings = outputs[0]  # (batch, seq_len, hidden_dim)
        attention_mask = enc["attention_mask"]
        mask_expanded = np.expand_dims(attention_mask, axis=-1).astype(np.float32)
        sum_embeddings = np.sum(token_embeddings * mask_expanded, axis=1)
        sum_mask = np.clip(mask_expanded.sum(axis=1), a_min=1e-9, a_max=None)
        embeddings = sum_embeddings / sum_mask

        # L2 normalize
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms = np.clip(norms, a_min=1e-9, a_max=None)
        return (embeddings / norms).astype(np.float32)


class RAGEngine:
    """Document store with FAISS retrieval."""

    def __init__(self, model_id: str | None = None):
        import faiss
        from rank_bm25 import BM25Okapi
        self.embedder = ONNXEmbedder(model_id)
        self.index = None  # faiss.IndexFlatIP
        self.bm25 = None   # BM25Okapi sparse index
        self.chunks: list[dict] = []  # {"text": ..., "source": ..., "chunk_id": ...}
        self._faiss = faiss
        self._BM25 = BM25Okapi
        # Stored separately for composite index rebuilds
        self._user_embeddings: np.ndarray | None = None
        self._user_chunks: list[dict] = []

    def _chunk_text(self, text: str, chunk_size: int = 500, overlap: int = 100) -> list[str]:
        """Split text into overlapping chunks."""
        chunks = []
        start = 0
        while start < len(text):
            end = start + chunk_size
            chunk = text[start:end]
            if chunk.strip():
                chunks.append(chunk.strip())
            start += chunk_size - overlap
        return chunks

    def _load_file(self, filepath: Path) -> str | None:
        """Load a file's text content."""
        suffix = filepath.suffix.lower()
        try:
            if suffix in (".txt", ".md", ".py", ".js", ".ts", ".json", ".csv",
                          ".yaml", ".yml", ".toml", ".cfg", ".ini", ".log",
                          ".html", ".xml", ".rst", ".sh", ".bash"):
                return filepath.read_text(encoding="utf-8", errors="ignore")
            else:
                return None
        except Exception:
            return None

    def load_directory(self, directory: str, chunk_size: int = 500, overlap: int = 100) -> int:
        """Load and index all supported files from a directory."""
        doc_dir = Path(directory)
        if not doc_dir.exists():
            return 0

        all_chunks = []
        files_loaded = 0

        for filepath in sorted(doc_dir.rglob("*")):
            if filepath.is_dir():
                continue
            text = self._load_file(filepath)
            if not text:
                continue
            files_loaded += 1
            chunks = self._chunk_text(text, chunk_size, overlap)
            for i, chunk in enumerate(chunks):
                all_chunks.append({
                    "text": chunk,
                    "source": str(filepath.relative_to(doc_dir)),
                    "chunk_id": i,
                })

        if not all_chunks:
            return 0

        # Embed all chunks
        print(f"  {DIM}Indexing {len(all_chunks)} chunks from {files_loaded} files...{RESET}", end=" ", flush=True)
        t0 = time.perf_counter()

        texts = [c["text"] for c in all_chunks]
        # Batch embedding to avoid OOM on large doc sets
        batch_size = 32
        all_embeddings = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            all_embeddings.append(self.embedder.embed(batch))
        embeddings = np.vstack(all_embeddings)

        # Store user data separately for composite rebuilds
        self._user_embeddings = embeddings
        self._user_chunks = list(all_chunks)

        # Build FAISS index (inner product on normalized vectors = cosine similarity)
        dim = embeddings.shape[1]
        self.index = self._faiss.IndexFlatIP(dim)
        self.index.add(embeddings)
        self.chunks = list(all_chunks)

        # Build BM25 sparse index
        tokenized = [c["text"].lower().split() for c in all_chunks]
        self.bm25 = self._BM25(tokenized)

        elapsed = time.perf_counter() - t0
        print(f"{GREEN}done{RESET} {DIM}({elapsed:.1f}s, hybrid){RESET}")
        return len(all_chunks)

    def retrieve(self, query: str, top_k: int = 3) -> list[dict]:
        """Hybrid retrieval: dense (FAISS) + sparse (BM25) with Reciprocal Rank Fusion."""
        if self.index is None or self.index.ntotal == 0:
            return []

        n_candidates = min(top_k * 5, self.index.ntotal)  # Fetch more, fuse, then trim
        rrf_k = 60  # RRF constant (standard value)

        # Dense retrieval (FAISS)
        query_vec = self.embedder.embed([query])
        dense_scores, dense_indices = self.index.search(query_vec, n_candidates)
        dense_ranking = {}  # chunk_idx -> rank (0-based)
        for rank, idx in enumerate(dense_indices[0]):
            if idx >= 0:
                dense_ranking[int(idx)] = rank

        # Sparse retrieval (BM25)
        sparse_ranking = {}
        if self.bm25 is not None:
            query_tokens = query.lower().split()
            bm25_scores = self.bm25.get_scores(query_tokens)
            # Get top-n_candidates by BM25 score
            top_bm25 = np.argsort(bm25_scores)[::-1][:n_candidates]
            for rank, idx in enumerate(top_bm25):
                if bm25_scores[idx] > 0:
                    sparse_ranking[int(idx)] = rank

        # Reciprocal Rank Fusion
        all_candidates = set(dense_ranking.keys()) | set(sparse_ranking.keys())
        fused = []
        for idx in all_candidates:
            rrf_score = 0
            if idx in dense_ranking:
                rrf_score += 1.0 / (rrf_k + dense_ranking[idx])
            if idx in sparse_ranking:
                rrf_score += 1.0 / (rrf_k + sparse_ranking[idx])
            # Also keep the original dense score for threshold filtering
            dense_sim = float(dense_scores[0][dense_ranking[idx]]) if idx in dense_ranking else 0
            fused.append((idx, rrf_score, dense_sim))

        # Sort by RRF score descending
        fused.sort(key=lambda x: x[1], reverse=True)

        # Filter: require at least some semantic relevance (dense score > 0.2)
        results = []
        for idx, rrf_score, dense_sim in fused[:top_k]:
            if dense_sim < 0.2 and idx not in sparse_ranking:
                continue
            chunk = self.chunks[idx].copy()
            chunk["score"] = rrf_score
            chunk["dense_score"] = dense_sim
            chunk["retrieval"] = "hybrid"
            results.append(chunk)

        return results

    def format_context(self, results: list[dict]) -> str:
        """Format retrieved chunks into a context string for the LLM."""
        if not results:
            return ""
        parts = []
        for r in results:
            parts.append(f"[Source: {r['source']}]\n{r['text']}")
        return "\n\n---\n\n".join(parts)

    def rebuild_composite_index(self, gallery_manager=None):
        """Rebuild FAISS index from user docs + all enabled knowledge packs."""
        all_emb = []
        all_ch = []

        # User documents
        if self._user_embeddings is not None and len(self._user_chunks) > 0:
            all_emb.append(self._user_embeddings)
            all_ch.extend(self._user_chunks)

        # Knowledge packs
        if gallery_manager:
            for pack_id, chunks, embeddings in gallery_manager.get_enabled_pack_data():
                all_emb.append(embeddings)
                all_ch.extend(chunks)

        if not all_emb:
            self.index = None
            self.bm25 = None
            self.chunks = []
            return 0

        combined = np.vstack(all_emb)
        dim = combined.shape[1]
        self.index = self._faiss.IndexFlatIP(dim)
        self.index.add(combined)
        self.chunks = all_ch

        # Rebuild BM25
        tokenized = [c["text"].lower().split() for c in all_ch]
        self.bm25 = self._BM25(tokenized)
        return len(all_ch)

    @property
    def doc_count(self) -> int:
        return self.index.ntotal if self.index else 0
