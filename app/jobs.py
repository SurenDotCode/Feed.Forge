"""In-memory + on-disk job queue with a worker pool (unattended batch runs, full job logs)."""
from __future__ import annotations
import json, threading, time, traceback, uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from . import config
from .schemas import JobRequest

# rough public list prices, only to make per-job cost *visible*; adjust freely
COST = {"llm_calls": 0.01, "images": 0.0, "tts_chars": 0.0}


class Job:
    def __init__(self, request: JobRequest):
        self.id = uuid.uuid4().hex[:10]
        self.request = request
        self.dir = config.DATA_DIR / self.id
        self.dir.mkdir(parents=True, exist_ok=True)
        self.status = "queued"
        self.stage = "queued"
        self.logs: list[str] = []
        self.usage: dict = {}
        self.plan: dict | None = None
        self.result: dict | None = None
        self.error: str | None = None
        self.created = time.time()
        self.started = self.finished = None

    def emit(self, msg: str):
        self.logs.append(f"[{time.strftime('%H:%M:%S')}] {msg}")

    def to_dict(self) -> dict:
        cost = sum(self.usage.get(k, 0) * v for k, v in COST.items())
        d = {"id": self.id, "topic": self.request.topic, "status": self.status, "stage": self.stage,
             "logs": self.logs[-40:], "usage": self.usage, "est_cost_usd": round(cost, 4),
             "plan": self.plan, "error": self.error, "created": self.created,
             "elapsed_s": round((self.finished or time.time()) - self.started, 1) if self.started else 0}
        if self.result:
            d.update({k: v for k, v in self.result.items() if k != "video"})
            d["video_url"] = f"/api/jobs/{self.id}/video"
        return d


class JobManager:
    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self.pool = ThreadPoolExecutor(max_workers=config.WORKERS)
        self.lock = threading.Lock()

    def submit(self, req: JobRequest) -> Job:
        job = Job(req)
        with self.lock:
            self.jobs[job.id] = job
        self.pool.submit(self._run, job)
        return job

    def _run(self, job: Job):
        from .pipeline import run_pipeline
        job.status, job.started = "running", time.time()
        job.emit(f"job {job.id} started: {job.request.topic!r}")
        try:
            job.result = run_pipeline(job, job.emit)
            job.status, job.stage = "done", "done"
        except Exception as e:
            job.status, job.error = "failed", f"{type(e).__name__}: {e}"
            job.emit("FAILED: " + job.error)
            job.emit(traceback.format_exc()[-800:])
        finally:
            job.finished = time.time()
            (job.dir / "job.json").write_text(json.dumps(job.to_dict(), indent=2, default=str))

    def get(self, jid: str) -> Job | None:
        return self.jobs.get(jid)

    def list(self) -> list[Job]:
        return sorted(self.jobs.values(), key=lambda j: j.created, reverse=True)


manager = JobManager()
