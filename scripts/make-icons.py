#!/usr/bin/env python3
"""Generate Klyro's application icons.

Run: python3 scripts/make-icons.py
Writes build/icon.png (1024), build/icon-256.png, build/icon.ico.
The generated files are committed, so a release build does not need Python.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
RADIUS = int(SIZE * 0.22)
TOP = (124, 127, 245)
BOTTOM = (59, 62, 207)
GLYPH = (255, 255, 255)
BUILD = Path(__file__).resolve().parent.parent / "build"


def gradient(size: int) -> Image.Image:
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    for y in range(size):
        ratio = y / max(1, size - 1)
        # Ease slightly so the dark end occupies more of the tile.
        eased = ratio ** 0.85
        row = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * eased) for i in range(3))
        for x in range(size):
            pixels[x, y] = row
    return image


def mask(size: int, radius: int) -> Image.Image:
    shape = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(shape).rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius=radius * 4, fill=255)
    return shape.resize((size, size), Image.LANCZOS)


def glyph(size: int) -> Image.Image:
    """A geometric 'K' built from strokes so no font is required."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    stroke = round(size * 0.085)
    left = round(size * 0.31)
    right = round(size * 0.70)
    top = round(size * 0.26)
    bottom = round(size * 0.74)
    middle = round(size * 0.50)

    draw.line([(left, top), (left, bottom)], fill=GLYPH, width=stroke)
    draw.line([(left, middle), (right, top)], fill=GLYPH, width=stroke)
    draw.line([(left + stroke // 2, middle), (right, bottom)], fill=GLYPH, width=stroke)

    for x, y in ((left, top), (left, bottom), (right, top), (right, bottom)):
        draw.ellipse([x - stroke // 2, y - stroke // 2, x + stroke // 2, y + stroke // 2], fill=GLYPH)
    return layer


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)

    canvas = gradient(SIZE).convert("RGBA")
    canvas.putalpha(mask(SIZE, RADIUS))
    canvas.alpha_composite(glyph(SIZE))

    icon = canvas.resize((1024, 1024), Image.LANCZOS)
    icon.save(BUILD / "icon.png")
    icon.resize((256, 256), Image.LANCZOS).save(BUILD / "icon-256.png")
    icon.save(BUILD / "icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"wrote {BUILD/'icon.png'}, {BUILD/'icon-256.png'}, {BUILD/'icon.ico'}")


if __name__ == "__main__":
    main()
