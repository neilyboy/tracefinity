"""Tool pocket generation: convert 2D outlines into 3D pockets and subtract from bin.

A tool pocket is a depression in the bin floor that the tool sits in.
Key design principles (matching Tooltrace.ai behavior):

1. **Pocket depth**: The pocket starts at the TOP of the bin and goes DOWN
   by pocket_depth_mm. It does NOT go all the way through — there's a solid
   floor below the tool so it doesn't fall out the bottom.

2. **No holes**: Tool pockets are solid depressions. We don't cut holes
   inside the tool outline (no doughnut effect). The tool sits in a
   solid pocket shaped like its outline.

3. **Finger scoops**: A cylindrical cutout at one end of each tool pocket
   so you can reach in and grab the tool. Default 20mm diameter, going
   through the full pocket depth. This makes it easy to lift tools out.

4. **Margin**: The pocket is slightly larger than the tool outline to
   provide clearance for inserting/removing the tool.
"""
from __future__ import annotations

import numpy as np
from build123d import (
    Cylinder,
    Location,
    Part,
    Polygon,
    Sketch,
    Solid,
    extrude,
)

from ..schemas import BinParams, ToolOutline
from ..utils.geometry import offset_polygon, to_np
from . import constants as C


def build_pocket(outline: ToolOutline, params: BinParams, bin_w_mm: float, bin_l_mm: float) -> Solid | None:
    """Build a single tool pocket solid (to be subtracted from the bin).

    The pocket is a depression that starts at the top of the bin and goes
    down by pocket_depth_mm. It does NOT go all the way through.

    Coordinates in the outline are in mm relative to the paper origin (top-left).
    We translate them into bin-local coords (centered at bin center).
    """
    outer = to_np(outline.outer)
    if len(outer) < 3:
        return None

    margin = outline.margin_mm if outline.margin_mm is not None else params.tool_margin_mm
    pocket_depth = outline.pocket_depth_mm if outline.pocket_depth_mm is not None else params.pocket_depth_mm

    # Offset the outer polygon outward by the margin (clearance).
    offset_outer = offset_polygon(outer, margin)

    # Build a sketch from the polygon — NO holes (solid pocket, not doughnut).
    # Reverse points to ensure CCW winding (build123d extrudes CCW polygons upward).
    pts = [(float(p[0]), float(p[1])) for p in offset_outer][::-1]
    try:
        outer_face = Polygon(pts)
    except Exception:
        return None

    sketch = Sketch() + outer_face

    # Extrude to create the pocket solid.
    # The pocket starts at the TOP of the bin walls and goes DOWN by pocket_depth.
    # The bin walls go up to total_h (height_units * HEIGHT_UNIT_MM).
    # The lip (if present) sits above that and we don't cut through it.
    # We add a small extra (2mm) above total_h to ensure clean cuts at the top surface.
    total_h = params.height_units * C.HEIGHT_UNIT_MM
    extrude_depth = pocket_depth + 2.0  # small overshoot for clean top cut

    # Extrude upward (+Z) from the sketch plane (Z=0) to Z=extrude_depth.
    pocket = extrude(sketch, amount=extrude_depth)

    # Position the pocket in bin-local coordinates.
    # Outlines are in paper coords (origin top-left, y down).
    # Bin coords: origin at bin center, x right, y forward, z up.
    translate_x = -bin_w_mm / 2
    translate_y = -bin_l_mm / 2

    # After extrude(+depth), the solid spans z=[0, extrude_depth].
    # We want the pocket top at total_h + 2 (slightly above wall top for clean cut),
    # and the pocket bottom at total_h - pocket_depth.
    # So we move it by (total_h - pocket_depth) — the bottom of the pocket.
    pocket_bottom_z = total_h - pocket_depth
    pocket = pocket.moved(Location((translate_x, translate_y, pocket_bottom_z)))

    return pocket


def build_finger_scoop(
    outline: ToolOutline, params: BinParams, bin_w_mm: float, bin_l_mm: float
) -> Solid | None:
    """Build a cylindrical finger scoop at one end of a tool pocket.

    The scoop is a cylinder that cuts through the bin wall at the edge of
    the tool pocket, making it easy to reach in and grab the tool.
    Default diameter is 20mm (matching Tooltrace.ai).
    """
    outer = to_np(outline.outer)
    if len(outer) < 3:
        return None

    pocket_depth = outline.pocket_depth_mm if outline.pocket_depth_mm is not None else params.pocket_depth_mm
    total_h = params.height_units * C.HEIGHT_UNIT_MM

    # Find the centroid of the tool outline
    cx = float(np.mean(outer[:, 0]))
    cy = float(np.mean(outer[:, 1]))

    # Find the point on the outline farthest from the centroid
    # (this is typically one end of the tool — a good place for a scoop)
    dists = np.sqrt((outer[:, 0] - cx) ** 2 + (outer[:, 1] - cy) ** 2)
    far_idx = int(np.argmax(dists))
    far_pt = outer[far_idx]

    # Direction from centroid to far point
    dx = far_pt[0] - cx
    dy = far_pt[1] - cy
    dist = np.sqrt(dx * dx + dy * dy)
    if dist < 1e-6:
        return None
    ux, uy = dx / dist, dy / dist

    # Place the scoop just past the far end of the tool, half inside and
    # half outside the tool outline. This creates a finger notch at the edge.
    margin = outline.margin_mm if outline.margin_mm is not None else params.tool_margin_mm
    scoop_radius = params.finger_scoop_diameter_mm / 2
    # Position: at the far edge of the tool + margin, shifted slightly outward
    scoop_x = far_pt[0] + ux * (margin + scoop_radius * 0.3)
    scoop_y = far_pt[1] + uy * (margin + scoop_radius * 0.3)

    # Convert to bin-local coords
    scoop_x_local = scoop_x - bin_w_mm / 2
    scoop_y_local = scoop_y - bin_l_mm / 2

    # Build a cylinder oriented along Z, spanning the full pocket depth
    # plus a bit extra to cut through the top surface cleanly.
    scoop_height = pocket_depth + 5.0
    scoop = Cylinder(scoop_radius, scoop_height)
    # Position: center of cylinder at the scoop point, z centered in the pocket
    scoop_z = total_h - pocket_depth / 2
    scoop = scoop.moved(Location((scoop_x_local, scoop_y_local, scoop_z)))

    return scoop


def subtract_pockets(bin_solid: Part, outlines: list[ToolOutline], params: BinParams) -> Part:
    """Subtract all tool pockets and finger scoops from the bin solid."""
    bin_w = params.grid_w * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    bin_l = params.grid_l * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM

    # Build all pockets and scoops, union them first (better boolean performance).
    cutters = []
    for outline in outlines:
        if not outline.visible:
            continue
        pocket = build_pocket(outline, params, bin_w, bin_l)
        if pocket is not None:
            cutters.append(pocket)
        # Add finger scoop if enabled
        if getattr(params, 'finger_scoop', True):
            scoop = build_finger_scoop(outline, params, bin_w, bin_l)
            if scoop is not None:
                cutters.append(scoop)

    if not cutters:
        return bin_solid

    # Union all cutters into one, then subtract.
    combined = cutters[0]
    for c in cutters[1:]:
        combined = combined + c

    return bin_solid - combined
