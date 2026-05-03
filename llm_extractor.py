"""
EdgeWord NLP — LLM-Based Entity & Relation Extraction
Phase 2, Work Stream C: Uses the local 1B-3B model to extract typed entities
and relations from knowledge pack chunks.

Produces dramatically cleaner entities than n-gram extraction (~2K vs ~10K per pack)
with typed relations enabling structured graph traversal.
"""

import json
import time
import re
import threading
from pathlib import Path


# Per-domain predicate vocabularies
PREDICATE_SETS = {
    "medical": [
        "TREATS", "CAUSES", "CONTRAINDICATED_IN", "INTERACTS_WITH",
        "METABOLIZED_BY", "MEASURED_BY", "COMPLICATION_OF", "INDICATED_FOR",
        "CLASSIFIED_AS", "COMPONENT_OF", "REQUIRES_MONITORING_OF",
    ],
    "science": [
        "CAUSES", "ENABLES", "COMPOSED_OF", "CONVERTS_TO", "MEASURED_BY",
        "OCCURS_IN", "REQUIRES", "PRODUCES", "INHIBITS", "CLASSIFIED_AS",
    ],
    "coding": [
        "IMPLEMENTS", "EXTENDS", "DEPENDS_ON", "CALLS", "RETURNS",
        "CONFIGURED_BY", "REPLACES", "COMPATIBLE_WITH", "PART_OF",
    ],
    "default": [
        "CAUSES", "RELATES_TO", "PART_OF", "PRODUCES", "REQUIRES",
        "CLASSIFIED_AS", "ENABLES", "INHIBITS", "MEASURED_BY",
    ],
}

# Per-domain entity type vocabularies
ENTITY_TYPES = {
    "medical": "DRUG|CONDITION|PROCEDURE|ANATOMY|TEST|MECHANISM|SYMPTOM",
    "science": "CONCEPT|METHOD|ORGANISM|RESULT|MEASUREMENT|PROCESS|SUBSTANCE",
    "coding": "LANGUAGE|FRAMEWORK|LIBRARY|PATTERN|PROTOCOL|TOOL|CONCEPT",
    "default": "CONCEPT|ENTITY|PROCESS|MEASUREMENT|CATEGORY",
}

# Map pack IDs to domains
PACK_DOMAINS = {
    "medmcqa": "medical",
    "sciq": "science",
    "coding-qa": "coding",
    "finance": "default",
    "mmlu-stem": "science",
    "history-geo": "default",
    "legal-basics": "default",
    "grammar": "default",
}


def build_extraction_prompt(chunk_text: str, domain: str = "default", template: str = "llama3") -> str:
    """Build the extraction prompt for a given chunk and domain."""
    predicates = PREDICATE_SETS.get(domain, PREDICATE_SETS["default"])
    entity_types = ENTITY_TYPES.get(domain, ENTITY_TYPES["default"])
    predicate_list = ", ".join(predicates)

    system = f"""You are extracting a knowledge graph from text.

Read the passage below and output JSON only — no prose, no commentary.

Extract:
1. ENTITIES: specific named things mentioned in the text
2. RELATIONS: explicit relationships between extracted entities

Rules:
- Only extract specific named entities, never generic concepts
  GOOD: "metformin", "photosynthesis", "DNA replication"
  BAD: "the drug", "this process", "the patient"
- Only extract relations explicitly stated in the text
- Use canonical forms for names
- Each relation must connect two extracted entities
- Entity types: {entity_types}
- Predicates: {predicate_list}

Output format (JSON only):
{{"entities": [{{"name": "...", "type": "..."}}], "relations": [{{"subject": "...", "predicate": "...", "object": "..."}}]}}

Text:
\"\"\"{chunk_text[:1500]}\"\"\"
"""

    if template == "llama3":
        return (
            f"<|start_header_id|>system<|end_header_id|>\n\n{system}<|eot_id|>"
            f"<|start_header_id|>user<|end_header_id|>\n\nExtract entities and relations from the text above. Output JSON only.<|eot_id|>"
            f"<|start_header_id|>assistant<|end_header_id|>\n\n"
        )
    else:
        return (
            f"<|im_start|>system\n{system}<|im_end|>\n"
            f"<|im_start|>user\nExtract entities and relations. JSON only.<|im_end|>\n"
            f"<|im_start|>assistant\n"
        )


def parse_extraction(raw_output: str) -> dict | None:
    """Parse LLM output into entities and relations. Handles common LLM output issues."""
    # Try to find JSON in the output
    text = raw_output.strip()

    # Remove common LLM artifacts
    for stop in ["<|im_end|>", "<|eot_id|>", "```json", "```", "Note:", "Here"]:
        if stop in text:
            text = text[:text.index(stop)]

    # Find JSON object
    start = text.find("{")
    end = text.rfind("}") + 1
    if start < 0 or end <= start:
        return None

    try:
        data = json.loads(text[start:end])
    except json.JSONDecodeError:
        # Try fixing common issues
        try:
            # Fix trailing commas
            fixed = re.sub(r',\s*([}\]])', r'\1', text[start:end])
            data = json.loads(fixed)
        except:
            return None

    # Validate structure
    entities = data.get("entities", [])
    relations = data.get("relations", [])

    # Filter valid entities
    valid_entities = []
    entity_names = set()
    for e in entities:
        if isinstance(e, dict) and "name" in e and len(e["name"]) > 1:
            name = e["name"].strip()
            if name.lower() not in ("the", "a", "an", "this", "that", "it"):
                valid_entities.append({"name": name, "type": e.get("type", "CONCEPT")})
                entity_names.add(name.lower())

    # Filter valid relations
    valid_relations = []
    for r in relations:
        if isinstance(r, dict) and all(k in r for k in ("subject", "predicate", "object")):
            subj = r["subject"].strip()
            obj = r["object"].strip()
            pred = r["predicate"].strip().upper()
            if subj.lower() in entity_names and obj.lower() in entity_names:
                valid_relations.append({"subject": subj, "predicate": pred, "object": obj})

    if not valid_entities:
        return None

    return {"entities": valid_entities, "relations": valid_relations}


class LLMExtractor:
    """Runs LLM-based entity extraction on knowledge pack chunks."""

    def __init__(self, llm, template: str = "llama3"):
        self.llm = llm
        self.template = template

    def extract_chunk(self, chunk_text: str, domain: str = "default") -> dict | None:
        """Extract entities and relations from a single chunk."""
        prompt = build_extraction_prompt(chunk_text, domain, self.template)

        try:
            result = self.llm.create_completion(
                prompt,
                max_tokens=500,
                temperature=0.0,
                stream=False,
                echo=False,
                stop=["<|im_end|>", "<|eot_id|>"],
            )
            raw = result["choices"][0]["text"]
            return parse_extraction(raw)
        except Exception:
            return None

    def run_pilot(self, chunks: list[dict], domain: str = "default",
                  sample_size: int = 500, on_progress=None) -> dict:
        """Run extraction pilot on a sample of chunks.
        Returns quality metrics for decision gate."""
        import random
        random.seed(42)
        sample = random.sample(chunks, min(sample_size, len(chunks)))

        results = []
        parse_failures = 0
        total_entities = 0
        total_relations = 0
        t0 = time.time()

        for i, chunk in enumerate(sample):
            extraction = self.extract_chunk(chunk["text"], domain)

            if extraction is None:
                parse_failures += 1
                results.append({"source": chunk["source"], "success": False})
            else:
                n_ents = len(extraction["entities"])
                n_rels = len(extraction["relations"])
                total_entities += n_ents
                total_relations += n_rels
                results.append({
                    "source": chunk["source"],
                    "success": True,
                    "entities": extraction["entities"],
                    "relations": extraction["relations"],
                    "n_entities": n_ents,
                    "n_relations": n_rels,
                })

            if on_progress and i % 10 == 0:
                elapsed = time.time() - t0
                rate = (i + 1) / elapsed if elapsed > 0 else 0
                eta = (len(sample) - i - 1) / rate if rate > 0 else 0
                on_progress(i + 1, len(sample), elapsed, eta)

        elapsed = time.time() - t0
        success_count = len(sample) - parse_failures
        avg_entities = total_entities / max(success_count, 1)
        avg_relations = total_relations / max(success_count, 1)

        # Collect all unique entities
        all_entities = {}
        for r in results:
            if r.get("success"):
                for e in r.get("entities", []):
                    key = e["name"].lower()
                    if key not in all_entities:
                        all_entities[key] = {"name": e["name"], "type": e["type"], "count": 0}
                    all_entities[key]["count"] += 1

        report = {
            "sample_size": len(sample),
            "success_count": success_count,
            "parse_failure_rate": round(parse_failures / len(sample) * 100, 1),
            "avg_entities_per_chunk": round(avg_entities, 1),
            "avg_relations_per_chunk": round(avg_relations, 1),
            "unique_entities": len(all_entities),
            "total_entity_mentions": total_entities,
            "total_relations": total_relations,
            "elapsed_s": round(elapsed, 1),
            "rate_chunks_per_sec": round(len(sample) / elapsed, 2),
            "top_entities": sorted(all_entities.values(), key=lambda x: x["count"], reverse=True)[:30],
            "results": results,  # full detail for inspection
        }

        return report
