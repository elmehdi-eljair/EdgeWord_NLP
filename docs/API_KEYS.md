# EdgeWord NLP — API Key Management

## Overview

EdgeWord uses API keys to authenticate requests, track usage, and enforce rate limits. Keys are stored as SHA-256 hashes in a local SQLite database — raw keys are never persisted.

**Key format:** `ew_` + 32-byte URL-safe random token  
**Storage:** `.cache/api_keys.db`  
**Rate limit:** Configurable per key (default: 60 requests/minute)

---

## CLI Commands

### Create a key

```bash
.venv/bin/python3 api_keys.py create --name "my-app"
.venv/bin/python3 api_keys.py create --name "production" --rate-limit 120
```

Output:
```
  API key created successfully!
  Name:       my-app
  Rate limit: 60 req/min

  Key: ew_pYDbOLVjMChmqyhSqeI8_UEnqJH4KC1m-l5vdElibpM

  Save this key — it won't be shown again.
```

The raw key is displayed only once at creation time. Store it securely.

### List all keys

```bash
.venv/bin/python3 api_keys.py list
```

Output:
```
    ID | Name                 | Key              | Status   |   Requests |     Tokens | Rate Limit
  ----------------------------------------------------------------------------------------------------
     1 | my-app               | ew_pYDbOLVj...   | active   |         42 |       1250 |      60/min
     2 | old-app              | ew_xK9mN2Lp...   | revoked  |        100 |       3500 |      60/min
```

### View usage statistics

```bash
.venv/bin/python3 api_keys.py usage
```

Shows aggregate statistics and recent request log:
```
  Usage Summary:
    Active keys:    1
    Total requests: 42
    Total tokens:   1250
    Avg latency:    150.3 ms

  Recent requests (last 24h):
  Time                 | Key                  | Endpoint     |  Tokens |    Latency | Status
  -------------------------------------------------------------------------------------
  2026-05-01 13:19:58  | my-app               | /v1/chat     |      15 |    1420.0ms |    200
  2026-05-01 13:19:55  | my-app               | /v1/classify |       0 |      14.2ms |    200
```

### Revoke a key

```bash
# By full key
.venv/bin/python3 api_keys.py revoke ew_pYDbOLVjMChmqyhSqeI8_UEnqJH4KC1m-l5vdElibpM

# By prefix
.venv/bin/python3 api_keys.py revoke ew_pYDbOLVj
```

Revoked keys immediately stop working. The key and its usage history are retained in the database for auditing.

---

## Using Keys in API Requests

Pass the key as a Bearer token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer ew_your_key_here" \
     http://localhost:8000/v1/classify \
     -H "Content-Type: application/json" \
     -d '{"text": "Great product!"}'
```

### Error Responses

**Invalid key (401):**
```json
{"detail": "Invalid API key"}
```

**Missing key (403):**
```json
{"detail": "Not authenticated"}
```

**Rate limited (429):**
```json
{"detail": "Rate limit exceeded. Retry after 60s"}
```

---

## Checking Usage via API

The `/v1/keys/usage` endpoint returns stats for the calling key:

```bash
curl -H "Authorization: Bearer ew_..." http://localhost:8000/v1/keys/usage
```

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

## Security Notes

- Raw API keys are never stored — only SHA-256 hashes
- Keys use `secrets.token_urlsafe(32)` for cryptographic randomness
- Rate limiting is enforced per key using a sliding 60-second window
- All requests are logged with timestamp, endpoint, tokens, and latency
- The `ew_` prefix makes keys easy to identify in logs and rotation scripts
- The database is stored locally in `.cache/api_keys.db` (gitignored)

---

## Programmatic Usage

You can also use the `APIKeyManager` class directly in Python:

```python
from api_keys import APIKeyManager

mgr = APIKeyManager()

# Create
raw_key = mgr.create_key("my-app", rate_limit=100)

# Validate
info = mgr.validate_key(raw_key)
if info and "error" not in info:
    print(f"Valid key: {info['name']}")

# Log usage
mgr.log_usage(raw_key, "/v1/chat", tokens=25, latency_ms=1500)

# Stats
summary = mgr.get_usage_summary()
print(f"Total requests: {summary['total_requests']}")

# Revoke
mgr.revoke_key(raw_key)
```
