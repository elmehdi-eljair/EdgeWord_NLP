# EdgeWord NLP — API Reference

## Overview

The EdgeWord API is a RESTful JSON API powered by FastAPI. It exposes the full NLP pipeline — sentiment classification, text generation with conversation memory, RAG, auto-tools, and response caching — behind API key authentication.

**Base URL:** `http://localhost:8000`  
**Auth:** Bearer token (`Authorization: Bearer ew_...`)  
**Content-Type:** `application/json`

---

## Authentication

All endpoints except `/v1/health` require a valid API key.

```bash
# Create a key
.venv/bin/python3 api_keys.py create --name "my-app"

# Use it in requests
curl -H "Authorization: Bearer ew_your_key_here" ...
```

**Error responses:**

| Status | Meaning |
|---|---|
| 401 | Invalid or missing API key |
| 429 | Rate limit exceeded (default: 60 req/min) |

---

## Endpoints

### GET /v1/health

Health check. No authentication required.

**Response:**
```json
{
  "status": "healthy",
  "fast_path": true,
  "compute_path": true,
  "rag_chunks": 3,
  "cache_entries": 5,
  "model": "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
  "uptime_s": 120.5
}
```

---

### POST /v1/classify

Classify the sentiment of a single text.

**Request:**
```json
{
  "text": "This product is amazing!"
}
```

**Response:**
```json
{
  "result": {
    "label": "POSITIVE",
    "confidence": 0.9998,
    "scores": {
      "NEGATIVE": 0.0002,
      "POSITIVE": 0.9998
    },
    "latency_ms": 14.2
  }
}
```

---

### POST /v1/classify/batch

Classify sentiment of multiple texts in one request.

**Request:**
```json
{
  "texts": [
    "I love this product",
    "Terrible experience",
    "The documentation is clear"
  ]
}
```

**Response:**
```json
{
  "results": [
    {"label": "POSITIVE", "confidence": 0.999, "scores": {...}, "latency_ms": 12.5},
    {"label": "NEGATIVE", "confidence": 0.998, "scores": {...}, "latency_ms": 13.1},
    {"label": "POSITIVE", "confidence": 0.997, "scores": {...}, "latency_ms": 12.8}
  ],
  "total_ms": 38.4
}
```

---

### POST /v1/chat

Chat with the LLM. Includes sentiment classification, RAG context retrieval, auto-tools, response caching, and conversation memory.

**Request:**
```json
{
  "message": "Who created EdgeWord NLP?",
  "max_tokens": 256,
  "temperature": 0.7,
  "session_id": "user-123",
  "use_rag": true,
  "use_tools": true,
  "use_cache": true
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `message` | string | required | User message |
| `max_tokens` | int | 256 | Max tokens to generate (1-2048) |
| `temperature` | float | 0.7 | Sampling temperature (0.0-2.0) |
| `session_id` | string | "default" | Session ID for conversation memory |
| `use_rag` | bool | true | Enable RAG context retrieval |
| `use_tools` | bool | true | Enable auto-tools (calc, datetime, etc.) |
| `use_cache` | bool | true | Enable response cache |

**Response:**
```json
{
  "response": "EdgeWord NLP was created by El Mehdi El Jair.",
  "sentiment": {
    "label": "NEGATIVE",
    "confidence": 0.997,
    "scores": {"NEGATIVE": 0.997, "POSITIVE": 0.003},
    "latency_ms": 14.5
  },
  "tool_result": null,
  "rag_sources": ["about_edgeword.txt"],
  "tokens": 15,
  "tps": 14.9,
  "ttft_s": 0.377,
  "total_s": 1.42,
  "cached": false,
  "session_id": "user-123"
}
```

| Field | Description |
|---|---|
| `response` | The LLM-generated response text |
| `sentiment` | Sentiment classification of the user's input |
| `tool_result` | Tool output if auto-tools triggered (e.g., calculator result) |
| `rag_sources` | List of document filenames used for context |
| `tokens` | Number of tokens generated |
| `tps` | Tokens per second |
| `ttft_s` | Time to first token in seconds |
| `total_s` | Total request time in seconds |
| `cached` | Whether the response came from cache |
| `session_id` | The session ID used for this conversation |

**Conversation Memory:**

Use the same `session_id` across requests to maintain conversation context. The model will remember previous exchanges in the session.

```bash
# Turn 1
curl -X POST http://localhost:8000/v1/chat \
  -H "Authorization: Bearer ew_..." \
  -H "Content-Type: application/json" \
  -d '{"message": "My name is Mehdi", "session_id": "s1"}'

# Turn 2 — model remembers
curl -X POST http://localhost:8000/v1/chat \
  -H "Authorization: Bearer ew_..." \
  -H "Content-Type: application/json" \
  -d '{"message": "What is my name?", "session_id": "s1"}'
# -> "Your name is Mehdi."
```

---

### GET /v1/sessions

List all active conversation sessions.

**Response:**
```json
{
  "sessions": [
    {"session_id": "user-123", "turns": 5},
    {"session_id": "user-456", "turns": 2}
  ]
}
```

---

### DELETE /v1/sessions/{session_id}

Clear conversation memory for a specific session.

**Response:**
```json
{"status": "cleared", "session_id": "user-123"}
```

---

### GET /v1/keys/usage

Get usage statistics for the current API key.

**Response:**
```json
{
  "name": "my-app",
  "total_requests": 42,
  "total_tokens": 1250,
  "rate_limit": 60,
  "active": true
}
```

---

## Auto-Tools

When `use_tools` is enabled, the API automatically detects and executes tools based on the user's message. Tool results are injected into the LLM context.

| Tool | Triggers | Example |
|---|---|---|
| Calculator | Math expressions | "what is 125 * 8 + 50?" |
| DateTime | Time/date questions | "what time is it?" |
| SystemInfo | Hardware questions | "what CPU do I have?" |
| FileReader | File references | "read file requirements.txt" |

Tool results appear in the `tool_result` field of the response.

---

## RAG (Retrieval Augmented Generation)

When `use_rag` is enabled, the API searches indexed documents for relevant context before generating a response.

- Documents are loaded from the `./docs/` directory on server startup
- Supported formats: `.txt`, `.md`, `.py`, `.json`, `.csv`, `.yaml`, `.html`, `.xml`, and more
- Documents are chunked (500 chars, 100 overlap) and embedded using all-MiniLM-L6-v2 (ONNX)
- Retrieval uses FAISS with cosine similarity, threshold 0.3

To add documents, place files in `./docs/` and restart the server.

---

## Rate Limiting

Each API key has a configurable rate limit (default: 60 requests per minute). When exceeded, the API returns:

```json
{
  "detail": "Rate limit exceeded. Retry after 60s"
}
```

Status code: `429 Too Many Requests`

---

## Error Responses

All errors return JSON:

```json
{
  "detail": "Error message here"
}
```

| Status | Meaning |
|---|---|
| 400 | Invalid request body |
| 401 | Invalid or missing API key |
| 422 | Validation error (wrong field types) |
| 429 | Rate limit exceeded |
| 503 | Compute-Path not available (no GGUF model) |

---

## Integration Examples

### Python

```python
import requests

API_URL = "http://localhost:8000"
API_KEY = "ew_your_key_here"
headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

# Classify
r = requests.post(f"{API_URL}/v1/classify", headers=headers,
                   json={"text": "Great product!"})
print(r.json()["result"]["label"])  # POSITIVE

# Chat
r = requests.post(f"{API_URL}/v1/chat", headers=headers,
                   json={"message": "What is EdgeWord?", "session_id": "my-session"})
print(r.json()["response"])
```

### JavaScript / Node.js

```javascript
const API_URL = "http://localhost:8000";
const API_KEY = "ew_your_key_here";

// Chat
const res = await fetch(`${API_URL}/v1/chat`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    message: "What is EdgeWord?",
    session_id: "my-session",
  }),
});
const data = await res.json();
console.log(data.response);
```

### cURL

```bash
# Classify
curl -X POST http://localhost:8000/v1/classify \
  -H "Authorization: Bearer ew_..." \
  -H "Content-Type: application/json" \
  -d '{"text": "Amazing product!"}'

# Chat
curl -X POST http://localhost:8000/v1/chat \
  -H "Authorization: Bearer ew_..." \
  -H "Content-Type: application/json" \
  -d '{"message": "Explain quantization", "max_tokens": 100}'
```
