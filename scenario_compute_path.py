"""
Scenario 2: Compute-Path (Language Generation) Benchmark
Model: GGUF Q4_K_M via llama-cpp-python (CPU only, n_gpu_layers=0)
SLA:   TTFT < 1 second | sustained 10-25 tokens/sec
Tasks: text generation, TTFT & TPS across thread counts
"""

import time
import sys
import os
import multiprocessing
from pathlib import Path

SLA_TTFT_S = 1.0
SLA_TPS_MIN = 10
SLA_TPS_TARGET = 25

TEST_PROMPTS = [
    "Explain the concept of 4-bit quantization and why it reduces memory bandwidth requirements:",
    "List three key advantages of running AI inference on CPU instead of GPU:",
    "Describe in one paragraph how the GGUF format stores quantized model weights:",
    "What is the difference between ONNX Runtime and llama.cpp as inference engines:",
    "Explain why cache-friendly matrix multiplication matters for CPU inference speed:",
]

MAX_TOKENS = 120
N_CTX = 512


def _detect_thread_counts() -> list[int]:
    logical = multiprocessing.cpu_count()
    counts = sorted({1, 2, 4, max(1, logical // 2), logical})
    return counts


def run_compute_path_benchmark(model_path: str) -> dict:
    from llama_cpp import Llama

    print("=" * 62)
    print("SCENARIO 2: Compute-Path — llama.cpp (CPU)")
    print("=" * 62)
    print(f"  Model:      {Path(model_path).name}")
    print(f"  Max tokens: {MAX_TOKENS} | Context: {N_CTX}")
    print(f"  SLA TTFT:   < {SLA_TTFT_S}s")
    print(f"  SLA TPS:    {SLA_TPS_MIN}–{SLA_TPS_TARGET} tokens/sec\n")

    thread_counts = _detect_thread_counts()
    print(f"  Thread counts to test: {thread_counts}\n")

    all_results: dict[int, dict] = {}

    for n_threads in thread_counts:
        print(f"--- Thread Count: {n_threads} ---")

        t_load = time.perf_counter()
        llm = Llama(
            model_path=model_path,
            n_ctx=N_CTX,
            n_threads=n_threads,
            n_gpu_layers=0,       # Force CPU — matches spec
            verbose=False,
        )
        load_s = time.perf_counter() - t_load
        print(f"  Loaded in {load_s:.2f}s")

        run_results = []

        for prompt in TEST_PROMPTS:
            first_token_time: float | None = None
            tokens_generated = 0
            full_text = []

            t_start = time.perf_counter()

            # create_completion with stream=True gives per-token timing
            stream = llm.create_completion(
                prompt,
                max_tokens=MAX_TOKENS,
                stream=True,
                echo=False,
                temperature=0.0,   # deterministic — consistent benchmarks
            )

            for chunk in stream:
                if first_token_time is None:
                    first_token_time = time.perf_counter() - t_start
                tokens_generated += 1
                full_text.append(chunk["choices"][0]["text"])

            total_s = time.perf_counter() - t_start
            tps = tokens_generated / total_s if total_s > 0 else 0.0
            ttft = first_token_time if first_token_time is not None else total_s

            ttft_ok = "PASS" if ttft < SLA_TTFT_S else "FAIL"
            tps_ok = "PASS" if tps >= SLA_TPS_MIN else "FAIL"

            print(
                f"  TTFT [{ttft_ok}] {ttft:.3f}s | "
                f"TPS [{tps_ok}] {tps:.1f} t/s | "
                f"{tokens_generated} tokens | {prompt[:45]}..."
            )

            run_results.append({"ttft_s": ttft, "tps": tps, "tokens": tokens_generated})

        avg_ttft = sum(r["ttft_s"] for r in run_results) / len(run_results)
        avg_tps = sum(r["tps"] for r in run_results) / len(run_results)

        ttft_sla = "PASS" if avg_ttft < SLA_TTFT_S else "FAIL"
        tps_sla = "PASS" if avg_tps >= SLA_TPS_MIN else "FAIL"

        print(f"\n  threads={n_threads} avg: TTFT {avg_ttft:.3f}s [{ttft_sla}]  TPS {avg_tps:.1f} [{tps_sla}]\n")

        all_results[n_threads] = {
            "avg_ttft_s": avg_ttft,
            "avg_tps": avg_tps,
            "runs": run_results,
        }

        del llm  # release RAM before next thread config

    # --- Cross-thread comparison table ---
    print("--- Thread Comparison Table ---")
    print(f"  {'Threads':>8} | {'Avg TTFT (s)':>12} | {'Avg TPS':>9} | {'TTFT SLA':>9} | {'TPS SLA':>8}")
    print("  " + "-" * 56)
    for n_t, r in all_results.items():
        ts = "PASS" if r["avg_ttft_s"] < SLA_TTFT_S else "FAIL"
        ps = "PASS" if r["avg_tps"] >= SLA_TPS_MIN else "FAIL"
        print(f"  {n_t:>8} | {r['avg_ttft_s']:>12.3f} | {r['avg_tps']:>9.1f} | {ts:>9} | {ps:>8}")

    best_threads = max(all_results, key=lambda k: all_results[k]["avg_tps"])
    print(f"\n  Best TPS config: {best_threads} threads "
          f"({all_results[best_threads]['avg_tps']:.1f} t/s)\n")

    return all_results


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scenario_compute_path.py <path/to/model.gguf>")
        print("\nRecommended models (download from HuggingFace):")
        print("  Qwen2.5-0.5B-Instruct-Q4_K_M.gguf  (~400 MB, fast)")
        print("  Llama-3.2-1B-Instruct-Q4_K_M.gguf  (~770 MB)")
        print("  Meta-Llama-3-8B-Instruct-Q4_K_M.gguf (~4.6 GB)")
        sys.exit(1)

    path = sys.argv[1]
    if not Path(path).exists():
        print(f"Model file not found: {path}")
        sys.exit(1)

    run_compute_path_benchmark(path)
