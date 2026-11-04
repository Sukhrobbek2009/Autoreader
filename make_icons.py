"""Generate speaker-with-soundwaves icons as transparent PNGs.

Usage: python make_icons.py
Writes extension/icons/icon{16,32,48,128,256,512}.png next to this script.
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZES = [16, 32, 48, 128, 256, 512]
COLOR = (37, 99, 235, 255)  # blue, readable on light and dark toolbars
SUPERSAMPLE = 4             # draw large, then downscale for smooth edges
OUT_DIR = Path(__file__).parent / "extension" / "icons"


def draw_icon(size: int) -> Image.Image:
    big = size * SUPERSAMPLE
    k = big / 512  # all coordinates below are on a 512-unit grid
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def s(*pts):
        return [v * k for v in pts]

    # Speaker: small box plus flared cone
    d.rectangle(s(60, 190, 150, 322), fill=COLOR)
    d.polygon(s(140, 190, 260, 90, 260, 422, 140, 322), fill=COLOR)

    # Sound waves: two arcs centred on the speaker, thicker at larger sizes
    width = max(int(34 * k), 1)
    for r in (110, 190):
        cx, cy = 270, 256
        d.arc(s(cx - r, cy - r, cx + r, cy + r), start=-45, end=45,
              fill=COLOR, width=width)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT_DIR / f"icon{size}.png"
        draw_icon(size).save(path)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
