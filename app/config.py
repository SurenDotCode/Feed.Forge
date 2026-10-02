import os
from pathlib import Path

def _b(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes")

MOCK = _b("FEEDFORGE_MOCK")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
LLM_MODEL = os.getenv("LLM_MODEL", "claude-sonnet-4-6")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
IMAGE_PROVIDER = os.getenv("IMAGE_PROVIDER", "pollinations").lower()
TTS_VOICE = os.getenv("TTS_VOICE", "en-US-AriaNeural")
DEFAULT_SCENES = int(os.getenv("DEFAULT_SCENES", "5"))
WORKERS = int(os.getenv("WORKERS", "2"))
DATA_DIR = Path(os.getenv("DATA_DIR", "./data")).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

W, H, FPS = 1080, 1920, 30
