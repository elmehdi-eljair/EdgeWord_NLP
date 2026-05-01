"""
EdgeWord NLP — Image Classification Module
Classifies images using MobileNetV2 via ONNX Runtime (CPU-native).
Requires a pre-exported ONNX model in .cache/image_classifier/

Setup (one-time, requires pip install optimum[onnxruntime]):
    optimum-cli export onnx --model google/mobilenet_v2_1.0_224 .cache/image_classifier/

Or download a pre-exported ONNX model and place it in .cache/image_classifier/model.onnx

Usage:
    clf = ImageClassifier()
    result = clf.classify("photo.jpg")
    print(result["top_labels"])
"""

import json
import time
import os
import numpy as np
import onnxruntime as ort
from pathlib import Path

BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RESET = "\033[0m"

IMAGENET_LABELS_URL = "https://raw.githubusercontent.com/anishathalye/imagenet-simple-labels/master/imagenet-simple-labels.json"


class ImageClassifier:
    """MobileNetV2 image classifier via ONNX Runtime."""

    def __init__(self):
        print(f"{DIM}Loading image classifier...{RESET}", end=" ", flush=True)
        t0 = time.perf_counter()
        from PIL import Image
        self._Image = Image

        # Look for ONNX model in .cache/image_classifier/
        cache_dir = Path(__file__).parent / ".cache" / "image_classifier"
        onnx_path = None
        if cache_dir.exists():
            for f in cache_dir.rglob("*.onnx"):
                onnx_path = str(f)
                break

        if onnx_path is None:
            raise FileNotFoundError(
                f"No ONNX model found in {cache_dir}. "
                "Export one with: optimum-cli export onnx --model google/mobilenet_v2_1.0_224 .cache/image_classifier/"
            )

        # Load ONNX session
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(
            onnx_path, opts, providers=["CPUExecutionProvider"]
        )
        self.input_name = self.session.get_inputs()[0].name

        # Load ImageNet labels
        labels_path = cache_dir / "labels.json"
        if labels_path.exists():
            with open(labels_path) as f:
                self.labels = json.load(f)
        else:
            # Fallback: try to download
            try:
                import urllib.request
                urllib.request.urlretrieve(IMAGENET_LABELS_URL, str(labels_path))
                with open(labels_path) as f:
                    self.labels = json.load(f)
            except Exception:
                self.labels = [f"class_{i}" for i in range(1000)]

        elapsed = time.perf_counter() - t0
        print(f"{GREEN}ready{RESET} {DIM}({elapsed:.1f}s, {len(self.labels)} classes){RESET}")

    def _preprocess(self, image_path: str) -> np.ndarray:
        """Load and preprocess image to model input format."""
        img = self._Image.open(image_path).convert("RGB")
        img = img.resize((224, 224))

        arr = np.array(img, dtype=np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        arr = (arr - mean) / std

        # HWC -> CHW -> NCHW
        arr = arr.transpose(2, 0, 1)
        arr = np.expand_dims(arr, axis=0)
        return arr

    def classify(self, image_path: str, top_k: int = 5) -> dict:
        """Classify an image, return top-K labels with confidence."""
        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"Image not found: {image_path}")

        t0 = time.perf_counter()
        input_tensor = self._preprocess(str(path))
        logits = self.session.run(None, {self.input_name: input_tensor})[0]

        # Softmax
        exp = np.exp(logits[0] - logits[0].max())
        probs = exp / exp.sum()

        # Top-K
        top_indices = np.argsort(probs)[::-1][:top_k]
        top_labels = []
        for idx in top_indices:
            label = self.labels[idx] if idx < len(self.labels) else f"class_{idx}"
            top_labels.append({
                "label": label,
                "confidence": round(float(probs[idx]), 4),
            })

        elapsed = time.perf_counter() - t0

        img = self._Image.open(str(path))
        return {
            "top_labels": top_labels,
            "image_size": f"{img.width}x{img.height}",
            "processing_ms": round(elapsed * 1000, 1),
        }
