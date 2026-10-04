#!/usr/bin/env python3
"""Crop dashboard panels out of the @2x full-page PNGs using the captured DOM boxes.

  python3 video/captures/tools/crop_panels.py 03-one-payment 05-many-payments
Writes video/captures/dashboard/panel-<state>-<element>.png and records each crop under
`panel_crops` in that state's .boxes.json. Pixels are the screenshot's own; nothing is redrawn.
"""
import json, os, subprocess, sys

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dashboard")
KEYS = ["cash_out", "unbilled_panel", "live_feed_card", "chart_card", "network_split", "kpi_revenue"]
PAD = 24

for state in sys.argv[1:]:
    path = os.path.join(D, f"dashboard-{state}.boxes.json")
    meta = json.load(open(path))
    scale = meta["deviceScaleFactor"]
    src = os.path.join(D, f"dashboard-{state}-full.png")
    crops = {}
    for k in KEYS:
        b = meta["elements"].get(k)
        if not b:
            continue
        x, y = max(0, b["x"] - PAD), max(0, b["y"] - PAD)
        w, h = b["width"] + 2 * PAD, b["height"] + 2 * PAD
        X, Y, W, H = (int(round(v * scale)) for v in (x, y, w, h))
        name = f"panel-{state}-{k.replace('_', '-')}.png"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-vf", f"crop={W}:{H}:{X}:{Y}", os.path.join(D, name)], check=True)
        crops[k] = {"file": f"dashboard/{name}", "from": f"dashboard/dashboard-{state}-full.png", "crop_png_px": [X, Y, W, H], "padding_css_px": PAD}
    meta["panel_crops"] = crops
    with open(path, "w") as f:
        json.dump(meta, f, indent=2)
        f.write("\n")
    print(state, ", ".join(crops))
