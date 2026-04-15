"""Generate a multi-size Windows .ico from a source image.

Usage:
    python scripts/make-icon.py <source_image> <output_ico>

Embeds 16, 20, 24, 32, 40, 48, 64, 96, 128, 256 px variants so that
Windows Explorer / taskbar / title bar / ARP entries all pick a
native-resolution rendering.
"""

from __future__ import annotations

import sys
from pathlib import Path
from PIL import Image


SIZES = [(s, s) for s in (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)]


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2

    src = Path(sys.argv[1]).resolve()
    dst = Path(sys.argv[2]).resolve()

    if not src.is_file():
        print(f"[make-icon] source not found: {src}", file=sys.stderr)
        return 1

    dst.parent.mkdir(parents=True, exist_ok=True)

    img = Image.open(src).convert("RGBA")
    # Square the canvas so circular/portrait sources don't get stretched.
    w, h = img.size
    side = max(w, h)
    if (w, h) != (side, side):
        square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        square.paste(img, ((side - w) // 2, (side - h) // 2))
        img = square

    img.save(dst, format="ICO", sizes=SIZES)
    print(f"[make-icon] wrote {dst} ({len(SIZES)} sizes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
