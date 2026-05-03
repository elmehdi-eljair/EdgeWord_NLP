"""
EdgeWord NLP — Retrieval Evaluation Harness
Measures Recall@K, latency, and per-query breakdown against a ground-truth eval set.

Usage:
    python eval_harness.py                    # run baseline (hybrid retrieval)
    python eval_harness.py --with-graph       # run with graph-augmented retrieval
"""

import json
import time
import sys
from pathlib import Path


def load_eval_set(path: str = "eval_set.jsonl") -> list[dict]:
    queries = []
    with open(path) as f:
        for line in f:
            if line.strip():
                queries.append(json.loads(line))
    return queries


def recall_at_k(retrieved_sources: list[str], answer_chunks: list[str], k: int) -> float:
    """Fraction of answer chunks found in top-K retrieved sources."""
    if not answer_chunks:
        return 0.0
    retrieved_set = set(retrieved_sources[:k])
    hits = sum(1 for c in answer_chunks if c in retrieved_set)
    return hits / len(answer_chunks)


def run_eval(rag_engine, eval_set: list[dict], retrieve_fn=None, label: str = "baseline"):
    """Run evaluation and return results."""
    if retrieve_fn is None:
        retrieve_fn = lambda q: rag_engine.retrieve(q, top_k=10)

    results = []
    total_latency = 0

    for q in eval_set:
        t0 = time.perf_counter()
        retrieved = retrieve_fn(q["query"])
        latency_ms = (time.perf_counter() - t0) * 1000
        total_latency += latency_ms

        retrieved_sources = [r["source"] for r in retrieved]

        r5 = recall_at_k(retrieved_sources, q["answer_chunks"], 5)
        r10 = recall_at_k(retrieved_sources, q["answer_chunks"], 10)

        results.append({
            "query_id": q["query_id"],
            "query": q["query"],
            "type": q["type"],
            "hops": q["hops_needed"],
            "answer_chunks": len(q["answer_chunks"]),
            "retrieved": len(retrieved),
            "r_at_5": r5,
            "r_at_10": r10,
            "latency_ms": round(latency_ms, 2),
            "retrieved_sources": retrieved_sources[:10],
        })

    # Aggregate
    by_type = {}
    for r in results:
        t = r["type"]
        if t not in by_type:
            by_type[t] = {"r5": [], "r10": [], "lat": []}
        by_type[t]["r5"].append(r["r_at_5"])
        by_type[t]["r10"].append(r["r_at_10"])
        by_type[t]["lat"].append(r["latency_ms"])

    print(f"\n{'='*60}")
    print(f"  EVALUATION: {label}")
    print(f"{'='*60}")
    print(f"  Total queries: {len(results)}")
    print(f"  Total latency: {total_latency:.0f} ms")
    print(f"  Avg latency:   {total_latency/len(results):.1f} ms")
    print()

    overall_r5 = sum(r["r_at_5"] for r in results) / len(results) * 100
    overall_r10 = sum(r["r_at_10"] for r in results) / len(results) * 100
    print(f"  Overall R@5:  {overall_r5:.1f}%")
    print(f"  Overall R@10: {overall_r10:.1f}%")
    print()

    for t, vals in sorted(by_type.items()):
        avg_r5 = sum(vals["r5"]) / len(vals["r5"]) * 100
        avg_r10 = sum(vals["r10"]) / len(vals["r10"]) * 100
        avg_lat = sum(vals["lat"]) / len(vals["lat"])
        print(f"  {t:15} R@5={avg_r5:5.1f}%  R@10={avg_r10:5.1f}%  lat={avg_lat:.1f}ms  (n={len(vals['r5'])})")

    print()

    # Per-query breakdown for multi-hop (the ones graph should improve)
    mh = [r for r in results if r["type"] == "multi_hop"]
    if mh:
        print("  Multi-hop per-query:")
        for r in sorted(mh, key=lambda x: x["r_at_10"]):
            status = "OK" if r["r_at_10"] > 0.5 else "WEAK" if r["r_at_10"] > 0.2 else "MISS"
            print(f"    [{status:4}] R@10={r['r_at_10']:.0%} {r['query_id']}: {r['query'][:60]}")

    # Save detailed results
    report_path = f"eval_report_{label}.json"
    with open(report_path, "w") as f:
        json.dump({
            "label": label,
            "overall_r5": round(overall_r5, 2),
            "overall_r10": round(overall_r10, 2),
            "by_type": {t: {"r5": round(sum(v["r5"])/len(v["r5"])*100, 2), "r10": round(sum(v["r10"])/len(v["r10"])*100, 2)} for t, v in by_type.items()},
            "results": results,
        }, f, indent=2)
    print(f"\n  Detailed report saved to: {report_path}")
    return results


if __name__ == "__main__":
    from rag import RAGEngine

    print("Loading RAG engine...")
    rag = RAGEngine()

    # Load user docs
    docs_dir = Path("docs")
    if docs_dir.exists():
        rag.load_directory(str(docs_dir))

    # Load knowledge packs
    from knowledge_gallery import KnowledgeGalleryManager
    gm = KnowledgeGalleryManager("knowledge_packs", rag.embedder)
    rag.rebuild_composite_index(gm)
    print(f"RAG loaded: {rag.doc_count} chunks")

    # Load eval set
    eval_set = load_eval_set()
    print(f"Eval set: {len(eval_set)} queries")

    # Run baseline
    run_eval(rag, eval_set, label="baseline_hybrid")

    # If --with-graph, also run graph-augmented
    if "--with-graph" in sys.argv:
        from graph_rag import KnowledgeGraph, GraphRAG
        kg = KnowledgeGraph("./knowledge_graph")
        graph = GraphRAG(kg, rag)
        run_eval(rag, eval_set, retrieve_fn=lambda q: graph.retrieve(q, top_k=10), label="graph_augmented")
