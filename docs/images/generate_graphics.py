"""Generate README graphics for Tracefinity."""
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.dirname(os.path.abspath(__file__))

# ─── Logo ───────────────────────────────────────────────────────────────
def make_logo():
    """Create a clean SVG logo for Tracefinity."""
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120" viewBox="0 0 400 120">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#7c3aed"/>
      <stop offset="100%" style="stop-color:#c026d3"/>
    </linearGradient>
  </defs>
  <!-- Gridfinity-style grid icon -->
  <g transform="translate(10,20)">
    <rect x="0" y="0" width="80" height="80" rx="8" fill="url(#g)"/>
    <g stroke="#fff" stroke-width="2" fill="none" opacity="0.4">
      <line x1="26.7" y1="0" x2="26.7" y2="80"/>
      <line x1="53.3" y1="0" x2="53.3" y2="80"/>
      <line x1="0" y1="26.7" x2="80" y2="26.7"/>
      <line x1="0" y1="53.3" x2="80" y2="53.3"/>
    </g>
    <!-- Tool silhouette inside -->
    <path d="M 15 55 L 15 25 Q 15 18 22 18 L 40 18 Q 47 18 47 25 L 47 30 L 55 30 L 55 35 L 47 35 L 47 55 Q 47 62 40 62 L 22 62 Q 15 62 15 55 Z"
          fill="#fff" opacity="0.9"/>
    <circle cx="58" cy="48" r="8" fill="url(#g)" stroke="#fff" stroke-width="2"/>
  </g>
  <text x="105" y="55" font-family="system-ui,-apple-system,sans-serif" font-size="36" font-weight="bold" fill="#e4e4e7">Trace<tspan fill="#7c3aed">finity</tspan></text>
  <text x="105" y="80" font-family="system-ui,-apple-system,sans-serif" font-size="14" fill="#71717a">Photo → Gridfinity in seconds</text>
</svg>'''
    with open(os.path.join(OUT, "logo.svg"), "w") as f:
        f.write(svg)
    print("Created logo.svg")


# ─── Workflow Diagram ───────────────────────────────────────────────────
def make_workflow():
    """Create a workflow diagram showing the 4-step process."""
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="800" height="140" viewBox="0 0 800 140">
  <defs>
    <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#7c3aed"/><stop offset="100%" style="stop-color:#a78bfa"/>
    </linearGradient>
    <linearGradient id="g2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0891b2"/><stop offset="100%" style="stop-color:#22d3ee"/>
    </linearGradient>
    <linearGradient id="g3" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#059669"/><stop offset="100%" style="stop-color:#34d399"/>
    </linearGradient>
    <linearGradient id="g4" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#d97706"/><stop offset="100%" style="stop-color:#fbbf24"/>
    </linearGradient>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="#52525b"/>
    </marker>
  </defs>

  <!-- Step 1: Photo -->
  <g transform="translate(10,20)">
    <rect width="160" height="100" rx="12" fill="url(#g1)"/>
    <text x="80" y="40" text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" fill="#fff">📷</text>
    <text x="80" y="70" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" font-weight="bold" fill="#fff">1. Snap Photo</text>
    <text x="80" y="88" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#fff" opacity="0.8">Tools on paper</text>
  </g>
  <line x1="175" y1="70" x2="205" y2="70" stroke="#52525b" stroke-width="2" marker-end="url(#arrow)"/>

  <!-- Step 2: Auto-Trace -->
  <g transform="translate(210,20)">
    <rect width="160" height="100" rx="12" fill="url(#g2)"/>
    <text x="80" y="40" text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" fill="#fff">🔍</text>
    <text x="80" y="70" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" font-weight="bold" fill="#fff">2. Auto-Trace</text>
    <text x="80" y="88" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#fff" opacity="0.8">CV detects outlines</text>
  </g>
  <line x1="375" y1="70" x2="405" y2="70" stroke="#52525b" stroke-width="2" marker-end="url(#arrow)"/>

  <!-- Step 3: Customize -->
  <g transform="translate(410,20)">
    <rect width="160" height="100" rx="12" fill="url(#g3)"/>
    <text x="80" y="40" text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" fill="#fff">⚙️</text>
    <text x="80" y="70" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" font-weight="bold" fill="#fff">3. Customize</text>
    <text x="80" y="88" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#fff" opacity="0.8">Edit &amp; tune params</text>
  </g>
  <line x1="575" y1="70" x2="605" y2="70" stroke="#52525b" stroke-width="2" marker-end="url(#arrow)"/>

  <!-- Step 4: Export -->
  <g transform="translate(610,20)">
    <rect width="180" height="100" rx="12" fill="url(#g4)"/>
    <text x="90" y="40" text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" fill="#fff">📦</text>
    <text x="90" y="70" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" font-weight="bold" fill="#fff">4. Export</text>
    <text x="90" y="88" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#fff" opacity="0.8">SVG DXF STL 3MF STEP</text>
  </g>
</svg>'''
    with open(os.path.join(OUT, "workflow.svg"), "w") as f:
        f.write(svg)
    print("Created workflow.svg")


# ─── Sample screenshot (synthetic) ──────────────────────────────────────
def make_sample_screenshot():
    """Create a synthetic screenshot showing the editor with tool outlines."""
    w, h = 800, 500
    img = Image.new('RGB', (w, h), '#0a0a0b')
    draw = ImageDraw.Draw(img)

    # Top bar
    draw.rectangle([0, 0, w, 36], fill='#18181b')
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
        font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 11)
        font_lg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
    except:
        font = ImageFont.load_default()
        font_sm = font
        font_lg = font

    draw.text((12, 10), "Tracefinity", fill='#e4e4e7', font=font)
    draw.text((120, 10), "Upload  Calibrate  Trace  Editor  Export", fill='#71717a', font=font_sm)

    # Left panel (bin params)
    draw.rectangle([0, 36, 220, h], fill='#18181b')
    draw.line([220, 36, 220, h], fill='#27272a', width=1)
    draw.text((12, 50), "Bin Parameters", fill='#e4e4e7', font=font_lg)
    params = [
        "Grid: 4 × 5",
        "Height: 3U (21mm)",
        "Wall: 1.2mm",
        "Pocket: 15mm",
        "Margin: 1.0mm",
        "☑ Magnet holes",
        "☑ Scoop",
        "☑ Lip",
        "☐ Screw holes",
        "Tabs: None",
    ]
    for i, p in enumerate(params):
        draw.text((12, 80 + i * 22), p, fill='#a1a1aa', font=font_sm)

    # Right panel (tool properties)
    draw.rectangle([620, 36, w, h], fill='#18181b')
    draw.line([620, 36, 620, h], fill='#27272a', width=1)
    draw.text((632, 50), "Tool: Wrench", fill='#e4e4e7', font=font_lg)
    tool_props = ["Label: Wrench", "Margin: 1.0mm", "Pocket: 15mm", "Visible: ☑", "", "5 tools detected"]
    for i, p in enumerate(tool_props):
        draw.text((632, 80 + i * 22), p, fill='#a1a1aa', font=font_sm)

    # Center: SVG editor area
    draw.rectangle([220, 36, 620, h], fill='#0f1115')

    # Grid overlay
    grid_x, grid_y = 240, 56
    cell = 40
    cols, rows = 4, 5
    for i in range(cols + 1):
        draw.line([grid_x + i * cell, grid_y, grid_x + i * cell, grid_y + rows * cell], fill='#27272a', width=1)
    for i in range(rows + 1):
        draw.line([grid_x, grid_y + i * cell, grid_x + cols * cell, grid_y + i * cell], fill='#27272a', width=1)

    # Bin outline
    draw.rectangle([grid_x, grid_y, grid_x + cols * cell, grid_y + rows * cell], outline='#3f3f46', width=2)

    # Tool outlines (smooth shapes)
    # Tool 1: Wrench shape
    wrench = [(260, 80), (260, 130), (270, 140), (270, 200), (280, 210), (290, 210), (290, 200), (280, 140), (290, 130), (290, 80)]
    draw.polygon(wrench, outline='#7c3aed', width=2, fill=(124, 58, 237, 30))

    # Tool 2: Screwdriver
    screw = [(320, 90), (330, 90), (335, 100), (335, 220), (345, 230), (345, 240), (320, 240), (320, 230), (330, 220), (330, 100)]
    draw.polygon(screw, outline='#22d3ee', width=2, fill=(34, 211, 238, 30))

    # Tool 3: Pliers
    pliers = [(380, 100), (400, 95), (410, 105), (410, 180), (400, 190), (380, 190), (375, 180), (375, 105)]
    draw.polygon(pliers, outline='#34d399', width=2, fill=(52, 211, 153, 30))

    # Tool 4: Small tool
    small = [(420, 120), (440, 120), (440, 170), (420, 170)]
    draw.polygon(small, outline='#fbbf24', width=2, fill=(251, 191, 36, 30))

    # Selected tool indicator
    draw.polygon(wrench, outline='#a78bfa', width=3)

    # Export bar at bottom
    draw.rectangle([220, h - 36, 620, h], fill='#18181b')
    draw.line([220, h - 36, 620, h - 36], fill='#27272a', width=1)
    formats = ['SVG', 'DXF', 'STL', '3MF', 'STEP']
    for i, fmt in enumerate(formats):
        x = 240 + i * 70
        draw.rounded_rectangle([x, h - 28, x + 55, h - 8], radius=4, fill='#27272a', outline='#3f3f46')
        draw.text((x + 12, h - 25), fmt, fill='#e4e4e7', font=font_sm)

    img.save(os.path.join(OUT, "screenshot-editor.png"))
    print("Created screenshot-editor.png")


# ─── Export format badges ───────────────────────────────────────────────
def make_format_badges():
    """Create a row of export format badges."""
    formats = [
        ("SVG", "2D Vector", "#7c3aed"),
        ("DXF", "2D CAD", "#0891b2"),
        ("STL", "3D Mesh", "#059669"),
        ("3MF", "3D Print", "#d97706"),
        ("STEP", "3D CAD", "#dc2626"),
    ]
    badge_w, badge_h = 130, 70
    total_w = len(formats) * badge_w + (len(formats) - 1) * 15
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w}" height="{badge_h}" viewBox="0 0 {total_w} {badge_h}">'
    for i, (name, desc, color) in enumerate(formats):
        x = i * (badge_w + 15)
        svg += f'''
  <g transform="translate({x},0)">
    <rect width="{badge_w}" height="{badge_h}" rx="10" fill="#18181b" stroke="{color}" stroke-width="2"/>
    <text x="{badge_w//2}" y="30" text-anchor="middle" font-family="system-ui,sans-serif" font-size="20" font-weight="bold" fill="{color}">{name}</text>
    <text x="{badge_w//2}" y="50" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#71717a">{desc}</text>
  </g>'''
    svg += '</svg>'
    with open(os.path.join(OUT, "export-formats.svg"), "w") as f:
        f.write(svg)
    print("Created export-formats.svg")


# ─── Gridfinity spec diagram ────────────────────────────────────────────
def make_gridfinity_spec():
    """Create a diagram showing Gridfinity dimensions."""
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200" viewBox="0 0 500 200">
  <rect width="500" height="200" fill="#0a0a0b" rx="12"/>

  <!-- Grid cells -->
  <g transform="translate(50,30)">
    <rect x="0" y="0" width="84" height="84" fill="none" stroke="#7c3aed" stroke-width="2" rx="4"/>
    <rect x="0" y="0" width="42" height="42" fill="none" stroke="#3f3f46" stroke-width="1" stroke-dasharray="3,3"/>
    <rect x="42" y="0" width="42" height="42" fill="none" stroke="#3f3f46" stroke-width="1" stroke-dasharray="3,3"/>
    <rect x="0" y="42" width="42" height="42" fill="none" stroke="#3f3f46" stroke-width="1" stroke-dasharray="3,3"/>
    <rect x="42" y="42" width="42" height="42" fill="none" stroke="#3f3f46" stroke-width="1" stroke-dasharray="3,3"/>

    <!-- Dimension labels -->
    <line x1="0" y1="-10" x2="84" y2="-10" stroke="#71717a" stroke-width="1" marker-start="url(#arr)" marker-end="url(#arr)"/>
    <text x="42" y="-15" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" fill="#a1a1aa">42mm × 2 = 84mm</text>

    <line x1="-10" y1="0" x2="-10" y2="84" stroke="#71717a" stroke-width="1" marker-start="url(#arr)" marker-end="url(#arr)"/>
    <text x="-15" y="42" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" fill="#a1a1aa" transform="rotate(-90,-15,42)">42mm × 2</text>

    <!-- Magnet holes -->
    <circle cx="6" cy="6" r="4" fill="none" stroke="#fbbf24" stroke-width="1.5"/>
    <circle cx="78" cy="6" r="4" fill="none" stroke="#fbbf24" stroke-width="1.5"/>
    <circle cx="6" cy="78" r="4" fill="none" stroke="#fbbf24" stroke-width="1.5"/>
    <circle cx="78" cy="78" r="4" fill="none" stroke="#fbbf24" stroke-width="1.5"/>
  </g>

  <!-- Height diagram -->
  <g transform="translate(200,30)">
    <rect x="0" y="0" width="60" height="21" fill="#27272a" stroke="#7c3aed" stroke-width="2" rx="2"/>
    <rect x="0" y="21" width="60" height="4" fill="#7c3aed" opacity="0.5" rx="2"/>
    <line x1="70" y1="0" x2="70" y2="25" stroke="#71717a" stroke-width="1" marker-start="url(#arr)" marker-end="url(#arr)"/>
    <text x="75" y="15" font-family="system-ui,sans-serif" font-size="11" fill="#a1a1aa">3U = 21mm</text>
    <line x1="70" y1="21" x2="70" y2="25" stroke="#71717a" stroke-width="1" marker-start="url(#arr)" marker-end="url(#arr)"/>
    <text x="75" y="28" font-family="system-ui,sans-serif" font-size="10" fill="#71717a">base 4mm</text>
  </g>

  <!-- Spec table -->
  <g transform="translate(300,25)">
    <text x="0" y="0" font-family="system-ui,sans-serif" font-size="13" font-weight="bold" fill="#e4e4e7">Gridfinity Spec</text>
    <text x="0" y="25" font-family="system-ui,sans-serif" font-size="11" fill="#a1a1aa">Unit cell: 42 × 42mm</text>
    <text x="0" y="45" font-family="system-ui,sans-serif" font-size="11" fill="#a1a1aa">Height unit: 7mm</text>
    <text x="0" y="65" font-family="system-ui,sans-serif" font-size="11" fill="#a1a1aa">Base: 4mm</text>
    <text x="0" y="85" font-family="system-ui,sans-serif" font-size="11" fill="#a1a1aa">Magnets: 6 × 2mm</text>
    <text x="0" y="105" font-family="system-ui,sans-serif" font-size="11" fill="#a1a1aa">Screws: M3 (3.35mm)</text>
    <text x="0" y="125" font-family="system-ui,sans-serif" font-size="11" fill="#a1a1aa">Clearance: 0.5mm/side</text>
  </g>

  <defs>
    <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="#71717a"/>
    </marker>
  </defs>
</svg>'''
    with open(os.path.join(OUT, "gridfinity-spec.svg"), "w") as f:
        f.write(svg)
    print("Created gridfinity-spec.svg")


if __name__ == "__main__":
    make_logo()
    make_workflow()
    make_sample_screenshot()
    make_format_badges()
    make_gridfinity_spec()
    print("\nAll graphics generated!")
