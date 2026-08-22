"""Tool pocket generation: convert 2D outlines into 3D pockets and subtract from bin."""
from __future__ import annotations

from build123d import (
    Location,
    Polygon,
    Sketch,
    extrude,
)

from ..schemas import BinParams, ToolOutline
from ..utils.geometry import offset_polygon, to_np
from . import constants as C


def build_pocket(outline: ToolOutline, params: BinParams, bin_w_mm: float, bin_l_mm: float) -> Solid | None:
    """Build a single tool pocket solid (to be subtracted from the bin).

    Coordinates in the outline are in mm relative to the paper origin (top-left).
    We translate them into bin-local coords (centered at bin center, origin at base top).
    """
    outer = to_np(outline.outer)
    if len(outer) < 3:
        return None

    margin = outline.margin_mm if outline.margin_mm is not None else params.tool_margin_mm
    pocket_depth = outline.pocket_depth_mm if outline.pocket_depth_mm is not None else params.pocket_depth_mm

    # Offset the outer polygon outward by the margin (clearance).
    offset_outer = offset_polygon(outer, margin)

    # Build a sketch from the polygon.
    # build123d Sketch uses 2D points; we create a polygon face.
    pts = [(float(p[0]), float(p[1])) for p in offset_outer]

    # Create the pocket face using make_polygon for the outer loop.
    try:
        outer_face = Polygon(pts)
    except Exception:
        return None

    # Add holes if present.
    faces = [outer_face]
    for hole in outline.holes:
        hole_pts = to_np(hole)
        if len(hole_pts) < 3:
            continue
        try:
            hole_face = Polygon([(float(p[0]), float(p[1])) for p in hole_pts])
            faces.append(hole_face)
        except Exception:
            pass

    # Build a sketch and extrude downward to create the pocket.
    # We extrude a solid that will be subtracted from the bin.
    # The pocket cuts into the solid floor of the bin.
    sketch = Sketch()
    for f in faces:
        sketch = sketch + f

    # Extrude the pocket solid upward (+Z) so it spans from the base
    # through the floor and walls, cutting through all solid material.
    total_h = params.height_units * C.HEIGHT_UNIT_MM
    extrude_depth = total_h + 5.0  # tall enough to cut through everything
    pocket = extrude(sketch, amount=-extrude_depth)  # negative = upward in build123d

    # Position the pocket in bin-local coordinates.
    # Outlines are in paper coords (origin top-left, y down).
    # Bin coords: origin at bin center, x right, y forward, z up.
    translate_x = -bin_w_mm / 2
    translate_y = -bin_l_mm / 2

    # The pocket starts at z=0 (bottom of base) and extends upward
    # through the floor and walls.
    pocket = pocket.moved(Location((translate_x, translate_y, 0)))

    return pocket


def subtract_pockets(bin_solid: Part, outlines: list[ToolOutline], params: BinParams) -> Part:
    """Subtract all tool pockets from the bin solid."""
    bin_w = params.grid_w * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    bin_l = params.grid_l * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM

    # Build all pockets and union them first (better boolean performance).
    pockets = []
    for outline in outlines:
        if not outline.visible:
            continue
        pocket = build_pocket(outline, params, bin_w, bin_l)
        if pocket is not None:
            pockets.append(pocket)

    if not pockets:
        return bin_solid

    # Union all pockets into one, then subtract.
    combined = pockets[0]
    for p in pockets[1:]:
        combined = combined + p

    return bin_solid - combined
