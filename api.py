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
    session_id: str = Field("default", description="Session ID for conversation memory")
    use_rag: bool = Field(True, description="Enable RAG context retrieval")
    use_tools: bool = Field(True, description="Enable auto-tools")
    use_cache: bool = Field(True, description="Enable response cache")

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
stt_engine = None
tts_engine = None
ocr_engine = None
img_classifier = None
sessions = {}  # session_id -> conversation history
start_time = None


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

    # RAG retrieval
    rag_context = ""
    rag_sources = []
    if req.use_rag and rag_engine:
        results = rag_engine.retrieve(req.message, top_k=3)
        if results and results[0]["score"] > 0.3:
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

    # Generate (capture output instead of printing)
    prompt = compute_path._build_prompt(req.message, rag_context=rag_context, tool_result=tool_result)

    first_token_time = None
    token_count = 0
    response_parts = []
    t0 = time.perf_counter()

    stream = compute_path.llm.create_completion(
        prompt,
        max_tokens=req.max_tokens,
        stream=True,
        echo=False,
        temperature=req.temperature,
    )

    for chunk in stream:
        tok = chunk["choices"][0]["text"]
        if "<|im_end|>" in tok or "<|eot_id|>" in tok:
            break
        if first_token_time is None:
            first_token_time = time.perf_counter() - t0
        token_count += 1
        response_parts.append(tok)

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
