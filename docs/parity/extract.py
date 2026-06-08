#!/usr/bin/env python3
"""Pull the live screenshots out of a filled parity board.

The parity board (docs/parity/parity-board.html) bakes each dropped screenshot
into a self-contained file via its "Save board for Claude" button. That file
embeds every shot as <img data-page="ID" src="data:image/png;base64,...">.
This script decodes them back into individual PNGs so they can be reviewed.

Usage:
    python3 docs/parity/extract.py [parity-live.html] [out-dir]

Defaults: reads ./parity-live.html, writes ./shots/.
"""
import base64
import os
import re
import sys

src = sys.argv[1] if len(sys.argv) > 1 else "parity-live.html"
out = sys.argv[2] if len(sys.argv) > 2 else "shots"

html = open(src, encoding="utf-8").read()
os.makedirs(out, exist_ok=True)

pairs = re.findall(
    r'data-page="([^"]+)"\s+src="data:image/(png|jpeg);base64,([^"]+)"', html
)
if not pairs:
    print("No embedded screenshots found in", src)
    sys.exit(1)

for pid, ext, b64 in pairs:
    ext = "jpg" if ext == "jpeg" else ext
    path = os.path.join(out, f"live-{pid}.{ext}")
    open(path, "wb").write(base64.b64decode(b64))
    print("wrote", path)

print(f"\n{len(pairs)} screenshot(s) extracted to {out}/")
