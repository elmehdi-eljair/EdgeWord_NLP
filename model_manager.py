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
import requests


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
    def __init__(self, models_dir: str = "./models", on_notify=None):
        self.models_dir = Path(models_dir)
        self.models_dir.mkdir(exist_ok=True)
        self.downloading: dict = {}  # model_id -> progress
        self.on_notify = on_notify  # callback(type, title, body, link, icon)

    def list_models(self) -> list[dict]:
        """List all available models with installed status."""
        result = []
        for model_id, info in AVAILABLE_MODELS.items():
            fpath = self.models_dir / info["file"]
            part_path = fpath.with_suffix(".gguf.part")
            # Only count as installed if file exists AND no .part file (still downloading)
            is_installed = fpath.exists() and not part_path.exists() and fpath.stat().st_size > 100_000_000
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

        part_path = dest.with_suffix(".gguf.part")
        if dest.exists() and not part_path.exists() and dest.stat().st_size > 100_000_000:
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
                import requests

                # Build direct HuggingFace CDN URL
                url = f"https://huggingface.co/{info['repo']}/resolve/main/{info['file']}"
                tmp = dest.with_suffix(".gguf.part")

                # Resume support: check for partial download
                downloaded = tmp.stat().st_size if tmp.exists() else 0
                hdrs = {"User-Agent": "edgeword-nlp/1.0"}
                if downloaded > 0:
                    hdrs["Range"] = f"bytes={downloaded}-"

                r = requests.get(url, stream=True, allow_redirects=True, headers=hdrs, timeout=30)
                r.raise_for_status()

                # Total size from Content-Length (or Content-Range for resumed)
                if r.status_code == 206:  # Partial content (resume)
                    total_bytes = downloaded + int(r.headers.get("content-length", 0))
                else:
                    total_bytes = int(r.headers.get("content-length", 0))
                    downloaded = 0  # Server didn't support range, restart

                if total_bytes:
                    self.downloading[model_id]["total_mb"] = round(total_bytes / 1024 / 1024, 1)

                t_start = time.time()
                mode = "ab" if downloaded > 0 else "wb"
                with open(tmp, mode) as f:
                    for chunk in r.iter_content(chunk_size=256 * 1024):
                        f.write(chunk)
                        downloaded += len(chunk)
                        elapsed = time.time() - t_start
                        speed = round((downloaded / 1024 / 1024) / elapsed, 1) if elapsed > 0 else 0
                        pct = round((downloaded / total_bytes) * 100, 1) if total_bytes > 0 else 0
                        self.downloading[model_id].update({
                            "percent": min(pct, 99.9),
                            "downloaded_mb": round(downloaded / 1024 / 1024, 1),
                            "speed_mbps": speed,
                            "elapsed_s": round(elapsed, 1),
                        })

                # Rename to final destination
                tmp.rename(dest)
                self.downloading[model_id]["status"] = "complete"
                self.downloading[model_id]["percent"] = 100
                elapsed = time.time() - t_start
                if self.on_notify:
                    self.on_notify(
                        "SUCCESS", f"{info['name']} ready",
                        f"Downloaded {info['size']} in {elapsed/60:.0f}m. You can now activate it.",
                        "model", "download",
                    )

                # Clean up after a delay so frontend can read final status
                time.sleep(5)
                if model_id in self.downloading:
                    del self.downloading[model_id]

            except Exception as e:
                if self.on_notify:
                    self.on_notify(
                        "ERROR", f"{info['name']} download failed",
                        str(e), "model", "error",
                    )
                self.downloading[model_id] = {"status": "error", "error": str(e)}
                time.sleep(5)
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

        # Don't switch to a file that's still being downloaded
        part_path = model_path + ".part"
        if os.path.exists(part_path):
            raise ValueError(f"Model is still downloading: {info['file']}")

        file_size = os.path.getsize(model_path)
        if file_size < 100_000_000:  # < 100 MB means incomplete
            raise ValueError(f"Model file appears incomplete ({file_size // 1024 // 1024} MB)")

        from llama_cpp import Llama

        # Detect template
        model_name = info["file"].lower()
        template = "llama3" if "llama" in model_name else "chatml"

        # Release old model safely
        if hasattr(compute_path, 'llm') and compute_path.llm:
            try:
                del compute_path.llm
            except Exception:
                compute_path.llm = None

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
