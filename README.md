# EdgeWord NLP — CPU-Native NLP Pipeline

> Project specification: `Technical Specification.txt`

EdgeWord is a fully CPU-native NLP pipeline with no GPU or cloud API dependencies. It runs two distinct inference branches: a high-throughput **Fast-Path** for language understanding (ONNX Runtime), and a **Compute-Path** for language generation (llama.cpp / GGUF).

---

## Architecture

```
Input Text
    │
    ├─── Fast-Path (< 50 ms SLA)
    │       DistilBERT / MiniLM
    │       ONNX Runtime · CPUExecutionProvider · AVX2
    │       Tasks: classification, sentiment, entity extraction
    │
    └─── Compute-Path (< 1 s TTFT · 10–25 t/s SLA)
            Qwen2.5 / Llama-3 · GGUF Q4_K_M
            llama-cpp-python · compiled C++
            Tasks: generation, summarisation
```

---

## Project Structure

```
EdgeWord_NLP/
├── Technical Specification.txt   # Original spec
├── scenario_fast_path.py         # Scenario 1 benchmark (ONNX)
├── scenario_compute_path.py      # Scenario 2 benchmark (llama.cpp)
├── run_scenarios.py              # Orchestrator — runs both, prints report
├── Dockerfile                    # CPU-only Ubuntu 22.04 image (no CUDA)
├── requirements.txt              # Native Python deps
├── PROGRESS.md                   # What has been built and tested
└── PLAN_AHEAD.md                 # Next steps for the dev team
```

---

## Quick Start

### Option A — Docker (recommended, matches spec)

```bash
# Build image (compiles llama-cpp-python from source, ~10 min first run)
docker build -t edgeword .

# Scenario 1 only — no model needed
docker run --rm edgeword python run_scenarios.py --fast-only

# Both scenarios — mount a GGUF model
docker run --rm -v /path/to/models:/models edgeword \
    python run_scenarios.py --model /models/Qwen2.5-0.5B-Q4_K_M.gguf
```

### Option B — Native Python (Windows/Linux/macOS)

```bash
pip install -r requirements.txt

# Scenario 1
python scenario_fast_path.py

# Both scenarios (requires a compiled llama-cpp-python + GGUF model)
python run_scenarios.py --model path/to/model.gguf
```

> **Windows note:** `llama-cpp-python` requires VS Build Tools 2022 or run via Docker.

---

## Benchmark Targets (from spec)

| Path | Metric | SLA |
|---|---|---|
| Fast-Path | Latency per sequence | < 50 ms |
| Fast-Path | QPS | maximise |
| Compute-Path | Time-To-First-Token | < 1 s |
| Compute-Path | Sustained generation | 10–25 tokens/sec |

---

## Recommended GGUF Models

| Model | Size | Use case |
|---|---|---|
| `Qwen2.5-0.5B-Instruct-Q4_K_M.gguf` | ~400 MB | Baseline / CI |
| `Llama-3.2-1B-Instruct-Q4_K_M.gguf` | ~770 MB | Light production |
| `Meta-Llama-3-8B-Instruct-Q4_K_M.gguf` | ~4.6 GB | Full spec target |

Download from [HuggingFace](https://huggingface.co/models?library=gguf&sort=trending).

---

## Environment Check

```bash
python run_scenarios.py --check
```
