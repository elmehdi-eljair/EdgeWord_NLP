"""
EdgeWord NLP — User Authentication
SQLite-backed user store with JWT session tokens.
"""

import sqlite3
import time
import secrets
import hashlib
from pathlib import Path
from jose import jwt

SECRET_KEY = None
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 72

DEFAULT_DB = Path(__file__).parent / ".cache" / "users.db"


def _get_secret() -> str:
    global SECRET_KEY
    if SECRET_KEY:
        return SECRET_KEY
    secret_path = Path(__file__).parent / ".cache" / ".jwt_secret"
    secret_path.parent.mkdir(parents=True, exist_ok=True)
    if secret_path.exists():
        SECRET_KEY = secret_path.read_text().strip()
    else:
        SECRET_KEY = secrets.token_urlsafe(48)
        secret_path.write_text(SECRET_KEY)
    return SECRET_KEY


def _hash_password(password: str) -> str:
    """Hash password with SHA-256 + salt (simple, no bcrypt dependency issues)."""
    salt = secrets.token_hex(16)
    h = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}:{h}"


def _verify_password(password: str, stored: str) -> bool:
    salt, h = stored.split(":", 1)
    return hashlib.sha256((salt + password).encode()).hexdigest() == h


class UserManager:
    def __init__(self, db_path: Path = DEFAULT_DB):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                display_name TEXT,
                created_at REAL NOT NULL,
                last_login_at REAL
            )
        """)
        self.conn.commit()

    def register(self, username: str, password: str, display_name: str = "") -> dict:
        username = username.strip().lower()
        if len(username) < 3:
            raise ValueError("Username must be at least 3 characters")
        if len(password) < 6:
            raise ValueError("Password must be at least 6 characters")

        existing = self.conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        if existing:
            raise ValueError("Username already taken")

        pw_hash = _hash_password(password)
        self.conn.execute(
            "INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)",
            (username, pw_hash, display_name or username, time.time()),
        )
        self.conn.commit()

        user = self.conn.execute(
            "SELECT id, username, display_name FROM users WHERE username = ?", (username,)
        ).fetchone()
        return dict(user)

    def login(self, username: str, password: str) -> str:
        username = username.strip().lower()
        user = self.conn.execute(
            "SELECT id, username, password_hash, display_name FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if not user:
            raise ValueError("Invalid username or password")
        if not _verify_password(password, user["password_hash"]):
            raise ValueError("Invalid username or password")

        self.conn.execute(
            "UPDATE users SET last_login_at = ? WHERE id = ?", (time.time(), user["id"])
        )
        self.conn.commit()

        token = jwt.encode(
            {
                "sub": str(user["id"]),
                "username": user["username"],
                "name": user["display_name"],
                "exp": time.time() + TOKEN_EXPIRE_HOURS * 3600,
            },
            _get_secret(),
            algorithm=ALGORITHM,
        )
        return token

    @staticmethod
    def verify_token(token: str) -> dict:
        payload = jwt.decode(token, _get_secret(), algorithms=[ALGORITHM])
        if payload.get("exp", 0) < time.time():
            raise ValueError("Token expired")
        return payload

    def close(self):
        self.conn.close()
