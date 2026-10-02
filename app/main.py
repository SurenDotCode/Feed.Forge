from __future__ import annotations
import logging
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from . import config
from .jobs import manager
from .schemas import BatchRequest, JobRequest

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="FeedForge", description="Topic in, publish-ready Qoneqt video out.")
STATIC = Path(__file__).parent / "static"


@app.get("/health")
def health():
    return {"ok": True, "mock": config.MOCK, "llm": "anthropic" if config.ANTHROPIC_API_KEY else "gemini" if config.GEMINI_API_KEY else "offline-template",
            "image_provider": config.IMAGE_PROVIDER, "workers": config.WORKERS}


@app.post("/api/jobs")
def create_job(req: JobRequest):
    return manager.submit(req).to_dict()


@app.post("/api/batch")
def create_batch(req: BatchRequest):
    jobs = [manager.submit(JobRequest(topic=t.strip(), tone=req.tone, scenes=req.scenes)) for t in req.topics if len(t.strip()) >= 3]
    return {"jobs": [j.to_dict() for j in jobs]}


@app.get("/api/jobs")
def list_jobs():
    return {"jobs": [j.to_dict() for j in manager.list()]}


@app.get("/api/jobs/{jid}")
def get_job(jid: str):
    j = manager.get(jid)
    if not j:
        raise HTTPException(404, "job not found")
    return j.to_dict()


@app.get("/api/jobs/{jid}/video")
def get_video(jid: str):
    j = manager.get(jid)
    if not j or not j.result:
        raise HTTPException(404, "video not ready")
    return FileResponse(j.result["video"], media_type="video/mp4", filename=f"feedforge_{jid}.mp4")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
