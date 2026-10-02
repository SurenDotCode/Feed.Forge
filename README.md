# FeedForge — Team Optimus (CTRL FREAK 2026 × Qoneqt)

One topic in → one publish-ready 9:16 captioned, narrated MP4 out, for the Qoneqt Global Feed.

**Pipeline:** Script (LLM → schema-validated scene plan) → Generate (image + voice per scene, in parallel) → Compose (FFmpeg Ken-Burns + word-synced burned captions) → Validate (quality gate).

## Run locally
```bash
# needs Python 3.11+ and ffmpeg (with libass) on PATH
pip install -r requirements.txt
cp .env.example .env      # add ANTHROPIC_API_KEY (or GEMINI_API_KEY)
set -a; source .env; set +a
uvicorn app.main:app --port 7860     # open http://localhost:7860
```
Offline test (no keys, no network): `FEEDFORGE_MOCK=1 python -m tests.smoke`

## API
- `POST /api/jobs` `{"topic": "...", "scenes": 5}` · `POST /api/batch` `{"topics": ["..",".."]}`
- `GET /api/jobs` · `GET /api/jobs/{id}` (logs, stage, usage, est. cost, quality report) · `GET /api/jobs/{id}/video`

## Engineering properties
- **Typed contracts:** Pydantic models between every stage (`app/schemas.py`); LLM output is validated and retried up to 3x, then falls back Claude → Gemini → offline template.
- **Resilient generation:** per-scene retries; failed image → gradient card, failed TTS → silent audio with estimated timings. A scene degrades, the video still ships (reported in `degraded_scenes`).
- **Captions:** word-level timestamps from edge-tts WordBoundary events → ASS subtitles burned in (readable on mute).
- **Quality gate:** 9:16, 1080x1920, audio present, 8–90 s, scene count, file integrity.
- **Batch mode:** worker pool processes queued topics unattended; every job has a full log and `job.json`.
- **Model-agnostic:** swap stages in `llm.py`, `visuals.py`, `voice.py`.

## Deploy (Docker: Hugging Face Spaces / Render / Railway)
`Dockerfile` included (installs ffmpeg + fonts, listens on `$PORT`, default 7860). Set `ANTHROPIC_API_KEY` as a secret.
