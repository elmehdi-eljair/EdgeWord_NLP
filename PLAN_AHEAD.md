# EdgeWord NLP — Plan Ahead

**Audience:** Dev team running on a higher-spec machine (16+ GB RAM, multi-core CPU)  
**Pre-requisite:** Read `PROGRESS.md` first for context on what has already been done.

---

## Immediate Actions (Complete Scenario 2)

### Step 1 — Build the Docker image

On the dev machine:
```bash
git clone <this-repo>
cd EdgeWord_NLP
docker build -t edgeword .
```

The image:
- Ubuntu 22.04, no CUDA/NVIDIA (spec requirement)
- Compiles `llama-cpp-python` with AVX2 flags (`-DGGML_AVX2=ON`)
- Installs `onnxruntime`, `transformers`, `huggingface_hub` (~150 MB total, no torch)
- Build time: ~10 min first time (C++ compilation), instant thereafter (Docker cache)

### Step 2 — Download GGUF models

Start with the smallest model to validate the pipeline, then step up:

```bash
# Option A: huggingface-cli (recommended)
pip install huggingface_hub
huggingface-cli download Qwen/Qwen2.5-0.5B-Instruct-GGUF \
    Qwen2.5-0.5B-Instruct-Q4_K_M.gguf --local-dir ./models

# Option B: direct Python
python -c "
from huggingface_hub import hf_hub_download
hf_hub_download('Qwen/Qwen2.5-0.5B-Instruct-GGUF',
                'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
                local_dir='./models')
"
```

Recommended model progression:

| Priority | Model | Size | Why |
|---|---|---|---|
| 1st | `Qwen2.5-0.5B-Instruct-Q4_K_M.gguf` | ~400 MB | Fastest; validates pipeline end-to-end |
| 2nd | `Llama-3.2-1B-Instruct-Q4_K_M.gguf` | ~770 MB | Better quality, still fast |
| 3rd | `Meta-Llama-3-8B-Instruct-Q4_K_M.gguf` | ~4.6 GB | Spec target; needs 16 GB RAM |

### Step 3 — Run Scenario 2

```bash
# Full benchmark: both scenarios
docker run --rm \
    -v $(pwd)/models:/models \
    edgeword \
    python run_scenarios.py --model /models/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf
```

Expected output per thread count:
```
--- Thread Count: 4 ---
  TTFT [PASS] 0.4s | TPS [PASS] 18.2 t/s | ...
```

### Step 4 — Record & compare results

The benchmark automatically prints a comparison table:
```
--- Thread Comparison Table ---
  Threads | Avg TTFT (s) | Avg TPS | TTFT SLA | TPS SLA
        1 |        1.200 |     5.1 |     FAIL |    FAIL
        2 |        0.800 |     9.8 |     PASS |    FAIL
        4 |        0.420 |    18.5 |     PASS |    PASS
        8 |        0.310 |    22.1 |     PASS |    PASS
```

Document the **optimal thread count** for the target machine and add it to `PROGRESS.md`.

---

## Optimisation Roadmap

### Fast-Path Optimisations

| Optimisation | Expected gain | Effort |
|---|---|---|
| Switch model to `all-MiniLM-L6-v2` (spec recommendation) | Smaller model, lower latency | Low |
| Batched inference (group N requests before calling ONNX) | 3–5× QPS | Medium |
| Quantise the ONNX model to INT8 (`onnxruntime.quantization`) | ~2× latency reduction | Medium |
| Pre-allocate input buffers, reuse across requests | Eliminates tokenizer allocation overhead | Medium |
| Benchmarking endpoint with FastAPI | Required for production QPS measurement | Medium |

### Compute-Path Optimisations

| Optimisation | Expected gain | Effort |
|---|---|---|
| Tune thread count per machine (currently auto-tested 1/2/4/8) | Up to 2× TPS | Low |
| Enable `mmap=True` in Llama() — maps model to RAM directly | Reduces first-load time | Low |
| Try Q5_K_M instead of Q4_K_M | ~5% better quality, ~10% slower | Low |
| Context caching — share KV cache across related requests | Reduces repeat-prompt latency | High |
| Persistent server mode (`llama-cpp-python` server) | Eliminates per-request model load overhead | Medium |

---

## Production Considerations

### Deployment

```
Client Request
      │
      ▼
  FastAPI Server (single process, multiple workers)
      │
      ├─── Fast-Path Worker Pool
      │         ONNX Session (shared, thread-safe)
      │         InferenceSession loaded once at startup
      │
      └─── Compute-Path Worker Queue
                Llama instance per worker (not thread-safe)
                Queue depth = number of CPU cores / 4
```

### Resource budgeting (per instance)

| Component | RAM | CPU |
|---|---|---|
| ONNX DistilBERT | ~70 MB | 1–2 cores at peak |
| Qwen2.5-0.5B Q4_K_M | ~400 MB | 4–8 cores at peak |
| Llama-3-8B Q4_K_M | ~4.6 GB | 4–8 cores at peak |
| OS + Python + FastAPI | ~300 MB | background |

Minimum recommended server: **16 GB RAM, 8 cores** (matches spec Section 2.1).

### Health checks to implement

- [ ] ONNX session warmup at startup (prevent cold-start SLA misses)
- [ ] `GET /health` returning model load status and last-10 p95 latency
- [ ] Prometheus metrics: `fast_path_latency_ms`, `compute_path_tps`, `queue_depth`
- [ ] Graceful shutdown: drain in-flight requests before stopping

---

## Testing Checklist

- [ ] Scenario 1: run on dev machine, confirm p50 < 50 ms
- [ ] Scenario 2: run with Qwen2.5-0.5B, confirm TTFT < 1 s and TPS >= 10
- [ ] Scenario 2: run with Llama-3-8B (full spec model), record results
- [ ] Stress test: 1000-request burst on Fast-Path, check p99
- [ ] Memory test: run Scenario 2 for 30 minutes, check for leaks via `psutil`
- [ ] Docker: verify image runs on ARM64 (Apple Silicon / AWS Graviton)

---

## Open Issues

| # | Issue | Owner | Priority |
|---|---|---|---|
| 1 | Scenario 2 not yet run — blocked on model download + Docker build | Dev team | High |
| 2 | Fast-Path uses DistilBERT; spec recommends MiniLM-L6-v2 | Dev team | Medium |
| 3 | No FastAPI wrapper yet — benchmark is standalone script only | Dev team | Medium |
| 4 | No INT8 quantisation on ONNX model | Dev team | Low |
| 5 | No ARM64 Docker build tested | Dev team | Low |
