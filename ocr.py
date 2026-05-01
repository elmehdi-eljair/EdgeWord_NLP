"""
EdgeWord NLP — OCR Module
Extracts text from images using Tesseract OCR.

Usage:
    ocr = OCREngine()
    result = ocr.extract("screenshot.png")
    print(result["text"])
"""

import time
from pathlib import Path

BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
RESET = "\033[0m"


class OCREngine:
    """Tesseract-based OCR for extracting text from images."""

    def __init__(self):
        print(f"{DIM}Loading OCR engine (Tesseract)...{RESET}", end=" ", flush=True)
        t0 = time.perf_counter()
        import pytesseract
        from PIL import Image

        self._pytesseract = pytesseract
        self._Image = Image

        # Verify tesseract is available
        try:
            pytesseract.get_tesseract_version()
        except Exception as e:
            print(f"FAILED: {e}")
            raise RuntimeError("Tesseract not installed. Run: sudo apt install tesseract-ocr") from e

        elapsed = time.perf_counter() - t0
        print(f"{GREEN}ready{RESET} {DIM}({elapsed:.1f}s){RESET}")

    def extract(self, image_path: str, lang: str = "eng") -> dict:
        """Extract text from an image file."""
        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"Image not found: {image_path}")

        t0 = time.perf_counter()
        img = self._Image.open(str(path))
        text = self._pytesseract.image_to_string(img, lang=lang)
        elapsed = time.perf_counter() - t0

        # Get detailed data
        data = self._pytesseract.image_to_data(img, lang=lang, output_type=self._pytesseract.Output.DICT)
        word_count = sum(1 for t in data["text"] if t.strip())
        confidence_values = [int(c) for c, t in zip(data["conf"], data["text"]) if t.strip() and int(c) > 0]
        avg_confidence = sum(confidence_values) / len(confidence_values) if confidence_values else 0

        return {
            "text": text.strip(),
            "word_count": word_count,
            "confidence": round(avg_confidence, 1),
            "image_size": f"{img.width}x{img.height}",
            "processing_ms": round(elapsed * 1000, 1),
            "language": lang,
        }
