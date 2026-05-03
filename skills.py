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
    """Match user messages to domain-specific skills using semantic similarity.
    Supports built-in + custom skills persisted in SQLite."""

    def __init__(self, embedder, db_path: str = "skills.db"):
        """Initialize with an ONNXEmbedder instance (shared with RAG)."""
        import faiss
        import sqlite3
        self.embedder = embedder
        self._faiss = faiss
        self._db_path = db_path
        self._init_db()
        self._load_and_index()
        print(f"  Skills engine: {len(self.skills)} skills indexed ({self._count_custom()} custom)")

    def _init_db(self):
        import sqlite3
        conn = sqlite3.connect(self._db_path)
        conn.execute("""CREATE TABLE IF NOT EXISTS custom_skills (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT DEFAULT 'Custom',
            description TEXT NOT NULL,
            system_prompt TEXT NOT NULL,
            output_format TEXT DEFAULT 'structured',
            examples TEXT DEFAULT '[]',
            enabled INTEGER DEFAULT 1,
            created_at REAL,
            updated_at REAL
        )""")
        conn.commit()
        conn.close()

    def _count_custom(self) -> int:
        import sqlite3
        conn = sqlite3.connect(self._db_path)
        count = conn.execute("SELECT COUNT(*) FROM custom_skills").fetchone()[0]
        conn.close()
        return count

    def _load_and_index(self):
        """Load all skills (built-in + custom) and rebuild FAISS index."""
        import sqlite3, json
        # Built-in skills (always present)
        self.skills = [s for s in BUILT_IN_SKILLS]

        # Load custom skills from DB
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM custom_skills WHERE enabled = 1").fetchall()
        conn.close()
        for r in rows:
            self.skills.append({
                "id": r["id"],
                "name": r["name"],
                "category": r["category"],
                "description": r["description"],
                "system_prompt": r["system_prompt"],
                "output_format": r["output_format"],
                "examples": json.loads(r["examples"]) if r["examples"] else [],
                "custom": True,
            })

        # Build FAISS index
        if self.skills:
            descriptions = [s["description"] for s in self.skills]
            self.skill_embeddings = self.embedder.embed(descriptions)
            self.index = self._faiss.IndexFlatIP(self.skill_embeddings.shape[1])
            self.index.add(self.skill_embeddings)
        else:
            self.index = None

    def list_all(self) -> list[dict]:
        """List all skills with enabled/custom status."""
        import sqlite3, json
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        custom_rows = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM custom_skills").fetchall()}
        conn.close()

        result = []
        for s in BUILT_IN_SKILLS:
            result.append({**s, "builtin": True, "enabled": True, "custom": False})
        for sid, r in custom_rows.items():
            result.append({
                "id": r["id"], "name": r["name"], "category": r["category"],
                "description": r["description"], "system_prompt": r["system_prompt"],
                "output_format": r["output_format"],
                "examples": json.loads(r["examples"]) if r["examples"] else [],
                "enabled": bool(r["enabled"]), "custom": True, "builtin": False,
            })
        return result

    def create_skill(self, data: dict) -> dict:
        """Create a custom skill."""
        import sqlite3, json, time as _t
        sid = data.get("id") or data["name"].lower().replace(" ", "-")
        # Check not duplicate
        if any(s["id"] == sid for s in BUILT_IN_SKILLS):
            raise ValueError(f"Cannot override built-in skill: {sid}")
        conn = sqlite3.connect(self._db_path)
        now = _t.time()
        conn.execute(
            "INSERT OR REPLACE INTO custom_skills (id, name, category, description, system_prompt, output_format, examples, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)",
            (sid, data["name"], data.get("category", "Custom"), data["description"],
             data["system_prompt"], data.get("output_format", "structured"),
             json.dumps(data.get("examples", [])), now, now),
        )
        conn.commit()
        conn.close()
        self._load_and_index()
        return {"id": sid, "status": "created"}

    def update_skill(self, skill_id: str, data: dict) -> dict:
        """Update a custom skill."""
        import sqlite3, json, time as _t
        if any(s["id"] == skill_id for s in BUILT_IN_SKILLS):
            raise ValueError("Cannot edit built-in skills")
        conn = sqlite3.connect(self._db_path)
        fields = []
        values = []
        for key in ["name", "category", "description", "system_prompt", "output_format"]:
            if key in data:
                fields.append(f"{key} = ?")
                values.append(data[key])
        if "examples" in data:
            fields.append("examples = ?")
            values.append(json.dumps(data["examples"]))
        if "enabled" in data:
            fields.append("enabled = ?")
            values.append(1 if data["enabled"] else 0)
        fields.append("updated_at = ?")
        values.append(_t.time())
        values.append(skill_id)
        conn.execute(f"UPDATE custom_skills SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
        conn.close()
        self._load_and_index()
        return {"id": skill_id, "status": "updated"}

    def delete_skill(self, skill_id: str) -> dict:
        """Delete a custom skill."""
        if any(s["id"] == skill_id for s in BUILT_IN_SKILLS):
            raise ValueError("Cannot delete built-in skills")
        import sqlite3
        conn = sqlite3.connect(self._db_path)
        conn.execute("DELETE FROM custom_skills WHERE id = ?", (skill_id,))
        conn.commit()
        conn.close()
        self._load_and_index()
        return {"id": skill_id, "status": "deleted"}

    def toggle_skill(self, skill_id: str, enabled: bool) -> dict:
        """Enable or disable a custom skill."""
        if any(s["id"] == skill_id for s in BUILT_IN_SKILLS):
            raise ValueError("Cannot disable built-in skills")
        import sqlite3
        conn = sqlite3.connect(self._db_path)
        conn.execute("UPDATE custom_skills SET enabled = ? WHERE id = ?", (1 if enabled else 0, skill_id))
        conn.commit()
        conn.close()
        self._load_and_index()
        return {"id": skill_id, "enabled": enabled}

    def match(self, message: str, threshold: float = 0.50) -> dict | None:
        """Find the best matching skill for a message. Returns skill dict or None.
        Uses 0.50 threshold with ambiguity check to avoid false positives."""
        if not self.index or self.index.ntotal == 0:
            return None
        query_vec = self.embedder.embed([message])
        # Get top 3 to compare scores
        k = min(3, self.index.ntotal)
        scores, indices = self.index.search(query_vec, k)

        best_score = float(scores[0][0])
        if best_score < threshold:
            return None

        # Reject if top 2 scores are too close (ambiguous match = no match)
        if k >= 2 and scores[0][1] > 0:
            gap = best_score - float(scores[0][1])
            if gap < 0.03:  # Less than 3% gap = too ambiguous
                return None

        skill = self.skills[indices[0][0]]
        return {**skill, "score": best_score}

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
        if base_system_prompt:
            enhanced += f"\nAdditional context: {base_system_prompt}\n"
        return enhanced
