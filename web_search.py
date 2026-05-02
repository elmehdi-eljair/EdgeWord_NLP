"""
EdgeWord NLP — Web Search Module
DuckDuckGo-powered web search with content extraction.
No API key needed. Privacy-friendly.

Usage:
    ws = WebSearch()
    results = ws.search("latest Python release")
    context = ws.format_for_llm(results)
"""

import time
from duckduckgo_search import DDGS


class WebSearch:
    """DuckDuckGo web search with snippet extraction."""

    def __init__(self):
        self.ddgs = DDGS()

    def search(self, query: str, max_results: int = 5) -> list[dict]:
        """Search the web. Returns list of {title, url, snippet}."""
        t0 = time.perf_counter()
        try:
            raw = list(self.ddgs.text(query, max_results=max_results))
            results = []
            for r in raw:
                results.append({
                    "title": r.get("title", ""),
                    "url": r.get("href", r.get("link", "")),
                    "snippet": r.get("body", r.get("snippet", "")),
                })
            elapsed = time.perf_counter() - t0
            return results
        except Exception as e:
            print(f"[WebSearch] Error: {e}")
            return []

    def should_search(self, message: str) -> bool:
        """Heuristic: should this message trigger a web search suggestion?"""
        msg = message.lower()
        # Current events / time-sensitive
        time_triggers = ["latest", "recent", "today", "yesterday", "this week",
                         "this month", "2025", "2026", "news", "update",
                         "current", "now", "new release", "just released"]
        if any(t in msg for t in time_triggers):
            return True
        # Specific lookups
        lookup_triggers = ["price of", "weather in", "stock", "score",
                          "how to install", "download", "official site",
                          "documentation for", "github", "npm", "pypi"]
        if any(t in msg for t in lookup_triggers):
            return True
        # URLs mentioned
        if "http" in msg or "www." in msg or ".com" in msg or ".io" in msg:
            return True
        return False

    def format_for_llm(self, results: list[dict]) -> str:
        """Format search results as context for the LLM prompt."""
        if not results:
            return ""
        parts = ["Web search results:\n"]
        for i, r in enumerate(results, 1):
            parts.append(f"[{i}] {r['title']}")
            parts.append(f"    {r['snippet']}")
            parts.append(f"    Source: {r['url']}\n")
        parts.append("Use these web results to provide an accurate, up-to-date answer. Cite sources when relevant.")
        return "\n".join(parts)

    def format_for_display(self, results: list[dict]) -> list[dict]:
        """Format results for frontend display."""
        return [{"title": r["title"], "url": r["url"], "snippet": r["snippet"][:150]} for r in results]
