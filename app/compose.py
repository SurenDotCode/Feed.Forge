"""Stage 3 - Compose: Ken-Burns scene clips + voice -> concat -> burned word-synced captions -> 9:16 MP4."""
from __future__ import annotations
from pathlib import Path
from . import config
from .media import run
from .schemas import SceneAssets

TAIL = 0.35  # seconds of breathing room after each scene


def scene_clip(a: SceneAssets, out: str):
    dur = a.duration + TAIL
    frames = int(dur * config.FPS) + 1
    if a.index % 2 == 0:
        z = "min(zoom+0.0007,1.22)"
    else:
        z = "if(eq(on,0),1.22,max(zoom-0.0007,1.0))"
    vf = (f"scale=1296:2304,zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
          f":d={frames}:s={config.W}x{config.H}:fps={config.FPS},format=yuv420p")
    run(["ffmpeg", "-y", "-i", a.image_path, "-i", a.audio_path, "-vf", vf, "-af", "apad,aresample=44100",
         "-t", f"{dur:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-r", str(config.FPS),
         "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k", out])


def _ts(t: float) -> str:
    t = max(t, 0)
    h, m, s = int(t // 3600), int(t % 3600 // 60), t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def build_ass(assets: list[SceneAssets], hook: str, path: str):
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {config.W}
PlayResY: {config.H}
WrapStyle: 0

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Cap,DejaVu Sans,76,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,2,2,90,90,420,1
Style: Hook,DejaVu Sans,56,&H0000E5FF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,8,90,90,220,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
"""
    lines = [head]
    offset = 0.0
    for a in assets:
        words = a.words
        for i in range(0, len(words), 3):
            chunk = words[i : i + 3]
            start = offset + chunk[0].start
            nxt = words[i + 3].start if i + 3 < len(words) else chunk[-1].end + 0.25
            end = offset + nxt
            text = " ".join(w.text for w in chunk).replace("{", "(").replace("}", ")")
            lines.append(f"Dialogue: 0,{_ts(start)},{_ts(end)},Cap,,0,0,0,,{text}\n")
        offset += a.duration + TAIL
    safe_hook = hook.replace("{", "(").replace("}", ")")
    lines.append(f"Dialogue: 1,{_ts(0.1)},{_ts(3.2)},Hook,,0,0,0,,{{\\fad(200,300)}}{safe_hook}\n")
    Path(path).write_text("".join(lines), encoding="utf-8")


def compose(assets: list[SceneAssets], hook: str, workdir: Path) -> Path:
    clips = []
    for a in assets:
        out = workdir / f"clip_{a.index}.mp4"
        scene_clip(a, str(out))
        clips.append(out.name)
    (workdir / "concat.txt").write_text("".join(f"file '{c}'\n" for c in clips))
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "joined.mp4"], cwd=workdir)
    build_ass(assets, hook, str(workdir / "captions.ass"))
    run(["ffmpeg", "-y", "-i", "joined.mp4", "-vf", "subtitles=captions.ass", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", "final.mp4"], cwd=workdir)
    return workdir / "final.mp4"
