"""Draws the app icons with Pillow: python3 tools/make_icons.py (writes icons/*.png)."""
from pathlib import Path
from PIL import Image, ImageDraw

MINT = (205, 238, 221)
GREEN = (20, 108, 67)
WHITE = (255, 255, 255)
OUT = Path(__file__).resolve().parent.parent / "icons"


def draw(size, maskable):
    s = 4  # supersample, then shrink for smooth edges
    n = size * s
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, n, n], fill=MINT)
        scale = 0.62  # keep the art inside the 80% safe zone
    else:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.22), fill=MINT)
        scale = 0.78
    # A capsule pill, tilted 45 degrees: draw it upright on its own layer, then rotate.
    w, h = int(n * scale * 0.42), int(n * scale)
    pill = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    p = ImageDraw.Draw(pill)
    p.rounded_rectangle([0, 0, w - 1, h - 1], radius=w // 2, fill=GREEN)
    # Lower half is white with a green outline, like a two-tone capsule.
    border = max(2, w // 9)
    lower = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    q = ImageDraw.Draw(lower)
    q.rounded_rectangle([border, border, w - 1 - border, h - 1 - border], radius=w // 2 - border, fill=WHITE)
    lower = lower.crop((0, h // 2, w, h))
    pill.alpha_composite(lower, (0, h // 2))
    pill = pill.rotate(-45, resample=Image.BICUBIC, expand=True)
    img.alpha_composite(pill, ((n - pill.width) // 2, (n - pill.height) // 2))
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    for size in (192, 512):
        draw(size, False).save(OUT / f"icon-{size}.png", optimize=True)
        draw(size, True).save(OUT / f"maskable-{size}.png", optimize=True)
    draw(180, True).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    draw(32, False).save(OUT / "favicon-32.png", optimize=True)


if __name__ == "__main__":
    main()
