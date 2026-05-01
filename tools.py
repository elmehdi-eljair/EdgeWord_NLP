"""
EdgeWord NLP — Auto-Tools
Automatically detects tool-worthy input and returns results to inject into context.
No reliance on the LLM to parse tool calls — deterministic detection, zero extra latency.

Usage:
    tools = AutoTools()
    result = tools.run("what is 25 * 4 + 10?")
    # result = "The calculation result is: 110"
"""

import re
import os
import datetime
import platform
import multiprocessing
from pathlib import Path

# --- Colours ---
DIM = "\033[2m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RESET = "\033[0m"


class AutoTools:
    """Auto-detect and execute tools based on user input."""

    def __init__(self, base_dir: str = "."):
        self.base_dir = Path(base_dir)

    def run(self, user_input: str) -> str | None:
        """Try all tools, return result string or None if no tool matched."""
        for tool in [self._calc, self._datetime, self._sysinfo, self._readfile]:
            result = tool(user_input)
            if result:
                return result
        return None

    def _calc(self, text: str) -> str | None:
        """Detect and evaluate math expressions."""
        # Look for math-like patterns
        math_pattern = re.search(
            r'(?:calculate|compute|eval|solve|what is|what\'s|how much is)?\s*'
            r'([\d\s\+\-\*\/\.\(\)\%\^]+)',
            text, re.IGNORECASE,
        )
        if not math_pattern:
            return None

        expr = math_pattern.group(1).strip()
        # Must contain at least one operator and one digit
        if not re.search(r'\d', expr) or not re.search(r'[\+\-\*\/\%\^]', expr):
            return None
        # Must be primarily math (not just a number in a sentence)
        if len(expr) < 3:
            return None

        # Replace ^ with ** for Python
        expr = expr.replace("^", "**")

        try:
            # Safe eval — only allow math
            result = eval(expr, {"__builtins__": {}}, {})
            if isinstance(result, float) and result.is_integer():
                result = int(result)
            return f"[Tool: Calculator] {expr.replace('**', '^')} = {result}"
        except Exception:
            return None

    def _datetime(self, text: str) -> str | None:
        """Detect date/time questions."""
        low = text.lower()
        triggers = [
            "what time", "what date", "what day", "current time", "current date",
            "today's date", "what is today", "what's today", "right now",
            "what year", "what month",
        ]
        if not any(t in low for t in triggers):
            return None

        now = datetime.datetime.now()
        return (
            f"[Tool: DateTime] "
            f"Date: {now.strftime('%A, %B %d, %Y')} | "
            f"Time: {now.strftime('%H:%M:%S')} | "
            f"Timezone: {datetime.datetime.now().astimezone().tzname()}"
        )

    def _sysinfo(self, text: str) -> str | None:
        """Detect system info questions."""
        low = text.lower()
        triggers = [
            "system info", "cpu info", "how much ram", "how much memory",
            "what cpu", "what processor", "my hardware", "my system",
            "machine info", "computer specs",
        ]
        if not any(t in low for t in triggers):
            return None

        try:
            import psutil
            ram = psutil.virtual_memory()
            ram_str = f"{ram.total / (1024**3):.1f} GB total, {ram.available / (1024**3):.1f} GB available"
        except ImportError:
            ram_str = "unknown"

        return (
            f"[Tool: SystemInfo] "
            f"OS: {platform.platform()} | "
            f"CPU: {platform.processor() or 'unknown'} | "
            f"Cores: {multiprocessing.cpu_count()} logical | "
            f"RAM: {ram_str} | "
            f"Python: {platform.python_version()}"
        )

    def _readfile(self, text: str) -> str | None:
        """Detect file read requests and return file content."""
        low = text.lower()

        # Look for "read <file>", "show <file>", "cat <file>", "open <file>"
        match = re.search(
            r'(?:read|show|cat|open|display|print|contents? of)\s+(?:file\s+)?["\']?([^\s"\']+\.\w+)["\']?',
            low,
        )
        if not match:
            return None

        filename = match.group(1)
        # Search in base_dir and docs/
        candidates = [
            self.base_dir / filename,
            self.base_dir / "docs" / filename,
        ]

        for filepath in candidates:
            if filepath.exists() and filepath.is_file():
                try:
                    content = filepath.read_text(encoding="utf-8", errors="ignore")
                    # Truncate if too long
                    if len(content) > 2000:
                        content = content[:2000] + "\n... (truncated)"
                    return f"[Tool: FileReader] {filepath.name}:\n{content}"
                except Exception:
                    continue

        return None
