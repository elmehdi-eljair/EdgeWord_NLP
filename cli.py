"""
EdgeWord NLP — Interactive CLI
Type anything — gets sentiment classification + AI response.
Features: conversation memory (LangChain), RAG (FAISS + ONNX), response cache (SQLite), auto-tools.

Usage:
    .venv/bin/python3 cli.py
    .venv/bin/python3 cli.py --docs ./docs
    .venv/bin/python3 cli.py --no-cache
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
BLUE = "\033[34m"
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
        print(f"\n  {DIM}[classify]{RESET} {colour}{BOLD}{label}{RESET}  {confidence:.1%}  {DIM}({ms:.1f} ms){RESET}")
        for i, p in enumerate(probs):
            lbl = self.id2label.get(i, str(i))
            bar = "█" * int(p * 30)
            print(f"  {DIM}{lbl:>10}{RESET} {bar} {p:.1%}")
        print()


class ComputePath:
    """llama.cpp text generator with LangChain conversation memory."""

    def __init__(self, model_path: str, n_threads: int = 4, memory_k: int = 50):
        print(f"{DIM}Loading Compute-Path model...{RESET}", end=" ", flush=True)
        t0 = time.perf_counter()
        from llama_cpp import Llama

        self.llm = Llama(
            model_path=model_path,
            n_ctx=4096,
            n_threads=n_threads,
            n_gpu_layers=0,
            verbose=False,
        )
        self.model_path = model_path
        self.n_threads = n_threads

        # Detect chat template from model name
        model_name = os.path.basename(model_path).lower()
        if "llama" in model_name:
            self.template = "llama3"
        else:
            self.template = "chatml"

        # LangChain conversation memory
        from langchain_core.messages import HumanMessage, AIMessage
        self._HumanMessage = HumanMessage
        self._AIMessage = AIMessage
        self.memory_k = memory_k
        self.history: list = []

        elapsed = time.perf_counter() - t0
        print(f"{GREEN}ready{RESET} {DIM}({elapsed:.1f}s, {n_threads} threads, memory={memory_k} turns){RESET}")

    def _build_prompt(self, user_message: str, rag_context: str = "", tool_result: str = "") -> str:
        """Build prompt with conversation history, RAG context, and tool results."""
        system_text = (
            "You are EdgeWord Assistant, a helpful AI running locally on CPU with no cloud dependencies. "
            "Be concise and clear. "
            "Pay close attention to the conversation history below — if the user refers to something said earlier, "
            "use the history to answer accurately."
        )

        if rag_context:
            system_text += (
                "\n\nUse the following retrieved documents to help answer the user's question. "
                "If the documents are relevant, base your answer on them. "
                "If not relevant, answer from your own knowledge.\n\n"
                f"--- Retrieved Documents ---\n{rag_context}\n--- End Documents ---"
            )

        # Prepend tool results to the user message if any
        if tool_result:
            user_message = f"{tool_result}\n\nUser question: {user_message}"

        if self.template == "llama3":
            return self._build_llama3_prompt(system_text, user_message)
        else:
            return self._build_chatml_prompt(system_text, user_message)

    def _build_chatml_prompt(self, system_text: str, user_message: str) -> str:
        prompt = f"<|im_start|>system\n{system_text}<|im_end|>\n"
        for human_msg, ai_msg in self.history[-self.memory_k:]:
            prompt += f"<|im_start|>user\n{human_msg.content}<|im_end|>\n"
            prompt += f"<|im_start|>assistant\n{ai_msg.content}<|im_end|>\n"
        prompt += f"<|im_start|>user\n{user_message}<|im_end|>\n"
        prompt += "<|im_start|>assistant\n"
        return prompt

    def _build_llama3_prompt(self, system_text: str, user_message: str) -> str:
        prompt = f"<|start_header_id|>system<|end_header_id|>\n\n{system_text}<|eot_id|>"
        for human_msg, ai_msg in self.history[-self.memory_k:]:
            prompt += f"<|start_header_id|>user<|end_header_id|>\n\n{human_msg.content}<|eot_id|>"
            prompt += f"<|start_header_id|>assistant<|end_header_id|>\n\n{ai_msg.content}<|eot_id|>"
        prompt += f"<|start_header_id|>user<|end_header_id|>\n\n{user_message}<|eot_id|>"
        prompt += "<|start_header_id|>assistant<|end_header_id|>\n\n"
        return prompt

    def chat(self, message: str, max_tokens: int = 256, temperature: float = 0.7,
             rag_context: str = "", tool_result: str = "") -> str:
        """Generate a response. Returns the response text."""
        prompt = self._build_prompt(message, rag_context=rag_context, tool_result=tool_result)

        sys.stdout.write(f"  {DIM}[chat]{RESET} {CYAN}")
        sys.stdout.flush()

        first_token_time = None
        token_count = 0
        response_parts = []
        t0 = time.perf_counter()

        stream = self.llm.create_completion(
            prompt,
            max_tokens=max_tokens,
            stream=True,
            echo=False,
            temperature=temperature,
        )

        for chunk in stream:
            tok = chunk["choices"][0]["text"]
            if "<|im_end|>" in tok or "<|eot_id|>" in tok:
                break
            if first_token_time is None:
                first_token_time = time.perf_counter() - t0
            token_count += 1
            response_parts.append(tok)
            sys.stdout.write(tok)
            sys.stdout.flush()

        total = time.perf_counter() - t0
        tps = token_count / total if total > 0 else 0
        ttft = first_token_time if first_token_time is not None else total

        sys.stdout.write(RESET)
        print(f"\n\n  {DIM}{token_count} tokens · {tps:.1f} t/s · TTFT {ttft:.3f}s{RESET}\n")

        response_text = "".join(response_parts).strip()
        self.history.append((
            self._HumanMessage(content=message),
            self._AIMessage(content=response_text),
        ))
        return response_text

    def clear_memory(self) -> None:
        self.history.clear()

    def show_memory(self) -> None:
        if not self.history:
            print(f"  {DIM}(no conversation history){RESET}\n")
        else:
            print(f"\n  {BOLD}Conversation Memory ({len(self.history)} turns):{RESET}")
            for i, (human, ai) in enumerate(self.history, 1):
                print(f"  {DIM}[{i}] User:{RESET} {human.content[:80]}{'...' if len(human.content) > 80 else ''}")
                print(f"  {DIM}    AI:{RESET}   {ai.content[:80]}{'...' if len(ai.content) > 80 else ''}")
            print()


def print_banner(has_compute: bool, rag_count: int, cache_on: bool, tools_on: bool) -> None:
    print(f"""
{BOLD}╔══════════════════════════════════════════════════╗
║          EdgeWord NLP — Interactive CLI           ║
╚══════════════════════════════════════════════════╝{RESET}
""")
    print(f"  Type anything. Every input gets:")
    print(f"    {GREEN}Sentiment{RESET}   → classification            {DIM}(Fast-Path, ONNX){RESET}")
    if has_compute:
        print(f"    {CYAN}Response{RESET}    → AI-generated answer      {DIM}(Compute-Path, llama.cpp){RESET}")
        print(f"    {MAGENTA}Memory{RESET}      → conversation remembered  {DIM}(LangChain){RESET}")
    if rag_count > 0:
        print(f"    {BLUE}RAG{RESET}         → {rag_count} chunks indexed       {DIM}(FAISS + ONNX embeddings){RESET}")
    if cache_on:
        print(f"    {YELLOW}Cache{RESET}       → instant repeat answers   {DIM}(SQLite){RESET}")
    if tools_on:
        print(f"    {GREEN}Tools{RESET}       → calc, datetime, sysinfo  {DIM}(auto-detect){RESET}")
    print()
    print(f"  {BOLD}Commands:{RESET}")
    print(f"    {YELLOW}bench{RESET}        — run latency benchmark")
    if has_compute:
        print(f"    {YELLOW}memory{RESET}       — show conversation history")
        print(f"    {YELLOW}clear{RESET}        — clear conversation memory")
    if rag_count > 0:
        print(f"    {YELLOW}rag{RESET}          — show indexed documents")
    if cache_on:
        print(f"    {YELLOW}cache{RESET}        — show cache stats")
        print(f"    {YELLOW}cache clear{RESET}  — clear response cache")
    if has_compute:
        print(f"    {YELLOW}/tokens N{RESET}  /temp N  /threads N  — tune generation")
    print(f"    {YELLOW}quit{RESET}         — exit")
    print()


def run_bench(fast: FastPath, compute: "ComputePath | None") -> None:
    sentences = [
        "This product is absolutely wonderful and I love it.",
        "Terrible quality, completely useless, waste of money.",
        "The weather is okay today, nothing remarkable.",
        "Incredible breakthrough in renewable energy technology!",
        "I regret buying this, it broke after one day.",
    ]
    print(f"\n  {BOLD}Fast-Path Benchmark{RESET} ({len(sentences)} sentences x 20 reps)\n")
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
    print(f"    runs: {n}")

    if compute:
        print(f"\n  {BOLD}Compute-Path Benchmark{RESET} (1 prompt, 60 tokens)\n")
        t0 = time.perf_counter()
        first_t = None
        count = 0
        stream = compute.llm.create_completion(
            "Explain CPU inference in three sentences:",
            max_tokens=60, stream=True, echo=False, temperature=0.0,
        )
        for chunk in stream:
            if first_t is None:
                first_t = time.perf_counter() - t0
            count += 1
        total = time.perf_counter() - t0
        tps = count / total if total > 0 else 0
        ttft_sla = f"{GREEN}PASS{RESET}" if first_t < 1.0 else f"{RED}FAIL{RESET}"
        tps_sla = f"{GREEN}PASS{RESET}" if tps >= 10 else f"{RED}FAIL{RESET}"
        print(f"    TTFT:  {first_t:.3f}s   SLA(<1s): {ttft_sla}")
        print(f"    TPS:   {tps:.1f} t/s  SLA(10+): {tps_sla}")
        print(f"    tokens: {count}")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="EdgeWord NLP Interactive CLI")
    parser.add_argument("--model", type=str, help="Path to GGUF model for generation")
    parser.add_argument("--fast-only", action="store_true", help="Classification only, skip generation")
    parser.add_argument("--threads", type=int, default=4, help="Thread count for generation (default: 4)")
    parser.add_argument("--memory", type=int, default=50, help="Conversation turns to remember (default: 50)")
    parser.add_argument("--docs", type=str, default="./docs", help="Directory for RAG documents (default: ./docs)")
    parser.add_argument("--no-cache", action="store_true", help="Disable response cache")
    parser.add_argument("--no-tools", action="store_true", help="Disable auto-tools")
    parser.add_argument("--no-rag", action="store_true", help="Disable RAG")
    args = parser.parse_args()

    # --- Load backends ---
    fast = FastPath()

    compute = None
    if not args.fast_only and args.model:
        from pathlib import Path
        if not Path(args.model).exists():
            print(f"{RED}Model not found: {args.model}{RESET}")
            sys.exit(1)
        compute = ComputePath(args.model, n_threads=args.threads, memory_k=args.memory)
    elif not args.fast_only:
        from pathlib import Path
        models_dir = Path(__file__).parent / "models"
        ggufs = sorted(models_dir.glob("*.gguf")) if models_dir.exists() else []
        if ggufs:
            compute = ComputePath(str(ggufs[0]), n_threads=args.threads, memory_k=args.memory)
        else:
            print(f"{YELLOW}No GGUF model found — generation disabled.{RESET}")
            print(f"{DIM}Use --model path/to/model.gguf or place a .gguf in ./models/{RESET}\n")

    has_compute = compute is not None

    # --- Load RAG ---
    rag = None
    rag_count = 0
    if not args.no_rag:
        from pathlib import Path
        docs_dir = Path(args.docs)
        if docs_dir.exists() and any(docs_dir.rglob("*")):
            from rag import RAGEngine
            rag = RAGEngine()
            rag_count = rag.load_directory(args.docs)
            if rag_count == 0:
                rag = None

    # --- Load Cache ---
    cache = None
    if not args.no_cache:
        from cache import ResponseCache
        cache = ResponseCache(enabled=True)

    # --- Load Tools ---
    tools = None
    if not args.no_tools:
        from tools import AutoTools
        tools = AutoTools(base_dir=str(Path(__file__).parent))

    max_tokens = 256
    temperature = 0.7

    print_banner(has_compute, rag_count, cache is not None, tools is not None)

    while True:
        try:
            raw = input(f"{BOLD}>{RESET} ").strip()
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
            print_banner(has_compute, rag_count, cache is not None, tools is not None)
            continue
        if low == "bench":
            run_bench(fast, compute)
            continue
        if low == "memory" and has_compute:
            compute.show_memory()
            continue
        if low == "clear" and has_compute:
            compute.clear_memory()
            print(f"  {DIM}Conversation memory cleared.{RESET}\n")
            continue
        if low == "rag" and rag:
            print(f"\n  {BOLD}RAG Index:{RESET} {rag.doc_count} chunks indexed")
            sources = set(c["source"] for c in rag.chunks)
            for s in sorted(sources):
                count = sum(1 for c in rag.chunks if c["source"] == s)
                print(f"    {DIM}{s}{RESET} ({count} chunks)")
            print()
            continue
        if low == "cache" and cache:
            stats = cache.stats()
            print(f"  {DIM}Cache: {stats['entries']} entries, {stats['total_hits']} hits{RESET}\n")
            continue
        if low == "cache clear" and cache:
            removed = cache.clear()
            print(f"  {DIM}Cleared {removed} cached responses.{RESET}\n")
            continue
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
                mp = compute.model_path
                old_history = compute.history
                del compute
                compute = ComputePath(mp, n_threads=n, memory_k=args.memory)
                compute.history = old_history
                has_compute = True
            except (ValueError, IndexError):
                print(f"  {RED}Usage: /threads N{RESET}")
            continue

        # --- Classify ---
        fast.classify(raw)

        if not has_compute:
            continue

        # --- Auto-tools (inject results into context, zero LLM overhead) ---
        tool_result = ""
        if tools:
            result = tools.run(raw)
            if result:
                tool_result = result
                print(f"  {DIM}[tool]{RESET} {GREEN}{result}{RESET}\n")

        # --- RAG retrieval ---
        rag_context = ""
        if rag:
            results = rag.retrieve(raw, top_k=3)
            if results and results[0]["score"] > 0.3:  # relevance threshold
                rag_context = rag.format_context(results)
                top_source = results[0]["source"]
                top_score = results[0]["score"]
                print(f"  {DIM}[rag]{RESET} {BLUE}Found {len(results)} relevant chunks (top: {top_source}, score: {top_score:.2f}){RESET}\n")

        # --- Cache check ---
        if cache:
            cached_response = cache.get(raw)
            if cached_response:
                print(f"  {DIM}[cache hit]{RESET} {CYAN}{cached_response}{RESET}")
                print(f"\n  {DIM}(cached — instant){RESET}\n")
                # Still save to memory for conversation continuity
                from langchain_core.messages import HumanMessage, AIMessage
                compute.history.append((
                    HumanMessage(content=raw),
                    AIMessage(content=cached_response),
                ))
                continue

        # --- Generate ---
        response = compute.chat(
            raw,
            max_tokens=max_tokens,
            temperature=temperature,
            rag_context=rag_context,
            tool_result=tool_result,
        )

        # --- Cache store ---
        if cache and response:
            cache.put(raw, response)


if __name__ == "__main__":
    main()
