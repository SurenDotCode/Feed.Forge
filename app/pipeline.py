"""Orchestrates Script -> Generate -> Compose -> Validate for one job."""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from . import config
from .llm import generate_plan
from .visuals import make_image
from .voice import make_voice
from .compose import compose
from .validate import quality_gate
from .schemas import SceneAssets, ScenePlan


def _scene(i: int, scene, workdir: Path, usage: dict, emit) -> SceneAssets:
    img, aud = str(workdir / f"scene_{i}.jpg"), str(workdir / f"scene_{i}.mp3")
    label = scene.on_screen_text or scene.narration.split(".")[0][:40]
    src_i = make_image(i, scene.visual_prompt, label, img, usage, emit)
    dur, words, src_a = make_voice(i, scene.narration, aud, usage, emit)
    emit(f"scene {i + 1}/{{n}} ready ({dur:.1f}s, image={src_i}, voice={src_a})")
    return SceneAssets(index=i, image_path=img, audio_path=aud, duration=dur, words=words,
                       image_source=src_i, audio_source=src_a)


def run_pipeline(job, emit) -> dict:
    req, workdir, usage = job.request, job.dir, job.usage
    n = req.scenes or config.DEFAULT_SCENES

    job.stage = "script"
    emit("stage 1/4: script")
    plan: ScenePlan = generate_plan(req.topic, req.tone, n, req.community, usage, emit)
    (workdir / "plan.json").write_text(plan.model_dump_json(indent=2))
    job.plan = plan.model_dump()

    job.stage = "generate"
    emit("stage 2/4: generate visuals + voice")
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = [ex.submit(_scene, i, s, workdir, usage, lambda m: emit(m.replace("{n}", str(len(plan.scenes))))) for i, s in enumerate(plan.scenes)]
        assets = [f.result() for f in futs]

    job.stage = "compose"
    emit("stage 3/4: compose (ffmpeg)")
    final = compose(assets, plan.hook, workdir)

    job.stage = "validate"
    emit("stage 4/4: quality gate")
    report = quality_gate(final, len(plan.scenes))
    emit(f"quality gate {'PASSED' if report['passed'] else 'FAILED'}: {report}")
    if not report["passed"]:
        raise RuntimeError(f"quality gate failed: {report['checks']}")

    degraded = [a.index + 1 for a in assets if a.image_source != "pollinations" or a.audio_source != "edge-tts"]
    return {
        "video": str(final), "quality": report, "degraded_scenes": degraded,
        "publish_pack": {"title": plan.title, "caption": plan.caption, "hashtags": plan.hashtags},
    }
