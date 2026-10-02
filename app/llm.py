"""Stage 1 - Script: topic -> schema-validated ScenePlan (Claude -> Gemini -> mock fallback)."""
from __future__ import annotations
import json, re, logging
import httpx
from pydantic import ValidationError
from . import config
from .schemas import ScenePlan

log = logging.getLogger("feedforge.llm")

SYSTEM = """You are a short-form video scriptwriter for Qoneqt, a community-first social platform where people discover communities and share content in a Global Feed.
Write a vertical (9:16) video that hooks in the first 2 seconds, teaches or entertains, and ends with a call to join the conversation in a community.
Return ONLY a JSON object, no markdown, matching exactly:
{
 "title": "short title",
 "hook": "first-line hook, max 12 words",
 "caption": "post caption for the feed, 1-2 sentences",
 "hashtags": ["#tag1", "#tag2"],
 "scenes": [
   {"narration": "12-22 spoken words, plain text, no emojis",
    "visual_prompt": "vivid description for an image generator: subject, setting, lighting, style. No text in image.",
    "on_screen_text": "optional 2-5 word overlay"}
 ]
}
Rules: exactly N scenes (N given by user); narration reads naturally aloud; first scene narration starts with the hook; visual prompts are concrete and cinematic; keep everything safe, factual and non-defamatory."""


def _extract_json(text: str) -> dict:
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    a, b = text.find("{"), text.rfind("}")
    if a == -1 or b == -1:
        raise ValueError("no JSON object in LLM output")
    return json.loads(text[a : b + 1])


def _call_anthropic(prompt: str) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY, timeout=60)
    msg = client.messages.create(
        model=config.LLM_MODEL, max_tokens=2000, system=SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(b.text for b in msg.content if b.type == "text")


def _call_gemini(prompt: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{config.GEMINI_MODEL}:generateContent"
    r = httpx.post(
        url, params={"key": config.GEMINI_API_KEY}, timeout=60,
        json={
            "systemInstruction": {"parts": [{"text": SYSTEM}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.9},
        },
    )
    r.raise_for_status()
    return r.json()["candidates"][0]["content"]["parts"][0]["text"]


def _mock_plan(topic: str, n: int) -> ScenePlan:
    beats = [
        f"Did you know {topic} is changing faster than most people realise?",
        f"Here is the simple idea behind {topic}, explained in plain words anyone can follow.",
        f"The big win with {topic} is that small, steady steps add up quickly over time.",
        f"A common mistake with {topic} is rushing, so slow down and focus on the basics first.",
        f"Ready to explore {topic} with people who care about it? Join the community on Qoneqt today.",
        f"Real stories from real people show how {topic} can open unexpected doors.",
        f"Try one small experiment with {topic} this week and share what you learn.",
        f"Come talk about {topic} with us on Qoneqt and keep the conversation going.",
    ]
    beats = beats[: n - 1] + [beats[4]]
    scenes = [
        {"narration": b, "visual_prompt": f"cinematic vertical illustration about {topic}, scene {i + 1}, soft light, vibrant colors",
         "on_screen_text": topic[:30] if i == 0 else None}
        for i, b in enumerate(beats)
    ]
    return ScenePlan.model_validate({
        "title": topic[:80], "hook": beats[0][:130],
        "caption": f"A quick look at {topic}. Join the conversation on Qoneqt!",
        "hashtags": ["#Qoneqt", "#Community", "#" + re.sub(r"\W", "", topic.title())[:24]],
        "scenes": scenes,
    })


def generate_plan(topic: str, tone: str, n_scenes: int, community: str | None, usage: dict, emit) -> ScenePlan:
    prompt = f"Topic: {topic}\nTone: {tone}\nN scenes: {n_scenes}\n" + (f"Target community: {community}\n" if community else "")
    providers = []
    if not config.MOCK:
        if config.ANTHROPIC_API_KEY:
            providers.append(("anthropic", _call_anthropic))
        if config.GEMINI_API_KEY:
            providers.append(("gemini", _call_gemini))
    for name, fn in providers:
        err_note = ""
        for attempt in range(1, 4):
            try:
                raw = fn(prompt + err_note)
                usage["llm_calls"] = usage.get("llm_calls", 0) + 1
                plan = ScenePlan.model_validate(_extract_json(raw))
                emit(f"script ok via {name} (attempt {attempt}, {len(plan.scenes)} scenes)")
                return plan
            except (ValidationError, ValueError, json.JSONDecodeError) as e:
                err_note = f"\n\nYour previous output was invalid: {str(e)[:300]}. Return ONLY valid JSON for exactly {n_scenes} scenes."
                emit(f"script {name} attempt {attempt} invalid output, retrying")
            except Exception as e:  # network / auth / rate limit
                emit(f"script {name} attempt {attempt} failed: {type(e).__name__}: {str(e)[:120]}")
    emit("script: using offline template fallback")
    return _mock_plan(topic, n_scenes)
