"""
EdgeWord NLP — Hybrid Reasoning Engine
Multi-stage chain-of-thought with query decomposition, multi-hop retrieval,
and critic-based verification. Implements the Generate → Retrieve → Verify pattern
from the Hybrid Reasoning Stack spec.
"""

from typing import Generator
import re


STAGES = [
    {
        "name": "analyse",
        "system": (
            "You are an analytical assistant. Break down the user's question.\n"
            "1. What is the user actually asking?\n"
            "2. What are the key concepts and entities?\n"
            "3. Break this into 1-3 focused sub-questions that together answer the original.\n\n"
            "IMPORTANT: End with SUB-QUERIES on separate lines, each starting with 'Q:'\n"
            "Example:\n"
            "Q: What is metformin used for?\n"
            "Q: What are the side effects of metformin?\n\n"
            "Then end with NEXT: followed by a short phrase (max 8 words)."
        ),
        "max_tokens": 250,
    },
    {
        "name": "retrieve",
        "system": (
            "Based on the analysis and retrieved documents below, evaluate the evidence.\n"
            "1. Which retrieved passages are most relevant?\n"
            "2. What key facts can we extract?\n"
            "3. Is there enough evidence to answer the question? What's missing?\n\n"
            "IMPORTANT: End with NEXT: followed by a short phrase (max 8 words)."
        ),
        "max_tokens": 250,
    },
    {
        "name": "reason",
        "system": (
            "Think step by step using the analysis and evidence.\n"
            "1. State your reasoning clearly, citing specific facts from the evidence\n"
            "2. Consider alternatives or caveats\n"
            "3. Reach a well-supported conclusion\n\n"
            "IMPORTANT: End with NEXT: followed by a short phrase (max 8 words)."
        ),
        "max_tokens": 350,
    },
    {
        "name": "synthesise",
        "system": (
            "Write your final answer to the user.\n"
            "Use your analysis, evidence, and reasoning.\n"
            "Be precise, helpful, and direct.\n"
            "Ground your answer in the retrieved evidence — cite what you know from the documents."
        ),
        "max_tokens": 512,
    },
    {
        "name": "verify",
        "system": (
            "You are a verification assistant. Review the answer below against the retrieved evidence.\n"
            "Check:\n"
            "1. Is every claim in the answer supported by the retrieved documents?\n"
            "2. Are there any statements that go beyond what the evidence shows?\n"
            "3. Does the answer actually address the user's question?\n\n"
            "If the answer is well-grounded, respond with: VERIFIED: [brief confirmation]\n"
            "If there are issues, respond with: REVISION: [what needs to change]\n"
            "Be concise — 2-3 sentences max."
        ),
        "max_tokens": 150,
    },
]


def _extract_next_label(text: str) -> tuple[str, str]:
    """Extract NEXT: label from stage output. Returns (clean_output, label)."""
    lines = text.strip().split("\n")
    label = ""
    clean_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.upper().startswith("NEXT:"):
            label = stripped[5:].strip().strip('"').strip("*").strip(".")
        else:
            clean_lines.append(line)
    return "\n".join(clean_lines).strip(), label


def _extract_sub_queries(text: str) -> list[str]:
    """Extract Q: sub-queries from the analyse stage output."""
    queries = []
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("Q:") or stripped.startswith("q:"):
            q = stripped[2:].strip()
            if q and len(q) > 5:
                queries.append(q)
    return queries[:3]  # Cap at 3 sub-queries


class ReasoningEngine:
    """Multi-stage hybrid reasoning with decomposition, multi-hop retrieval, and verification."""

    def __init__(self, llm, rag_engine=None, template="llama3"):
        self.llm = llm
        self.rag = rag_engine
        self.template = template

    def _build_stage_prompt(self, stage: dict, message: str, context: dict, rag_context: str = "") -> str:
        system = stage["system"]
        if context:
            system += "\n\nPrevious thinking:\n"
            for prev_name, prev_output in context.items():
                system += f"[{prev_name.upper()}]: {prev_output}\n"

        # Inject RAG context for retrieve and verify stages
        if stage["name"] in ("retrieve", "verify") and rag_context:
            system += f"\n\nRetrieved documents:\n{rag_context}"

        # For verify stage, also inject the synthesised answer
        if stage["name"] == "verify" and "synthesise" in context:
            system += f"\n\nAnswer to verify:\n{context['synthesise']}"

        if self.template == "llama3":
            prompt = f"<|start_header_id|>system<|end_header_id|>\n\n{system}<|eot_id|>"
            prompt += f"<|start_header_id|>user<|end_header_id|>\n\n{message}<|eot_id|>"
            prompt += "<|start_header_id|>assistant<|end_header_id|>\n\n"
        else:
            prompt = f"<|im_start|>system\n{system}<|im_end|>\n"
            prompt += f"<|im_start|>user\n{message}<|im_end|>\n"
            prompt += "<|im_start|>assistant\n"
        return prompt

    def run(self, message: str, rag_context: str = "") -> Generator[dict, None, None]:
        """Run hybrid reasoning chain with decomposition, multi-hop retrieval, and verification."""
        context = {}
        enriched_rag = rag_context  # Start with initial RAG context

        # First label is based on the question itself
        topic = " ".join(message.split()[:8])
        next_label = f"Breaking down: {topic}"

        for i, stage in enumerate(STAGES):
            # Yield the label
            yield {"type": "stage", "name": stage["name"], "label": next_label}

            prompt = self._build_stage_prompt(stage, message, context, enriched_rag)

            stage_output = ""
            stream = self.llm.create_completion(
                prompt,
                max_tokens=stage["max_tokens"],
                stream=True,
                echo=False,
                temperature=0.3,
                top_p=0.85,
            )

            for chunk in stream:
                tok = chunk["choices"][0]["text"]
                if "<|im_end|>" in tok or "<|eot_id|>" in tok:
                    break
                stage_output += tok
                yield {"type": "token", "stage": stage["name"], "text": tok}

            # Extract NEXT: label
            clean_output, extracted_label = _extract_next_label(stage_output)
            context[stage["name"]] = clean_output

            # After analyse: extract sub-queries and do multi-hop retrieval
            if stage["name"] == "analyse" and self.rag:
                sub_queries = _extract_sub_queries(stage_output)
                if sub_queries:
                    all_results = []
                    seen = set()
                    for sq in sub_queries:
                        results = self.rag.retrieve(sq, top_k=3)
                        for r in results:
                            key = r["text"][:100]
                            if key not in seen:
                                seen.add(key)
                                all_results.append(r)
                    if all_results:
                        enriched_rag = self.rag.format_context(all_results[:6])
                        yield {"type": "sub_queries", "queries": sub_queries, "results_count": len(all_results)}

            # After verify: check if revision needed
            if stage["name"] == "verify":
                if "REVISION:" in clean_output.upper():
                    # The critic found issues — note it but don't loop (1B model can't reliably revise)
                    yield {"type": "revision_needed", "critique": clean_output}

            # Set next label
            if extracted_label and len(extracted_label) < 80:
                next_label = extracted_label
            else:
                first_line = clean_output.strip().split("\n")[0].strip("*#- 1234567890.").strip()
                if first_line and 10 < len(first_line) < 80:
                    next_label = first_line[:60] + ("..." if len(first_line) > 60 else "")
                elif i == 0:
                    next_label = f"Searching for: {' '.join(message.split()[:5])}"
                elif i == 1:
                    next_label = f"Reasoning about {' '.join(message.split()[:5])}"
                elif i == 2:
                    next_label = f"Writing answer about {' '.join(message.split()[:4])}"
                elif i == 3:
                    next_label = "Verifying answer"

            yield {"type": "stage_done", "name": stage["name"], "output": clean_output}

        yield {
            "type": "done",
            "reasoning": context,
            "response": context.get("synthesise", ""),
        }
