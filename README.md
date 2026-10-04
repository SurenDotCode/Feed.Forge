# FeedForge — Team Optimus (CTRL FREAK 2026 × Qoneqt)

One topic in → one publish-ready 9:16 captioned, narrated MP4 out, for the Qoneqt Global Feed.

**Pipeline:** Script (Gemini → schema-validated scene plan) → Generate (voiceover + stock visuals per scene) → Compose (Remotion: animated word-synced captions, motion, transitions → 1080×1920 MP4) → Validate (ffprobe quality gate) → publish pack (title, caption, hashtags).

```
public/          Web UI (index.html + static/ assets: shader hero, effects, job actions)
server/          Backend API + video engine (Node 22, TypeScript)
```

## Run locally
Requirements: Node.js 22+, FFmpeg (with ffprobe) on PATH, a Google AI Studio key, a Pixabay key (free).

```bash
cd server
npm install
npx remotion browser ensure
cp .env.example .env          # Windows: copy .env.example .env  — then fill in the keys
npm start                     # open http://localhost:7860
```
Offline test (no keys, no cost): `npm run smoke`.
Windows: enable Settings → For developers → Developer Mode (the renderer needs symlinks).

## API
- `POST /api/jobs` `{"topic": "...", "scenes": 3-8 | null}` · `POST /api/batch` `{"topics": ["..",".."]}` (max 25)
- `GET /api/jobs` · `GET /api/jobs/{id}` (logs, stage, plan, usage, est. cost, quality report)
- `GET /api/jobs/{id}/video` (Range supported, `?download=1`) · `DELETE /api/jobs/{id}` (409 while running)
- `GET /health`

## Engineering properties
- **Typed contracts:** Zod-validated scene plan from the LLM; strict request validation.
- **Economy mode:** ~3 Google API calls per video (no research/critic loops/prompt rewriting).
- **Model fallback chains:** free-tier quota is per model, so text and voice models fall back automatically; no wasted retries on quota errors.
- **Resilient generation:** stock-photo fallback when AI images are unavailable, neighbour-image reuse, audio-timed captions when the alignment model can't load, re-encoded stock clips with measured durations.
- **Quality gate:** 9:16, 1080×1920, audio present, duration window, scene count, file integrity — named checks in every job.
- **Batch mode + persistence:** worker pool; every job keeps a full log and `job.json`, restored on restart.
- **Render safety:** bundled fonts (works offline).

The rendering core is adapted from the open-source OpenReels engine (MIT, see `server/LICENSE`).
