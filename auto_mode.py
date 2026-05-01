"""
EdgeWord NLP — Auto-Mode
Automatically selects optimal model parameters based on user message intent.
Uses a quick LLM classification call (~0.5s) to detect message type.

Usage:
    auto = AutoMode()
    params = auto.classify(message, llm)
    # params = {"temperature": 0.15, "top_p": 0.8, "top_k": 20, "max_tokens": 512, "profile": "code"}
"""

PARAM_PROFILES = {
    "factual": {
        "temperature": 0.2, "top_p": 0.8, "top_k": 20, "max_tokens": 256,
        "repeat_penalty": 1.2, "label": "Factual",
    },
    "creative": {
        "temperature": 1.0, "top_p": 0.95, "top_k": 80, "max_tokens": 1024,
        "repeat_penalty": 1.0, "label": "Creative",
    },
    "code": {
        "temperature": 0.15, "top_p": 0.8, "top_k": 20, "max_tokens": 512,
        "repeat_penalty": 1.2, "label": "Code",
    },
    "analysis": {
        "temperature": 0.3, "top_p": 0.85, "top_k": 30, "max_tokens": 512,
        "repeat_penalty": 1.15, "label": "Analysis",
    },
    "chat": {
        "temperature": 0.7, "top_p": 0.9, "top_k": 40, "max_tokens": 256,
        "repeat_penalty": 1.1, "label": "Chat",
    },
    "summary": {
        "temperature": 0.3, "top_p": 0.85, "top_k": 30, "max_tokens": 512,
        "repeat_penalty": 1.15, "label": "Summary",
    },
}

# Keyword fallback for when LLM classification fails
_KEYWORD_MAP = {
    "code": ["code", "function", "class", "debug", "error", "bug", "implement", "python", "javascript", "sql", "api", "refactor", "compile", "syntax"],
    "creative": ["write", "poem", "story", "creative", "imagine", "fiction", "essay", "lyrics", "narrative"],
    "summary": ["summarize", "summarise", "summary", "tldr", "brief", "recap", "condense"],
    "analysis": ["analyze", "analyse", "compare", "evaluate", "assess", "review", "pros and cons", "data", "statistics"],
    "factual": ["what is", "who is", "when did", "where is", "define", "explain", "how does", "capital of", "history of"],
}


class AutoMode:
    """Auto-select optimal model parameters per message."""

    def classify(self, message: str, llm) -> dict:
        """Classify message intent and return optimal params + profile name."""
        # Try LLM classification first
        try:
            prompt = (
                "<|start_header_id|>system<|end_header_id|>\n\n"
                "Classify this message into exactly one category. "
                "Reply with ONLY the category name, nothing else.\n"
                "Categories: factual, creative, code, analysis, chat, summary<|eot_id|>"
                f"<|start_header_id|>user<|end_header_id|>\n\n{message}<|eot_id|>"
                "<|start_header_id|>assistant<|end_header_id|>\n\n"
            )
            result = llm.create_completion(
                prompt, max_tokens=10, temperature=0.0, stream=False, echo=False,
            )
            category = result["choices"][0]["text"].strip().lower().split()[0]
            # Clean up — remove punctuation
            category = "".join(c for c in category if c.isalpha())
            if category in PARAM_PROFILES:
                params = {**PARAM_PROFILES[category], "profile": category}
                return params
        except Exception:
            pass

        # Fallback: keyword-based classification
        msg_lower = message.lower()
        for category, keywords in _KEYWORD_MAP.items():
            if any(kw in msg_lower for kw in keywords):
                params = {**PARAM_PROFILES[category], "profile": category}
                return params

        # Default: chat
        return {**PARAM_PROFILES["chat"], "profile": "chat"}
