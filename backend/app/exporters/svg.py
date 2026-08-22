"""SVG exporter for 2D foam cutouts and gridfinity top-view."""
from __future__ import annotations

import io
from xml.sax.saxutils import escape

from ..schemas import Design
from ..utils.geometry import offset_polygon, to_np
from ..gridfinity import constants as C


def export_svg(design: Design) -> str:
    """Generate an SVG string for the design.

    For foam mode: tool cutout paths on a sheet sized to the bin footprint.
    For gridfinity mode: top-view of the bin with pocket outlines.
    """
    p = design.params
    bin_w = p.grid_w * C.GRID_UNIT_MM
    bin_l = p.grid_l * C.GRID_UNIT_MM

    # SVG viewBox in mm; add padding.
    pad = 10
    view_w = bin_w + 2 * pad
    view_h = bin_l + 2 * pad

    parts: list[str] = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {view_w:.2f} {view_h:.2f}" width="{view_w:.2f}mm" height="{view_h:.2f}mm">'
    )

    # Sheet/bin outline (engrave layer - blue)
    parts.append(f'<g id="sheet" fill="none" stroke="blue" stroke-width="0.2">')
    parts.append(f'<rect x="{pad}" y="{pad}" width="{bin_w:.2f}" height="{bin_l:.2f}" rx="3.75" ry="3.75"/>')
    parts.append('</g>')

    # Gridfinity grid overlay (light gray, for reference)
    parts.append('<g id="grid" fill="none" stroke="#ccc" stroke-width="0.1" stroke-dasharray="1,1">')
    for i in range(1, p.grid_w):
        x = pad + i * C.GRID_UNIT_MM
        parts.append(f'<line x1="{x:.2f}" y1="{pad}" x2="{x:.2f}" y2="{pad + bin_l:.2f}"/>')
    for i in range(1, p.grid_l):
        y = pad + i * C.GRID_UNIT_MM
        parts.append(f'<line x1="{pad}" y1="{y:.2f}" x2="{pad + bin_w:.2f}" y2="{y:.2f}"/>')
    parts.append('</g>')

    # Tool cutouts (cut layer - red)
    parts.append('<g id="cutouts" fill="none" stroke="red" stroke-width="0.3">')
    for outline in design.outlines:
        if not outline.visible:
            continue
        margin = outline.margin_mm if outline.margin_mm is not None else p.tool_margin_mm
        outer = to_np(outline.outer)
        if len(outer) < 3:
            continue
        offset_outer = offset_polygon(outer, margin)
        # Translate from paper coords to SVG coords (pad offset).
        d = _polygon_to_path(offset_outer, dx=pad, dy=pad)
        parts.append(f'<path d="{d}" fill="none" stroke="red" stroke-width="0.3"/>')
        # Holes
        for hole in outline.holes:
            hole_pts = to_np(hole)
            if len(hole_pts) < 3:
                continue
            d = _polygon_to_path(hole_pts, dx=pad, dy=pad)
            parts.append(f'<path d="{d}" fill="none" stroke="red" stroke-width="0.3"/>')
        # Label text
        if outline.label:
            cx = float(outer[:, 0].mean()) + pad
            cy = float(outer[:, 1].mean()) + pad
            parts.append(
                f'<text x="{cx:.1f}" y="{cy:.1f}" font-size="3" text-anchor="middle" '
                f'fill="green" stroke="none">{escape(outline.label)}</text>'
            )
    parts.append('</g>')

    # Magnet/screw hole markers (for gridfinity mode)
    if p.output_mode == "gridfinity" and (p.magnet_holes or p.screw_holes):
        parts.append('<g id="holes" fill="none" stroke="red" stroke-width="0.2">')
        inset = C.MAGNET_INSET_MM
        corners = [
            (pad + inset, pad + inset),
            (pad + bin_w - inset, pad + inset),
            (pad + inset, pad + bin_l - inset),
            (pad + bin_w - inset, pad + bin_l - inset),
        ]
        for cx, cy in corners:
            if p.magnet_holes:
                parts.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{C.MAGNET_DIAMETER_MM/2:.2f}"/>')
            if p.screw_holes:
                parts.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{C.SCREW_DIAMETER_MM/2:.2f}"/>')
        parts.append('</g>')

    parts.append('</svg>')
    return '\n'.join(parts)


def _polygon_to_path(pts, dx: float = 0, dy: float = 0) -> str:
    """Convert an (N,2) array to a smooth SVG path 'd' string (closed).

    Uses Catmull-Rom splines converted to cubic bezier curves for smooth,
    rounded outlines — same technique as tooltrace.ai.
    """
    if len(pts) < 3:
        return ""
    n = len(pts)
    tension = 0.5
    cmds = [f"M {pts[0][0] + dx:.2f} {pts[0][1] + dy:.2f}"]
    for i in range(n):
        p0 = pts[(i - 1) % n]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n]
        cp1x = p1[0] + (p2[0] - p0[0]) * tension / 3
        cp1y = p1[1] + (p2[1] - p0[1]) * tension / 3
        cp2x = p2[0] - (p3[0] - p1[0]) * tension / 3
        cp2y = p2[1] - (p3[1] - p1[1]) * tension / 3
        cmds.append(f"C {cp1x + dx:.2f} {cp1y + dy:.2f} {cp2x + dx:.2f} {cp2y + dy:.2f} {p2[0] + dx:.2f} {p2[1] + dy:.2f}")
    cmds.append("Z")
    return " ".join(cmds)
