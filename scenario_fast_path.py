"""
Scenario 1: Fast-Path (Language Understanding) Benchmark
Model: DistilBERT-SST2 — pre-exported ONNX via onnxruntime.InferenceSession (no torch)
SLA:   < 50ms latency per sequence
Tasks: sentiment classification, QPS measurement
"""

import time
import json
import os
import statistics
import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer
from huggingface_hub import snapshot_download

MODEL_ID = "optimum/distilbert-base-uncased-finetuned-sst-2-english"
SLA_MS = 50
WARMUP_REPS = 10
QPS_REPS = 100

TEST_SENTENCES = [
    "The product quality is excellent and I am very satisfied with the results.",
    "This was a terrible experience, nothing worked and support was useless.",
    "The documentation is clear, well-structured, and easy to follow.",
    "Absolutely fantastic — best purchase I have made this year by far.",
    "Disappointing results, the service was painfully slow and unhelpful.",
    "The meeting was productive and the team reached every goal we set.",
    "I cannot believe how unreliable this software is in production.",
    "Outstanding customer support, I highly recommend this to everyone.",
    "Performance is average, nothing special to report either way.",
    "The new architecture dramatically reduced our latency and cost.",
    "Setup took hours and the instructions were completely misleading.",
    "Solid framework with good defaults, minor rough edges on Windows.",
]

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def _softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - x.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)


def run_fast_path_benchmark() -> dict:
    print("=" * 62)
    print("SCENARIO 1: Fast-Path — ONNX Runtime (CPU, no torch)")
    print("=" * 62)
    print(f"  Model:       {MODEL_ID}")
    print(f"  SLA target:  < {SLA_MS} ms per sequence")
    print(f"  Providers:   {ort.get_available_providers()}\n")

    # Download pre-exported ONNX model (cached after first run)
    print("Downloading / loading ONNX model...")
    t0 = time.perf_counter()
    model_dir = snapshot_download(MODEL_ID)

    onnx_path = os.path.join(model_dir, "model.onnx")
    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(
        onnx_path, sess_options=sess_options, providers=["CPUExecutionProvider"]
    )

    tokenizer = AutoTokenizer.from_pretrained(model_dir)

    with open(os.path.join(model_dir, "config.json")) as f:
        config = json.load(f)
    id2label: dict[int, str] = {int(k): v for k, v in config.get("id2label", {}).items()}

    # Input names the ONNX graph expects
    input_names = {inp.name for inp in session.get_inputs()}

    load_ms = (time.perf_counter() - t0) * 1000
    print(f"Model loaded in {load_ms:.0f} ms")
    print(f"  ONNX inputs: {[i.name for i in session.get_inputs()]}\n")

    def infer(text: str) -> tuple[str, float, np.ndarray]:
        enc = tokenizer(text, return_tensors="np", truncation=True, max_length=128, padding=True)
        ort_inputs = {k: v for k, v in enc.items() if k in input_names}
        logits = session.run(None, ort_inputs)[0]      # (1, num_labels)
        probs = _softmax(logits)[0]
        label_id = int(np.argmax(probs))
        return id2label.get(label_id, str(label_id)), float(probs[label_id]), probs

    # Warmup — use real sentences to prime ONNX JIT and CPU caches
    for i in range(WARMUP_REPS):
        infer(TEST_SENTENCES[i % len(TEST_SENTENCES)])

    # --- Per-sequence latency ---
    print("--- Per-Sequence Latency ---")
    latencies_ms: list[float] = []

    for sentence in TEST_SENTENCES:
        t0 = time.perf_counter()
        label, confidence, _ = infer(sentence)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        latencies_ms.append(elapsed_ms)

        sla = "PASS" if elapsed_ms < SLA_MS else "FAIL"
        print(f"  [{sla}] {elapsed_ms:5.1f} ms | {label:8s} {confidence:.0%} | {sentence[:55]}...")

    # --- QPS (sustained throughput) ---
    print(f"\n--- QPS Benchmark ({QPS_REPS} requests) ---")
    t0 = time.perf_counter()
    for i in range(QPS_REPS):
        infer(TEST_SENTENCES[i % len(TEST_SENTENCES)])
    qps = QPS_REPS / (time.perf_counter() - t0)
    print(f"  QPS: {qps:.1f} requests/sec")

    # --- Summary ---
    p50 = statistics.median(latencies_ms)
    p95 = sorted(latencies_ms)[int(len(latencies_ms) * 0.95) - 1]
    sla_passes = sum(1 for l in latencies_ms if l < SLA_MS)
    overall = "PASS" if p50 < SLA_MS else "FAIL"

    print("\n--- Summary ---")
    print(f"  Min:         {min(latencies_ms):.1f} ms")
    print(f"  Median p50:  {p50:.1f} ms")
    print(f"  p95:         {p95:.1f} ms")
    print(f"  Max:         {max(latencies_ms):.1f} ms")
    print(f"  QPS:         {qps:.1f}")
    print(f"  SLA (<{SLA_MS}ms): {sla_passes}/{len(latencies_ms)} sequences passed")
    print(f"  Overall:     {overall} (median vs SLA)\n")

    return {
        "p50_ms": p50,
        "p95_ms": p95,
        "min_ms": min(latencies_ms),
        "max_ms": max(latencies_ms),
        "qps": qps,
        "sla_pass_rate": sla_passes / len(latencies_ms),
        "overall": overall,
    }


if __name__ == "__main__":
    run_fast_path_benchmark()
