"""
EdgeWord NLP — Reasoning Engine
Multi-stage chain-of-thought reasoning with streaming.
Stages: Analyse → Retrieve → Reason → Synthesise

Usage:
    engine = ReasoningEngine(llm, rag_engine)
    for event in engine.run(message, history):
        # event = {"type": "stage", "name": "analyse"} or
        #         {"type": "token", "stage": "analyse", "text": "..."} or
        #         {"type": "done", "reasoning": {...}, "response": "..."}
"""

from typing import Generator


STAGES = [
    {
        "name": "analyse",
        "label": "Analysing",
        "system": (
            "You are an analytical assistant. Your job is to break down the user's question.\n"
            "1. What is the user actually asking?\n"
            "2. What information do you need to answer it?\n"
            "3. What are the key concepts involved?\n"
            "Be concise — 3-5 sentences max. This is internal thinking, not the final answer."
        ),
        "max_tokens": 200,
    },
    {
        "name": "retrieve",
        "label": "Retrieving",
        "system": (
            "Based on the analysis below, formulate what information would be most useful.\n"
            "If document context is provided, evaluate its relevance.\n"
            "Score each piece of evidence: highly relevant, somewhat relevant, or not relevant.\n"
            "Be concise — list format."
        ),
        "max_tokens": 150,
    },
    {
        "name": "reason",
        "label": "Reasoning",
        "system": (
            "Think step by step about the question using the analysis and evidence.\n"
            "1. State your reasoning clearly\n"
            "2. Consider alternative interpretations\n"
            "3. Note any uncertainties\n"
            "4. Reach a conclusion\n"
            "This is your internal reasoning chain — be thorough."
        ),
        "max_tokens": 300,
    },
    {
        "name": "synthesise",
        "label": "Synthesising",
        "system": (
            "Now write your final answer to the user.\n"
            "Use your analysis, evidence, and reasoning to produce a clear, well-structured response.\n"
            "Be precise, helpful, and direct. This is what the user will see."
        ),
        "max_tokens": 512,
    },
]


class ReasoningEngine:
    """Multi-stage reasoning with streaming chain-of-thought."""

    def __init__(self, llm, rag_engine=None, template="llama3"):
        self.llm = llm
        self.rag = rag_engine
        self.template = template

    def _build_stage_prompt(self, stage: dict, message: str, context: dict, rag_context: str = "") -> str:
        """Build prompt for a reasoning stage."""
        system = stage["system"]

        # Add previous stage outputs as context
        if context:
            system += "\n\nPrevious thinking:\n"
            for prev_name, prev_output in context.items():
                system += f"[{prev_name.upper()}]: {prev_output}\n"

        # Add RAG context in retrieve stage
        if stage["name"] == "retrieve" and rag_context:
            system += f"\n\nRetrieved documents:\n{rag_context}"

        # Build in the right template format
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
        """Run reasoning chain, yielding events for each stage and token."""
        context = {}

        for stage in STAGES:
            # Signal stage start
            yield {"type": "stage", "name": stage["name"], "label": stage["label"]}

            # Build prompt with accumulated context
            prompt = self._build_stage_prompt(stage, message, context, rag_context)

            # Stream tokens
            stage_output = ""
            stream = self.llm.create_completion(
                prompt,
                max_tokens=stage["max_tokens"],
                stream=True,
                echo=False,
                temperature=0.3,  # Lower temp for reasoning
                top_p=0.85,
            )

            for chunk in stream:
                tok = chunk["choices"][0]["text"]
                if "<|im_end|>" in tok or "<|eot_id|>" in tok:
                    break
                stage_output += tok
                yield {"type": "token", "stage": stage["name"], "text": tok}

            context[stage["name"]] = stage_output.strip()
            yield {"type": "stage_done", "name": stage["name"], "output": stage_output.strip()}

        # Done — yield final result
        yield {
            "type": "done",
            "reasoning": context,
            "response": context.get("synthesise", ""),
        }
