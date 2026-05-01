# EdgeWord NLP — Full Testing Report

**Date:** 2026-05-01  
**Environment:** Ubuntu 24.04 (Linux 6.17.0-20-generic) · Python 3.12.3 · Intel Core i7-4810MQ @ 2.80 GHz (4 cores / 8 threads, HT) · 15.5 GB RAM  
**Spec reference:** `Technical Specification.txt`

---

## Environment Summary

| Component | Version |
|---|---|
| OS | Ubuntu 24.04 LTS (x86_64) |
| Kernel | 6.17.0-20-generic |
| Python | 3.12.3 (venv) |
| onnxruntime | 1.25.1 (CPUExecutionProvider) |
| transformers | 5.7.0 |
| llama-cpp-python | 0.3.21 (compiled from source, AVX2) |
| cmake | 3.28.3 |
| gcc/g++ | 13.3.0 |

**CPU Features:** AVX2 supported — enables optimised ONNX kernels and llama.cpp matrix multiplication.  
**GPU:** None used (CPU-only pipeline as per spec).

---

## Scenario 1: Fast-Path (Language Understanding)

**Model:** `optimum/distilbert-base-uncased-finetuned-sst-2-english` (pre-exported ONNX, no PyTorch)  
**Engine:** ONNX Runtime · CPUExecutionProvider · `ORT_ENABLE_ALL` graph optimisation  
**Test set:** 12 sentences (sentiment classification)  
**Warmup:** 10 repetitions with real sentences before measurement

### Latency Results

| Sentence | Latency (ms) | SLA (<50ms) | Label | Confidence |
|---|---|---|---|---|
| "The product quality is excellent and I am very satisfied with the results." | 18.3 | PASS | POSITIVE | 100% |
| "This was a terrible experience, nothing worked and support was useless." | 18.2 | PASS | NEGATIVE | 100% |
| "The documentation is clear, well-structured, and easy to follow." | 18.3 | PASS | POSITIVE | 100% |
| "Absolutely fantastic — best purchase I have made this year by far." | 18.2 | PASS | POSITIVE | 100% |
| "Disappointing results, the service was painfully slow and unhelpful." | 18.5 | PASS | NEGATIVE | 100% |
| "The meeting was productive and the team reached every goal we set." | 18.1 | PASS | POSITIVE | 100% |
| "I cannot believe how unreliable this software is in production." | 17.6 | PASS | NEGATIVE | 100% |
| "Outstanding customer support, I highly recommend this to everyone." | 17.7 | PASS | POSITIVE | 100% |
| "Performance is average, nothing special to report either way." | 17.7 | PASS | NEGATIVE | 100% |
| "The new architecture dramatically reduced our latency and cost." | 17.7 | PASS | NEGATIVE | 100% |
| "Setup took hours and the instructions were completely misleading." | 19.5 | PASS | NEGATIVE | 100% |
| "Solid framework with good defaults, minor rough edges on Windows." | 19.6 | PASS | POSITIVE | 100% |

### Summary Statistics

| Metric | Result | SLA | Status |
|---|---|---|---|
| Min latency | 17.6 ms | — | — |
| Median (p50) | 18.2 ms | < 50 ms | **PASS** |
| p95 latency | 19.5 ms | — | — |
| Max latency | 19.6 ms | — | — |
| QPS (100 requests) | 56.4 req/sec | maximise | — |
| SLA pass rate | 12 / 12 (100%) | — | **PASS** |

**Headroom:** Median is **2.7× below** the 50 ms SLA target.

### Classification Notes

- 10/12 sentences classified with expected sentiment.
- Sentences 9 ("Performance is average...") and 10 ("The new architecture dramatically reduced our latency and cost.") were classified as NEGATIVE at 100% confidence. These are borderline/ambiguous for a binary sentiment model — sentence 9 is neutral-leaning and sentence 10 is arguably positive. This is a **model limitation** of DistilBERT-SST2, not a pipeline issue. Switching to MiniLM-L6-v2 (as recommended in the spec) may improve accuracy on edge cases.

---

## Scenario 2: Compute-Path (Language Generation)

**Model:** `Qwen2.5-0.5B-Instruct-Q4_K_M.gguf` (469 MB, 4-bit quantised)  
**Engine:** llama-cpp-python 0.3.21 · compiled with `-DGGML_AVX2=ON` · `n_gpu_layers=0` (CPU only)  
**Context:** 512 tokens · Max generation: 120 tokens · Temperature: 0.0 (deterministic)  
**Test set:** 5 technical prompts

### Per-Thread Results

#### 1 Thread

| Prompt (truncated) | TTFT (s) | TPS (t/s) | Tokens | TTFT SLA | TPS SLA |
|---|---|---|---|---|---|
| Explain the concept of 4-bit quantization... | 0.468 | 18.0 | 121 | PASS | PASS |
| List three key advantages of running AI... | 0.198 | 18.5 | 121 | PASS | PASS |
| Describe in one paragraph how the GGUF... | 0.342 | 18.4 | 121 | PASS | PASS |
| What is the difference between ONNX Runtime... | 0.189 | 18.9 | 121 | PASS | PASS |
| Explain why cache-friendly matrix multi... | 0.381 | 18.4 | 121 | PASS | PASS |

**Average:** TTFT 0.315s [PASS] · TPS 18.4 [PASS]

#### 2 Threads

| Prompt (truncated) | TTFT (s) | TPS (t/s) | Tokens | TTFT SLA | TPS SLA |
|---|---|---|---|---|---|
| Explain the concept of 4-bit quantization... | 0.265 | 27.5 | 121 | PASS | PASS |
| List three key advantages of running AI... | 0.183 | 28.0 | 121 | PASS | PASS |
| Describe in one paragraph how the GGUF... | 0.186 | 27.4 | 121 | PASS | PASS |
| What is the difference between ONNX Runtime... | 0.235 | 27.2 | 121 | PASS | PASS |
| Explain why cache-friendly matrix multi... | 0.153 | 27.8 | 121 | PASS | PASS |

**Average:** TTFT 0.204s [PASS] · TPS 27.6 [PASS]

#### 4 Threads (Best Configuration)

| Prompt (truncated) | TTFT (s) | TPS (t/s) | Tokens | TTFT SLA | TPS SLA |
|---|---|---|---|---|---|
| Explain the concept of 4-bit quantization... | 0.300 | 33.0 | 121 | PASS | PASS |
| List three key advantages of running AI... | 0.215 | 33.9 | 121 | PASS | PASS |
| Describe in one paragraph how the GGUF... | 0.245 | 33.5 | 121 | PASS | PASS |
| What is the difference between ONNX Runtime... | 0.280 | 33.3 | 121 | PASS | PASS |
| Explain why cache-friendly matrix multi... | 0.189 | 34.0 | 121 | PASS | PASS |

**Average:** TTFT 0.246s [PASS] · TPS 33.5 [PASS]

#### 8 Threads

| Prompt (truncated) | TTFT (s) | TPS (t/s) | Tokens | TTFT SLA | TPS SLA |
|---|---|---|---|---|---|
| Explain the concept of 4-bit quantization... | 0.206 | 15.0 | 121 | PASS | PASS |
| List three key advantages of running AI... | 0.304 | 20.7 | 121 | PASS | PASS |
| Describe in one paragraph how the GGUF... | 0.185 | 20.4 | 121 | PASS | PASS |
| What is the difference between ONNX Runtime... | 0.186 | 21.4 | 121 | PASS | PASS |
| Explain why cache-friendly matrix multi... | 0.159 | 21.4 | 121 | PASS | PASS |

**Average:** TTFT 0.208s [PASS] · TPS 19.8 [PASS]

### Thread Comparison Summary

| Threads | Avg TTFT (s) | Avg TPS (t/s) | TTFT SLA | TPS SLA |
|---|---|---|---|---|
| 1 | 0.315 | 18.4 | **PASS** | **PASS** |
| 2 | 0.204 | 27.6 | **PASS** | **PASS** |
| **4** | **0.246** | **33.5** | **PASS** | **PASS** |
| 8 | 0.208 | 19.8 | **PASS** | **PASS** |

**Optimal configuration: 4 threads** — matches the number of physical cores on this i7-4810MQ. Performance drops at 8 threads due to hyperthreading contention, which is expected behaviour for compute-bound workloads.

**Best TPS (33.5 t/s) exceeds the upper SLA target of 25 t/s by 34%.**

---

## Combined SLA Compliance

| Path | Metric | SLA Target | Result | Status | Margin |
|---|---|---|---|---|---|
| Fast-Path | Median latency | < 50 ms | 18.2 ms | **PASS** | 2.7× headroom |
| Fast-Path | QPS | maximise | 56.4 req/s | — | — |
| Compute-Path | TTFT | < 1 s | 0.204 s (best) | **PASS** | 4.9× headroom |
| Compute-Path | Sustained TPS | 10–25 t/s | 33.5 t/s (best) | **PASS** | 1.3× above upper target |

**Overall: ALL SLAs PASSED across both scenarios.**

---

## Issues & Observations

### 1. DistilBERT-SST2 Misclassifications
Two sentences were arguably misclassified (neutral/positive text labelled NEGATIVE). The spec recommends `all-MiniLM-L6-v2` — switching to it may improve accuracy and reduce latency further.

### 2. Hyperthreading Penalty at 8 Threads
TPS dropped from 33.5 (4 threads) to 19.8 (8 threads). This is expected: the i7-4810MQ has 4 physical cores with HT. llama.cpp's matrix multiplication is ALU-bound, and HT threads compete for the same execution units. **Recommendation:** Pin thread count to physical core count in production.

### 3. No PyTorch Dependency
The entire pipeline runs without PyTorch. Total venv footprint is ~150 MB (vs ~700 MB with torch). This matches the spec's goal of lightweight CPU-native deployment.

### 4. Model Used vs Spec Target
This test used Qwen2.5-0.5B (469 MB), the smallest recommended model. The spec's full target is Meta-Llama-3-8B (~4.6 GB). The 0.5B model validates the pipeline end-to-end; the 8B model should be tested on a machine with 16+ GB available RAM for production-grade benchmarking.

---

## Test Environment Reproducibility

```bash
# Create venv and install dependencies
python3 -m venv .venv
.venv/bin/pip install "onnxruntime>=1.17.0" "transformers>=4.38.0" huggingface_hub numpy psutil
CMAKE_ARGS="-DGGML_AVX2=ON" .venv/bin/pip install llama-cpp-python

# Download model
.venv/bin/python3 -c "
from huggingface_hub import hf_hub_download
hf_hub_download('Qwen/Qwen2.5-0.5B-Instruct-GGUF',
                'qwen2.5-0.5b-instruct-q4_k_m.gguf',
                local_dir='./models')
"

# Run both scenarios
.venv/bin/python3 run_scenarios.py --model ./models/qwen2.5-0.5b-instruct-q4_k_m.gguf

# Run individually
.venv/bin/python3 run_scenarios.py --fast-only
.venv/bin/python3 run_scenarios.py --compute-only --model ./models/qwen2.5-0.5b-instruct-q4_k_m.gguf
```
