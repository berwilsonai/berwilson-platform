#!/usr/bin/env python3
"""
Build every Ber Wilson logo asset from the one source artwork.

Sources
  assets/ber-wilson-logo-source.png       the lockup as supplied: cream
                                          wordmark + coral/gold/teal chevron
                                          on a near-black field, 1024x1024.
  assets/ber-wilson-logo-light-source.png the company's own light-background
                                          lockup, lifted from the customer
                                          quote template (assets/steel-quote-
                                          template.docx, word/media/image1.png)
                                          so that every Ber Wilson document —
                                          an app print letterhead and a quote
                                          a customer signs — carries the same
                                          mark. It is already transparent, and
                                          it is NOT the dark one recoloured:
                                          the brand renders the chevron's
                                          third stroke black on light and teal
                                          on dark.

The dark source is a SQUARE ICON, which is what the app icons (home screen,
favicon, PWA) want. It cannot be used in the app chrome, though: a hard black
tile reads as a box on the navy sidebar and as a slab on a white print
letterhead. So it is keyed off its background into a transparent lockup for
dark surfaces, and the chevron is split out on its own for the collapsed
sidebar rail, where the full lockup is too wide to read.

Keying is done against a known palette rather than by unpremultiplying
luminance: the artwork is flat colour with antialiased edges, so matching each
pixel to its nearest brand colour and taking alpha from the luminance ratio
restores clean, fully-saturated shapes instead of edges that stay slightly
transparent (the max channel of every brand colour is well below 255, so a
naive alpha = max(r,g,b)/255 leaves solid fills 15-25% see-through).

Requires Pillow.  Run from the repo root:
    python3 scripts/build-logo-assets.py
"""

from __future__ import annotations

import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'ber-wilson-logo-source.png')
SRC_LIGHT = os.path.join(ROOT, 'assets', 'ber-wilson-logo-light-source.png')
PUB = os.path.join(ROOT, 'public')
APP = os.path.join(ROOT, 'src', 'app')

# Sampled from the source artwork (modal value of each flat region).
CREAM = (238, 231, 212)
CORAL = (203, 111, 86)
GOLD = (197, 154, 75)
TEAL = (113, 155, 143)
BLACK = (10, 10, 10)          # the field the lockup sits on

PALETTE = [CREAM, CORAL, GOLD, TEAL]

# Below this max-channel value a pixel is background noise, not artwork.
FLOOR = 14

# The source field is not perfectly flat — it carries a faint vignette that
# keys out at 1-3/255 of alpha. Left in, it is invisible but it fills the whole
# 1024px canvas, so every trim to the lockup's bounding box returns the entire
# frame. Genuine antialiasing ramps far faster than this, so nothing real is
# lost by discarding it.
ALPHA_FLOOR = 10


def lum(c):
    r, g, b = c
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def key_out_background(im: Image.Image) -> Image.Image:
    """Replace the black field with alpha, snapping fills to the brand palette."""
    im = im.convert('RGB')
    w, h = im.size
    src = im.load()
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    dst = out.load()

    pal_lum = [lum(c) for c in PALETTE]

    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            peak = max(r, g, b)
            if peak <= FLOOR:
                continue

            # Direction of the pixel's colour, independent of how much the
            # black field has darkened it, so an antialiased edge still
            # matches the fill it belongs to.
            scale = 255.0 / peak
            nr, ng, nb = r * scale, g * scale, b * scale

            best, best_d = 0, None
            for i, (pr, pg, pb) in enumerate(PALETTE):
                ps = 255.0 / max(pr, pg, pb)
                d = (nr - pr * ps) ** 2 + (ng - pg * ps) ** 2 + (nb - pb * ps) ** 2
                if best_d is None or d < best_d:
                    best, best_d = i, d

            colour = PALETTE[best]

            # Coverage: how far this pixel travelled from the black field
            # toward its own fill colour.
            base = lum(BLACK)
            a = (lum((r, g, b)) - base) / max(pal_lum[best] - base, 1.0)
            a = max(0.0, min(1.0, a))
            alpha = int(round(a * 255))
            if alpha < ALPHA_FLOOR:
                continue

            dst[x, y] = (colour[0], colour[1], colour[2], alpha)

    return out


def trim(im: Image.Image, pad: int = 0) -> Image.Image:
    box = im.getbbox()
    if not box:
        return im
    l, t, r, b = box
    w, h = im.size
    box = (max(0, l - pad), max(0, t - pad), min(w, r + pad), min(h, b + pad))
    return im.crop(box)


def split_chevron(im: Image.Image, min_gap: int = 8) -> Image.Image:
    """Return just the chevron — everything above the band that separates it
    from the wordmark.

    The separator has to be a RUN of empty rows, not the first single one: the
    coral peak is a near-horizontal edge, so its antialiasing leaves a one-row
    hole a couple of pixels below the very tip, and splitting there returns the
    tip alone.
    """
    w, h = im.size
    px = im.load()
    rows = [any(px[x, y][3] > 0 for x in range(w)) for y in range(h)]
    first = rows.index(True)
    run = 0
    for y in range(first, h):
        run = run + 1 if not rows[y] else 0
        if run >= min_gap:
            return trim(im.crop((0, 0, w, y - min_gap + 1)))
    return trim(im)


def fit_width(im: Image.Image, width: int) -> Image.Image:
    if im.width == width:
        return im
    return im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)


def compact(im: Image.Image, colours: int = 128) -> Image.Image:
    """Palette-reduce a keyed lockup.

    The artwork is five flat colours, but Lanczos resampling scatters ringing
    across thousands of near-identical values, which more than doubles the PNG
    over the un-resized original. Octree quantisation is the only Pillow method
    that keeps the alpha channel.
    """
    return im.quantize(colors=colours, method=Image.Quantize.FASTOCTREE)


def square_icon(art: Image.Image, size: int, fill: float = 0.75) -> Image.Image:
    """The lockup on a flat black square.

    Rebuilt from the keyed art rather than resized from the source so the
    field is flat: the source's near-black is dithered noise, which survives
    downscaling as grain, costs ~6x the file size in PNG, and muddies the
    lockup's edges at 32px.

    `fill` is the artwork's width as a fraction of the square. 0.75 reproduces
    the source composition; the maskable icon needs less, so the lockup
    survives Android's circular adaptive-icon mask (which crops to roughly the
    middle 72%); the favicon wants more, since it has no wordmark to protect.
    """
    canvas = Image.new('RGB', (size, size), BLACK)
    art = fit_width(art, max(1, round(size * fill)))
    canvas.paste(art, ((size - art.width) // 2, (size - art.height) // 2), art)
    return canvas


def main() -> None:
    src = Image.open(SRC)
    print(f'source {src.size[0]}x{src.size[1]}')

    keyed = key_out_background(src)
    dark_full = trim(keyed, pad=2)
    light_full = trim(Image.open(SRC_LIGHT).convert('RGBA'), pad=2)

    # The lockup never renders taller than ~44 CSS px (the login card); 640
    # wide leaves headroom for a 3x screen and for print, without shipping a
    # 774px asset on every page load.
    dark = compact(fit_width(dark_full, 640))
    light = compact(fit_width(light_full, 640))
    mark = compact(fit_width(split_chevron(keyed), 256))

    writes = [
        # App chrome. `logo.png` keeps its name so nothing that still points at
        # it breaks, and is the light-surface variant because that is where an
        # un-updated reference is most likely to sit.
        (os.path.join(PUB, 'logo.png'), light),
        (os.path.join(PUB, 'logo-light.png'), light),
        (os.path.join(PUB, 'logo-dark.png'), dark),
        (os.path.join(PUB, 'logo-mark.png'), mark),
        # Home screen / favicon / PWA — the black lockup, as asked for.
        (os.path.join(PUB, 'apple-touch-icon.png'), square_icon(dark_full, 180)),
        (os.path.join(PUB, 'icon-192x192.png'), square_icon(dark_full, 192)),
        (os.path.join(PUB, 'icon-512x512.png'), square_icon(dark_full, 512)),
        (os.path.join(PUB, 'icon-maskable-512.png'), square_icon(dark_full, 512, fill=0.58)),
    ]
    for path, img in writes:
        img.save(path)
        print(f'  {os.path.relpath(path, ROOT):42s} {img.size[0]}x{img.size[1]}')

    # The favicon is the CHEVRON, not the lockup. A browser tab renders at
    # 16-32px, where a mark nearly twice as wide as it is tall collapses the
    # wordmark into two grey smears — legible as "something is there", not as
    # Ber Wilson. The chevron survives 16px. Every larger icon (home screen,
    # PWA, install prompt) keeps the full lockup, which is what was asked for.
    ico = os.path.join(APP, 'favicon.ico')
    # RGBA, not RGB: Pillow stores the 256px entry as an embedded PNG, and
    # Next's image decoder rejects a PNG-in-ICO that has no alpha channel —
    # the build fails outright with "The PNG is not in RGBA format".
    mark_full = split_chevron(keyed)
    square_icon(mark_full, 256, fill=0.86).convert('RGBA').save(
        ico, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )
    print(f'  {os.path.relpath(ico, ROOT):42s} multi-size')


if __name__ == '__main__':
    main()
