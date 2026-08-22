"""DXF exporter for 2D cutouts (laser/foam cutting)."""
from __future__ import annotations

import os
import tempfile

import ezdxf

from ..schemas import Design
from ..utils.geometry import offset_polygon, to_np
from ..gridfinity import constants as C


def export_dxf(design: Design) -> bytes:
    """Generate a DXF file with tool cutout outlines in mm."""
    doc = ezdxf.new("R2018")
    msp = doc.modelspace()
    doc.layers.add(name="CUT", color=1)  # red
    doc.layers.add(name="ENGRAVE", color=5)  # blue
    doc.layers.add(name="GRID", color=8)  # gray

    p = design.params
    bin_w = p.grid_w * C.GRID_UNIT_MM
    bin_l = p.grid_l * C.GRID_UNIT_MM

    # Sheet outline (engrave)
    msp.add_lwpolyline(
        [(0, 0), (bin_w, 0), (bin_w, bin_l), (0, bin_l), (0, 0)],
        dxfattribs={"layer": "ENGRAVE"},
    )

    # Grid lines (reference)
    for i in range(1, p.grid_w):
        msp.add_line((i * C.GRID_UNIT_MM, 0), (i * C.GRID_UNIT_MM, bin_l), dxfattribs={"layer": "GRID"})
    for i in range(1, p.grid_l):
        msp.add_line((0, i * C.GRID_UNIT_MM), (bin_w, i * C.GRID_UNIT_MM), dxfattribs={"layer": "GRID"})

    # Tool cutouts
    for outline in design.outlines:
        if not outline.visible:
            continue
        margin = outline.margin_mm if outline.margin_mm is not None else p.tool_margin_mm
        outer = to_np(outline.outer)
        if len(outer) < 3:
            continue
        offset_outer = offset_polygon(outer, margin)
        _add_polyline(msp, offset_outer, layer="CUT")
        for hole in outline.holes:
            hole_pts = to_np(hole)
            if len(hole_pts) < 3:
                continue
            _add_polyline(msp, hole_pts, layer="CUT")

    # Magnet/screw holes
    if p.magnet_holes or p.screw_holes:
        inset = C.MAGNET_INSET_MM
        corners = [(inset, inset), (bin_w - inset, inset), (inset, bin_l - inset), (bin_w - inset, bin_l - inset)]
        for cx, cy in corners:
            if p.magnet_holes:
                msp.add_circle((cx, cy), C.MAGNET_DIAMETER_MM / 2, dxfattribs={"layer": "CUT"})
            if p.screw_holes:
                msp.add_circle((cx, cy), C.SCREW_DIAMETER_MM / 2, dxfattribs={"layer": "CUT"})

    # Write to a temp file and read back.
    fd, path = tempfile.mkstemp(suffix=".dxf")
    os.close(fd)
    try:
        doc.saveas(path)
        with open(path, "rb") as f:
            return f.read()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _add_polyline(msp, pts, layer: str):
    """Add a closed lwpolyline from an (N,2) array."""
    points = [(float(p[0]), float(p[1])) for p in pts]
    points.append(points[0])  # close
    msp.add_lwpolyline(points, dxfattribs={"layer": layer})
