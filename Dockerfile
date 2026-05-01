# EdgeWord NLP Pipeline — CPU-only test environment
# Stripped of CUDA/NVIDIA runtimes as specified in the spec.
#
# No torch inside this image — Fast-Path uses onnxruntime.InferenceSession
# directly (~150 MB deps vs ~700 MB with torch).

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV TOKENIZERS_PARALLELISM=false

# Build tools needed for llama-cpp-python compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 \
        python3-pip \
        python3.11-dev \
        build-essential \
        cmake \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 \
 && update-alternatives --install /usr/bin/pip    pip    /usr/bin/pip3     1

WORKDIR /edgeword

# Fast-Path deps — no torch, no optimum (~150 MB total)
RUN pip install --no-cache-dir \
        onnxruntime>=1.17.0 \
        transformers>=4.38.0 \
        huggingface_hub \
        numpy \
        psutil

# Compute-Path: compile llama-cpp-python from source (CPU-only, AVX2)
ENV CMAKE_ARGS="-DGGML_CUDA=OFF -DGGML_AVX2=ON"
RUN pip install --no-cache-dir llama-cpp-python

COPY scenario_fast_path.py \
     scenario_compute_path.py \
     run_scenarios.py ./

# ----- Usage -----
# Fast-Path only (no model needed):
#   docker build -t edgeword .
#   docker run --rm edgeword python run_scenarios.py --fast-only
#
# Both paths (mount a GGUF model):
#   docker run --rm -v /path/to/models:/models edgeword \
#       python run_scenarios.py --model /models/Qwen2.5-0.5B-Q4_K_M.gguf
CMD ["python", "run_scenarios.py", "--fast-only"]
