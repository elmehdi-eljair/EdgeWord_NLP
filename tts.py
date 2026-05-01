"""
EdgeWord NLP — Text-to-Speech Module
Converts text to speech using Piper TTS (ONNX, CPU-native).

Usage:
    tts = TextToSpeech()
    tts.speak("Hello world", output_path="output.wav")
"""

import io
import time
import wave
import urllib.request
from pathlib import Path

BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
RESET = "\033[0m"

DEFAULT_VOICE = "en_US-lessac-medium"
VOICE_BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/"


class TextToSpeech:
    """Piper-based text-to-speech, CPU-only."""

    def __init__(self, voice: str = DEFAULT_VOICE):
        print(f"{DIM}Loading TTS model ({voice})...{RESET}", end=" ", flush=True)
        t0 = time.perf_counter()
        from piper import PiperVoice

        # Download voice model if needed
        data_dir = Path(__file__).parent / ".cache" / "piper"
        data_dir.mkdir(parents=True, exist_ok=True)

        model_file = data_dir / f"{voice}.onnx"
        config_file = data_dir / f"{voice}.onnx.json"

        if not model_file.exists():
            print(f"\n  {DIM}Downloading voice model...{RESET}", end=" ", flush=True)
            urllib.request.urlretrieve(
                f"{VOICE_BASE_URL}{voice}.onnx",
                str(model_file),
            )
            urllib.request.urlretrieve(
                f"{VOICE_BASE_URL}{voice}.onnx.json",
                str(config_file),
            )

        self.voice = PiperVoice.load(str(model_file), config_path=str(config_file))
        self.voice_name = voice
        elapsed = time.perf_counter() - t0
        print(f"{GREEN}ready{RESET} {DIM}({elapsed:.1f}s){RESET}")

    def synthesize(self, text: str) -> tuple[bytes, int, float]:
        """Synthesize text to WAV audio bytes. Returns (wav_bytes, sample_rate, elapsed)."""
        t0 = time.perf_counter()
        sample_rate = self.voice.config.sample_rate

        # Collect raw audio from all chunks
        raw_audio = b""
        for chunk in self.voice.synthesize(text):
            raw_audio += chunk.audio_int16_bytes

        # Wrap in WAV format
        audio_buffer = io.BytesIO()
        with wave.open(audio_buffer, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(raw_audio)

        elapsed = time.perf_counter() - t0
        wav_bytes = audio_buffer.getvalue()

        return wav_bytes, sample_rate, elapsed

    def speak(self, text: str, output_path: str = "output.wav") -> dict:
        """Synthesize text and save to a WAV file."""
        wav_bytes, sample_rate, elapsed = self.synthesize(text)

        out = Path(output_path)
        out.write_bytes(wav_bytes)

        return {
            "output_path": str(out),
            "sample_rate": sample_rate,
            "size_bytes": len(wav_bytes),
            "processing_s": round(elapsed, 3),
            "text_length": len(text),
        }
