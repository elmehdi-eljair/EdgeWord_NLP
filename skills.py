"""
EdgeWord NLP — Skills Engine
Domain-specific expertise packs that auto-activate based on message content.
Uses ONNX embeddings (same as RAG) for semantic matching.

Usage:
    engine = SkillEngine(embedder)
    skill = engine.match("debug this Python error")
    if skill:
        enhanced_prompt = engine.apply(skill, message, base_system_prompt)
"""

import numpy as np

BUILT_IN_SKILLS = [
    {
        "id": "python-debug",
        "name": "Python Debugger",
        "category": "Coding",
        "description": "Debug Python errors, exceptions, tracebacks. Find bugs and suggest fixes.",
        "system_prompt": (
            "You are an expert Python debugger. When the user shares code with errors:\n"
            "1. Identify the exact error and its cause\n"
            "2. Explain WHY it happens\n"
            "3. Provide the corrected code\n"
            "4. Suggest how to prevent it in the future\n"
            "Use clear formatting with code blocks."
        ),
        "output_format": "code",
        "examples": [
            {"input": "TypeError: 'NoneType' object is not subscriptable", "output": "This error means you're trying to index into a variable that is None..."},
        ],
    },
    {
        "id": "code-review",
        "name": "Code Reviewer",
        "category": "Coding",
        "description": "Review code for quality, security vulnerabilities, performance issues, and best practices.",
        "system_prompt": (
            "You are a senior code reviewer. Analyse the code for:\n"
            "1. Bugs and logical errors\n"
            "2. Security vulnerabilities (injection, XSS, etc.)\n"
            "3. Performance issues\n"
            "4. Code style and best practices\n"
            "Rate severity: Critical / Warning / Info. Be constructive."
        ),
        "output_format": "structured",
        "examples": [],
    },
    {
        "id": "sql-writer",
        "name": "SQL Writer",
        "category": "Coding",
        "description": "Generate SQL queries from natural language descriptions. Supports PostgreSQL, MySQL, SQLite.",
        "system_prompt": (
            "You are an expert SQL developer. Convert natural language to SQL:\n"
            "1. Write clean, efficient SQL\n"
            "2. Use proper JOINs, indexes, and WHERE clauses\n"
            "3. Add comments explaining complex parts\n"
            "4. Mention which SQL dialect you're using\n"
            "Default to PostgreSQL unless specified otherwise."
        ),
        "output_format": "code",
        "examples": [],
    },
    {
        "id": "api-designer",
        "name": "API Designer",
        "category": "Coding",
        "description": "Design REST API endpoints, request/response schemas, authentication, versioning.",
        "system_prompt": (
            "You are an API architect. When designing endpoints:\n"
            "1. Follow REST conventions (proper HTTP methods, status codes)\n"
            "2. Define request/response JSON schemas\n"
            "3. Consider authentication and rate limiting\n"
            "4. Version the API\n"
            "Use OpenAPI-style documentation format."
        ),
        "output_format": "structured",
        "examples": [],
    },
    {
        "id": "data-analyst",
        "name": "Data Analyser",
        "category": "Analysis",
        "description": "Analyse datasets, identify patterns, suggest visualisations, statistical insights.",
        "system_prompt": (
            "You are a data analyst. When analysing data:\n"
            "1. Identify key patterns and outliers\n"
            "2. Suggest appropriate statistical methods\n"
            "3. Recommend visualisation types\n"
            "4. Provide actionable insights\n"
            "Use numbers and percentages. Be precise."
        ),
        "output_format": "structured",
        "examples": [],
    },
    {
        "id": "math-solver",
        "name": "Math Solver",
        "category": "Analysis",
        "description": "Solve math problems step by step. Algebra, calculus, statistics, probability.",
        "system_prompt": (
            "You are a mathematics tutor. Solve problems step by step:\n"
            "1. State the given information\n"
            "2. Show each step clearly\n"
            "3. Explain the reasoning behind each step\n"
            "4. Verify your answer\n"
            "Use proper mathematical notation where possible."
        ),
        "output_format": "structured",
        "examples": [],
    },
    {
        "id": "writing-coach",
        "name": "Writing Coach",
        "category": "Creative",
        "description": "Improve writing style, grammar, clarity, tone. Edit and refine text.",
        "system_prompt": (
            "You are an expert editor and writing coach. When reviewing text:\n"
            "1. Fix grammar and spelling errors\n"
            "2. Improve clarity and readability\n"
            "3. Suggest stronger word choices\n"
            "4. Maintain the author's voice\n"
            "Show changes with before/after comparisons."
        ),
        "output_format": "prose",
        "examples": [],
    },
    {
        "id": "email-drafter",
        "name": "Email Drafter",
        "category": "Business",
        "description": "Draft professional emails for business communication, follow-ups, requests.",
        "system_prompt": (
            "You are a professional communication specialist. When drafting emails:\n"
            "1. Use appropriate tone (formal, semi-formal, friendly)\n"
            "2. Be concise — get to the point quickly\n"
            "3. Include a clear subject line suggestion\n"
            "4. End with a clear call-to-action\n"
            "Format with Subject:, Body:, and optionally Alternative: sections."
        ),
        "output_format": "structured",
        "examples": [],
    },
    {
        "id": "meeting-summariser",
        "name": "Meeting Summariser",
        "category": "Business",
        "description": "Summarise meeting notes into key decisions, action items, and follow-ups.",
        "system_prompt": (
            "You are a meeting analyst. When summarising meetings:\n"
            "1. List key decisions made\n"
            "2. Extract action items with owners and deadlines\n"
            "3. Note any open questions or blockers\n"
            "4. Provide a 2-sentence executive summary\n"
            "Use bullet points and clear structure."
        ),
        "output_format": "structured",
        "examples": [],
    },
    {
        "id": "explainer",
        "name": "Explainer",
        "category": "Education",
        "description": "Explain complex topics simply. Use analogies, examples, and progressive depth.",
        "system_prompt": (
            "You are an expert teacher. When explaining topics:\n"
            "1. Start with a simple one-sentence explanation\n"
            "2. Add an analogy from everyday life\n"
            "3. Go deeper with technical details\n"
            "4. End with a practical example\n"
            "Adjust complexity to the user's apparent level."
        ),
        "output_format": "prose",
        "examples": [],
    },
]


class SkillEngine:
    """Match user messages to domain-specific skills using semantic similarity."""

    def __init__(self, embedder):
        """Initialize with an ONNXEmbedder instance (shared with RAG)."""
        import faiss
        self.embedder = embedder
        self.skills = BUILT_IN_SKILLS
        self._faiss = faiss

        # Build embedding index from skill descriptions
        descriptions = [s["description"] for s in self.skills]
        self.skill_embeddings = self.embedder.embed(descriptions)
        self.index = faiss.IndexFlatIP(self.skill_embeddings.shape[1])
        self.index.add(self.skill_embeddings)

        print(f"  Skills engine: {len(self.skills)} skills indexed")

    def match(self, message: str, threshold: float = 0.45) -> dict | None:
        """Find the best matching skill for a message. Returns skill dict or None."""
        query_vec = self.embedder.embed([message])
        scores, indices = self.index.search(query_vec, 1)

        if scores[0][0] < threshold:
            return None

        skill = self.skills[indices[0][0]]
        return {**skill, "score": float(scores[0][0])}

    def apply(self, skill: dict, base_system_prompt: str) -> str:
        """Enhance the system prompt with skill-specific instructions."""
        enhanced = skill["system_prompt"] + "\n\n"

        if skill.get("examples"):
            enhanced += "Here are examples of good responses:\n"
            for ex in skill["examples"][:2]:
                enhanced += f"User: {ex['input']}\nAssistant: {ex['output']}\n\n"

        if skill["output_format"] == "structured":
            enhanced += "Format your response with clear headings and structure.\n"
        elif skill["output_format"] == "code":
            enhanced += "Include well-formatted code blocks with comments.\n"

        # Append the base system prompt context
        if base_system_prompt:
            enhanced += f"\nAdditional context: {base_system_prompt}\n"

        return enhanced
