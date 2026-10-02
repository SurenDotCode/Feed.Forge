"""Offline end-to-end smoke test: FEEDFORGE_MOCK=1 python -m tests.smoke"""
import os, time
os.environ.setdefault("FEEDFORGE_MOCK", "1")
os.environ.setdefault("DATA_DIR", "/tmp/ff-test")
from app.jobs import manager
from app.schemas import JobRequest

j = manager.submit(JobRequest(topic="Why community learning beats studying alone", scenes=4))
while j.status in ("queued", "running"):
    time.sleep(1)
print("\n".join(j.logs))
assert j.status == "done", j.error
assert j.result["quality"]["passed"], j.result["quality"]
print("OK", j.result["quality"], j.result["video"])
