"""Typed contracts between every pipeline stage."""
from __future__ import annotations
from pydantic import BaseModel, Field


class Scene(BaseModel):
    narration: str = Field(min_length=5, max_length=420)
    visual_prompt: str = Field(min_length=5, max_length=420)
    on_screen_text: str | None = Field(default=None, max_length=60)


class ScenePlan(BaseModel):
    title: str = Field(min_length=3, max_length=100)
    hook: str = Field(min_length=3, max_length=140)
    caption: str = Field(min_length=3, max_length=500)
    hashtags: list[str] = Field(default_factory=list, max_length=12)
    scenes: list[Scene] = Field(min_length=3, max_length=8)


class WordTiming(BaseModel):
    text: str
    start: float  # seconds, relative to scene start
    end: float


class SceneAssets(BaseModel):
    index: int
    image_path: str
    audio_path: str
    duration: float
    words: list[WordTiming]
    image_source: str   # pollinations | pillow-fallback
    audio_source: str   # edge-tts | silent-fallback


class JobRequest(BaseModel):
    topic: str = Field(min_length=3, max_length=300)
    tone: str = Field(default="energetic, friendly, curious", max_length=100)
    scenes: int | None = Field(default=None, ge=3, le=8)
    community: str | None = Field(default=None, max_length=80)


class BatchRequest(BaseModel):
    topics: list[str] = Field(min_length=1, max_length=25)
    tone: str = "energetic, friendly, curious"
    scenes: int | None = Field(default=None, ge=3, le=8)
