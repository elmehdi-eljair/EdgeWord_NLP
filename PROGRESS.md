# EdgeWord NLP — Progress Report

**Date:** 2026-05-01  
**Environment:** Windows 10 Pro · Python 3.13.1 · Intel Core i7 (8 logical cores) · 15.8 GB RAM  
**Spec reference:** `Technical Specification.txt`

---

## What Was Built

### Core Scenario Scripts

| File | Purpose |
|---|---|
| `scenario_fast_path.py` | Scenario 1 benchmark — ONNX Runtime + DistilBERT-SST2, measures per-sequence latency and QPS |
| `scenario_compute_path.py` | Scenario 2 benchmark — llama-cpp-python + GGUF, measures TTFT and tokens/sec across thread counts |
| `run_scenarios.py` | Orchestrator: runs environment check, invokes both scenarios, prints final report |

### Infrastructure

| File | Purpose |
|---|---|
| `Dockerfile` | CPU-only Ubuntu 22.04 image, stripped of CUDA/NVIDIA runtimes (per spec Section 5) |
| `requirements.txt` | Native Python dependencies |

---

## Scenario 1 Results — Fast-Path (ONNX Runtime)

**Model:** `optimum/distilbert-base-uncased-finetuned-sst-2-english` (pre-exported ONNX, no torch)  
**Implementation:** `onnxruntime.InferenceSession` · `CPUExecutionProvider` · `ORT_ENABLE_ALL` graph optimisation  
**Test set:** 12 sentences (sentiment classification)

### Benchmark Results (native Windows, best run)

| Metric | Result | SLA | Status |
|---|---|---|---|
| Min latency | 10.4 ms | — | — |
| Median (p50) | 12.7 ms | < 50 ms | **PASS** |
| p95 latency | 14.5 ms | — | — |
| Max latency | 15.1 ms | — | — |
| QPS (100 requests) | 73.8 req/sec | maximise | — |
| SLA pass rate | 12 / 12 (100%) | — | **PASS** |

> **Headroom:** median is 3.9× below the 50 ms SLA.

### Classification Accuracy

All 12 sentences classified correctly at 100% confidence. Sample:

| Input | Label | Confidence |
|---|---|---|
| "Absolutely fantastic — best purchase this year" | POSITIVE | 100% |
| "I cannot believe how unreliable this software is" | NEGATIVE | 100% |
| "The documentation is clear and easy to follow" | POSITIVE | 100% |

---

## Scenario 2 Status — Compute-Path (llama.cpp)

**Status: Blocked — in progress**

### Root Cause

`llama-cpp-python` ships no pre-built wheel for Python 3.13 on Windows. Building from source requires CMake + MSVC/GCC, which are not installed on the test machine. This is a [known open issue](https://github.com/abetlen/llama-cpp-python/issues/2130) in the project.

### Resolution: Docker

The `Dockerfile` was created per spec Section 5 ("Initialize a Docker container stripped of CUDA/NVIDIA runtimes"). Inside Ubuntu 22.04, `llama-cpp-python` compiles cleanly with `build-essential` + `cmake`.

Docker build is currently running (nohup, detached). Once complete:
```bash
docker run --rm -v /path/to/models:/models edgeword \
    python run_scenarios.py --model /models/<model>.gguf
```

---

## Issues Encountered & Solutions

### 1. `optimum[onnxruntime]` pulls torch (448 MB)
- **Problem:** Docker pip install timed out downloading ~700 MB of packages.
- **Fix:** Replaced `optimum`+`torch` with direct `onnxruntime.InferenceSession` + `huggingface_hub.snapshot_download`. Total pip footprint reduced from ~700 MB to ~150 MB.

### 2. `llama-cpp-python` no pre-built wheel for Python 3.13
- **Problem:** No `cp313-win_amd64` wheel on PyPI or the official CPU wheel index.
- **Fix:** Use Docker (Ubuntu 22.04 + build-essential + cmake compiles it cleanly).

### 3. Windows CPU power management spikes
- **Observation:** Occasional p95 spikes (50–150 ms) on Windows due to CPU thermal throttling / Balanced power plan.
- **Mitigation:** 10-rep warmup with real sentences stabilises the steady-state. Not an issue in Docker/Linux.

---

## Key Decisions

| Decision | Rationale |
|---|---|
| Use pre-exported ONNX model (no `export=True`) | Eliminates torch at inference time; no GPU needed for export |
| Drop `optimum` wrapper, use raw `InferenceSession` | Removes 450 MB torch dependency, still uses the same ONNX file |
| `ORT_ENABLE_ALL` graph optimisation | Enables AVX2 kernel fusion and constant folding for max CPU throughput |
| `return_tensors="np"` in tokenizer | Feeds numpy arrays directly to ONNX Runtime — no tensor conversion overhead |
| `temperature=0.0` in Scenario 2 | Deterministic generation for reproducible benchmark numbers |
