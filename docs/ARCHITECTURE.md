# EdgeWord NLP — Architecture

## System Overview

EdgeWord is a fully CPU-native NLP pipeline with no GPU or cloud API dependencies. It processes text through two inference branches and is augmented with RAG, caching, conversation memory, and auto-tools.

```
                          User Input
                              │
                    ┌─────────┴──────────┐
                    │                    │
              ┌─────▼─────┐       ┌─────▼─────┐
              │ Fast-Path  │       │  Auto-     │
              │ ONNX       │       │  Tools     │
              │ DistilBERT │       │ calc/date/ │
              │ ~14ms      │       │ sysinfo    │
              └─────┬──────┘       └─────┬──────┘
                    │                    │
                    │              ┌─────▼──────┐
                    │              │  RAG       │
                    │              │  FAISS +   │
                    │              │  MiniLM    │
                    │              │  ~5ms      │
                    │              └─────┬──────┘
                    │                    │
                    │              ┌─────▼──────┐
                    │              │  Cache     │
                    │              │  SQLite    │
                    │              │  ~0ms hit  │
                    │              └──┬────┬────┘
                    │                 │    │
                    │            hit  │    │ miss
                    │                 │    │
                    │                 │  ┌─▼────────┐
                    │                 │  │ Compute-  │
                    │                 │  │ Path      │
                    │                 │  │ llama.cpp │
                    │                 │  │ Llama 1B  │
                    │                 │  │ ~15 t/s   │
                    │                 │  └─┬─────────┘
                    │                 │    │
                    ▼                 ▼    ▼
              ┌───────────────────────────────┐
              │        JSON Response          │
              │  sentiment + response + tools │
              │  + rag_sources + metrics      │
              └───────────────────────────────┘
```

---

## Components

### Fast-Path (Language Understanding)

| Property | Value |
|---|---|
| Engine | ONNX Runtime, CPUExecutionProvider |
| Model | DistilBERT-SST2 (pre-exported ONNX, 67M params) |
| Task | Binary sentiment classification |
| Latency | ~14 ms per sequence |
| Dependencies | onnxruntime, transformers (tokenizer only), numpy |

The model is downloaded once from HuggingFace and cached locally. No PyTorch is required — inference uses raw `InferenceSession` with `ORT_ENABLE_ALL` graph optimisation. Input is tokenized to numpy arrays and fed directly to ONNX Runtime.

**File:** `cli.py` → `FastPath` class

### Compute-Path (Language Generation)

| Property | Value |
|---|---|
| Engine | llama-cpp-python (C++ backend) |
| Model | Llama-3.2-1B-Instruct-Q4_K_M (GGUF, 771 MB) |
| Task | Text generation, chat |
| Performance | ~15 t/s at 4 threads, TTFT ~0.4s |
| Dependencies | llama-cpp-python (compiled with AVX2) |

The model runs entirely in CPU RAM with `n_gpu_layers=0`. GGUF Q4_K_M quantization reduces the 1B parameter model to 771 MB while retaining quality. Thread count is configurable and defaults to 4 (matches physical core count).

**Chat template auto-detection:** The system detects whether the model uses ChatML (Qwen, Mistral) or Llama 3 format based on the filename and builds prompts accordingly.

**File:** `cli.py` → `ComputePath` class

### RAG (Retrieval Augmented Generation)

| Property | Value |
|---|---|
| Embedding model | all-MiniLM-L6-v2 (ONNX, 22M params) |
| Vector store | FAISS (IndexFlatIP, cosine similarity) |
| Chunk size | 500 chars, 100 char overlap |
| Retrieval | Top-3 chunks, threshold 0.3 |

Documents from `./docs/` are loaded, chunked, and embedded on startup. Embeddings are computed with ONNX Runtime (same CPUExecutionProvider as Fast-Path). FAISS indexes are held in-memory for sub-millisecond retrieval.

**Supported file types:** `.txt`, `.md`, `.py`, `.js`, `.ts`, `.json`, `.csv`, `.yaml`, `.yml`, `.toml`, `.html`, `.xml`, `.rst`, `.sh`

**File:** `rag.py` → `RAGEngine`, `ONNXEmbedder` classes

### Response Cache

| Property | Value |
|---|---|
| Backend | SQLite |
| Key | SHA-256 hash of normalized input |
| Location | `.cache/responses.db` |

Identical queries return cached responses instantly (0ms LLM overhead). The cache persists across restarts. Cache hits still save to conversation memory for continuity.

**File:** `cache.py` → `ResponseCache` class

### Auto-Tools

| Tool | Detection | Latency |
|---|---|---|
| Calculator | Math expressions with operators | ~0ms |
| DateTime | "what time", "what date", etc. | ~0ms |
| SystemInfo | "cpu info", "how much ram", etc. | ~0ms |
| FileReader | "read file X", "show X", etc. | ~1ms |

Tools are detected deterministically from the input text (no LLM-based routing). Results are injected into the LLM context as additional information, so the model can reference them in its response.

**File:** `tools.py` → `AutoTools` class

### Conversation Memory

| Property | Value |
|---|---|
| Backend | LangChain messages (HumanMessage, AIMessage) |
| Window | Last 50 turns (configurable) |
| Scope | Per-session (CLI) or per-session_id (API) |

Conversation history is injected into the prompt as prior user/assistant turns. The model sees the full conversation context and can reference earlier exchanges.

**File:** `cli.py` → `ComputePath.history`, API → `sessions` dict

### API Key Management

| Property | Value |
|---|---|
| Backend | SQLite |
| Key format | `ew_` prefix + 32-byte URL-safe token |
| Storage | SHA-256 hash (raw key never stored) |
| Rate limiting | Per-key, configurable (default 60 req/min) |
| Tracking | Requests, tokens, latency per key |

**File:** `api_keys.py` → `APIKeyManager` class

---

## Project Structure

```
EdgeWord_NLP/
├── cli.py                     # Interactive CLI (FastPath + ComputePath)
├── api.py                     # FastAPI REST server
├── api_keys.py                # API key management (CLI + library)
├── rag.py                     # RAG engine (ONNX embeddings + FAISS)
├── cache.py                   # SQLite response cache
├── tools.py                   # Auto-tools (calc, datetime, sysinfo, file)
├── run_scenarios.py           # Benchmark orchestrator
├── scenario_fast_path.py      # Scenario 1 benchmark
├── scenario_compute_path.py   # Scenario 2 benchmark
├── Dockerfile                 # CPU-only Ubuntu 22.04 image
├── requirements.txt           # Python dependencies
├── Technical Specification.txt # Original project spec
├── TESTING_REPORT.md          # Full benchmark results
├── PROGRESS.md                # Development progress
├── PLAN_AHEAD.md              # Roadmap and next steps
├── docs/                      # Documents for RAG indexing
│   └── about_edgeword.txt
├── models/                    # GGUF models (gitignored)
│   └── Llama-3.2-1B-Instruct-Q4_K_M.gguf
└── .cache/                    # SQLite databases (gitignored)
    ├── responses.db
    └── api_keys.db
```

---

## Data Flow

### CLI Mode

```
User types text
  → FastPath.classify() → sentiment result (14ms)
  → AutoTools.run() → tool result if matched (0ms)
  → RAGEngine.retrieve() → relevant chunks (5ms)
  → ResponseCache.get() → if hit, return immediately
  → ComputePath.chat() → LLM generation with history + RAG + tools
  → ResponseCache.put() → store for future
  → Print all results
```

### API Mode

```
HTTP Request with Bearer token
  → verify_api_key() → validate + rate limit check
  → FastPath._infer() → sentiment
  → AutoTools.run() → tool result
  → RAGEngine.retrieve() → RAG context
  → ResponseCache.get() → cache check
  → ComputePath (llama.cpp) → generate with session memory
  → ResponseCache.put() → cache store
  → APIKeyManager.log_usage() → track request
  → Return JSON response
```

---

## Performance Characteristics

| Component | Latency | RAM |
|---|---|---|
| Fast-Path (ONNX) | ~14 ms | ~70 MB |
| Compute-Path (Llama 1B) | TTFT ~0.4s, 15 t/s | ~1.2 GB |
| RAG retrieval | ~5 ms | ~50 MB |
| Response cache hit | ~0 ms | negligible |
| Auto-tools | ~0 ms | negligible |
| Embedding (per chunk) | ~3 ms | shared with RAG |

**Total RAM:** ~1.5 GB for all components loaded simultaneously.

**Minimum hardware:** 4-core x86_64 CPU with AVX2, 8 GB RAM.  
**Recommended:** 8-core CPU, 16 GB RAM.
