# EdgeWord NLP — Infrastructure Specification
## For 3B Model Deployment (Virtualized / Ray Cluster)

**Date:** 2026-05-02  
**Audience:** DevOps / Infrastructure team  
**Target model:** Llama-3.2-3B-Instruct-Q4_K_M (~2.0 GB)

---

## 1. Compute Requirements

### Single Node (Minimum Viable)

| Resource | Minimum | Recommended | Notes |
|---|---|---|---|
| **CPU** | 8 cores (x86_64, AVX2) | 16 cores | llama.cpp is CPU-bound; more cores = higher TPS |
| **RAM** | 8 GB | 16 GB | Model ~3 GB in RAM + 2 GB for RAG/embeddings/OS |
| **Storage** | 20 GB SSD | 50 GB SSD | Models + docs + SQLite DBs + cache |
| **Network** | 100 Mbps | 1 Gbps | For web search, ngrok, file uploads |

### CPU Architecture

- **Required:** x86_64 with **AVX2** instruction set (Intel Haswell+ or AMD Zen+)
- **Optional:** AVX-512 (Intel Skylake-X+) — ~15% faster inference
- **ARM64** (Apple M-series, AWS Graviton) — supported but requires recompilation
- **No GPU needed** — entire pipeline is CPU-native by design

### Performance Estimates (3B model, Q4_K_M)

| CPU | Cores | Est. TPS | Est. TTFT |
|---|---|---|---|
| Intel i7-4810MQ (current) | 4C/8T | ~8 t/s | ~1.5s |
| Intel Xeon E5-2680 v4 | 14C/28T | ~15-20 t/s | ~0.5s |
| AMD EPYC 7402 | 24C/48T | ~25-30 t/s | ~0.3s |
| Apple M2 Pro | 12C | ~20-25 t/s | ~0.4s |
| AWS c6i.4xlarge (16 vCPU) | 16 vCPU | ~12-18 t/s | ~0.6s |

---

## 2. Software Stack

### Required

| Component | Version | Purpose |
|---|---|---|
| Ubuntu | 22.04+ or 24.04 | OS |
| Python | 3.10-3.12 | Runtime |
| GCC/G++ | 12+ | Compile llama-cpp-python |
| CMake | 3.20+ | Build system |
| Node.js | 18+ | Frontend |
| SQLite | 3.35+ | Databases |
| Tesseract | 5.0+ | OCR |

### Python Dependencies (~250 MB total pip footprint)

```
onnxruntime>=1.17.0       # Fast-Path inference
llama-cpp-python>=0.2.57  # Compute-Path (compiled from source with AVX2)
transformers>=4.38.0      # Tokenizers only (no PyTorch)
faiss-cpu>=1.7.0          # Vector store for RAG
langchain>=1.0.0          # Conversation memory
fastapi>=0.100.0          # API server
uvicorn>=0.23.0           # ASGI server
faster-whisper>=1.0.0     # Speech-to-Text
piper-tts>=1.4.0          # Text-to-Speech
duckduckgo-search>=6.0    # Web search
react-syntax-highlighter  # Frontend (npm)
```

---

## 3. Memory Budget (3B Model)

| Component | RAM Usage |
|---|---|
| Llama 3.2 3B Q4_K_M model | ~3.0 GB |
| ONNX DistilBERT (Fast-Path) | ~70 MB |
| ONNX MiniLM embeddings (RAG) | ~50 MB |
| FAISS index (1000 chunks) | ~20 MB |
| Whisper tiny (STT) | ~75 MB |
| Piper TTS | ~60 MB |
| Python + FastAPI + OS | ~500 MB |
| Response cache + DBs | ~50 MB |
| **Total** | **~4.0 GB** |

**Headroom needed:** 2-4 GB for:
- KV cache during generation (~1 GB for 4096 context)
- Concurrent request buffering
- File upload processing
- Web search HTTP connections

**Minimum RAM: 8 GB. Recommended: 16 GB.**

---

## 4. Concurrency Model

### Current Architecture (Single Process)

```
uvicorn (1 worker)
  ├─ FastAPI (async)
  │   ├─ Fast-Path (ONNX) — thread-safe, parallel OK
  │   ├─ RAG (FAISS) — thread-safe, parallel OK
  │   ├─ Compute-Path (llama.cpp) — NOT thread-safe
  │   │   └─ Global _llm_lock — serializes all LLM access
  │   ├─ Tools — stateless, parallel OK
  │   └─ Web Search — HTTP calls, parallel OK
  └─ SQLite DBs — WAL mode, concurrent reads OK
```

**Bottleneck:** The LLM is single-threaded per request. Only one generation can run at a time. Multiple users must queue.

### Scaling Strategy

#### Option A: Multiple Workers (Simple)

```
uvicorn --workers 4
  Worker 1: own Llama instance (3 GB RAM each)
  Worker 2: own Llama instance
  Worker 3: own Llama instance
  Worker 4: own Llama instance
```

- **RAM:** 4 × 3 GB = 12 GB just for models
- **Concurrency:** 4 simultaneous generations
- **Pro:** Simple, no shared state issues
- **Con:** High memory usage, duplicate model loading

#### Option B: Ray Cluster (Recommended)

```
Ray Head Node
  ├─ API Server (FastAPI)
  │   ├─ Fast-Path (local, shared)
  │   ├─ RAG (local, shared)
  │   └─ Routes to Ray actors for LLM
  │
  ├─ LLM Actor Pool (Ray)
  │   ├─ Actor 1: Llama 3B instance
  │   ├─ Actor 2: Llama 3B instance
  │   └─ Actor N: Llama 3B instance
  │
  └─ Worker Nodes (optional, for horizontal scaling)
      ├─ Worker 1: additional LLM actors
      └─ Worker 2: additional LLM actors
```

**Benefits:**
- Model instances managed as Ray actors
- Automatic load balancing across actors
- Horizontal scaling by adding worker nodes
- Shared object store for RAG index (Arrow/Plasma)
- Fault tolerance — actors restart on crash

**Implementation:**

```python
import ray

@ray.remote(num_cpus=4)  # Each actor gets 4 cores
class LLMWorker:
    def __init__(self, model_path):
        from llama_cpp import Llama
        self.llm = Llama(model_path=model_path, n_ctx=4096, n_threads=4)
    
    def generate(self, prompt, **kwargs):
        return self.llm.create_completion(prompt, **kwargs)
    
    def generate_stream(self, prompt, **kwargs):
        for chunk in self.llm.create_completion(prompt, stream=True, **kwargs):
            yield chunk

# Pool of N actors
pool = [LLMWorker.remote("model.gguf") for _ in range(4)]
```

---

## 5. Ray Cluster Specification

### Head Node

| Resource | Spec |
|---|---|
| CPU | 8+ cores |
| RAM | 8 GB (API server + RAG + routing) |
| Storage | 50 GB SSD (models, DBs, docs) |
| Role | API server, Ray head, scheduler |

### Worker Nodes (each)

| Resource | Spec |
|---|---|
| CPU | 8-16 cores (4 per LLM actor) |
| RAM | 8 GB per LLM actor (model + KV cache) |
| Storage | 10 GB (model cache) |
| Role | LLM inference only |

### Example Cluster for 10 Concurrent Users

```
Head Node: 8 cores, 16 GB RAM
  - API server, RAG, embeddings, cache
  - 1 LLM actor (local fallback)

Worker 1: 16 cores, 16 GB RAM
  - 4 LLM actors (4 cores each)

Worker 2: 16 cores, 16 GB RAM
  - 4 LLM actors (4 cores each)

Total: 9 LLM actors = 9 concurrent generations
Total cores: 40
Total RAM: 48 GB
```

### Virtualization Notes

If using VMs (KVM, VMware, Hyper-V):

- **CPU:** Pass through AVX2/AVX-512 instructions to the guest VM
  ```
  <cpu mode='host-passthrough'/>  # KVM
  ```
- **RAM:** Use huge pages for better memory performance
  ```
  echo 4096 > /proc/sys/vm/nr_hugepages
  ```
- **NUMA:** Pin VMs to NUMA nodes to avoid cross-socket memory access
- **Storage:** Use NVMe/SSD, not spinning disk (model loading is I/O bound)
- **Network:** Low-latency between head and workers (~0.1ms RTT)

---

## 6. Docker Deployment

### Production Dockerfile

```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y \
    python3.11 python3-pip build-essential cmake git \
    tesseract-ocr nodejs npm
    
WORKDIR /edgeword
COPY requirements.txt .
RUN pip install -r requirements.txt
RUN CMAKE_ARGS="-DGGML_AVX2=ON" pip install llama-cpp-python

COPY . .
RUN cd frontend && npm install && npm run build

EXPOSE 8000 3000
CMD ["sh", "-c", "python3 api.py --port 8000 & cd frontend && npm start -- -p 3000"]
```

### Docker Compose (with Ray)

```yaml
version: '3.8'
services:
  head:
    build: .
    command: ray start --head && python3 api.py
    ports: ["8000:8000", "3000:3000"]
    deploy:
      resources:
        limits: { cpus: '8', memory: '16G' }
  
  worker:
    build: .
    command: ray start --address=head:6379
    deploy:
      replicas: 2
      resources:
        limits: { cpus: '16', memory: '16G' }
```

---

## 7. Monitoring & Health

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /v1/health` | Model status, uptime, component checks |
| `GET /v1/keys/usage` | API usage metrics |

### Metrics to Monitor

| Metric | Alert Threshold |
|---|---|
| TTFT (Time to First Token) | > 3s |
| TPS (Tokens per Second) | < 5 t/s |
| RAM usage | > 85% |
| CPU usage (sustained) | > 90% for 5 min |
| Queue depth | > 10 pending requests |
| Error rate | > 5% |
| Cache hit rate | < 20% (indicates poor caching) |

### Recommended Stack

- **Prometheus** — scrape `/v1/health` and custom metrics
- **Grafana** — dashboards for latency, TPS, queue depth
- **Loki** — log aggregation from uvicorn

---

## 8. Networking

| Port | Service | Access |
|---|---|---|
| 3000 | Next.js frontend | Public (via reverse proxy) |
| 8000 | FastAPI API | Internal (proxied by frontend) |
| 6379 | Ray dashboard (optional) | Internal only |
| 8265 | Ray dashboard UI (optional) | Internal only |

### Reverse Proxy (Nginx)

```nginx
server {
    listen 443 ssl;
    server_name edgeword.yourcompany.com;
    
    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }
    
    # API (SSE streaming support)
    location /api/ {
        proxy_pass http://localhost:8000/;
        proxy_set_header Host $host;
        proxy_buffering off;           # Critical for SSE
        proxy_cache off;
        proxy_read_timeout 300s;       # Long timeout for reasoning
    }
}
```

---

## 9. Security Considerations

| Concern | Mitigation |
|---|---|
| Model access | API key required for all endpoints |
| User data | SQLite DBs on encrypted filesystem |
| Web search | DuckDuckGo (no tracking); user opt-in only |
| File uploads | Sandboxed in `./docs/`, size limits |
| JWT tokens | 72h expiry, SHA-256 HMAC |
| Network | HTTPS via nginx/certbot, internal ports firewalled |

---

## 10. Cost Estimate (Cloud)

### AWS (on-demand, us-east-1)

| Config | Instance | Monthly Cost | Users |
|---|---|---|---|
| Minimal | c6i.2xlarge (8 vCPU, 16 GB) | ~$250/mo | 1-3 concurrent |
| Standard | c6i.4xlarge (16 vCPU, 32 GB) | ~$500/mo | 5-8 concurrent |
| Production | 3× c6i.4xlarge (Ray cluster) | ~$1,500/mo | 15-25 concurrent |

### Self-Hosted (one-time)

| Config | Hardware | Cost |
|---|---|---|
| Minimal | Used server, 16 cores, 32 GB | ~$500-800 |
| Standard | Refurb Xeon, 32 cores, 64 GB | ~$1,200-2,000 |
| Production | 3× nodes, 48 cores total, 96 GB | ~$3,000-5,000 |
