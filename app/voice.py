"""Stage 2b - Voiceover + word-level timings (edge-tts -> silent fallback with estimated timings)."""
from __future__ import annotations
import asyncio, re
from . import config
from .media import run, duration
from .schemas import WordTiming


def _estimate(text: str, total: float) -> list[WordTiming]:
    words = text.split()
    weights = [max(len(re.sub(r"\W", "", w)), 1) + 1 for w in words]
    s, t = sum(weights), 0.0
    out = []
    for w, wt in zip(words, weights):
        d = total * wt / s
        out.append(WordTiming(text=w, start=t, end=t + d))
        t += d
    return out


async def _edge(text: str, path: str) -> list[WordTiming]:
    import edge_tts
    try:
        comm = edge_tts.Communicate(text, config.TTS_VOICE, boundary="WordBoundary")
    except TypeError:  # older edge-tts: word boundaries are the default
        comm = edge_tts.Communicate(text, config.TTS_VOICE)
    words: list[WordTiming] = []
    with open(path, "wb") as f:
        async for ch in comm.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                s = ch["offset"] / 1e7
                words.append(WordTiming(text=ch["text"], start=s, end=s + ch["duration"] / 1e7))
    return words


def make_voice(index: int, text: str, path: str, usage: dict, emit) -> tuple[float, list[WordTiming], str]:
    if not config.MOCK:
        for attempt in range(1, 4):
            try:
                words = asyncio.run(asyncio.wait_for(_edge(text, path), timeout=60))
                dur = duration(path)
                usage["tts_chars"] = usage.get("tts_chars", 0) + len(text)
                if len(words) < max(1, len(text.split()) // 2):  # sentence-level boundaries only
                    words = _estimate(text, dur)
                return dur, words, "edge-tts"
            except Exception as e:
                emit(f"scene {index + 1}: tts attempt {attempt} failed ({type(e).__name__})")
        emit(f"scene {index + 1}: using silent-audio fallback")
    est = max(len(text.split()) / 2.6, 2.5)
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", f"{est:.2f}", "-c:a", "libmp3lame", path])
    return duration(path), _estimate(text, est), "silent-fallback"
