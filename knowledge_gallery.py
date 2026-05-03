"""
EdgeWord NLP — Knowledge Gallery Manager
Download curated knowledge packs from HuggingFace and process them into RAG-ready
chunks + embeddings. Packs enrich the model's knowledge in specific domains.

Usage:
    mgr = KnowledgeGalleryManager("./knowledge_packs", embedder, on_notify)
    mgr.install_pack("sciq")      # background download + process
    mgr.toggle_pack("sciq", True) # enable/disable
    mgr.list_packs()              # status of all packs
"""

import os
import json
import time
import shutil
import threading
import numpy as np
from pathlib import Path

# HuggingFace Datasets Server API — returns JSON rows, no pyarrow needed
HF_ROWS_API = "https://datasets-server.huggingface.co/rows"

GALLERY_PACKS = {
    "sciq": {
        "name": "Science Q&A",
        "description": "13.7K science exam questions with answers and explanatory passages covering physics, chemistry, and biology.",
        "category": "Science",
        "icon": "science",
        "hf_dataset": "allenai/sciq",
        "hf_config": "default",
        "hf_split": "train",
        "text_fields": ["question", "correct_answer", "support"],
        "text_template": "Q: {question}\nA: {correct_answer}\n\nExplanation: {support}",
        "max_rows": 13000,
        "size_estimate": "~10 MB",
        "chunk_estimate": "~14K chunks",
    },
    "medmcqa": {
        "name": "Medical Knowledge",
        "description": "Medical exam questions across 21 subjects — anatomy, pharmacology, pathology, and more.",
        "category": "Medical",
        "icon": "medical",
        "hf_dataset": "openlifescienceai/medmcqa",
        "hf_config": "default",
        "hf_split": "train",
        "text_fields": ["question", "exp"],
        "text_template": "Medical Q: {question}\n\nExplanation: {exp}",
        "max_rows": 30000,
        "size_estimate": "~50 MB",
        "chunk_estimate": "~35K chunks",
    },
    "finance": {
        "name": "Finance & Business",
        "description": "Financial instruction data covering markets, accounting, risk analysis, and business strategy.",
        "category": "Business",
        "icon": "finance",
        "hf_dataset": "sujet-ai/Sujet-Finance-Instruct-177k",
        "hf_config": "default",
        "hf_split": "train",
        "text_fields": ["instruction", "output"],
        "text_template": "Q: {instruction}\nA: {output}",
        "max_rows": 20000,
        "size_estimate": "~80 MB",
        "chunk_estimate": "~25K chunks",
    },
    "mmlu-stem": {
        "name": "STEM Knowledge",
        "description": "Expert-level STEM questions — physics, math, computer science, engineering, and abstract algebra.",
        "category": "Science",
        "icon": "stem",
        "hf_dataset": "cais/mmlu",
        "hf_config": "all",
        "hf_split": "test",
        "text_fields": ["question", "choices", "answer"],
        "text_template": "Q: {question}\nChoices: {choices}\nCorrect answer index: {answer}",
        "max_rows": 14000,
        "size_estimate": "~5 MB",
        "chunk_estimate": "~8K chunks",
    },
    "coding-qa": {
        "name": "Programming Q&A",
        "description": "Python programming questions and solutions from Stack Overflow — debugging, algorithms, libraries.",
        "category": "Coding",
        "icon": "code",
        "hf_dataset": "koutch/stackoverflow_python",
        "hf_config": "default",
        "hf_split": "train",
        "text_fields": ["question", "answer"],
        "text_template": "Programming Q: {question}\n\nSolution: {answer}",
        "max_rows": 15000,
        "size_estimate": "~30 MB",
        "chunk_estimate": "~20K chunks",
    },
    "history-geo": {
        "name": "History & Geography",
        "description": "General knowledge facts covering world history, geography, culture, and notable events.",
        "category": "Humanities",
        "icon": "history",
        "hf_dataset": "MuskumPillerum/General-Knowledge",
        "hf_config": "default",
        "hf_split": "train",
        "text_fields": ["Question", "Answer"],
        "text_template": "Q: {Question}\nA: {Answer}",
        "max_rows": 15000,
        "size_estimate": "~5 MB",
        "chunk_estimate": "~6K chunks",
    },
    "legal-basics": {
        "name": "Legal Fundamentals",
        "description": "Legal reasoning tasks — contract interpretation, statutory analysis, and legal terminology.",
        "category": "Legal",
        "icon": "legal",
        "hf_dataset": "nguha/legalbench",
        "hf_config": "abercrombie",
        "hf_split": "test",
        "text_fields": ["text", "label", "answer"],
        "text_template": "Legal text: {text}\nClassification: {label}\nAnswer: {answer}",
        "max_rows": 10000,
        "size_estimate": "~10 MB",
        "chunk_estimate": "~5K chunks",
    },
    "grammar": {
        "name": "Grammar & Writing",
        "description": "Text editing examples — grammar corrections, clarity improvements, style rewrites.",
        "category": "Language",
        "icon": "grammar",
        "hf_dataset": "grammarly/coedit",
        "hf_config": "default",
        "hf_split": "train",
        "text_fields": ["src", "tgt"],
        "text_template": "Original: {src}\nImproved: {tgt}",
        "max_rows": 15000,
        "size_estimate": "~20 MB",
        "chunk_estimate": "~15K chunks",
    },
    # ── Infrastructure & DevOps ──
    "devops-code": {
        "name": "DevOps & Infrastructure Code",
        "description": "80K code instructions covering Docker, Kubernetes, CI/CD, shell scripting, cloud deployments, Ansible, Terraform, and infrastructure automation.",
        "category": "Infrastructure",
        "icon": "infra",
        "hf_dataset": "nickrosh/Evol-Instruct-Code-80k-v1",
        "hf_config": "default",
        "hf_split": "train",
        "text_fields": ["instruction", "output"],
        "text_template": "Task: {instruction}\n\nSolution: {output}",
        "max_rows": 20000,
        "size_estimate": "~80 MB",
        "chunk_estimate": "~25K chunks",
    },
    "k8s-cloud": {
        "name": "Kubernetes & Cloud Platforms",
        "description": "Advanced code and infrastructure patterns — Kubernetes manifests, Helm charts, GCP/AWS configs, container orchestration, microservices architecture.",
        "category": "Infrastructure",
        "icon": "infra",
        "hf_dataset": "ise-uiuc/Magicoder-Evol-Instruct-110K",
        "hf_config": "default",
        "hf_split": "train",
        "text_fields": ["instruction", "response"],
        "text_template": "Q: {instruction}\n\nA: {response}",
        "max_rows": 20000,
        "size_estimate": "~100 MB",
        "chunk_estimate": "~30K chunks",
    },
    "sysadmin-ops": {
        "name": "Linux & System Administration",
        "description": "System administration knowledge — Linux commands, shell scripting, networking, security, monitoring, troubleshooting, and server management.",
        "category": "Infrastructure",
        "icon": "infra",
        "hf_dataset": "sahil2801/CodeAlpaca-20k",
        "hf_config": "default",
        "hf_split": "train",
        "text_fields": ["instruction", "output"],
        "text_template": "Task: {instruction}\n\nSolution: {output}",
        "max_rows": 20000,
        "size_estimate": "~30 MB",
        "chunk_estimate": "~20K chunks",
    },
    "infra-general": {
        "name": "Infrastructure Engineering",
        "description": "Broad infrastructure knowledge — databases, APIs, deployment strategies, performance tuning, architecture patterns, DevOps practices, and operational excellence.",
        "category": "Infrastructure",
        "icon": "infra",
        "hf_dataset": "databricks/databricks-dolly-15k",
        "hf_config": "default",
        "hf_split": "train",
        "text_fields": ["instruction", "context", "response"],
        "text_template": "Q: {instruction}\nContext: {context}\n\nA: {response}",
        "max_rows": 15000,
        "size_estimate": "~40 MB",
        "chunk_estimate": "~18K chunks",
    },
    "code-feedback": {
        "name": "Code Review & Debugging",
        "description": "Code review conversations, debugging strategies, performance optimization, security patterns, and best practices across all languages and infrastructure tools.",
        "category": "Infrastructure",
        "icon": "code",
        "hf_dataset": "m-a-p/Code-Feedback",
        "hf_config": "default",
        "hf_split": "train",
        "text_fields": ["messages"],
        "text_template": "{messages}",
        "max_rows": 15000,
        "size_estimate": "~60 MB",
        "chunk_estimate": "~20K chunks",
    },
}


class KnowledgeGalleryManager:
    """Manages downloading, processing, and indexing of knowledge packs."""

    def __init__(self, packs_dir: str, embedder=None, on_notify=None, on_complete=None):
        self.packs_dir = Path(packs_dir)
        self.packs_dir.mkdir(exist_ok=True)
        self.embedder = embedder
        self.on_notify = on_notify
        self.on_complete = on_complete  # callback() to rebuild RAG composite index
        self.installing: dict = {}  # pack_id -> progress dict
        self._lock = threading.Lock()  # serialize installs (embedder not thread-safe)

    def list_packs(self) -> list[dict]:
        """List all gallery packs with local install/enable status."""
        result = []
        for pack_id, info in GALLERY_PACKS.items():
            meta = self._load_meta(pack_id)
            installed = meta is not None
            result.append({
                "id": pack_id,
                "name": info["name"],
                "description": info["description"],
                "category": info["category"],
                "icon": info["icon"],
                "size_estimate": info["size_estimate"],
                "chunk_estimate": info["chunk_estimate"],
                "installed": installed,
                "enabled": meta.get("enabled", False) if meta else False,
                "chunk_count": meta.get("chunk_count", 0) if meta else 0,
                "installed_at": meta.get("installed_at") if meta else None,
                "installing": pack_id in self.installing,
            })
        return result

    def get_progress(self, pack_id: str) -> dict | None:
        return self.installing.get(pack_id)

    def install_pack(self, pack_id: str) -> dict:
        """Start installing a knowledge pack in background."""
        if pack_id not in GALLERY_PACKS:
            raise ValueError(f"Unknown pack: {pack_id}")
        if pack_id in self.installing:
            return {"status": "already_installing"}
        meta = self._load_meta(pack_id)
        if meta:
            return {"status": "already_installed"}
        if not self.embedder:
            raise RuntimeError("Embedder not available")

        info = GALLERY_PACKS[pack_id]
        self.installing[pack_id] = {
            "status": "processing",
            "name": info["name"],
            "phase": "downloading",
            "percent": 0,
            "detail": "Starting download...",
            "started": time.time(),
        }
        threading.Thread(target=self._install_worker, args=(pack_id,), daemon=True).start()
        return {"status": "started"}

    def uninstall_pack(self, pack_id: str) -> dict:
        """Delete a pack's data."""
        pack_dir = self.packs_dir / pack_id
        if pack_dir.exists():
            shutil.rmtree(pack_dir)
        return {"status": "uninstalled"}

    def toggle_pack(self, pack_id: str, enabled: bool) -> dict:
        """Enable or disable a pack."""
        meta = self._load_meta(pack_id)
        if not meta:
            raise ValueError(f"Pack not installed: {pack_id}")
        meta["enabled"] = enabled
        self._save_meta(pack_id, meta)
        return {"status": "toggled", "enabled": enabled}

    def get_enabled_pack_data(self):
        """Yield (pack_id, chunks, embeddings) for each enabled pack."""
        for pack_id in GALLERY_PACKS:
            meta = self._load_meta(pack_id)
            if not meta or not meta.get("enabled"):
                continue
            pack_dir = self.packs_dir / pack_id
            chunks_path = pack_dir / "chunks.jsonl"
            emb_path = pack_dir / "embeddings.npy"
            if not chunks_path.exists() or not emb_path.exists():
                continue
            # Load chunks
            chunks = []
            with open(chunks_path, "r") as f:
                for line in f:
                    if line.strip():
                        chunks.append(json.loads(line))
            # Load embeddings
            embeddings = np.load(emb_path)
            yield pack_id, chunks, embeddings

    # ── Internal ──

    def _load_meta(self, pack_id: str) -> dict | None:
        meta_path = self.packs_dir / pack_id / "meta.json"
        if not meta_path.exists():
            return None
        try:
            return json.loads(meta_path.read_text())
        except Exception:
            return None

    def _save_meta(self, pack_id: str, meta: dict):
        pack_dir = self.packs_dir / pack_id
        pack_dir.mkdir(parents=True, exist_ok=True)
        (pack_dir / "meta.json").write_text(json.dumps(meta, indent=2))

    def _install_worker(self, pack_id: str):
        """Background thread: download → extract → chunk → embed → save."""
        info = GALLERY_PACKS[pack_id]
        pack_dir = self.packs_dir / pack_id
        pack_dir.mkdir(parents=True, exist_ok=True)
        raw_dir = pack_dir / "raw"
        raw_dir.mkdir(exist_ok=True)

        try:
            # ── Phase 1: Download rows from HF Datasets Server API ──
            self.installing[pack_id].update({"phase": "downloading", "detail": "Fetching rows from HuggingFace..."})
            rows = self._download_rows(pack_id, info)

            # ── Phase 2: Extract text and chunk ──
            self.installing[pack_id].update({"phase": "extracting", "percent": 40, "detail": "Extracting and chunking text..."})
            chunks = self._extract_and_chunk(pack_id, info, rows)

            # ── Phase 3: Embed ──
            self.installing[pack_id].update({"phase": "embedding", "percent": 65, "detail": f"Embedding {len(chunks)} chunks..."})
            embeddings = self._embed_chunks(pack_id, chunks)

            # ── Save ──
            self.installing[pack_id].update({"phase": "saving", "percent": 98, "detail": "Saving index..."})

            # Save chunks
            with open(pack_dir / "chunks.jsonl", "w") as f:
                for c in chunks:
                    f.write(json.dumps(c) + "\n")

            # Save embeddings
            np.save(pack_dir / "embeddings.npy", embeddings)

            # Save metadata
            elapsed = time.time() - self.installing[pack_id]["started"]
            self._save_meta(pack_id, {
                "name": info["name"],
                "enabled": True,
                "chunk_count": len(chunks),
                "row_count": len(rows),
                "installed_at": time.time(),
                "elapsed_s": round(elapsed, 1),
            })

            # Rebuild composite RAG index
            if self.on_complete:
                try:
                    self.on_complete()
                except Exception:
                    pass

            self.installing[pack_id].update({"status": "complete", "percent": 100, "detail": "Done!"})
            if self.on_notify:
                self.on_notify(
                    "SUCCESS", f"{info['name']} ready",
                    f"{len(chunks)} knowledge chunks indexed in {elapsed/60:.1f}m. "
                    f"Your model now has {info['category'].lower()} expertise.",
                    "knowledge-full", "index",
                )

            time.sleep(5)
            self.installing.pop(pack_id, None)

        except Exception as e:
            self.installing[pack_id] = {"status": "error", "detail": str(e), "name": info["name"]}
            if self.on_notify:
                self.on_notify("ERROR", f"{info['name']} install failed", str(e), "knowledge-full", "error")
            time.sleep(5)
            self.installing.pop(pack_id, None)

    def _download_rows(self, pack_id: str, info: dict) -> list[dict]:
        """Download dataset rows from HF Datasets Server API."""
        import requests as _req

        max_rows = info.get("max_rows", 10000)
        page_size = 100
        rows = []
        offset = 0

        while offset < max_rows:
            length = min(page_size, max_rows - offset)
            params = {
                "dataset": info["hf_dataset"],
                "config": info.get("hf_config", "default"),
                "split": info.get("hf_split", "train"),
                "offset": offset,
                "length": length,
            }
            try:
                resp = _req.get(HF_ROWS_API, params=params, timeout=30)
                resp.raise_for_status()
                data = resp.json()
                page_rows = data.get("rows", [])
                if not page_rows:
                    break
                for r in page_rows:
                    rows.append(r.get("row", r))
                offset += len(page_rows)

                pct = min(38, round((offset / max_rows) * 38))
                self.installing[pack_id].update({
                    "percent": pct,
                    "detail": f"Downloaded {offset}/{max_rows} rows...",
                })
            except Exception as e:
                if rows:
                    # Partial download — use what we have
                    break
                raise RuntimeError(f"Download failed: {e}")

        # Save raw data for potential reprocessing
        raw_path = self.packs_dir / pack_id / "raw" / "data.jsonl"
        with open(raw_path, "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")

        return rows

    def _extract_and_chunk(self, pack_id: str, info: dict, rows: list[dict]) -> list[dict]:
        """Extract text from rows and chunk it."""
        template = info.get("text_template", "")
        text_fields = info.get("text_fields", [])
        chunks = []

        for i, row in enumerate(rows):
            # Build text from template or concatenate fields
            if template:
                try:
                    # Handle special fields — lists, dicts, chat messages
                    fmt_row = {}
                    for f in text_fields:
                        val = row.get(f, "")
                        if isinstance(val, list):
                            # Chat messages: [{"role":"user","content":"..."},...]
                            if val and isinstance(val[0], dict) and ("content" in val[0] or "value" in val[0]):
                                parts = []
                                for msg in val:
                                    role = msg.get("role", msg.get("from", ""))
                                    content = msg.get("content", msg.get("value", ""))
                                    if content:
                                        parts.append(f"{role}: {content}" if role else str(content))
                                val = "\n".join(parts)
                            else:
                                val = ", ".join(str(v) for v in val)
                        elif isinstance(val, dict):
                            val = json.dumps(val)
                        elif val is None:
                            val = ""
                        fmt_row[f] = val
                    text = template.format(**fmt_row)
                except (KeyError, IndexError):
                    text = " ".join(str(row.get(f, "")) for f in text_fields if row.get(f))
            else:
                text = " ".join(str(row.get(f, "")) for f in text_fields if row.get(f))

            text = text.strip()
            if not text or len(text) < 20:
                continue

            # Chunk long texts, keep short ones as-is
            if len(text) > 600:
                sub_chunks = self._chunk_text(text, 500, 100)
                for j, sc in enumerate(sub_chunks):
                    chunks.append({"text": sc, "source": f"{pack_id}/row_{i}_c{j}", "chunk_id": len(chunks)})
            else:
                chunks.append({"text": text, "source": f"{pack_id}/row_{i}", "chunk_id": len(chunks)})

            if i % 500 == 0:
                pct = 40 + round((i / len(rows)) * 25)
                self.installing[pack_id].update({
                    "percent": min(pct, 64),
                    "detail": f"Extracted {len(chunks)} chunks from {i}/{len(rows)} rows...",
                })

        return chunks

    def _chunk_text(self, text: str, chunk_size: int = 500, overlap: int = 100) -> list[str]:
        """Split text into overlapping chunks."""
        chunks = []
        start = 0
        while start < len(text):
            end = start + chunk_size
            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)
            start += chunk_size - overlap
        return chunks

    def _embed_chunks(self, pack_id: str, chunks: list[dict]) -> np.ndarray:
        """Embed all chunks using the shared ONNX embedder."""
        texts = [c["text"] for c in chunks]
        batch_size = 32
        all_embeddings = []

        with self._lock:  # embedder is not thread-safe
            for i in range(0, len(texts), batch_size):
                batch = texts[i:i + batch_size]
                emb = self.embedder.embed(batch)
                all_embeddings.append(emb)

                done = min(i + batch_size, len(texts))
                pct = 65 + round((done / len(texts)) * 33)
                self.installing[pack_id].update({
                    "percent": min(pct, 98),
                    "detail": f"Embedded {done}/{len(texts)} chunks...",
                })

        return np.vstack(all_embeddings)
