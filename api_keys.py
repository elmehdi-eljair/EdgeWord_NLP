"""
EdgeWord NLP — API Key Management
SQLite-backed API key store with usage tracking and rate limiting.

Usage as CLI:
    python api_keys.py create --name "my-app"
    python api_keys.py list
    python api_keys.py usage
    python api_keys.py revoke <key>
"""

import argparse
import hashlib
import secrets
import sqlite3
import time
from datetime import datetime
from pathlib import Path

DEFAULT_DB = Path(__file__).parent / ".cache" / "api_keys.db"
KEY_PREFIX = "ew_"  # EdgeWord prefix


class APIKeyManager:
    """Manage API keys with usage tracking."""

    def __init__(self, db_path: Path = DEFAULT_DB):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS api_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key_hash TEXT UNIQUE NOT NULL,
                key_prefix TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at REAL NOT NULL,
                last_used_at REAL,
                is_active INTEGER DEFAULT 1,
                rate_limit INTEGER DEFAULT 60,
                total_requests INTEGER DEFAULT 0,
                total_tokens INTEGER DEFAULT 0
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS usage_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key_hash TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                tokens_used INTEGER DEFAULT 0,
                latency_ms REAL,
                timestamp REAL NOT NULL,
                status_code INTEGER DEFAULT 200
            )
        """)
        self.conn.commit()

    @staticmethod
    def _hash_key(key: str) -> str:
        return hashlib.sha256(key.encode()).hexdigest()

    def create_key(self, name: str, rate_limit: int = 60) -> str:
        """Create a new API key. Returns the raw key (only shown once)."""
        raw_key = KEY_PREFIX + secrets.token_urlsafe(32)
        key_hash = self._hash_key(raw_key)
        # Store first 8 chars for display
        key_prefix = raw_key[:12] + "..."

        self.conn.execute(
            "INSERT INTO api_keys (key_hash, key_prefix, name, created_at, rate_limit) VALUES (?, ?, ?, ?, ?)",
            (key_hash, key_prefix, name, time.time(), rate_limit),
        )
        self.conn.commit()
        return raw_key

    def validate_key(self, key: str) -> dict | None:
        """Validate an API key. Returns key info dict or None."""
        key_hash = self._hash_key(key)
        row = self.conn.execute(
            "SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1",
            (key_hash,),
        ).fetchone()

        if not row:
            return None

        # Check rate limit (requests per minute)
        one_min_ago = time.time() - 60
        recent = self.conn.execute(
            "SELECT COUNT(*) FROM usage_log WHERE key_hash = ? AND timestamp > ?",
            (key_hash, one_min_ago),
        ).fetchone()[0]

        if recent >= row["rate_limit"]:
            return {"error": "rate_limited", "retry_after": 60}

        return dict(row)

    def log_usage(self, key: str, endpoint: str, tokens: int = 0,
                  latency_ms: float = 0, status_code: int = 200) -> None:
        """Log an API request."""
        key_hash = self._hash_key(key)
        self.conn.execute(
            "INSERT INTO usage_log (key_hash, endpoint, tokens_used, latency_ms, timestamp, status_code) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (key_hash, endpoint, tokens, latency_ms, time.time(), status_code),
        )
        self.conn.execute(
            "UPDATE api_keys SET total_requests = total_requests + 1, "
            "total_tokens = total_tokens + ?, last_used_at = ? WHERE key_hash = ?",
            (tokens, time.time(), key_hash),
        )
        self.conn.commit()

    def revoke_key(self, key_or_prefix: str) -> bool:
        """Revoke a key by full key or prefix."""
        # Try full key first
        key_hash = self._hash_key(key_or_prefix)
        result = self.conn.execute(
            "UPDATE api_keys SET is_active = 0 WHERE key_hash = ?", (key_hash,)
        )
        if result.rowcount > 0:
            self.conn.commit()
            return True

        # Try by prefix
        result = self.conn.execute(
            "UPDATE api_keys SET is_active = 0 WHERE key_prefix LIKE ?",
            (key_or_prefix + "%",),
        )
        self.conn.commit()
        return result.rowcount > 0

    def list_keys(self) -> list[dict]:
        """List all API keys (active and revoked)."""
        rows = self.conn.execute(
            "SELECT id, key_prefix, name, created_at, last_used_at, is_active, "
            "rate_limit, total_requests, total_tokens FROM api_keys ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def get_usage(self, hours: int = 24) -> list[dict]:
        """Get usage logs for the last N hours."""
        since = time.time() - (hours * 3600)
        rows = self.conn.execute(
            "SELECT u.endpoint, u.tokens_used, u.latency_ms, u.timestamp, u.status_code, k.name "
            "FROM usage_log u JOIN api_keys k ON u.key_hash = k.key_hash "
            "WHERE u.timestamp > ? ORDER BY u.timestamp DESC LIMIT 100",
            (since,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_usage_summary(self) -> dict:
        """Get aggregate usage summary."""
        row = self.conn.execute(
            "SELECT COUNT(*) as total_requests, COALESCE(SUM(tokens_used), 0) as total_tokens, "
            "COALESCE(AVG(latency_ms), 0) as avg_latency FROM usage_log"
        ).fetchone()
        active = self.conn.execute(
            "SELECT COUNT(*) FROM api_keys WHERE is_active = 1"
        ).fetchone()[0]
        return {
            "active_keys": active,
            "total_requests": row["total_requests"],
            "total_tokens": row["total_tokens"],
            "avg_latency_ms": round(row["avg_latency"], 1),
        }

    def close(self) -> None:
        self.conn.close()


def _cli():
    """CLI interface for API key management."""
    parser = argparse.ArgumentParser(description="EdgeWord API Key Management")
    sub = parser.add_subparsers(dest="command")

    create = sub.add_parser("create", help="Create a new API key")
    create.add_argument("--name", required=True, help="Name/label for this key")
    create.add_argument("--rate-limit", type=int, default=60, help="Requests per minute (default: 60)")

    sub.add_parser("list", help="List all API keys")
    sub.add_parser("usage", help="Show usage summary")

    revoke = sub.add_parser("revoke", help="Revoke an API key")
    revoke.add_argument("key", help="Full API key or prefix to revoke")

    args = parser.parse_args()
    mgr = APIKeyManager()

    if args.command == "create":
        key = mgr.create_key(args.name, args.rate_limit)
        print(f"\n  API key created successfully!")
        print(f"  Name:       {args.name}")
        print(f"  Rate limit: {args.rate_limit} req/min")
        print(f"\n  Key: {key}")
        print(f"\n  Save this key — it won't be shown again.\n")

    elif args.command == "list":
        keys = mgr.list_keys()
        if not keys:
            print("\n  No API keys found.\n")
            return
        print(f"\n  {'ID':>4} | {'Name':<20} | {'Key':<16} | {'Status':<8} | {'Requests':>10} | {'Tokens':>10} | {'Rate Limit':>10}")
        print("  " + "-" * 100)
        for k in keys:
            status = "active" if k["is_active"] else "revoked"
            print(f"  {k['id']:>4} | {k['name']:<20} | {k['key_prefix']:<16} | {status:<8} | {k['total_requests']:>10} | {k['total_tokens']:>10} | {k['rate_limit']:>7}/min")
        print()

    elif args.command == "usage":
        summary = mgr.get_usage_summary()
        print(f"\n  Usage Summary:")
        print(f"    Active keys:    {summary['active_keys']}")
        print(f"    Total requests: {summary['total_requests']}")
        print(f"    Total tokens:   {summary['total_tokens']}")
        print(f"    Avg latency:    {summary['avg_latency_ms']} ms")

        logs = mgr.get_usage()
        if logs:
            print(f"\n  Recent requests (last 24h):")
            print(f"  {'Time':<20} | {'Key':<20} | {'Endpoint':<12} | {'Tokens':>7} | {'Latency':>10} | {'Status':>6}")
            print("  " + "-" * 85)
            for l in logs[:20]:
                ts = datetime.fromtimestamp(l["timestamp"]).strftime("%Y-%m-%d %H:%M:%S")
                print(f"  {ts:<20} | {l['name']:<20} | {l['endpoint']:<12} | {l['tokens_used']:>7} | {l['latency_ms']:>8.1f}ms | {l['status_code']:>6}")
        print()

    elif args.command == "revoke":
        if mgr.revoke_key(args.key):
            print(f"\n  Key revoked successfully.\n")
        else:
            print(f"\n  Key not found.\n")

    else:
        parser.print_help()

    mgr.close()


if __name__ == "__main__":
    _cli()
