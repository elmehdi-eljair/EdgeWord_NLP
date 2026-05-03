"""
EdgeWord NLP — Conversation Persistence
SQLite-backed storage for conversations, messages, sections, and user settings.
"""

import json
import sqlite3
import time
from pathlib import Path

DEFAULT_DB = Path(__file__).parent / ".cache" / "conversations.db"


class ConversationStore:
    def __init__(self, db_path: Path = DEFAULT_DB):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._create_tables()

    def _create_tables(self):
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                session_id TEXT NOT NULL DEFAULT 'web-ui',
                role TEXT NOT NULL,
                text TEXT NOT NULL,
                sentiment_json TEXT,
                rag_sources_json TEXT,
                tool_result TEXT,
                tokens INTEGER DEFAULT 0,
                tps REAL,
                ttft REAL,
                total_s REAL,
                cached INTEGER DEFAULT 0,
                attachments_json TEXT,
                timestamp REAL NOT NULL,
                created_at REAL NOT NULL DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS sections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                session_id TEXT NOT NULL DEFAULT 'web-ui',
                title TEXT NOT NULL,
                message_index INTEGER NOT NULL,
                message_count INTEGER NOT NULL,
                timestamp REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_settings (
                user_id TEXT PRIMARY KEY,
                max_tokens INTEGER DEFAULT 256,
                temperature REAL DEFAULT 0.7,
                context_window INTEGER DEFAULT 4096,
                top_p REAL DEFAULT 0.9,
                top_k INTEGER DEFAULT 40,
                repeat_penalty REAL DEFAULT 1.1,
                system_prompt TEXT DEFAULT '',
                updated_at REAL NOT NULL DEFAULT (strftime('%s','now'))
            );

            CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, session_id);
            CREATE INDEX IF NOT EXISTS idx_sections_user ON sections(user_id, session_id);
        """)
        # Migrate: add new columns to existing DBs
        for col, default in [("context_window", "4096"), ("top_p", "0.9"), ("top_k", "40"), ("repeat_penalty", "1.1"), ("system_prompt", "''")]:
            try:
                self.conn.execute(f"ALTER TABLE user_settings ADD COLUMN {col} DEFAULT {default}")
            except Exception:
                pass
        # Migrate messages table for new fields
        for col, default in [
            ("reasoning_json", "NULL"), ("auto_profile", "NULL"), ("skill_used", "NULL"),
            ("knowledge_gap_json", "NULL"), ("web_results_json", "NULL"), ("web_suggest", "0"),
        ]:
            try:
                self.conn.execute(f"ALTER TABLE messages ADD COLUMN {col} TEXT DEFAULT {default}")
            except Exception:
                pass
        self.conn.commit()

    # ── Messages ──

    def save_message(self, user_id: str, msg: dict, session_id: str = "web-ui") -> int:
        cur = self.conn.execute(
            """INSERT INTO messages
               (user_id, session_id, role, text, sentiment_json, rag_sources_json,
                tool_result, tokens, tps, ttft, total_s, cached, attachments_json, timestamp,
                reasoning_json, auto_profile, skill_used, knowledge_gap_json, web_results_json, web_suggest)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                user_id, session_id, msg["role"], msg["text"],
                json.dumps(msg.get("sentiment")) if msg.get("sentiment") else None,
                json.dumps(msg.get("ragSources")) if msg.get("ragSources") else None,
                msg.get("toolResult"),
                msg.get("tokens", 0), msg.get("tps"), msg.get("ttft"), msg.get("totalS"),
                1 if msg.get("cached") else 0,
                json.dumps([{"name": a["name"], "type": a["type"]} for a in msg.get("attachments", [])]) if msg.get("attachments") else None,
                msg["timestamp"],
                json.dumps(msg.get("reasoning")) if msg.get("reasoning") else None,
                msg.get("autoProfile"),
                msg.get("skillUsed"),
                json.dumps(msg.get("knowledgeGap")) if msg.get("knowledgeGap") else None,
                json.dumps(msg.get("webResults")) if msg.get("webResults") else None,
                "1" if msg.get("webSuggest") else "0",
            ),
        )
        self.conn.commit()
        return cur.lastrowid

    def get_messages(self, user_id: str, session_id: str = "web-ui") -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM messages WHERE user_id = ? AND session_id = ? ORDER BY timestamp ASC",
            (user_id, session_id),
        ).fetchall()
        return [self._row_to_message(r) for r in rows]

    def _row_to_message(self, row) -> dict:
        msg = {
            "id": str(row["id"]),
            "role": row["role"],
            "text": row["text"],
            "timestamp": row["timestamp"],
        }
        if row["sentiment_json"]:
            msg["sentiment"] = json.loads(row["sentiment_json"])
        if row["rag_sources_json"]:
            msg["ragSources"] = json.loads(row["rag_sources_json"])
        if row["tool_result"]:
            msg["toolResult"] = row["tool_result"]
        if row["tokens"]:
            msg["tokens"] = row["tokens"]
        if row["tps"]:
            msg["tps"] = row["tps"]
        if row["ttft"]:
            msg["ttft"] = row["ttft"]
        if row["total_s"]:
            msg["totalS"] = row["total_s"]
        if row["cached"]:
            msg["cached"] = True
        # New fields — safe access for migrated DBs
        try:
            if row["reasoning_json"]:
                msg["reasoning"] = json.loads(row["reasoning_json"])
            if row["auto_profile"]:
                msg["autoProfile"] = row["auto_profile"]
            if row["skill_used"]:
                msg["skillUsed"] = row["skill_used"]
            if row["knowledge_gap_json"]:
                msg["knowledgeGap"] = json.loads(row["knowledge_gap_json"])
            if row["web_results_json"]:
                msg["webResults"] = json.loads(row["web_results_json"])
            if row["web_suggest"] and row["web_suggest"] != "0":
                msg["webSuggest"] = True
        except (IndexError, KeyError):
            pass
        return msg

    def clear_messages(self, user_id: str, session_id: str = "web-ui"):
        self.conn.execute("DELETE FROM messages WHERE user_id = ? AND session_id = ?", (user_id, session_id))
        self.conn.execute("DELETE FROM sections WHERE user_id = ? AND session_id = ?", (user_id, session_id))
        self.conn.commit()

    # ── Sections ──

    def save_section(self, user_id: str, section: dict, session_id: str = "web-ui"):
        self.conn.execute(
            "INSERT INTO sections (user_id, session_id, title, message_index, message_count, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, session_id, section["title"], section["messageIndex"], section["messageCount"], section["timestamp"]),
        )
        self.conn.commit()

    def get_sections(self, user_id: str, session_id: str = "web-ui") -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM sections WHERE user_id = ? AND session_id = ? ORDER BY timestamp ASC",
            (user_id, session_id),
        ).fetchall()
        return [{"id": str(r["id"]), "title": r["title"], "messageIndex": r["message_index"],
                 "messageCount": r["message_count"], "timestamp": r["timestamp"]} for r in rows]

    # ── Settings ──

    def save_settings(self, user_id: str, settings: dict):
        self.conn.execute(
            """INSERT OR REPLACE INTO user_settings
               (user_id, max_tokens, temperature, context_window, top_p, top_k, repeat_penalty, system_prompt, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id,
             settings.get("max_tokens", 256), settings.get("temperature", 0.7),
             settings.get("context_window", 4096), settings.get("top_p", 0.9),
             settings.get("top_k", 40), settings.get("repeat_penalty", 1.1),
             settings.get("system_prompt", ""), time.time()),
        )
        self.conn.commit()

    def get_settings(self, user_id: str) -> dict:
        row = self.conn.execute("SELECT * FROM user_settings WHERE user_id = ?", (user_id,)).fetchone()
        if not row:
            return {"max_tokens": 256, "temperature": 0.7, "context_window": 4096, "top_p": 0.9, "top_k": 40, "repeat_penalty": 1.1, "system_prompt": ""}
        return {
            "max_tokens": row["max_tokens"], "temperature": row["temperature"],
            "context_window": row["context_window"] if "context_window" in row.keys() else 4096,
            "top_p": row["top_p"] if "top_p" in row.keys() else 0.9,
            "top_k": row["top_k"] if "top_k" in row.keys() else 40,
            "repeat_penalty": row["repeat_penalty"] if "repeat_penalty" in row.keys() else 1.1,
            "system_prompt": row["system_prompt"] if "system_prompt" in row.keys() else "",
        }

    def close(self):
        self.conn.close()
