# EdgeWord NLP — Progress Report

**Date:** 2026-05-01  
**Environment:** Ubuntu 24.04 (Linux 6.17.0-20-generic) · Python 3.12.3 · Intel Core i7-4810MQ (4C/8T) · 15.5 GB RAM  
**Previous environment:** Windows 10 Pro · Python 3.13.1 · Intel Core i7 (8 logical cores) · 15.8 GB RAM  
**Spec reference:** `Technical Specification.txt`  
**Full test report:** `TESTING_REPORT.md`

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

### Benchmark Results (native Linux, latest run)

| Metric | Result | SLA | Status |
|---|---|---|---|
| Min latency | 17.6 ms | — | — |
| Median (p50) | 18.2 ms | < 50 ms | **PASS** |
| p95 latency | 19.5 ms | — | — |
| Max latency | 19.6 ms | — | — |
| QPS (100 requests) | 56.4 req/sec | maximise | — |
| SLA pass rate | 12 / 12 (100%) | — | **PASS** |

> **Headroom:** median is 2.7× below the 50 ms SLA.

### Previous Results (Windows 10, Python 3.13.1)

| Metric | Result |
|---|---|
| Median (p50) | 12.7 ms |
| p95 | 14.5 ms |
| QPS | 73.8 req/sec |

### Classification Accuracy

All 12 sentences classified correctly at 100% confidence. Sample:

| Input | Label | Confidence |
|---|---|---|
| "Absolutely fantastic — best purchase this year" | POSITIVE | 100% |
| "I cannot believe how unreliable this software is" | NEGATIVE | 100% |
| "The documentation is clear and easy to follow" | POSITIVE | 100% |

---

## Scenario 2 Results — Compute-Path (llama.cpp)

**Status: Complete — ALL SLAs PASSED**

**Model:** `Qwen2.5-0.5B-Instruct-Q4_K_M.gguf` (469 MB, 4-bit quantised)  
**Implementation:** `llama-cpp-python` 0.3.21, compiled from source with `-DGGML_AVX2=ON`, `n_gpu_layers=0`  
**Test set:** 5 technical prompts, 120 max tokens, temperature=0.0

### Benchmark Results (native Linux, Ubuntu 24.04)

| Threads | Avg TTFT (s) | Avg TPS (t/s) | TTFT SLA (<1s) | TPS SLA (10+) |
|---|---|---|---|---|
| 1 | 0.315 | 18.4 | **PASS** | **PASS** |
| 2 | 0.204 | 27.6 | **PASS** | **PASS** |
| **4** | **0.246** | **33.5** | **PASS** | **PASS** |
| 8 | 0.208 | 19.8 | **PASS** | **PASS** |

**Optimal config: 4 threads (33.5 t/s)** — matches physical core count. 8-thread performance drops due to hyperthreading contention.

### Previous Blockers (Resolved)

- `llama-cpp-python` had no pre-built wheel for Python 3.13 on Windows — resolved by running natively on Ubuntu 24.04 with Python 3.12.3 and compiling from source with cmake + gcc.

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
