"""
EdgeWord NLP Pipeline — Scenario Test Runner
Runs Fast-Path and/or Compute-Path benchmarks and prints a final report.

Usage:
    # Environment check only:
    python run_scenarios.py --check

    # Fast-Path only (no GGUF model needed):
    python run_scenarios.py --fast-only

    # Both paths:
    python run_scenarios.py --model path/to/model.gguf

    # Compute-Path only:
    python run_scenarios.py --compute-only --model path/to/model.gguf
"""

import argparse
import sys
import time
import platform
import multiprocessing
from pathlib import Path


def check_environment() -> None:
    print("=" * 62)
    print("ENVIRONMENT CHECK")
    print("=" * 62)
    print(f"  Platform:  {platform.platform()}")
    print(f"  CPU:       {platform.processor() or 'unknown'}")
    print(f"  Cores:     {multiprocessing.cpu_count()} logical")
    print(f"  Python:    {sys.version.split()[0]}")

    try:
        import psutil
        ram_gb = psutil.virtual_memory().total / (1024 ** 3)
        avail_gb = psutil.virtual_memory().available / (1024 ** 3)
        flag = "  WARNING: <8 GB — generation may be slow or OOM" if ram_gb < 8 else ""
        print(f"  RAM:       {ram_gb:.1f} GB total / {avail_gb:.1f} GB available{flag}")
    except ImportError:
        print("  RAM:       (pip install psutil to detect)")

    print()

    for pkg, label in [
        ("onnxruntime", "onnxruntime"),
        ("optimum", "optimum"),
        ("transformers", "transformers"),
        ("llama_cpp", "llama-cpp-python"),
    ]:
        try:
            mod = __import__(pkg)
            ver = getattr(mod, "__version__", "?")
            extra = ""
            if pkg == "onnxruntime":
                providers = mod.get_available_providers()
                extra = f"  providers: {providers}"
            print(f"  {label:<20} {ver}{extra}")
        except (ImportError, FileNotFoundError):
            print(f"  {label:<20} NOT INSTALLED")
    print()


def print_final_report(fast: dict | None, compute: dict | None) -> None:
    print("=" * 62)
    print("FINAL REPORT: EdgeWord NLP Pipeline")
    print("=" * 62)

    if fast:
        overall = fast["overall"]
        print(f"\n  Fast-Path (ONNX / Classification)")
        print(f"    Median latency:  {fast['p50_ms']:.1f} ms  (SLA <50ms -> {overall})")
        print(f"    p95 latency:     {fast['p95_ms']:.1f} ms")
        print(f"    QPS:             {fast['qps']:.1f} req/sec")
        print(f"    SLA pass rate:   {fast['sla_pass_rate']:.0%}")

    if compute:
        best_t = max(compute, key=lambda k: compute[k]["avg_tps"])
        best = compute[best_t]
        min_ttft = min(r["avg_ttft_s"] for r in compute.values())
        tps_sla = "PASS" if best["avg_tps"] >= 10 else "FAIL"
        ttft_sla = "PASS" if min_ttft < 1.0 else "FAIL"

        print(f"\n  Compute-Path (llama.cpp / Generation)")
        print(f"    Best TPS:        {best['avg_tps']:.1f} t/s @ {best_t} threads  (SLA 10+ -> {tps_sla})")
        print(f"    Best TTFT:       {min_ttft:.3f} s  (SLA <1s -> {ttft_sla})")

    if not fast and not compute:
        print("\n  No benchmarks were run.")

    print("\n" + "=" * 62)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="EdgeWord NLP Pipeline — Scenario Tests",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--check", action="store_true", help="Environment check only")
    parser.add_argument("--fast-only", action="store_true", help="Run Fast-Path only")
    parser.add_argument("--compute-only", action="store_true", help="Run Compute-Path only")
    parser.add_argument("--model", type=str, help="Path to GGUF file for Compute-Path")
    args = parser.parse_args()

    check_environment()

    if args.check:
        return

    run_fast = not args.compute_only
    run_compute = not args.fast_only

    if run_compute and not args.model:
        if not args.fast_only:
            print("INFO: No --model supplied — skipping Compute-Path.\n"
                  "      Use --model path/to/model.gguf to enable it.\n")
        run_compute = False

    if run_compute and args.model and not Path(args.model).exists():
        print(f"ERROR: GGUF model not found: {args.model}")
        sys.exit(1)

    fast_results = None
    compute_results = None

    if run_fast:
        from scenario_fast_path import run_fast_path_benchmark
        fast_results = run_fast_path_benchmark()

    if run_compute:
        try:
            import llama_cpp  # noqa: F401 — verify .dll is present
        except (ImportError, FileNotFoundError) as exc:
            print(
                "SKIP Compute-Path: llama-cpp-python is not available on this platform.\n"
                f"  Reason: {exc}\n"
                "  To run Scenario 2 use the Docker image:\n"
                "    docker build -t edgeword .\n"
                "    docker run --rm -v <models_dir>:/models edgeword \\\n"
                "        python run_scenarios.py --model /models/<file>.gguf\n"
                "  Or install VS Build Tools + CMake, then: pip install llama-cpp-python\n"
            )
            run_compute = False

    if run_compute:
        from scenario_compute_path import run_compute_path_benchmark
        compute_results = run_compute_path_benchmark(args.model)

    print_final_report(fast_results, compute_results)


if __name__ == "__main__":
    main()
