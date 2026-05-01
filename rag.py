"""
EdgeWord NLP — RAG Module
ONNX-based embeddings (all-MiniLM-L6-v2) + FAISS vector store.
No PyTorch dependency — pure ONNX Runtime.

Usage:
    rag = RAGEngine()
    rag.load_directory("./docs")
    context = rag.retrieve("What is quantization?", top_k=3)
"""

import os
import time
import numpy as np
import onnxruntime as ort
from pathlib import Path
from transformers import AutoTokenizer
from huggingface_hub import snapshot_download

EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2"

# --- Colours ---
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RESET = "\033[0m"


class ONNXEmbedder:
    """Lightweight ONNX-based sentence embedder — no PyTorch."""

    def __init__(self):
        print(f"{DIM}Loading embedding model...{RESET}", end=" ", flush=True)
        t0 = time.perf_counter()

        model_dir = snapshot_download(
            EMBEDDING_MODEL_ID,
            allow_patterns=["*.onnx", "*.json", "*.txt"],
        )

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
        print(f"{GREEN}ready{RESET} {DIM}({elapsed:.1f}s){RESET}")

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

    def __init__(self):
        import faiss
        self.embedder = ONNXEmbedder()
        self.index = None  # faiss.IndexFlatIP
        self.chunks: list[dict] = []  # {"text": ..., "source": ..., "chunk_id": ...}
        self._faiss = faiss

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

        # Build FAISS index (inner product on normalized vectors = cosine similarity)
        dim = embeddings.shape[1]
        self.index = self._faiss.IndexFlatIP(dim)
        self.index.add(embeddings)
        self.chunks = all_chunks

        elapsed = time.perf_counter() - t0
        print(f"{GREEN}done{RESET} {DIM}({elapsed:.1f}s){RESET}")
        return len(all_chunks)

    def retrieve(self, query: str, top_k: int = 3) -> list[dict]:
        """Retrieve the top-k most relevant chunks for a query."""
        if self.index is None or self.index.ntotal == 0:
            return []

        query_vec = self.embedder.embed([query])
        scores, indices = self.index.search(query_vec, min(top_k, self.index.ntotal))

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0:
                continue
            chunk = self.chunks[idx].copy()
            chunk["score"] = float(score)
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

    @property
    def doc_count(self) -> int:
        return self.index.ntotal if self.index else 0
