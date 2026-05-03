"""
EdgeWord NLP — REST API Server
FastAPI endpoints with API key authentication, structured JSON responses.

Usage:
    # Create an API key first:
    .venv/bin/python3 api_keys.py create --name "my-app"

    # Start the server:
    .venv/bin/python3 api.py
    .venv/bin/python3 api.py --port 8080 --threads 4

    # Call the API:
    curl -H "Authorization: Bearer ew_..." http://localhost:8000/v1/chat \
         -H "Content-Type: application/json" \
         -d '{"message": "What is CPU inference?"}'
"""

import argparse
import os
import sys
import json
import time
import numpy as np
from pathlib import Path
from contextlib import asynccontextmanager

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from fastapi import FastAPI, HTTPException, Depends, Request, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DIM = "\033[2m"
RESET = "\033[0m"

# --- Request/Response models ---

class SentimentResult(BaseModel):
    label: str
    confidence: float
    scores: dict[str, float]
    latency_ms: float

class ChatRequest(BaseModel):
    message: str = Field(..., description="User message")
    max_tokens: int = Field(256, ge=1, le=2048, description="Max tokens to generate")
    temperature: float = Field(0.7, ge=0.0, le=2.0, description="Sampling temperature")
    top_p: float = Field(0.9, ge=0.0, le=1.0, description="Nucleus sampling")
    top_k: int = Field(40, ge=1, le=100, description="Top-K sampling")
    repeat_penalty: float = Field(1.1, ge=1.0, le=2.0, description="Repeat penalty")
    system_prompt: str = Field("", description="Custom system prompt (empty = default)")
    session_id: str = Field("default", description="Session ID for conversation memory")
    use_rag: bool = Field(True, description="Enable RAG context retrieval")
    use_tools: bool = Field(True, description="Enable auto-tools")
    use_cache: bool = Field(True, description="Enable response cache")
    auto_mode: bool = Field(False, description="Auto-select optimal params per message")
    use_web: bool = Field(False, description="Enable web search for this message")

class ChatResponse(BaseModel):
    response: str
    sentiment: SentimentResult | None = None
    tool_result: str | None = None
    rag_sources: list[str] = []
    tokens: int = 0
    tps: float = 0.0
    ttft_s: float = 0.0
    total_s: float = 0.0
    cached: bool = False
    session_id: str = "default"
    auto_profile: str | None = None
    skill_used: str | None = None
    web_results: list[dict] = []
    web_suggest: bool = False
    knowledge_gap: dict | None = None  # {"message": "...", "suggested_pack": {...}} when RAG has no match

class ClassifyRequest(BaseModel):
    text: str = Field(..., description="Text to classify")

class ClassifyBatchRequest(BaseModel):
    texts: list[str] = Field(..., description="List of texts to classify")

class ClassifyResponse(BaseModel):
    result: SentimentResult

class ClassifyBatchResponse(BaseModel):
    results: list[SentimentResult]
    total_ms: float

class HealthResponse(BaseModel):
    status: str
    fast_path: bool
    compute_path: bool
    rag_chunks: int
    cache_entries: int
    model: str | None
    uptime_s: float

class KeyUsageResponse(BaseModel):
    name: str
    total_requests: int
    total_tokens: int
    rate_limit: int
    active: bool

class TranscribeResponse(BaseModel):
    text: str
    language: str
    language_probability: float
    duration_s: float
    processing_s: float
    segments: list[dict]

class OCRResponse(BaseModel):
    text: str
    word_count: int
    confidence: float
    image_size: str
    processing_ms: float
    language: str

class ImageClassifyResponse(BaseModel):
    top_labels: list[dict]
    image_size: str
    processing_ms: float

class TTSResponse(BaseModel):
    output_path: str
    sample_rate: int
    size_bytes: int
    processing_s: float
    text_length: int

# --- Globals (loaded at startup) ---
fast_path = None
compute_path = None
rag_engine = None
response_cache = None
auto_tools = None
key_manager = None
conv_store = None
auto_mode_engine = None
web_search_engine = None
import threading
_llm_lock = threading.Lock()  # Global lock — llama.cpp is NOT thread-safe
skill_engine = None
gallery_manager = None
graph_rag = None  # GraphRAG instance
stt_engine = None
tts_engine = None
ocr_engine = None
img_classifier = None
sessions = {}  # session_id -> conversation history
start_time = None

# ── Log capture ring buffer ──
import logging
import collections

_log_buffer: collections.deque = collections.deque(maxlen=2000)
_log_id_counter = 0


class BufferLogHandler(logging.Handler):
    """Captures log records into a ring buffer for the /v1/logs endpoint."""
    def emit(self, record):
        global _log_id_counter
        _log_id_counter += 1
        try:
            msg = self.format(record)
        except Exception:
            msg = str(record.getMessage())
        _log_buffer.append({
            "id": _log_id_counter,
            "timestamp": record.created,
            "level": record.levelname,
            "source": record.name,
            "message": msg,
        })


# Install handler on root logger + uvicorn
_buf_handler = BufferLogHandler()
_buf_handler.setFormatter(logging.Formatter("%(message)s"))
logging.getLogger().addHandler(_buf_handler)
logging.getLogger().setLevel(logging.INFO)
for _ln in ["uvicorn", "uvicorn.access", "uvicorn.error", "edgeword"]:
    logging.getLogger(_ln).addHandler(_buf_handler)
_app_log = logging.getLogger("edgeword")


def _detect_knowledge_gap(message: str, rag_results: list, rag_has_context: bool) -> dict | None:
    """Detect if a query lacks knowledge coverage and suggest a gallery pack."""
    if rag_has_context:
        return None  # RAG found relevant content — no gap

    # Skip for simple greetings/chat
    msg_lower = message.lower()
    if len(message.split()) < 4:
        return None
    skip_words = {"hello", "hi", "hey", "thanks", "ok", "bye", "how are you"}
    if any(w in msg_lower for w in skip_words):
        return None

    # Try to match the query against gallery pack descriptions
    if not gallery_manager:
        return None

    from knowledge_gallery import GALLERY_PACKS
    best_pack = None
    best_score = 0

    # Use the RAG embedder to match query against pack descriptions
    if rag_engine and rag_engine.embedder:
        try:
            query_vec = rag_engine.embedder.embed([message])
            pack_list = []
            pack_descs = []
            for pid, info in GALLERY_PACKS.items():
                meta = gallery_manager._load_meta(pid)
                if meta and meta.get("enabled"):
                    continue  # Pack already installed and enabled — gap is in content quality, not coverage
                pack_list.append((pid, info))
                pack_descs.append(f"{info['name']}: {info['description']}")

            if pack_descs:
                desc_vecs = rag_engine.embedder.embed(pack_descs)
                # Cosine similarity (vectors are already normalized)
                scores = (query_vec @ desc_vecs.T)[0]
                best_idx = int(scores.argmax())
                best_score = float(scores[best_idx])

                if best_score > 0.35:  # Decent match to a pack description
                    pid, info = pack_list[best_idx]
                    best_pack = {
                        "id": pid,
                        "name": info["name"],
                        "description": info["description"],
                        "category": info["category"],
                    }
        except Exception:
            pass

    if best_pack:
        return {
            "message": f"I don't have deep knowledge about this topic yet. "
                       f"The {best_pack['name']} pack could help me give you a much better answer.",
            "suggested_pack": best_pack,
        }
    else:
        # Generic gap — no specific pack matches
        return {
            "message": "My knowledge on this topic is limited. "
                       "You can explore the Knowledge Gallery to install domain-specific packs.",
            "suggested_pack": None,
        }


def get_session(session_id: str):
    """Get or create a conversation session."""
    if session_id not in sessions:
        from langchain_core.messages import HumanMessage, AIMessage
        sessions[session_id] = []
    return sessions[session_id]


# --- Auth ---
security = HTTPBearer(auto_error=False)
user_manager = None


async def verify_auth(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Authenticate via JWT token (frontend) or API key (programmatic).
    JWT tokens start with 'eyJ', API keys start with 'ew_'."""
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = credentials.credentials

    # Try JWT first (frontend sessions)
    if token.startswith("eyJ"):
        try:
            from auth import UserManager
            payload = UserManager.verify_token(token)
            return {"auth_type": "jwt", "user_id": payload["sub"], "username": payload["username"], "name": payload.get("name", "")}
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid or expired session")

    # Try API key (programmatic)
    result = key_manager.validate_key(token)
    if result is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if "error" in result:
        if result["error"] == "rate_limited":
            raise HTTPException(status_code=429, detail=f"Rate limit exceeded. Retry after {result.get('retry_after', 60)}s")
    return {"auth_type": "api_key", "key": token, **result}


# Keep old name as alias for backward compat in endpoints
verify_api_key = verify_auth


# --- Lifespan ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    global fast_path, compute_path, rag_engine, response_cache, auto_tools, key_manager, start_time
    global stt_engine, tts_engine, ocr_engine, img_classifier, user_manager, conv_store
    import numpy as np
    import onnxruntime as ort
    from transformers import AutoTokenizer
    from huggingface_hub import snapshot_download
    from api_keys import APIKeyManager

    start_time = time.time()
    print("\n=== EdgeWord NLP API Server ===\n")

    # Fast-Path
    from cli import FastPath
    fast_path = FastPath()

    # Compute-Path
    models_dir = Path(__file__).parent / "models"
    ggufs = sorted(models_dir.glob("*.gguf")) if models_dir.exists() else []
    if ggufs:
        from cli import ComputePath
        threads = int(os.environ.get("EDGEWORD_THREADS", "4"))
        compute_path = ComputePath(str(ggufs[0]), n_threads=threads, memory_k=50)

    # RAG
    docs_dir = Path(__file__).parent / "docs"
    if docs_dir.exists() and any(docs_dir.rglob("*")):
        from rag import RAGEngine
        rag_engine = RAGEngine()
        rag_engine.load_directory(str(docs_dir))

    # Cache
    from cache import ResponseCache
    response_cache = ResponseCache(enabled=True)

    # Tools
    from tools import AutoTools
    auto_tools = AutoTools(base_dir=str(Path(__file__).parent))

    # API Keys
    key_manager = APIKeyManager()

    # User auth
    from auth import UserManager
    user_manager = UserManager()

    # Conversation persistence
    from conversations import ConversationStore
    conv_store = ConversationStore()

    # Auto-mode
    from auto_mode import AutoMode
    global auto_mode_engine
    auto_mode_engine = AutoMode()

    # Model manager
    global model_manager
    from model_manager import ModelManager
    model_manager = ModelManager(str(Path(__file__).parent / "models"), on_notify=push_notification)
    print(f"  Model manager: {len(model_manager.list_models())} models available")

    # Web search
    global web_search_engine
    try:
        from web_search import WebSearch
        web_search_engine = WebSearch()
        print("  Web search: ready (DuckDuckGo)")
    except Exception as e:
        print(f"  Web search: disabled ({e})")

    # Skills engine (shares embedder with RAG)
    global skill_engine
    if rag_engine and hasattr(rag_engine, 'embedder'):
        try:
            from skills import SkillEngine
            skill_engine = SkillEngine(rag_engine.embedder)
        except Exception as e:
            print(f"  Skills: disabled ({e})")

    # Knowledge Gallery
    global gallery_manager
    if rag_engine and hasattr(rag_engine, 'embedder'):
        try:
            from knowledge_gallery import KnowledgeGalleryManager
            packs_dir = str(Path(__file__).parent / "knowledge_packs")
            def _rebuild_rag():
                if rag_engine and gallery_manager:
                    rag_engine.rebuild_composite_index(gallery_manager)
                # Rebuild graph in background (non-blocking)
                import threading
                threading.Thread(target=_rebuild_graph, daemon=True).start()
            gallery_manager = KnowledgeGalleryManager(packs_dir, rag_engine.embedder, on_notify=push_notification, on_complete=_rebuild_rag)
            enabled = sum(1 for p in gallery_manager.list_packs() if p["enabled"])
            total_packs = len(gallery_manager.list_packs())
            if enabled > 0:
                count = rag_engine.rebuild_composite_index(gallery_manager)
                print(f"  Knowledge Gallery: {enabled}/{total_packs} packs enabled, {count} total chunks")
            else:
                print(f"  Knowledge Gallery: {total_packs} packs available")
        except Exception as e:
            print(f"  Knowledge Gallery: disabled ({e})")

    # Graph RAG (Approach B — embedding-based entity graph)
    global graph_rag
    if rag_engine:
        try:
            from graph_rag import GraphRAG
            # Check if pre-built index files exist
            idx_files = list(Path(".").glob("*_index.json"))
            if idx_files:
                graph_rag = GraphRAG(rag_engine, graph_index_dir=".")
                stats = graph_rag.get_stats()
                print(f"  Knowledge Graph: {stats['entities']} entities, {stats['edges']} edges (loaded from index)")
            else:
                print(f"  Knowledge Graph: no index found — run re-embed or install a pack to build")
                graph_rag = GraphRAG(rag_engine, graph_index_dir=".")  # empty but ready
        except Exception as e:
            print(f"  Knowledge Graph: disabled ({e})")

    # Speech-to-Text
    try:
        from stt import SpeechToText
        stt_engine = SpeechToText(model_size="tiny")
    except Exception as e:
        print(f"  {DIM}STT: disabled ({e}){RESET}")

    # Text-to-Speech
    try:
        from tts import TextToSpeech
        tts_engine = TextToSpeech()
    except Exception as e:
        print(f"  {DIM}TTS: disabled ({e}){RESET}")

    # OCR
    try:
        from ocr import OCREngine
        ocr_engine = OCREngine()
    except Exception as e:
        print(f"  {DIM}OCR: disabled ({e}){RESET}")

    # Image Classification
    try:
        from image_classifier import ImageClassifier
        img_classifier = ImageClassifier()
    except Exception as e:
        print(f"  {DIM}Image classifier: disabled ({e}){RESET}")

    print(f"\nServer ready. Components loaded:")
    print(f"  Fast-Path:    ready")
    print(f"  Compute-Path: {'ready' if compute_path else 'disabled'}")
    print(f"  RAG:          {rag_engine.doc_count if rag_engine else 0} chunks")
    print(f"  Cache:        {response_cache.stats()['entries']} entries")
    print(f"  STT:          {'ready' if stt_engine else 'disabled'}")
    print(f"  TTS:          {'ready' if tts_engine else 'disabled'}")
    print(f"  OCR:          {'ready' if ocr_engine else 'disabled'}")
    print(f"  Image CLF:    {'ready' if img_classifier else 'disabled'}")
    print(f"  API Keys:     {len([k for k in key_manager.list_keys() if k['is_active']])} active\n")

    push_notification(
        "INFO", "Server started",
        f"EdgeWord ready — {rag_engine.doc_count if rag_engine else 0} knowledge chunks, "
        f"model: {Path(compute_path.model_path).stem if compute_path else 'none'}.",
        "", "info",
    )

    yield

    # Cleanup
    if response_cache:
        response_cache.close()
    if key_manager:
        key_manager.close()


# --- App ---
app = FastAPI(
    title="EdgeWord NLP API",
    description="CPU-native NLP pipeline — classification + generation + RAG",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    t0 = time.time()
    response = await call_next(request)
    dt = round((time.time() - t0) * 1000)
    path = request.url.path
    if path not in ("/v1/health", "/v1/logs"):  # Skip noisy endpoints
        _app_log.info(f"{request.method} {path} → {response.status_code} ({dt}ms)")
    return response


# Global exception handler — return explicit error details instead of generic 500
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    tb = traceback.format_exc()
    print(f"\n!!! UNHANDLED ERROR: {exc}\n{tb}")
    return fastapi.responses.JSONResponse(
        status_code=500,
        content={
            "detail": str(exc),
            "type": type(exc).__name__,
            "path": str(request.url.path),
        },
    )

import fastapi.responses


# --- Endpoints ---

@app.get("/v1/health", response_model=HealthResponse)
async def health():
    """Health check — no auth required."""
    return HealthResponse(
        status="healthy",
        fast_path=fast_path is not None,
        compute_path=compute_path is not None,
        rag_chunks=rag_engine.doc_count if rag_engine else 0,
        cache_entries=response_cache.stats()["entries"] if response_cache else 0,
        model=os.path.basename(compute_path.model_path) if compute_path else None,
        uptime_s=round(time.time() - start_time, 1),
    )


@app.get("/v1/logs")
async def get_logs(
    auth: dict = Depends(verify_auth),
    after: int = 0,
    level: str = "",
    source: str = "",
    search: str = "",
    limit: int = 200,
):
    """Get recent logs with optional filtering. Supports long-polling via 'after' param."""
    logs = list(_log_buffer)
    if after > 0:
        logs = [l for l in logs if l["id"] > after]
    if level:
        levels = set(level.upper().split(","))
        logs = [l for l in logs if l["level"] in levels]
    if source:
        logs = [l for l in logs if source.lower() in l["source"].lower()]
    if search:
        s = search.lower()
        logs = [l for l in logs if s in l["message"].lower()]
    logs = logs[-limit:]
    return {"logs": logs, "total": len(_log_buffer)}


class AuthRequest(BaseModel):
    username: str = Field(..., min_length=3)
    password: str = Field(..., min_length=6)
    display_name: str = Field("")


@app.post("/v1/auth/register")
async def register(req: AuthRequest):
    """Register a new user account."""
    try:
        user = user_manager.register(req.username, req.password, req.display_name)
        token = user_manager.login(req.username, req.password)
        return {"token": token, "user": user}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/v1/auth/login")
async def login(req: AuthRequest):
    """Login and receive a JWT token."""
    try:
        token = user_manager.login(req.username, req.password)
        return {"token": token}
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))


@app.get("/v1/auth/me")
async def me(auth: dict = Depends(verify_auth)):
    """Get current user info from token."""
    return {"username": auth.get("username", ""), "name": auth.get("name", ""), "auth_type": auth.get("auth_type", "")}


# ── Conversation persistence endpoints ──

@app.get("/v1/conversation")
async def get_conversation(auth: dict = Depends(verify_auth)):
    """Load persisted conversation for current user."""
    uid = auth.get("sub") or auth.get("user_id", "anonymous")
    messages = conv_store.get_messages(uid)
    sections = conv_store.get_sections(uid)
    settings = conv_store.get_settings(uid)
    return {"messages": messages, "sections": sections, "settings": settings}


@app.post("/v1/conversation/message")
async def save_message(request: Request, auth: dict = Depends(verify_auth)):
    """Save a single message to the conversation."""
    uid = auth.get("sub") or auth.get("user_id", "anonymous")
    body = await request.json()
    conv_store.save_message(uid, body)
    return {"status": "saved"}


@app.post("/v1/conversation/section")
async def save_section(request: Request, auth: dict = Depends(verify_auth)):
    """Save a conversation section/summary."""
    uid = auth.get("sub") or auth.get("user_id", "anonymous")
    body = await request.json()
    conv_store.save_section(uid, body)
    return {"status": "saved"}


@app.post("/v1/conversation/settings")
async def save_settings(request: Request, auth: dict = Depends(verify_auth)):
    """Save user settings (max_tokens, temperature)."""
    uid = auth.get("sub") or auth.get("user_id", "anonymous")
    body = await request.json()
    conv_store.save_settings(uid, body)
    return {"status": "saved"}


@app.delete("/v1/conversation")
async def clear_conversation(auth: dict = Depends(verify_auth)):
    """Clear all messages and sections for current user."""
    uid = auth.get("sub") or auth.get("user_id", "anonymous")
    conv_store.clear_messages(uid)
    return {"status": "cleared"}


# ── Profile endpoints ──

@app.get("/v1/profile")
async def get_profile(auth: dict = Depends(verify_auth)):
    """Get current user's profile."""
    uid = auth.get("sub") or auth.get("user_id", "")
    profile = user_manager.get_profile(uid)
    return profile or {"error": "not found"}


@app.put("/v1/profile")
async def update_profile(request: Request, auth: dict = Depends(verify_auth)):
    """Update current user's profile (display_name, email, theme, accent)."""
    uid = auth.get("sub") or auth.get("user_id", "")
    body = await request.json()
    profile = user_manager.update_profile(uid, body)
    return profile


# ── Knowledge (docs) endpoints ──

@app.get("/v1/knowledge")
async def list_knowledge(auth: dict = Depends(verify_auth)):
    """List all indexed documents in the RAG knowledge base."""
    if not rag_engine or not rag_engine.chunks:
        return {"documents": [], "total_chunks": 0}
    # Group chunks by source
    sources: dict = {}
    for c in rag_engine.chunks:
        src = c["source"]
        if src not in sources:
            sources[src] = {"name": src, "chunks": 0}
        sources[src]["chunks"] += 1
    return {"documents": list(sources.values()), "total_chunks": rag_engine.doc_count}


@app.post("/v1/knowledge/upload")
async def upload_knowledge(
    file: UploadFile = File(...),
    auth: dict = Depends(verify_auth),
):
    """Upload a document to the knowledge base (./docs/)."""
    docs_dir = Path(__file__).parent / "docs"
    docs_dir.mkdir(exist_ok=True)
    dest = docs_dir / file.filename
    content = await file.read()
    dest.write_bytes(content)
    # Re-index if RAG engine exists
    if rag_engine:
        count = rag_engine.load_directory(str(docs_dir))
        # Rebuild composite index to include knowledge packs
        if gallery_manager:
            rag_engine.rebuild_composite_index(gallery_manager)
        # Update graph with new user docs in background
        import threading
        threading.Thread(target=_rebuild_graph, daemon=True).start()
        push_notification(
            "SUCCESS", "Knowledge indexed",
            f"{file.filename} uploaded — {count} chunks indexed. Graph updating.",
            "knowledge-full", "upload",
        )
        return {"status": "uploaded", "file": file.filename, "size": len(content), "total_chunks": count}
    push_notification(
        "INFO", "File uploaded",
        f"{file.filename} saved. Restart server to index.",
        "knowledge-full", "upload",
    )
    return {"status": "uploaded", "file": file.filename, "size": len(content), "note": "restart server to index"}


@app.delete("/v1/knowledge/{filename}")
async def delete_knowledge(filename: str, auth: dict = Depends(verify_auth)):
    """Delete a document from the knowledge base."""
    docs_dir = Path(__file__).parent / "docs"
    target = docs_dir / filename
    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found")
    target.unlink()
    # Re-index
    if rag_engine:
        rag_engine.load_directory(str(docs_dir))
    push_notification(
        "INFO", "Document removed",
        f"{filename} deleted from knowledge base.",
        "knowledge-full", "delete",
    )
    return {"status": "deleted", "file": filename}


# ── Notifications pipeline (SQLite-persisted) ──

import sqlite3

_notif_db_path = str(Path(__file__).parent / "notifications.db")
_notif_lock = threading.Lock()


def _notif_db():
    """Get a thread-local SQLite connection."""
    conn = sqlite3.connect(_notif_db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT DEFAULT '',
        link TEXT DEFAULT '',
        icon TEXT DEFAULT '',
        read INTEGER DEFAULT 0,
        timestamp REAL NOT NULL
    )""")
    conn.commit()
    return conn


# Init DB on import
_notif_db().close()


def push_notification(
    type: str,       # SUCCESS, ERROR, INFO, WARNING
    title: str,
    body: str,
    link: str = "",
    icon: str = "",
):
    """Push a notification to the persistent store."""
    with _notif_lock:
        conn = _notif_db()
        conn.execute(
            "INSERT INTO notifications (type, title, body, link, icon, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            (type, title, body, link, icon, time.time()),
        )
        # Keep last 200
        conn.execute("DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT 200)")
        conn.commit()
        conn.close()


@app.get("/v1/notifications")
async def get_notifications(auth: dict = Depends(verify_auth)):
    """Get all notifications (newest first) + active operations."""
    with _notif_lock:
        conn = _notif_db()
        rows = conn.execute("SELECT * FROM notifications ORDER BY id DESC LIMIT 100").fetchall()
        unread = conn.execute("SELECT COUNT(*) FROM notifications WHERE read = 0").fetchone()[0]
        conn.close()

    notifications = [dict(r) for r in rows]

    # Gather active operations
    operations = []
    if model_manager:
        for mid, prog in dict(model_manager.downloading).items():
            from model_manager import AVAILABLE_MODELS
            name = AVAILABLE_MODELS.get(mid, {}).get("name", mid)
            operations.append({
                "id": f"dl-{mid}",
                "type": "download",
                "title": f"Downloading {name}",
                "percent": prog.get("percent", 0),
                "downloaded_mb": prog.get("downloaded_mb", 0),
                "total_mb": prog.get("total_mb", 0),
                "speed_mbps": prog.get("speed_mbps", 0),
                "status": prog.get("status", "downloading"),
                "link": "model",
            })

    # Gallery installs
    if gallery_manager:
        for pid, prog in dict(gallery_manager.installing).items():
            phase = prog.get("phase", "downloading")
            phase_label = {"downloading": "Downloading", "extracting": "Extracting", "embedding": "Embedding", "saving": "Saving"}.get(phase, phase.title())
            operations.append({
                "id": f"gallery-{pid}",
                "type": "knowledge_install",
                "title": f"Installing {prog.get('name', pid)}",
                "percent": prog.get("percent", 0),
                "phase": phase,
                "phase_label": phase_label,
                "detail": prog.get("detail", ""),
                "status": prog.get("status", "processing"),
                "link": "knowledge-full",
            })

    # Re-embed operation
    if _reembed_progress and _reembed_progress.get("status") == "processing":
        operations.append({
            "id": "reembed",
            "type": "reembed",
            "title": f"Re-embedding with {_reembed_progress.get('model', '?')}",
            "percent": _reembed_progress.get("percent", 0),
            "phase": _reembed_progress.get("phase", ""),
            "phase_label": _reembed_progress.get("current_pack", "Processing"),
            "detail": _reembed_progress.get("detail", ""),
            "status": "processing",
            "link": "model",
        })

    return {"notifications": notifications, "unread": unread, "operations": operations}


@app.post("/v1/notifications/read")
async def mark_notifications_read(auth: dict = Depends(verify_auth)):
    """Mark all notifications as read."""
    with _notif_lock:
        conn = _notif_db()
        conn.execute("UPDATE notifications SET read = 1 WHERE read = 0")
        conn.commit()
        conn.close()
    return {"status": "ok"}


@app.delete("/v1/notifications")
async def clear_notifications(auth: dict = Depends(verify_auth)):
    """Clear all notifications."""
    with _notif_lock:
        conn = _notif_db()
        conn.execute("DELETE FROM notifications")
        conn.commit()
        conn.close()
    return {"status": "cleared"}


# ── API Keys management via API ──

@app.get("/v1/keys")
async def list_keys(auth: dict = Depends(verify_auth)):
    """List all API keys."""
    keys = key_manager.list_keys()
    return {"keys": keys}


@app.post("/v1/keys")
async def create_key(request: Request, auth: dict = Depends(verify_auth)):
    """Create a new API key."""
    body = await request.json()
    name = body.get("name", "unnamed")
    rate_limit = body.get("rate_limit", 60)
    raw_key = key_manager.create_key(name, rate_limit)
    return {"key": raw_key, "name": name, "rate_limit": rate_limit}


@app.delete("/v1/keys/{key_prefix}")
async def revoke_key(key_prefix: str, auth: dict = Depends(verify_auth)):
    """Revoke an API key by prefix."""
    if key_manager.revoke_key(key_prefix):
        return {"status": "revoked"}
    raise HTTPException(status_code=404, detail="Key not found")


# ── Model management endpoints ──

model_manager = None

@app.get("/v1/models")
async def list_models(auth: dict = Depends(verify_auth)):
    """List all available models with installed status."""
    if not model_manager:
        return {"models": [], "active": None}
    models = model_manager.list_models()
    active = os.path.basename(compute_path.model_path) if compute_path else None
    return {"models": models, "active": active}


@app.post("/v1/models/{model_id}/download")
async def download_model(model_id: str, auth: dict = Depends(verify_auth)):
    """Download a model from HuggingFace."""
    if not model_manager:
        raise HTTPException(status_code=503, detail="Model manager not available")
    try:
        result = model_manager.download(model_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/models/{model_id}/progress")
async def model_progress(model_id: str, auth: dict = Depends(verify_auth)):
    """Get download progress for a model."""
    if not model_manager:
        return {"status": "not_available"}
    progress = model_manager.get_download_progress(model_id)
    if not progress:
        return {"status": "not_downloading"}
    return progress


@app.post("/v1/models/{model_id}/activate")
async def activate_model(model_id: str, auth: dict = Depends(verify_auth)):
    """Switch the active model."""
    if not model_manager or not compute_path:
        raise HTTPException(status_code=503, detail="Model manager not available")
    try:
        with _llm_lock:
            result = model_manager.switch_model(model_id, compute_path)
        push_notification(
            "SUCCESS", f"Switched to {result.get('model', model_id)}",
            "Model loaded and ready for inference.",
            "model", "switch",
        )
        return result
    except Exception as e:
        push_notification(
            "ERROR", f"Model switch failed",
            str(e), "model", "error",
        )
        raise HTTPException(status_code=500, detail=str(e))


# ── Skills management endpoints ──

@app.get("/v1/skills")
async def list_skills(auth: dict = Depends(verify_auth)):
    """List all skills (built-in + custom)."""
    if not skill_engine:
        return {"skills": [], "total": 0}
    skills = skill_engine.list_all()
    return {"skills": skills, "total": len(skills)}


@app.post("/v1/skills")
async def create_skill(request: Request, auth: dict = Depends(verify_auth)):
    """Create a custom skill."""
    if not skill_engine:
        raise HTTPException(status_code=503, detail="Skills engine not available")
    body = await request.json()
    for field in ["name", "description", "system_prompt"]:
        if not body.get(field):
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
    try:
        result = skill_engine.create_skill(body)
        push_notification("SUCCESS", f"Skill created: {body['name']}", body["description"][:80], "", "info")
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/v1/skills/{skill_id}")
async def update_skill(skill_id: str, request: Request, auth: dict = Depends(verify_auth)):
    """Update a custom skill."""
    if not skill_engine:
        raise HTTPException(status_code=503, detail="Skills engine not available")
    body = await request.json()
    try:
        return skill_engine.update_skill(skill_id, body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/v1/skills/{skill_id}")
async def delete_skill(skill_id: str, auth: dict = Depends(verify_auth)):
    """Delete a custom skill."""
    if not skill_engine:
        raise HTTPException(status_code=503, detail="Skills engine not available")
    try:
        result = skill_engine.delete_skill(skill_id)
        push_notification("INFO", "Skill deleted", f"Skill '{skill_id}' removed.", "", "delete")
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/v1/skills/{skill_id}/toggle")
async def toggle_skill(skill_id: str, request: Request, auth: dict = Depends(verify_auth)):
    """Enable or disable a custom skill."""
    if not skill_engine:
        raise HTTPException(status_code=503, detail="Skills engine not available")
    body = await request.json()
    try:
        return skill_engine.toggle_skill(skill_id, body.get("enabled", True))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Embedding model endpoints ──

@app.get("/v1/embeddings")
async def list_embedding_models(auth: dict = Depends(verify_auth)):
    """List available embedding models with active status."""
    from rag import EMBEDDING_MODELS, get_configured_model
    active = rag_engine.embedder.model_id if rag_engine else get_configured_model()
    models = []
    for mid, info in EMBEDDING_MODELS.items():
        models.append({
            "id": mid,
            "name": info["name"],
            "dims": info["dims"],
            "description": info["description"],
            "size": info["size"],
            "quality": info["quality"],
            "speed": info["speed"],
            "active": mid == active,
            "available": info.get("available", True),
        })
    return {"models": models, "active": active}


_reembed_progress: dict | None = None  # global progress tracker for re-embed operation


def _rebuild_graph():
    """Rebuild the entity graph from all installed knowledge packs.
    Called after re-embedding, pack install/uninstall, embedding model switch."""
    global graph_rag
    if not rag_engine or not gallery_manager:
        return
    try:
        from graph_rag import EntityGraphBuilder, GraphRAG
        import shutil
        # Clear old graph
        graph_path = str(Path(__file__).parent / "knowledge_graph")
        for f in Path(".").glob("*_index.json"):
            f.unlink()
        if Path(graph_path).exists():
            shutil.rmtree(graph_path)

        builder = EntityGraphBuilder(rag_engine.embedder, db_path=graph_path, min_freq=3)

        from knowledge_gallery import GALLERY_PACKS
        for pid in GALLERY_PACKS:
            meta = gallery_manager._load_meta(pid)
            if not meta or not meta.get("enabled"):
                continue
            cp = gallery_manager.packs_dir / pid / "chunks.jsonl"
            if not cp.exists():
                continue
            chunks = [json.loads(l) for l in open(cp) if l.strip()]
            if chunks:
                builder.build_from_chunks(chunks, pack_id=pid)

        # Also process user docs
        if rag_engine._user_chunks:
            builder.build_from_chunks(rag_engine._user_chunks, pack_id="user_docs")

        # Reload graph index
        graph_rag = GraphRAG(rag_engine, graph_index_dir=".")
        _app_log.info(f"Graph rebuilt: {graph_rag.get_stats()}")
    except Exception as e:
        _app_log.error(f"Graph rebuild failed: {e}")


@app.post("/v1/embeddings/reembed")
async def reembed_all(auth: dict = Depends(verify_auth)):
    """Re-embed all knowledge packs with the current embedding model. Runs in background."""
    global _reembed_progress
    if not rag_engine or not gallery_manager:
        raise HTTPException(status_code=503, detail="RAG or gallery not available")
    if _reembed_progress and _reembed_progress.get("status") == "processing":
        return {"status": "already_running"}

    model_name = rag_engine.embedder.model_id
    from rag import EMBEDDING_MODELS
    model_info = EMBEDDING_MODELS.get(model_name, {})

    _reembed_progress = {
        "status": "processing",
        "phase": "starting",
        "percent": 0,
        "detail": "Preparing...",
        "current_pack": "",
        "packs_done": 0,
        "packs_total": 0,
        "chunks_done": 0,
        "chunks_total": 0,
        "model": model_info.get("name", model_name),
    }

    def _reembed():
        global _reembed_progress
        try:
            from knowledge_gallery import GALLERY_PACKS
            installed = [(pid, gallery_manager._load_meta(pid)) for pid in GALLERY_PACKS if gallery_manager._load_meta(pid)]
            total_packs = len(installed)
            _reembed_progress["packs_total"] = total_packs

            # Count total chunks
            total_chunks = 0
            for pid, meta in installed:
                chunks_path = gallery_manager.packs_dir / pid / "chunks.jsonl"
                if chunks_path.exists():
                    total_chunks += sum(1 for line in open(chunks_path) if line.strip())
            _reembed_progress["chunks_total"] = total_chunks

            chunks_done = 0
            for pack_idx, (pid, meta) in enumerate(installed):
                pack_dir = gallery_manager.packs_dir / pid
                chunks_path = pack_dir / "chunks.jsonl"
                if not chunks_path.exists():
                    continue

                pack_name = GALLERY_PACKS.get(pid, {}).get("name", pid)
                _reembed_progress.update({
                    "phase": "embedding",
                    "current_pack": pack_name,
                    "detail": f"Embedding {pack_name}...",
                })

                chunks = []
                with open(chunks_path) as f:
                    for line in f:
                        if line.strip():
                            chunks.append(json.loads(line))
                if not chunks:
                    continue

                texts = [c["text"] for c in chunks]
                all_emb = []
                with gallery_manager._lock:
                    for i in range(0, len(texts), 32):
                        all_emb.append(rag_engine.embedder.embed(texts[i:i+32]))
                        chunks_done += min(32, len(texts) - i)
                        pct = round((chunks_done / total_chunks) * 90) if total_chunks > 0 else 0
                        _reembed_progress.update({
                            "percent": pct,
                            "chunks_done": chunks_done,
                            "detail": f"Embedding {pack_name} — {chunks_done}/{total_chunks} chunks",
                        })

                embeddings = np.vstack(all_emb)
                np.save(pack_dir / "embeddings.npy", embeddings)
                meta["embedding_model"] = model_name
                gallery_manager._save_meta(pid, meta)
                _reembed_progress["packs_done"] = pack_idx + 1

            # Re-embed user docs
            _reembed_progress.update({"percent": 92, "phase": "user_docs", "detail": "Re-indexing user documents..."})
            docs_dir = Path(__file__).parent / "docs"
            if docs_dir.exists():
                rag_engine.load_directory(str(docs_dir))

            _reembed_progress.update({"percent": 93, "phase": "rebuilding", "detail": "Rebuilding composite index..."})
            rag_engine.rebuild_composite_index(gallery_manager)

            _reembed_progress.update({"percent": 96, "phase": "graph", "detail": "Rebuilding knowledge graph..."})
            _rebuild_graph()

            _reembed_progress.update({"status": "complete", "percent": 100, "detail": "Done!"})
            push_notification(
                "SUCCESS", "Re-embedding complete",
                f"{total_packs} packs + user docs re-embedded with {model_info.get('name', model_name)}. "
                f"Total: {rag_engine.doc_count} chunks.",
                "knowledge-full", "index",
            )
            time.sleep(5)
            _reembed_progress = None

        except Exception as e:
            _reembed_progress = {"status": "error", "detail": str(e)}
            push_notification("ERROR", "Re-embedding failed", str(e), "knowledge-full", "error")
            time.sleep(5)
            _reembed_progress = None

    import threading
    threading.Thread(target=_reembed, daemon=True).start()
    push_notification("INFO", "Re-embedding started", f"Re-embedding all content with {model_info.get('name', model_name)}...", "knowledge-full", "index")
    return {"status": "started", "model": model_name}


@app.get("/v1/embeddings/reembed/progress")
async def reembed_progress(auth: dict = Depends(verify_auth)):
    """Get re-embed progress."""
    if not _reembed_progress:
        return {"status": "idle"}
    return _reembed_progress


@app.post("/v1/embeddings/{model_id}/activate")
async def activate_embedding_model(model_id: str, auth: dict = Depends(verify_auth)):
    """Switch the embedding model. Re-embeds all docs and knowledge packs."""
    from rag import EMBEDDING_MODELS, set_configured_model, ONNXEmbedder
    if model_id not in EMBEDDING_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown embedding model: {model_id}")

    global rag_engine, skill_engine, gallery_manager
    if not rag_engine:
        raise HTTPException(status_code=503, detail="RAG engine not available")

    current = rag_engine.embedder.model_id
    if current == model_id:
        return {"status": "already_active", "model": model_id}

    try:
        info = EMBEDDING_MODELS[model_id]
        push_notification("INFO", f"Switching to {info['name']}", "Downloading model and re-embedding all content...", "model", "switch")

        # Load new embedder
        new_embedder = ONNXEmbedder(model_id)
        rag_engine.embedder = new_embedder
        set_configured_model(model_id)

        # Re-embed user docs
        docs_dir = Path(__file__).parent / "docs"
        if docs_dir.exists():
            rag_engine.load_directory(str(docs_dir))

        # Update skill engine embedder
        if skill_engine:
            from skills import SkillEngine
            skill_engine = SkillEngine(new_embedder)

        # Update gallery manager embedder + re-embed installed packs
        if gallery_manager:
            gallery_manager.embedder = new_embedder
            # Re-embed each installed pack
            from knowledge_gallery import GALLERY_PACKS
            for pack_id in GALLERY_PACKS:
                meta = gallery_manager._load_meta(pack_id)
                if not meta:
                    continue
                pack_dir = gallery_manager.packs_dir / pack_id
                chunks_path = pack_dir / "chunks.jsonl"
                if not chunks_path.exists():
                    continue
                # Load chunks and re-embed
                chunks = []
                with open(chunks_path) as f:
                    for line in f:
                        if line.strip():
                            chunks.append(json.loads(line))
                if chunks:
                    texts = [c["text"] for c in chunks]
                    all_emb = []
                    for i in range(0, len(texts), 32):
                        all_emb.append(new_embedder.embed(texts[i:i+32]))
                    embeddings = np.vstack(all_emb)
                    np.save(pack_dir / "embeddings.npy", embeddings)

            # Rebuild composite index + graph
            rag_engine.rebuild_composite_index(gallery_manager)
            _rebuild_graph()

        push_notification("SUCCESS", f"Switched to {info['name']}", f"All content re-embedded with {info['dims']}-dim vectors. Graph rebuilt.", "model", "switch")
        return {"status": "switched", "model": model_id, "dims": info["dims"], "total_chunks": rag_engine.doc_count}

    except Exception as e:
        push_notification("ERROR", "Embedding switch failed", str(e), "model", "error")
        raise HTTPException(status_code=500, detail=str(e))


# ── Knowledge Gallery endpoints ──

@app.get("/v1/gallery")
async def list_gallery(auth: dict = Depends(verify_auth)):
    """List all knowledge gallery packs with install/enable status."""
    if not gallery_manager:
        return {"packs": [], "total_chunks": 0}
    packs = gallery_manager.list_packs()
    total = sum(p["chunk_count"] for p in packs if p["enabled"])
    return {"packs": packs, "total_chunks": total}


@app.post("/v1/gallery/{pack_id}/install")
async def install_gallery_pack(pack_id: str, auth: dict = Depends(verify_auth)):
    """Start installing a knowledge pack (background download + processing)."""
    if not gallery_manager:
        raise HTTPException(status_code=503, detail="Gallery not available")
    try:
        result = gallery_manager.install_pack(pack_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/v1/gallery/{pack_id}")
async def uninstall_gallery_pack(pack_id: str, auth: dict = Depends(verify_auth)):
    """Uninstall a knowledge pack (delete all data)."""
    if not gallery_manager:
        raise HTTPException(status_code=503, detail="Gallery not available")
    result = gallery_manager.uninstall_pack(pack_id)
    if rag_engine:
        rag_engine.rebuild_composite_index(gallery_manager)
    # Remove pack graph index and rebuild
    idx_file = Path(f"./knowledge_graph_{pack_id}_index.json")
    if idx_file.exists():
        idx_file.unlink()
    if graph_rag:
        import threading
        threading.Thread(target=_rebuild_graph, daemon=True).start()
    push_notification("INFO", "Knowledge pack removed", f"Pack uninstalled. Graph updated.", "knowledge-full", "delete")
    return result


@app.post("/v1/gallery/{pack_id}/toggle")
async def toggle_gallery_pack(pack_id: str, request: Request, auth: dict = Depends(verify_auth)):
    """Enable or disable an installed knowledge pack."""
    if not gallery_manager:
        raise HTTPException(status_code=503, detail="Gallery not available")
    body = await request.json()
    enabled = body.get("enabled", True)
    try:
        result = gallery_manager.toggle_pack(pack_id, enabled)
        if rag_engine:
            count = rag_engine.rebuild_composite_index(gallery_manager)
            result["total_chunks"] = count
        # Rebuild graph in background
        import threading
        threading.Thread(target=_rebuild_graph, daemon=True).start()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/gallery/{pack_id}/progress")
async def gallery_pack_progress(pack_id: str, auth: dict = Depends(verify_auth)):
    """Get install progress for a knowledge pack."""
    if not gallery_manager:
        return {"status": "not_available"}
    progress = gallery_manager.get_progress(pack_id)
    if not progress:
        return {"status": "not_installing"}
    return progress


@app.post("/v1/classify", response_model=ClassifyResponse)
async def classify(req: ClassifyRequest, auth: dict = Depends(verify_api_key)):
    """Classify sentiment of a single text."""
    import numpy as np

    t0 = time.perf_counter()
    label, confidence, probs = fast_path._infer(req.text)
    ms = (time.perf_counter() - t0) * 1000

    scores = {fast_path.id2label.get(i, str(i)): float(p) for i, p in enumerate(probs)}

    key_manager.log_usage(auth.get("key", "jwt"), "/v1/classify", tokens=0, latency_ms=ms)

    return ClassifyResponse(
        result=SentimentResult(
            label=label,
            confidence=confidence,
            scores=scores,
            latency_ms=round(ms, 2),
        )
    )


@app.post("/v1/classify/batch", response_model=ClassifyBatchResponse)
async def classify_batch(req: ClassifyBatchRequest, auth: dict = Depends(verify_api_key)):
    """Classify sentiment of multiple texts."""
    t0 = time.perf_counter()
    results = []
    for text in req.texts:
        t1 = time.perf_counter()
        label, confidence, probs = fast_path._infer(text)
        ms = (time.perf_counter() - t1) * 1000
        scores = {fast_path.id2label.get(i, str(i)): float(p) for i, p in enumerate(probs)}
        results.append(SentimentResult(
            label=label, confidence=confidence, scores=scores, latency_ms=round(ms, 2)
        ))

    total_ms = (time.perf_counter() - t0) * 1000
    key_manager.log_usage(auth.get("key", "jwt"), "/v1/classify/batch", tokens=0, latency_ms=total_ms)

    return ClassifyBatchResponse(results=results, total_ms=round(total_ms, 2))


@app.post("/v1/chat/stream")
async def chat_stream(req: ChatRequest, auth: dict = Depends(verify_auth)):
    """Streaming chat — SSE endpoint that streams tokens as they generate."""
    if compute_path is None:
        raise HTTPException(status_code=503, detail="Compute-Path not available")

    from fastapi.responses import StreamingResponse
    import json as _json

    # Classify sentiment
    t0 = time.perf_counter()
    label, confidence, probs = fast_path._infer(req.message)
    cls_ms = (time.perf_counter() - t0) * 1000
    scores = {fast_path.id2label.get(i, str(i)): float(p) for i, p in enumerate(probs)}
    sentiment = {"label": label, "confidence": confidence, "scores": scores, "latency_ms": round(cls_ms, 2)}

    # Tools
    tool_result = ""
    if req.use_tools and auto_tools:
        result = auto_tools.run(req.message)
        if result:
            tool_result = result

    # Route query to optimal strategy
    route = {"strategy": "rag"}
    if auto_mode_engine:
        route = auto_mode_engine.route(req.message, has_rag=bool(rag_engine), has_knowledge_packs=bool(gallery_manager))

    # RAG — hybrid retrieval with optional query decomposition (skip for simple greetings)
    rag_context = ""
    rag_sources = []
    results = []
    if req.use_rag and rag_engine and route["strategy"] != "simple":
        # Use graph-augmented retrieval for complex queries
        if graph_rag and graph_rag.has_graph:
            results = graph_rag.retrieve(req.message, top_k=5)
        else:
            results = rag_engine.retrieve(req.message, top_k=3)
        has_good_results = results and results[0].get("dense_score", results[0].get("score", 0)) > 0.25

        # Additional multi-hop decomposition for complex queries
        if route["strategy"] == "reasoning" and has_good_results:
            # Quick decomposition via keyword extraction — no LLM call needed
            import re as _re
            # Extract noun phrases / key terms for sub-queries
            words = req.message.split()
            if len(words) > 8:
                # Split on conjunctions and question marks for sub-queries
                sub_parts = _re.split(r'\band\b|\bbut\b|\balso\b|\?', req.message)
                sub_parts = [s.strip() for s in sub_parts if len(s.strip()) > 10]
                if len(sub_parts) > 1:
                    all_results = list(results)  # start with original results
                    seen = set(r["text"][:80] for r in results)
                    for sub_q in sub_parts[:3]:
                        sub_results = rag_engine.retrieve(sub_q, top_k=2)
                        for r in sub_results:
                            key = r["text"][:80]
                            if key not in seen:
                                seen.add(key)
                                all_results.append(r)
                    results = all_results[:6]  # Cap at 6 chunks for context

        if results and results[0].get("dense_score", results[0].get("score", 0)) > 0.25:
            rag_context = rag_engine.format_context(results)
            rag_sources = list(set(r["source"] for r in results))

    # Auto-mode
    auto_profile = None
    gen_temp = req.temperature
    gen_top_p = req.top_p
    gen_top_k = req.top_k
    gen_rep = req.repeat_penalty
    gen_max = req.max_tokens
    if req.auto_mode and auto_mode_engine and compute_path:
        auto_params = auto_mode_engine.classify(req.message, compute_path.llm)
        auto_profile = auto_params.get("profile")
        gen_temp = auto_params.get("temperature", gen_temp)
        gen_top_p = auto_params.get("top_p", gen_top_p)
        gen_top_k = auto_params.get("top_k", gen_top_k)
        gen_rep = auto_params.get("repeat_penalty", gen_rep)
        gen_max = auto_params.get("max_tokens", gen_max)

    # Skills
    skill_name = None
    effective_system = req.system_prompt
    if skill_engine:
        matched_skill = skill_engine.match(req.message)
        if matched_skill:
            skill_name = matched_skill["name"]
            effective_system = skill_engine.apply(matched_skill, req.system_prompt)

    # For complex queries with RAG context, enhance the system prompt with grounding instructions
    if route["strategy"] == "reasoning" and rag_context:
        grounding = (
            "\n\nIMPORTANT: Base your answer strictly on the retrieved documents below. "
            "Cite specific facts from the sources. If the documents don't contain enough "
            "information, say so honestly rather than guessing."
        )
        effective_system = (effective_system or "") + grounding

    # Web search
    web_results = []
    web_suggest = False
    if req.use_web and web_search_engine:
        web_results = web_search_engine.search(req.message, max_results=5)
        if web_results:
            web_context = web_search_engine.format_for_llm(web_results)
            effective_system = (effective_system or "") + "\n\n" + web_context
            web_results = web_search_engine.format_for_display(web_results)
    elif web_search_engine and not req.use_web:
        web_suggest = web_search_engine.should_search(req.message)

    prompt = compute_path._build_prompt(req.message, rag_context=rag_context, tool_result=tool_result, system_prompt=effective_system)

    import asyncio, queue, threading

    q: queue.Queue = queue.Queue()

    def _generate_in_thread():
        _llm_lock.acquire()
        try:
            _kg = _detect_knowledge_gap(req.message, results if req.use_rag and rag_engine else [], bool(rag_context))
            q.put(f"data: {_json.dumps({'type':'meta','sentiment':sentiment,'tool_result':tool_result or None,'rag_sources':rag_sources,'auto_profile':auto_profile,'skill_used':skill_name,'web_results':web_results,'web_suggest':web_suggest,'knowledge_gap':_kg})}\n\n")

            token_count = 0
            t_start = time.perf_counter()
            first_token_time = None

            stream = compute_path.llm.create_completion(
                prompt, max_tokens=gen_max, stream=True, echo=False,
                temperature=gen_temp, top_p=gen_top_p, top_k=gen_top_k, repeat_penalty=gen_rep,
            )
            for chunk in stream:
                tok = chunk["choices"][0]["text"]
                if "<|im_end|>" in tok or "<|eot_id|>" in tok:
                    break
                if first_token_time is None:
                    first_token_time = time.perf_counter() - t_start
                token_count += 1
                q.put(f"data: {_json.dumps({'type':'token','text':tok})}\n\n")

            total = time.perf_counter() - t_start
            tps = token_count / total if total > 0 else 0
            ttft = first_token_time if first_token_time is not None else total
            q.put(f"data: {_json.dumps({'type':'done','tokens':token_count,'tps':round(tps,1),'ttft_s':round(ttft,3),'total_s':round(total,3)})}\n\n")
        except Exception as e:
            q.put(f"data: {_json.dumps({'type':'error','detail':str(e)})}\n\n")
        finally:
            _llm_lock.release()
            q.put(None)  # sentinel

    async def async_generate():
        thread = threading.Thread(target=_generate_in_thread)
        thread.start()
        while True:
            # Poll the queue from the async context
            while q.empty():
                await asyncio.sleep(0.01)
            item = q.get()
            if item is None:
                break
            yield item
        thread.join()

    key_manager.log_usage(auth.get("key", "jwt"), "/v1/chat/stream", tokens=0, latency_ms=0)
    return StreamingResponse(async_generate(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


@app.post("/v1/chat/reason")
async def chat_reason(req: ChatRequest, auth: dict = Depends(verify_auth)):
    """Reasoning mode — multi-stage chain-of-thought with SSE streaming."""
    if compute_path is None:
        raise HTTPException(status_code=503, detail="Compute-Path not available")

    from fastapi.responses import StreamingResponse
    from reasoning import ReasoningEngine
    import json as _json

    # RAG retrieval
    rag_context = ""
    if req.use_rag and rag_engine:
        results = rag_engine.retrieve(req.message, top_k=3)
        if results and results[0].get("dense_score", results[0].get("score", 0)) > 0.25:
            rag_context = rag_engine.format_context(results)

    engine = ReasoningEngine(compute_path.llm, rag_engine, template=compute_path.template)

    import asyncio, queue, threading

    q2: queue.Queue = queue.Queue()

    def _reason_in_thread():
        _llm_lock.acquire()
        try:
            for event in engine.run(req.message, rag_context=rag_context):
                q2.put(f"data: {_json.dumps(event)}\n\n")
        except Exception as e:
            q2.put(f"data: {_json.dumps({'type':'error','detail':str(e)})}\n\n")
        finally:
            _llm_lock.release()
            q2.put(None)

    async def async_reason():
        thread = threading.Thread(target=_reason_in_thread)
        thread.start()
        while True:
            while q2.empty():
                await asyncio.sleep(0.01)
            item = q2.get()
            if item is None:
                break
            yield item
        thread.join()

    key_manager.log_usage(auth.get("key", "jwt"), "/v1/chat/reason", tokens=0, latency_ms=0)
    return StreamingResponse(async_reason(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


@app.post("/v1/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, auth: dict = Depends(verify_api_key)):
    """Chat with the LLM — includes RAG, tools, cache, and conversation memory."""
    if compute_path is None:
        raise HTTPException(status_code=503, detail="Compute-Path not available — no GGUF model loaded")

    t_total = time.perf_counter()

    # Classify sentiment
    t0 = time.perf_counter()
    label, confidence, probs = fast_path._infer(req.message)
    cls_ms = (time.perf_counter() - t0) * 1000
    scores = {fast_path.id2label.get(i, str(i)): float(p) for i, p in enumerate(probs)}
    sentiment = SentimentResult(label=label, confidence=confidence, scores=scores, latency_ms=round(cls_ms, 2))

    # Auto-tools
    tool_result = ""
    if req.use_tools and auto_tools:
        result = auto_tools.run(req.message)
        if result:
            tool_result = result

    # Route query
    route = {"strategy": "rag"}
    if auto_mode_engine:
        route = auto_mode_engine.route(req.message, has_rag=bool(rag_engine), has_knowledge_packs=bool(gallery_manager))

    # RAG retrieval — hybrid with optional decomposition (skip for simple greetings)
    rag_context = ""
    rag_sources = []
    results = []
    if req.use_rag and rag_engine and route["strategy"] != "simple":
        # Graph-augmented retrieval for complex queries
        if graph_rag and graph_rag.has_graph:
            results = graph_rag.retrieve(req.message, top_k=5)
        else:
            results = rag_engine.retrieve(req.message, top_k=3)

        # Multi-hop decomposition for complex queries
        if route["strategy"] == "reasoning" and results:
            import re as _re
            sub_parts = _re.split(r'\band\b|\bbut\b|\balso\b|\?', req.message)
            sub_parts = [s.strip() for s in sub_parts if len(s.strip()) > 10]
            if len(sub_parts) > 1:
                all_results = list(results)
                seen = set(r["text"][:80] for r in results)
                for sub_q in sub_parts[:3]:
                    for r in rag_engine.retrieve(sub_q, top_k=2):
                        if r["text"][:80] not in seen:
                            seen.add(r["text"][:80])
                            all_results.append(r)
                results = all_results[:6]

        if results and results[0].get("dense_score", results[0].get("score", 0)) > 0.25:
            rag_context = rag_engine.format_context(results)
            rag_sources = list(set(r["source"] for r in results))

    # Cache check
    if req.use_cache and response_cache:
        cached = response_cache.get(req.message)
        if cached:
            total_s = time.perf_counter() - t_total
            key_manager.log_usage(auth.get("key", "jwt"), "/v1/chat", tokens=0, latency_ms=total_s * 1000)
            # Save to session memory
            session = get_session(req.session_id)
            from langchain_core.messages import HumanMessage, AIMessage
            session.append((HumanMessage(content=req.message), AIMessage(content=cached)))
            return ChatResponse(
                response=cached,
                sentiment=sentiment,
                tool_result=tool_result or None,
                rag_sources=rag_sources,
                tokens=0, tps=0, ttft_s=0,
                total_s=round(total_s, 3),
                cached=True,
                session_id=req.session_id,
            )

    # Build prompt with session memory
    session = get_session(req.session_id)
    old_history = compute_path.history
    compute_path.history = session

    # Auto-mode: classify and override params
    auto_profile = None
    gen_temp = req.temperature
    gen_top_p = req.top_p
    gen_top_k = req.top_k
    gen_rep = req.repeat_penalty
    gen_max = req.max_tokens
    if req.auto_mode and auto_mode_engine and compute_path:
        auto_params = auto_mode_engine.classify(req.message, compute_path.llm)
        auto_profile = auto_params.get("profile")
        gen_temp = auto_params.get("temperature", gen_temp)
        gen_top_p = auto_params.get("top_p", gen_top_p)
        gen_top_k = auto_params.get("top_k", gen_top_k)
        gen_rep = auto_params.get("repeat_penalty", gen_rep)
        gen_max = auto_params.get("max_tokens", gen_max)

    # Skill matching — enhance system prompt if a skill matches
    skill_name = None
    effective_system = req.system_prompt
    if skill_engine:
        matched_skill = skill_engine.match(req.message)
        if matched_skill:
            skill_name = matched_skill["name"]
            effective_system = skill_engine.apply(matched_skill, req.system_prompt)

    # Grounding instructions for complex knowledge queries
    if route["strategy"] == "reasoning" and rag_context:
        effective_system = (effective_system or "") + (
            "\n\nIMPORTANT: Base your answer strictly on the retrieved documents. "
            "Cite specific facts. If the documents don't cover the question fully, say so honestly."
        )

    # Web search — if enabled or auto-suggested
    web_results = []
    web_suggest = False
    web_context = ""
    if req.use_web and web_search_engine:
        web_results = web_search_engine.search(req.message, max_results=5)
        if web_results:
            web_context = web_search_engine.format_for_llm(web_results)
            web_results = web_search_engine.format_for_display(web_results)
    elif web_search_engine and not req.use_web:
        # Check if we should suggest web search
        web_suggest = web_search_engine.should_search(req.message)

    # Inject web context into system prompt if available
    if web_context:
        effective_system = (effective_system or "") + "\n\n" + web_context

    # Generate (capture output instead of printing)
    prompt = compute_path._build_prompt(req.message, rag_context=rag_context, tool_result=tool_result, system_prompt=effective_system)

    first_token_time = None
    token_count = 0
    response_parts = []
    t0 = time.perf_counter()

    _llm_lock.acquire()
    stream = compute_path.llm.create_completion(
        prompt,
        max_tokens=gen_max,
        stream=True,
        echo=False,
        temperature=gen_temp,
        top_p=gen_top_p,
        top_k=gen_top_k,
        repeat_penalty=gen_rep,
    )

    for chunk in stream:
        tok = chunk["choices"][0]["text"]
        if "<|im_end|>" in tok or "<|eot_id|>" in tok:
            break
        if first_token_time is None:
            first_token_time = time.perf_counter() - t0
        token_count += 1
        response_parts.append(tok)

    _llm_lock.release()

    gen_total = time.perf_counter() - t0
    tps = token_count / gen_total if gen_total > 0 else 0
    ttft = first_token_time if first_token_time is not None else gen_total
    response_text = "".join(response_parts).strip()

    # Save to session memory
    from langchain_core.messages import HumanMessage, AIMessage
    session.append((HumanMessage(content=req.message), AIMessage(content=response_text)))
    compute_path.history = old_history

    # Cache store
    if req.use_cache and response_cache and response_text:
        response_cache.put(req.message, response_text)

    total_s = time.perf_counter() - t_total
    key_manager.log_usage(auth.get("key", "jwt"), "/v1/chat", tokens=token_count, latency_ms=total_s * 1000)

    return ChatResponse(
        response=response_text,
        sentiment=sentiment,
        tool_result=tool_result or None,
        rag_sources=rag_sources,
        tokens=token_count,
        tps=round(tps, 1),
        ttft_s=round(ttft, 3),
        total_s=round(total_s, 3),
        cached=False,
        session_id=req.session_id,
        auto_profile=auto_profile,
        skill_used=skill_name,
        web_results=web_results,
        web_suggest=web_suggest,
        knowledge_gap=_detect_knowledge_gap(req.message, results if req.use_rag and rag_engine else [], bool(rag_context)),
    )


@app.delete("/v1/sessions/{session_id}")
async def clear_session(session_id: str, auth: dict = Depends(verify_api_key)):
    """Clear conversation memory for a session."""
    if session_id in sessions:
        del sessions[session_id]
        return {"status": "cleared", "session_id": session_id}
    return {"status": "not_found", "session_id": session_id}


@app.get("/v1/sessions")
async def list_sessions(auth: dict = Depends(verify_api_key)):
    """List active conversation sessions."""
    return {
        "sessions": [
            {"session_id": sid, "turns": len(hist)}
            for sid, hist in sessions.items()
        ]
    }


@app.get("/v1/keys/usage", response_model=KeyUsageResponse)
async def key_usage(auth: dict = Depends(verify_api_key)):
    """Get usage stats for the current API key."""
    return KeyUsageResponse(
        name=auth["name"],
        total_requests=auth["total_requests"],
        total_tokens=auth["total_tokens"],
        rate_limit=auth["rate_limit"],
        active=bool(auth["is_active"]),
    )


# --- Audio/Image Endpoints ---

@app.post("/v1/transcribe", response_model=TranscribeResponse)
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(None),
    auth: dict = Depends(verify_api_key),
):
    """Transcribe audio to text using Whisper (CPU)."""
    if stt_engine is None:
        raise HTTPException(status_code=503, detail="Speech-to-Text not available")

    # Save uploaded file temporarily
    import tempfile
    suffix = Path(file.filename).suffix if file.filename else ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = stt_engine.transcribe(tmp_path, language=language)
        key_manager.log_usage(auth.get("key", "jwt"), "/v1/transcribe", tokens=0, latency_ms=result["processing_s"] * 1000)
        return TranscribeResponse(**result)
    finally:
        os.unlink(tmp_path)


@app.post("/v1/speak")
async def speak(
    text: str = Form(...),
    auth: dict = Depends(verify_api_key),
):
    """Convert text to speech using Piper TTS. Returns a WAV file."""
    if tts_engine is None:
        raise HTTPException(status_code=503, detail="Text-to-Speech not available")

    import tempfile
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        tmp_path = tmp.name

    result = tts_engine.speak(text, output_path=tmp_path)
    key_manager.log_usage(auth.get("key", "jwt"), "/v1/speak", tokens=0, latency_ms=result["processing_s"] * 1000)

    return FileResponse(
        tmp_path,
        media_type="audio/wav",
        filename="speech.wav",
        headers={"X-Processing-Seconds": str(result["processing_s"])},
    )


@app.post("/v1/ocr", response_model=OCRResponse)
async def ocr(
    file: UploadFile = File(...),
    language: str = Form("eng"),
    auth: dict = Depends(verify_api_key),
):
    """Extract text from an image using Tesseract OCR."""
    if ocr_engine is None:
        raise HTTPException(status_code=503, detail="OCR not available")

    import tempfile
    suffix = Path(file.filename).suffix if file.filename else ".png"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = ocr_engine.extract(tmp_path, lang=language)
        key_manager.log_usage(auth.get("key", "jwt"), "/v1/ocr", tokens=0, latency_ms=result["processing_ms"])
        return OCRResponse(**result)
    finally:
        os.unlink(tmp_path)


@app.post("/v1/classify/image", response_model=ImageClassifyResponse)
async def classify_image(
    file: UploadFile = File(...),
    top_k: int = Form(5),
    auth: dict = Depends(verify_api_key),
):
    """Classify an image using MobileNetV2."""
    if img_classifier is None:
        raise HTTPException(status_code=503, detail="Image classifier not available")

    import tempfile
    suffix = Path(file.filename).suffix if file.filename else ".jpg"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = img_classifier.classify(tmp_path, top_k=top_k)
        key_manager.log_usage(auth.get("key", "jwt"), "/v1/classify/image", tokens=0, latency_ms=result["processing_ms"])
        return ImageClassifyResponse(**result)
    finally:
        os.unlink(tmp_path)


@app.post("/v1/ocr/chat")
async def ocr_chat(
    file: UploadFile = File(...),
    question: str = Form("What does this text say? Summarize it."),
    session_id: str = Form("default"),
    auth: dict = Depends(verify_api_key),
):
    """Extract text from image with OCR, then chat about it with the LLM."""
    if ocr_engine is None:
        raise HTTPException(status_code=503, detail="OCR not available")
    if compute_path is None:
        raise HTTPException(status_code=503, detail="Compute-Path not available")

    import tempfile
    suffix = Path(file.filename).suffix if file.filename else ".png"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        ocr_result = ocr_engine.extract(tmp_path, lang="eng")
    finally:
        os.unlink(tmp_path)

    extracted_text = ocr_result["text"]
    if not extracted_text.strip():
        return {"response": "No text found in the image.", "ocr": ocr_result}

    # Feed extracted text to chat as tool result
    tool_context = f"[Tool: OCR] Extracted text from image:\n{extracted_text}"

    session = get_session(session_id)
    old_history = compute_path.history
    compute_path.history = session

    prompt = compute_path._build_prompt(question, tool_result=tool_context)

    response_parts = []
    token_count = 0
    t0 = time.perf_counter()
    stream = compute_path.llm.create_completion(
        prompt, max_tokens=256, stream=True, echo=False, temperature=0.7,
    )
    for chunk in stream:
        tok = chunk["choices"][0]["text"]
        if "<|im_end|>" in tok or "<|eot_id|>" in tok:
            break
        token_count += 1
        response_parts.append(tok)

    total_s = time.perf_counter() - t0
    response_text = "".join(response_parts).strip()

    from langchain_core.messages import HumanMessage, AIMessage
    session.append((HumanMessage(content=question), AIMessage(content=response_text)))
    compute_path.history = old_history

    key_manager.log_usage(auth.get("key", "jwt"), "/v1/ocr/chat", tokens=token_count, latency_ms=total_s * 1000)

    return {
        "response": response_text,
        "ocr": ocr_result,
        "tokens": token_count,
        "total_s": round(total_s, 3),
        "session_id": session_id,
    }


def main():
    parser = argparse.ArgumentParser(description="EdgeWord NLP API Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Port (default: 8000)")
    parser.add_argument("--threads", type=int, default=4, help="LLM thread count (default: 4)")
    args = parser.parse_args()

    os.environ["EDGEWORD_THREADS"] = str(args.threads)

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
