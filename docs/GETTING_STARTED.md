# EdgeWord NLP — Getting Started

## Prerequisites

- Python 3.10+ (tested on 3.12)
- x86_64 CPU with AVX2 support (Intel Haswell+ or AMD Zen+)
- 8 GB RAM minimum (16 GB recommended)
- cmake, gcc/g++ (for compiling llama-cpp-python)
- ~2 GB disk space (models + dependencies)

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/elmehdi-eljair/EdgeWord_NLP.git
cd EdgeWord_NLP
```

### 2. Create a virtual environment

```bash
python3 -m venv .venv
```

### 3. Install dependencies

```bash
# Fast-Path + utilities
.venv/bin/pip install "onnxruntime>=1.17.0" "transformers>=4.38.0" \
    huggingface_hub numpy psutil

# Compute-Path (compiles from source, needs cmake + gcc)
CMAKE_ARGS="-DGGML_AVX2=ON" .venv/bin/pip install llama-cpp-python

# LangChain (conversation memory)
.venv/bin/pip install langchain langchain-community

# RAG
.venv/bin/pip install faiss-cpu

# API server
.venv/bin/pip install fastapi uvicorn
```

### 4. Download a GGUF model

```bash
mkdir -p models
.venv/bin/python3 -c "
from huggingface_hub import hf_hub_download
hf_hub_download('bartowski/Llama-3.2-1B-Instruct-GGUF',
                'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
                local_dir='./models')
"
```

---

## Usage

### Interactive CLI

```bash
.venv/bin/python3 cli.py
```

Type anything at the `>` prompt. Every input automatically gets:
- Sentiment classification (Fast-Path, ~14ms)
- AI-generated response (Compute-Path, ~15 t/s)
- Conversation memory (LangChain)
- RAG context from `./docs/` (if relevant documents found)
- Auto-tools (calculator, datetime, system info)
- Response caching (SQLite)

**CLI Commands:**

| Command | Action |
|---|---|
| `bench` | Run performance benchmark |
| `memory` | Show conversation history |
| `clear` | Clear conversation memory |
| `rag` | Show indexed documents |
| `cache` | Show cache statistics |
| `cache clear` | Clear response cache |
| `/tokens N` | Set max generation tokens |
| `/temp N` | Set temperature (0.0-2.0) |
| `/threads N` | Change thread count (reloads model) |
| `quit` | Exit |

**CLI Options:**

```bash
.venv/bin/python3 cli.py --help
  --model PATH      Path to GGUF model (auto-detects from ./models/)
  --threads N        Thread count (default: 4)
  --memory N         Conversation turns to remember (default: 50)
  --docs PATH        Directory for RAG documents (default: ./docs)
  --no-rag           Disable RAG
  --no-cache         Disable response cache
  --no-tools         Disable auto-tools
  --fast-only        Classification only, no generation
```

### REST API

```bash
# 1. Create an API key
.venv/bin/python3 api_keys.py create --name "my-app"

# 2. Start the server
.venv/bin/python3 api.py

# 3. Test it
curl http://localhost:8000/v1/health

curl -X POST http://localhost:8000/v1/chat \
  -H "Authorization: Bearer ew_your_key" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, who are you?"}'
```

See [API_REFERENCE.md](API_REFERENCE.md) for full endpoint documentation.

### Benchmarks

```bash
# Environment check
.venv/bin/python3 run_scenarios.py --check

# Fast-Path only (no model needed)
.venv/bin/python3 run_scenarios.py --fast-only

# Both paths
.venv/bin/python3 run_scenarios.py --model ./models/Llama-3.2-1B-Instruct-Q4_K_M.gguf
```

---

## Adding Documents for RAG

Place any text-based files in the `./docs/` directory:

```bash
cp my_report.txt ./docs/
cp project_notes.md ./docs/
cp config_reference.yaml ./docs/
```

Supported formats: `.txt`, `.md`, `.py`, `.js`, `.ts`, `.json`, `.csv`, `.yaml`, `.yml`, `.toml`, `.html`, `.xml`, `.rst`, `.sh`, `.bash`

Documents are automatically indexed when the CLI or API server starts. The LLM will use relevant document chunks to ground its responses.

---

## API Key Management

```bash
# Create a key (shown once, save it)
.venv/bin/python3 api_keys.py create --name "my-app"
.venv/bin/python3 api_keys.py create --name "prod" --rate-limit 120

# List all keys
.venv/bin/python3 api_keys.py list

# View usage statistics
.venv/bin/python3 api_keys.py usage

# Revoke a key
.venv/bin/python3 api_keys.py revoke ew_your_key_here
```

---

## Docker

```bash
# Build
docker build -t edgeword .

# Run benchmarks
docker run --rm edgeword python run_scenarios.py --fast-only

# Run with a model
docker run --rm -v $(pwd)/models:/models edgeword \
    python run_scenarios.py --model /models/Llama-3.2-1B-Instruct-Q4_K_M.gguf
```

---

## Recommended Models

| Model | Size | Use case |
|---|---|---|
| Llama-3.2-1B-Instruct-Q4_K_M | 771 MB | Default — good quality, fast |
| Qwen2.5-0.5B-Instruct-Q4_K_M | 469 MB | Minimal footprint, faster |
| Meta-Llama-3-8B-Instruct-Q4_K_M | 4.6 GB | Best quality, needs 16 GB RAM |

Download from [HuggingFace](https://huggingface.co/models?library=gguf&sort=trending) and place in `./models/`.

---

## Troubleshooting

**`llama-cpp-python` won't install:**
- Ensure `cmake` and `gcc`/`g++` are installed: `sudo apt install cmake build-essential`
- On Windows, use Docker or install VS Build Tools 2022

**Slow first request:**
- The first LLM request is slower due to model warmup and KV cache initialization
- Subsequent requests will be faster

**"No GGUF model found":**
- Place a `.gguf` file in `./models/` or use `--model path/to/model.gguf`

**High memory usage:**
- The 1B model uses ~1.2 GB RAM. Ensure at least 4 GB free.
- Use the 0.5B model for lower memory usage.

**ONNX model download slow:**
- First run downloads models from HuggingFace (~200 MB total)
- Models are cached in `~/.cache/huggingface/` after first download
