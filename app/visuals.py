"""Stage 2a - Visuals: image per scene (Pollinations -> Pillow gradient fallback)."""
from __future__ import annotations
import io, textwrap, urllib.parse, time
import httpx
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from . import config

PALETTES = [((88, 28, 135), (236, 72, 153)), ((15, 118, 110), (59, 130, 246)),
            ((190, 18, 60), (251, 146, 60)), ((30, 64, 175), (16, 185, 129)),
            ((67, 56, 202), (14, 165, 233)), ((120, 53, 15), (234, 179, 8))]
FONTS = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]


def _font(size: int):
    for f in FONTS:
        try:
            return ImageFont.truetype(f, size)
        except Exception:
            pass
    return ImageFont.load_default(size=size)


def _cover(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    w, h = img.size
    scale = max(config.W / w, config.H / h)
    img = img.resize((int(w * scale) + 1, int(h * scale) + 1), Image.LANCZOS)
    l, t = (img.width - config.W) // 2, (img.height - config.H) // 2
    return img.crop((l, t, l + config.W, t + config.H))


def fallback_card(index: int, text: str, path: str):
    c1, c2 = PALETTES[index % len(PALETTES)]
    img = Image.new("RGB", (config.W, config.H))
    px = ImageDraw.Draw(img)
    for y in range(config.H):
        t = y / config.H
        px.line([(0, y), (config.W, y)], fill=tuple(int(c1[i] * (1 - t) + c2[i] * t) for i in range(3)))
    glow = Image.new("RGB", (config.W, config.H), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse((150, 500, 930, 1280), fill=(255, 255, 255))
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    img = Image.blend(img, Image.composite(Image.new("RGB", img.size, (255, 255, 255)), img, glow.convert("L")), 0.18)
    d = ImageDraw.Draw(img)
    f = _font(78)
    y = 640
    for line in textwrap.wrap(text.upper(), 15)[:5]:
        w = d.textlength(line, font=f)
        d.text(((config.W - w) / 2, y), line, font=f, fill="white", stroke_width=3, stroke_fill=(0, 0, 0))
        y += 100
    img.save(path, quality=92)


def make_image(index: int, visual_prompt: str, label: str, path: str, usage: dict, emit) -> str:
    if config.MOCK or config.IMAGE_PROVIDER != "pollinations":
        fallback_card(index, label, path)
        return "pillow-fallback"
    prompt = visual_prompt + ", vertical composition, cinematic lighting, highly detailed, no text, no watermark"
    url = f"https://image.pollinations.ai/prompt/{urllib.parse.quote(prompt)}"
    for attempt in range(1, 4):
        try:
            r = httpx.get(url, params={"width": 1080, "height": 1920, "nologo": "true", "seed": 1000 + index * 7 + attempt},
                          timeout=120, follow_redirects=True)
            r.raise_for_status()
            if "image" not in r.headers.get("content-type", ""):
                raise ValueError("non-image response")
            _cover(Image.open(io.BytesIO(r.content))).save(path, quality=92)
            usage["images"] = usage.get("images", 0) + 1
            return "pollinations"
        except Exception as e:
            emit(f"scene {index + 1}: image attempt {attempt} failed ({type(e).__name__})")
            time.sleep(1.5 * attempt)
    emit(f"scene {index + 1}: using gradient-card fallback")
    fallback_card(index, label, path)
    return "pillow-fallback"
