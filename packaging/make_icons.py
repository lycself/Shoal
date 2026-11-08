"""Render the app icons from frontend/public/favicon.svg (needs only Pillow).

Writes backend/shoal/desktop/icon.png (tray / menu bar) and packaging/icons/Shoal.{png,ico,icns}.
The SVG is small and hand-written (a rounded square, a wave, three fish), so a tiny path renderer
for M/L/H/V/C/S/Z (absolute and relative) is enough. Run again after changing the favicon.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[1]
SVG = REPO / "frontend" / "public" / "favicon.svg"
NS = {"svg": "http://www.w3.org/2000/svg"}


def bezier(p0, p1, p2, p3, n=24):
    return [((1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t * t * p2[0] + t ** 3 * p3[0],
             (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t * t * p2[1] + t ** 3 * p3[1])
            for t in (i / n for i in range(1, n + 1))]


def path_points(d: str) -> list[list[tuple[float, float]]]:
    tokens = re.findall(r"[MmLlHhVvCcSsZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?", d)
    shapes, pts = [], []
    cur = (0.0, 0.0)
    start = cur
    last_ctrl = None
    cmd = None
    i = 0

    def num():
        nonlocal i
        v = float(tokens[i])
        i += 1
        return v

    while i < len(tokens):
        if re.fullmatch(r"[A-Za-z]", tokens[i]):
            cmd = tokens[i]
            i += 1
            if cmd in "Zz":
                if pts:
                    shapes.append(pts)
                pts, cur, last_ctrl = [], start, None
                continue
        rel = cmd.islower()
        c = cmd.upper()
        ox, oy = cur if rel else (0.0, 0.0)
        if c == "M":
            if pts:
                shapes.append(pts)
            cur = (ox + num(), oy + num())
            start, pts, last_ctrl = cur, [cur], None
            cmd = "l" if rel else "L"  # extra pairs after M are line-tos
        elif c == "L":
            cur = (ox + num(), oy + num())
            pts.append(cur)
            last_ctrl = None
        elif c == "H":
            cur = ((cur[0] if rel else 0) + num(), cur[1])
            pts.append(cur)
            last_ctrl = None
        elif c == "V":
            cur = (cur[0], (cur[1] if rel else 0) + num())
            pts.append(cur)
            last_ctrl = None
        elif c == "C":
            p1 = (ox + num(), oy + num())
            p2 = (ox + num(), oy + num())
            p3 = (ox + num(), oy + num())
            pts += bezier(cur, p1, p2, p3)
            cur, last_ctrl = p3, p2
        elif c == "S":
            p1 = (2 * cur[0] - last_ctrl[0], 2 * cur[1] - last_ctrl[1]) if last_ctrl else cur
            p2 = (ox + num(), oy + num())
            p3 = (ox + num(), oy + num())
            pts += bezier(cur, p1, p2, p3)
            cur, last_ctrl = p3, p2
    if pts:
        shapes.append(pts)
    return shapes


def render(size: int) -> Image.Image:
    root = ET.parse(SVG).getroot()
    vb = [float(v) for v in root.get("viewBox").split()]
    ss = 4  # supersampling
    scale = size * ss / vb[2]
    img = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    rect = root.find(".//svg:clipPath/svg:rect", NS)
    radius = float(rect.get("rx", 0)) * scale
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius=radius, fill=255)
    for el in root.find("svg:g", NS):
        tag = el.tag.split("}")[1]
        color = el.get("fill", "#000")
        rgb = tuple(int(color.lstrip("#")[k:k + 2], 16) for k in (0, 2, 4)) if color != "#fff" else (255, 255, 255)
        alpha = int(255 * float(el.get("opacity", 1)))
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        if tag == "rect":
            draw.rectangle([0, 0, img.size[0], img.size[1]], fill=rgb + (alpha,))
        elif tag == "path":
            for shape in path_points(el.get("d")):
                draw.polygon([(x * scale, y * scale) for x, y in shape], fill=rgb + (alpha,))
        img = Image.alpha_composite(img, layer)
    img.putalpha(Image.composite(img.getchannel("A"), Image.new("L", img.size, 0), mask))
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    out = REPO / "packaging" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    big = render(1024)
    big.save(out / "Shoal.png")
    big.save(out / "Shoal.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    big.save(out / "Shoal.icns")
    render(64).save(REPO / "backend" / "shoal" / "desktop" / "icon.png")
    print("icons written to", out)


if __name__ == "__main__":
    main()
