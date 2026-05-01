"""
EdgeWord NLP — Interactive CLI
Interact with the Fast-Path (classification) and Compute-Path (generation) backends.

Usage:
    .venv/bin/python3 cli.py
    .venv/bin/python3 cli.py --model ./models/qwen2.5-0.5b-instruct-q4_k_m.gguf
    .venv/bin/python3 cli.py --fast-only
"""

import argparse
import os
import sys
import json
import time
import readline  # enables arrow-key history in input()

import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer
from huggingface_hub import snapshot_download

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

FAST_MODEL_ID = "optimum/distilbert-base-uncased-finetuned-sst-2-english"

# --- Colours ---
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
RED = "\033[31m"
MAGENTA = "\033[35m"
RESET = "\033[0m"


def _softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - x.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)


class FastPath:
    """ONNX Runtime sentiment classifier."""

    def __init__(self):
        print(f"{DIM}Loading Fast-Path model...{RESET}", end=" ", flush=True)
        t0 = time.perf_counter()
        model_dir = snapshot_download(FAST_MODEL_ID)
        onnx_path = os.path.join(model_dir, "model.onnx")

        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(
            onnx_path, opts, providers=["CPUExecutionProvider"]
        )
        self.tokenizer = AutoTokenizer.from_pretrained(model_dir)
        self.input_names = {inp.name for inp in self.session.get_inputs()}

        with open(os.path.join(model_dir, "config.json")) as f:
            cfg = json.load(f)
        self.id2label = {int(k): v for k, v in cfg.get("id2label", {}).items()}

        # warmup
        self._infer("warmup sentence")
        elapsed = time.perf_counter() - t0
        print(f"{GREEN}ready{RESET} {DIM}({elapsed:.1f}s){RESET}")

    def _infer(self, text: str) -> tuple[str, float, np.ndarray]:
        enc = self.tokenizer(
            text, return_tensors="np", truncation=True, max_length=128, padding=True
        )
        inputs = {k: v for k, v in enc.items() if k in self.input_names}
        logits = self.session.run(None, inputs)[0]
        probs = _softmax(logits)[0]
        idx = int(np.argmax(probs))
        return self.id2label.get(idx, str(idx)), float(probs[idx]), probs

    def classify(self, text: str) -> None:
        t0 = time.perf_counter()
        label, confidence, probs = self._infer(text)
        ms = (time.perf_counter() - t0) * 1000

        colour = GREEN if label == "POSITIVE" else RED
        print(f"\n  {colour}{BOLD}{label}{RESET}  {confidence:.1%} confidence  {DIM}({ms:.1f} ms){RESET}")
        # show full distribution
        for i, p in enumerate(probs):
            lbl = self.id2label.get(i, str(i))
            bar = "█" * int(p * 30)
            print(f"  {DIM}{lbl:>10}{RESET} {bar} {p:.1%}")
        print()


class ComputePath:
    """llama.cpp text generator."""

    def __init__(self, model_path: str, n_threads: int = 4):
        print(f"{DIM}Loading Compute-Path model...{RESET}", end=" ", flush=True)
        t0 = time.perf_counter()
        from llama_cpp import Llama

        self.llm = Llama(
            model_path=model_path,
            n_ctx=2048,
            n_threads=n_threads,
            n_gpu_layers=0,
            verbose=False,
        )
        self.n_threads = n_threads
        elapsed = time.perf_counter() - t0
        print(f"{GREEN}ready{RESET} {DIM}({elapsed:.1f}s, {n_threads} threads){RESET}")

    def generate(self, prompt: str, max_tokens: int = 256, temperature: float = 0.7) -> None:
        sys.stdout.write(f"\n  {CYAN}")
        sys.stdout.flush()

        first_token_time = None
        token_count = 0
        t0 = time.perf_counter()

        stream = self.llm.create_completion(
            prompt,
            max_tokens=max_tokens,
            stream=True,
            echo=False,
            temperature=temperature,
        )

        for chunk in stream:
            if first_token_time is None:
                first_token_time = time.perf_counter() - t0
            token_count += 1
            sys.stdout.write(chunk["choices"][0]["text"])
            sys.stdout.flush()

        total = time.perf_counter() - t0
        tps = token_count / total if total > 0 else 0
        ttft = first_token_time if first_token_time is not None else total

        sys.stdout.write(RESET)
        print(f"\n\n  {DIM}{token_count} tokens · {tps:.1f} t/s · TTFT {ttft:.3f}s{RESET}\n")

    def chat(self, message: str, max_tokens: int = 256, temperature: float = 0.7) -> None:
        prompt = (
            "<|im_start|>system\n"
            "You are a helpful assistant. Be concise and clear.<|im_end|>\n"
            f"<|im_start|>user\n{message}<|im_end|>\n"
            "<|im_start|>assistant\n"
        )
        self.generate(prompt, max_tokens=max_tokens, temperature=temperature)


def print_banner(has_compute: bool) -> None:
    print(f"""
{BOLD}╔══════════════════════════════════════════════════╗
║          EdgeWord NLP — Interactive CLI           ║
╚══════════════════════════════════════════════════╝{RESET}
""")
    print(f"  {BOLD}Modes:{RESET}")
    print(f"    {YELLOW}classify{RESET} / {YELLOW}c{RESET}   — Sentiment analysis (Fast-Path)")
    if has_compute:
        print(f"    {YELLOW}generate{RESET} / {YELLOW}g{RESET}   — Raw text completion (Compute-Path)")
        print(f"    {YELLOW}chat{RESET}             — Chat with the model (Compute-Path)")
    print(f"    {YELLOW}bench{RESET}            — Quick latency benchmark")
    print(f"    {YELLOW}help{RESET}             — Show this help")
    print(f"    {YELLOW}quit{RESET} / {YELLOW}q{RESET}        — Exit")
    if has_compute:
        print(f"\n  {BOLD}Generation settings:{RESET}  {DIM}(change inline){RESET}")
        print(f"    {YELLOW}/tokens N{RESET}        — Set max tokens (default 256)")
        print(f"    {YELLOW}/temp N{RESET}          — Set temperature (default 0.7)")
        print(f"    {YELLOW}/threads N{RESET}       — Set thread count (reloads model)")
    print()


def run_bench(fast: FastPath) -> None:
    sentences = [
        "This product is absolutely wonderful and I love it.",
        "Terrible quality, completely useless, waste of money.",
        "The weather is okay today, nothing remarkable.",
        "Incredible breakthrough in renewable energy technology!",
        "I regret buying this, it broke after one day.",
    ]
    print(f"\n  {BOLD}Fast-Path Benchmark{RESET} ({len(sentences)} sentences × 20 reps)\n")
    times = []
    for _ in range(20):
        for s in sentences:
            t0 = time.perf_counter()
            fast._infer(s)
            times.append((time.perf_counter() - t0) * 1000)

    times.sort()
    n = len(times)
    p50 = times[n // 2]
    p95 = times[int(n * 0.95)]
    p99 = times[int(n * 0.99)]
    qps = 1000 / (sum(times) / n)
    sla = f"{GREEN}PASS{RESET}" if p50 < 50 else f"{RED}FAIL{RESET}"

    print(f"    p50:  {p50:.1f} ms   SLA(<50ms): {sla}")
    print(f"    p95:  {p95:.1f} ms")
    print(f"    p99:  {p99:.1f} ms")
    print(f"    QPS:  {qps:.1f} req/s")
    print(f"    runs: {n}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="EdgeWord NLP Interactive CLI")
    parser.add_argument("--model", type=str, help="Path to GGUF model for generation")
    parser.add_argument("--fast-only", action="store_true", help="Classification only, skip generation")
    parser.add_argument("--threads", type=int, default=4, help="Thread count for generation (default: 4)")
    args = parser.parse_args()

    # --- Load backends ---
    fast = FastPath()

    compute = None
    if not args.fast_only and args.model:
        from pathlib import Path

        if not Path(args.model).exists():
            print(f"{RED}Model not found: {args.model}{RESET}")
            sys.exit(1)
        compute = ComputePath(args.model, n_threads=args.threads)
    elif not args.fast_only:
        # auto-detect model in ./models/
        from pathlib import Path

        models_dir = Path(__file__).parent / "models"
        ggufs = sorted(models_dir.glob("*.gguf")) if models_dir.exists() else []
        if ggufs:
            compute = ComputePath(str(ggufs[0]), n_threads=args.threads)
        else:
            print(f"{YELLOW}No GGUF model found — generation disabled.{RESET}")
            print(f"{DIM}Use --model path/to/model.gguf or place a .gguf in ./models/{RESET}\n")

    has_compute = compute is not None
    print_banner(has_compute)

    # Session state
    max_tokens = 256
    temperature = 0.7
    mode = "classify"

    while True:
        try:
            mode_tag = {"classify": f"{GREEN}classify", "generate": f"{MAGENTA}generate", "chat": f"{CYAN}chat"}
            tag = mode_tag.get(mode, f"{YELLOW}{mode}")
            raw = input(f"{BOLD}[{tag}{RESET}{BOLD}]{RESET} ").strip()
        except (KeyboardInterrupt, EOFError):
            print(f"\n{DIM}Goodbye.{RESET}")
            break

        if not raw:
            continue

        low = raw.lower()

        # --- Commands ---
        if low in ("quit", "q", "exit"):
            print(f"{DIM}Goodbye.{RESET}")
            break
        if low in ("help", "h", "?"):
            print_banner(has_compute)
            continue
        if low in ("classify", "c"):
            mode = "classify"
            print(f"  {DIM}Switched to classify mode{RESET}")
            continue
        if low in ("generate", "g"):
            if not has_compute:
                print(f"  {RED}Generation not available — no model loaded{RESET}")
                continue
            mode = "generate"
            print(f"  {DIM}Switched to generate mode{RESET}")
            continue
        if low == "chat":
            if not has_compute:
                print(f"  {RED}Chat not available — no model loaded{RESET}")
                continue
            mode = "chat"
            print(f"  {DIM}Switched to chat mode{RESET}")
            continue
        if low == "bench":
            run_bench(fast)
            continue

        # --- Settings ---
        if low.startswith("/tokens "):
            try:
                max_tokens = int(raw.split()[1])
                print(f"  {DIM}max_tokens = {max_tokens}{RESET}")
            except ValueError:
                print(f"  {RED}Usage: /tokens N{RESET}")
            continue
        if low.startswith("/temp "):
            try:
                temperature = float(raw.split()[1])
                print(f"  {DIM}temperature = {temperature}{RESET}")
            except ValueError:
                print(f"  {RED}Usage: /temp N{RESET}")
            continue
        if low.startswith("/threads "):
            if not has_compute:
                print(f"  {RED}No model loaded{RESET}")
                continue
            try:
                n = int(raw.split()[1])
                print(f"  {DIM}Reloading model with {n} threads...{RESET}")
                model_path = compute.llm.model_path
                del compute
                compute = ComputePath(model_path, n_threads=n)
            except (ValueError, IndexError):
                print(f"  {RED}Usage: /threads N{RESET}")
            continue

        # --- Inference ---
        if mode == "classify":
            fast.classify(raw)
        elif mode == "generate":
            compute.generate(raw, max_tokens=max_tokens, temperature=temperature)
        elif mode == "chat":
            compute.chat(raw, max_tokens=max_tokens, temperature=temperature)


if __name__ == "__main__":
    main()
