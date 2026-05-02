"""
EdgeWord NLP — Reasoning Engine
Multi-stage chain-of-thought reasoning with streaming.
Each stage generates the next stage's dynamic label based on its findings.
"""

from typing import Generator


STAGES = [
    {
        "name": "analyse",
        "system": (
            "You are an analytical assistant. Break down the user's question.\n"
            "1. What is the user actually asking?\n"
            "2. What information do you need?\n"
            "3. What are the key concepts?\n"
            "Be concise — 3-5 sentences max.\n\n"
            "IMPORTANT: End your response with a line starting with NEXT: followed by "
            "a short phrase (max 8 words) describing what you will search for next."
        ),
        "max_tokens": 200,
    },
    {
        "name": "retrieve",
        "system": (
            "Based on the analysis below, evaluate the available information.\n"
            "If document context is provided, score its relevance.\n"
            "List what's useful and what's missing.\n\n"
            "IMPORTANT: End your response with a line starting with NEXT: followed by "
            "a short phrase (max 8 words) describing what you will reason about next."
        ),
        "max_tokens": 200,
    },
    {
        "name": "reason",
        "system": (
            "Think step by step using the analysis and evidence.\n"
            "1. State your reasoning clearly\n"
            "2. Consider alternatives\n"
            "3. Reach a conclusion\n\n"
            "IMPORTANT: End your response with a line starting with NEXT: followed by "
            "a short phrase (max 8 words) describing the answer you will write."
        ),
        "max_tokens": 300,
    },
    {
        "name": "synthesise",
        "system": (
            "Write your final answer to the user.\n"
            "Use your analysis, evidence, and reasoning.\n"
            "Be precise, helpful, and direct."
        ),
        "max_tokens": 512,
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


class ReasoningEngine:
    """Multi-stage reasoning with dynamic labels derived from each stage's output."""

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
        if stage["name"] == "retrieve" and rag_context:
            system += f"\n\nRetrieved documents:\n{rag_context}"

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
        """Run reasoning chain. Each stage produces the next stage's label."""
        context = {}

        # First label is based on the question itself
        topic = " ".join(message.split()[:8])
        next_label = f"Breaking down: {topic}"

        for i, stage in enumerate(STAGES):
            # Yield the label (dynamic from previous stage, or initial)
            yield {"type": "stage", "name": stage["name"], "label": next_label}

            prompt = self._build_stage_prompt(stage, message, context, rag_context)

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

            # Extract NEXT: label for the following stage
            clean_output, extracted_label = _extract_next_label(stage_output)
            context[stage["name"]] = clean_output

            if extracted_label and len(extracted_label) < 80:
                next_label = extracted_label
            else:
                # Fallback: extract a meaningful snippet from the stage output
                first_line = clean_output.strip().split("\n")[0].strip("*#- 1234567890.").strip()
                if first_line and len(first_line) > 10 and len(first_line) < 80:
                    # Use first meaningful line as label
                    next_label = first_line[:60] + ("..." if len(first_line) > 60 else "")
                elif i == 0:
                    next_label = f"Searching for: {' '.join(message.split()[:5])}"
                elif i == 1:
                    next_label = f"Reasoning about {' '.join(message.split()[:5])}"
                elif i == 2:
                    next_label = f"Writing answer about {' '.join(message.split()[:4])}"

            yield {"type": "stage_done", "name": stage["name"], "output": clean_output}

        yield {
            "type": "done",
            "reasoning": context,
            "response": context.get("synthesise", ""),
        }
