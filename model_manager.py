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

    def download(self, model_id: str) -> dict:
        """Download a model from HuggingFace. Returns model info."""
        if model_id not in AVAILABLE_MODELS:
            raise ValueError(f"Unknown model: {model_id}")

        info = AVAILABLE_MODELS[model_id]
        dest = self.models_dir / info["file"]

        if dest.exists():
            return {"status": "already_installed", "path": str(dest)}

        self.downloading[model_id] = {"status": "downloading", "started": time.time()}
        try:
            hf_hub_download(
                info["repo"],
                info["file"],
                local_dir=str(self.models_dir),
            )
            del self.downloading[model_id]
            return {"status": "installed", "path": str(dest)}
        except Exception as e:
            del self.downloading[model_id]
            raise RuntimeError(f"Download failed: {e}")

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
