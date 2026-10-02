"""Stage 4 - Quality gate: a video is only 'ready' if every check passes."""
from __future__ import annotations
from pathlib import Path
from .media import probe


def quality_gate(path: Path, expected_scenes: int) -> dict:
    checks = {}
    try:
        info = probe(str(path))
        v = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
        a = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
        dur = float(info["format"]["duration"])
        checks["file_not_empty"] = path.stat().st_size > 50_000
        checks["video_stream"] = v is not None
        checks["aspect_9_16"] = bool(v) and abs(v["width"] / v["height"] - 9 / 16) < 0.01
        checks["resolution_1080x1920"] = bool(v) and (v["width"], v["height"]) == (1080, 1920)
        checks["audio_present"] = a is not None
        checks["duration_8_to_90s"] = 8 <= dur <= 90
        checks["scene_count_ok"] = 3 <= expected_scenes <= 8
        report = {"duration_s": round(dur, 2), "size_mb": round(path.stat().st_size / 1e6, 2)}
    except Exception as e:
        checks["probe_ok"] = False
        report = {"error": str(e)[:200]}
    return {"passed": all(checks.values()), "checks": checks, **report}
