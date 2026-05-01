"""
EdgeWord NLP — Response Cache
SQLite-based LLM response cache. Instant return on cache hit.

Usage:
    cache = ResponseCache()
    cached = cache.get("What is NLP?")
    if cached:
        print(cached)  # instant
    else:
        response = llm.generate(...)
        cache.put("What is NLP?", response)
"""

import hashlib
import sqlite3
import time
from pathlib import Path

# --- Colours ---
DIM = "\033[2m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RESET = "\033[0m"

DEFAULT_DB = Path(__file__).parent / ".cache" / "responses.db"


class ResponseCache:
    """SQLite-backed LLM response cache."""

    def __init__(self, db_path: Path = DEFAULT_DB, enabled: bool = True):
        self.enabled = enabled
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                response TEXT NOT NULL,
                created_at REAL NOT NULL,
                hit_count INTEGER DEFAULT 0
            )
        """)
        self.conn.commit()

        count = self.conn.execute("SELECT COUNT(*) FROM cache").fetchone()[0]
        if count > 0:
            print(f"  {DIM}Cache loaded: {count} entries{RESET}")

    @staticmethod
    def _hash(text: str) -> str:
        """Normalize and hash the input text."""
        normalized = text.strip().lower()
        return hashlib.sha256(normalized.encode()).hexdigest()

    def get(self, query: str) -> str | None:
        """Return cached response or None."""
        if not self.enabled:
            return None
        key = self._hash(query)
        row = self.conn.execute(
            "SELECT response FROM cache WHERE key = ?", (key,)
        ).fetchone()
        if row:
            self.conn.execute(
                "UPDATE cache SET hit_count = hit_count + 1 WHERE key = ?", (key,)
            )
            self.conn.commit()
            return row[0]
        return None

    def put(self, query: str, response: str) -> None:
        """Store a response in the cache."""
        if not self.enabled:
            return
        key = self._hash(query)
        self.conn.execute(
            "INSERT OR REPLACE INTO cache (key, response, created_at, hit_count) VALUES (?, ?, ?, 0)",
            (key, response, time.time()),
        )
        self.conn.commit()

    def clear(self) -> int:
        """Clear all cached responses. Returns count of entries removed."""
        count = self.conn.execute("SELECT COUNT(*) FROM cache").fetchone()[0]
        self.conn.execute("DELETE FROM cache")
        self.conn.commit()
        return count

    def stats(self) -> dict:
        """Return cache statistics."""
        row = self.conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(hit_count), 0) FROM cache"
        ).fetchone()
        return {"entries": row[0], "total_hits": row[1]}

    def close(self) -> None:
        self.conn.close()
