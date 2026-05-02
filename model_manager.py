"""
EdgeWord NLP — Model Manager
Download GGUF models from HuggingFace and switch between them.

Usage:
    mgr = ModelManager("./models")
    mgr.download("bartowski/Llama-3.2-3B-Instruct-GGUF", "Llama-3.2-3B-Instruct-Q4_K_M.gguf")
    mgr.list_models()
    mgr.switch_model("Llama-3.2-3B-Instruct-Q4_K_M.gguf", compute_path)
"""

import os
import time
import threading
from pathlib import Path
from huggingface_hub import hf_hub_download


AVAILABLE_MODELS = {
    "llama-1b": {
        "repo": "bartowski/Llama-3.2-1B-Instruct-GGUF",
        "file": "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
        "name": "Llama 3.2 1B",
        "size": "771 MB",
        "ram": "1.2 GB",
        "tps_estimate": "~15 t/s",
        "description": "Fast, good quality. Light on resources.",
    },
    "llama-3b": {
        "repo": "bartowski/Llama-3.2-3B-Instruct-GGUF",
        "file": "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        "name": "Llama 3.2 3B",
        "size": "2.0 GB",
        "ram": "3 GB",
        "tps_estimate": "~5-8 t/s",
        "description": "Better reasoning. Needs more RAM.",
    },
    "qwen-05b": {
        "repo": "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
        "file": "qwen2.5-0.5b-instruct-q4_k_m.gguf",
        "name": "Qwen 2.5 0.5B",
        "size": "469 MB",
        "ram": "800 MB",
        "tps_estimate": "~33 t/s",
        "description": "Fastest. Lower quality on complex tasks.",
    },
}


class ModelManager:
    def __init__(self, models_dir: str = "./models"):
        self.models_dir = Path(models_dir)
        self.models_dir.mkdir(exist_ok=True)
        self.downloading: dict = {}  # model_id -> progress

    def list_models(self) -> list[dict]:
        """List all available models with installed status."""
        installed_files = set(f.name for f in self.models_dir.glob("*.gguf"))
        result = []
        for model_id, info in AVAILABLE_MODELS.items():
            is_installed = info["file"] in installed_files
            result.append({
                "id": model_id,
                "name": info["name"],
                "file": info["file"],
                "size": info["size"],
                "ram": info["ram"],
                "tps_estimate": info["tps_estimate"],
                "description": info["description"],
                "installed": is_installed,
                "downloading": model_id in self.downloading,
                "path": str(self.models_dir / info["file"]) if is_installed else None,
            })
        return result

    def get_download_progress(self, model_id: str) -> dict | None:
        """Get download progress for a model. Returns None if not downloading."""
        return self.downloading.get(model_id)

    def download(self, model_id: str) -> dict:
        """Start downloading a model in background. Returns immediately."""
        if model_id not in AVAILABLE_MODELS:
            raise ValueError(f"Unknown model: {model_id}")

        info = AVAILABLE_MODELS[model_id]
        dest = self.models_dir / info["file"]

        if dest.exists():
            return {"status": "already_installed", "path": str(dest)}

        if model_id in self.downloading:
            return {"status": "already_downloading"}

        # Start download in background thread
        self.downloading[model_id] = {
            "status": "downloading",
            "started": time.time(),
            "percent": 0,
            "downloaded_mb": 0,
            "total_mb": 0,
            "speed_mbps": 0,
        }

        def _download():
            try:
                # Use a custom tqdm callback to track progress
                import urllib.request
                import json as _json

                # Get file info to know total size
                try:
                    from huggingface_hub import hf_hub_url, get_hf_file_metadata
                    url = hf_hub_url(info["repo"], info["file"])
                    metadata = get_hf_file_metadata(url)
                    total_bytes = metadata.size or 0
                except Exception:
                    total_bytes = 0

                if total_bytes:
                    self.downloading[model_id]["total_mb"] = round(total_bytes / 1024 / 1024, 1)

                # Download with progress tracking via file size monitoring
                t_start = time.time()

                # Start actual download in sub-thread
                download_done = threading.Event()
                download_error = [None]

                def _do_download():
                    try:
                        hf_hub_download(
                            info["repo"],
                            info["file"],
                            local_dir=str(self.models_dir),
                            resume_download=True,
                        )
                    except Exception as e:
                        download_error[0] = e
                    finally:
                        download_done.set()

                t = threading.Thread(target=_do_download)
                t.start()

                # Monitor progress by checking partial file size
                while not download_done.is_set():
                    time.sleep(0.5)
                    # Check for partial downloads in HF cache or local dir
                    current_size = 0
                    for f in self.models_dir.rglob("*.incomplete"):
                        current_size = max(current_size, f.stat().st_size)
                    if dest.exists():
                        current_size = dest.stat().st_size

                    mb = round(current_size / 1024 / 1024, 1)
                    elapsed = time.time() - t_start
                    speed = round(mb / elapsed, 1) if elapsed > 0 else 0
                    pct = round((current_size / total_bytes) * 100, 1) if total_bytes > 0 else 0

                    self.downloading[model_id].update({
                        "percent": min(pct, 99.9),
                        "downloaded_mb": mb,
                        "speed_mbps": speed,
                        "elapsed_s": round(elapsed, 1),
                    })

                t.join()

                if download_error[0]:
                    self.downloading[model_id]["status"] = "error"
                    self.downloading[model_id]["error"] = str(download_error[0])
                else:
                    self.downloading[model_id]["status"] = "complete"
                    self.downloading[model_id]["percent"] = 100

                # Clean up after a delay so frontend can read final status
                time.sleep(3)
                if model_id in self.downloading:
                    del self.downloading[model_id]

            except Exception as e:
                self.downloading[model_id] = {"status": "error", "error": str(e)}
                time.sleep(3)
                if model_id in self.downloading:
                    del self.downloading[model_id]

        threading.Thread(target=_download, daemon=True).start()
        return {"status": "started"}

    def switch_model(self, model_id: str, compute_path) -> dict:
        """Switch the active model. Reloads llama.cpp with the new model."""
        if model_id not in AVAILABLE_MODELS:
            raise ValueError(f"Unknown model: {model_id}")

        info = AVAILABLE_MODELS[model_id]
        model_path = str(self.models_dir / info["file"])

        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model not installed: {info['file']}")

        from llama_cpp import Llama

        # Detect template
        model_name = info["file"].lower()
        template = "llama3" if "llama" in model_name else "chatml"

        # Release old model
        if hasattr(compute_path, 'llm') and compute_path.llm:
            del compute_path.llm

        # Load new model
        compute_path.llm = Llama(
            model_path=model_path,
            n_ctx=4096,
            n_threads=compute_path.n_threads,
            n_gpu_layers=0,
            verbose=False,
        )
        compute_path.model_path = model_path
        compute_path.template = template

        return {"status": "switched", "model": info["name"], "path": model_path}
