"""
EdgeWord NLP — Speech-to-Text Module
Transcribes audio using faster-whisper (CTranslate2, CPU-native).

Usage:
    stt = SpeechToText()
    result = stt.transcribe("audio.wav")
    print(result["text"])
"""

import time
from pathlib import Path

BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RESET = "\033[0m"

DEFAULT_MODEL = "tiny"  # tiny=75MB, base=150MB, small=500MB


class SpeechToText:
    """Whisper-based speech-to-text, CPU-only via CTranslate2."""

    def __init__(self, model_size: str = DEFAULT_MODEL):
        print(f"{DIM}Loading STT model (whisper-{model_size})...{RESET}", end=" ", flush=True)
        t0 = time.perf_counter()
        from faster_whisper import WhisperModel

        self.model = WhisperModel(
            model_size,
            device="cpu",
            compute_type="int8",
        )
        self.model_size = model_size
        elapsed = time.perf_counter() - t0
        print(f"{GREEN}ready{RESET} {DIM}({elapsed:.1f}s){RESET}")

    def transcribe(self, audio_path: str, language: str | None = None) -> dict:
        """Transcribe an audio file. Returns dict with text, language, duration, segments."""
        path = Path(audio_path)
        if not path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        t0 = time.perf_counter()
        segments, info = self.model.transcribe(
            str(path),
            language=language,
            beam_size=5,
            vad_filter=True,
        )

        # Collect all segments
        all_segments = []
        full_text_parts = []
        for seg in segments:
            all_segments.append({
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "text": seg.text.strip(),
            })
            full_text_parts.append(seg.text.strip())

        elapsed = time.perf_counter() - t0
        full_text = " ".join(full_text_parts)

        return {
            "text": full_text,
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "duration_s": round(info.duration, 2),
            "processing_s": round(elapsed, 2),
            "segments": all_segments,
        }
