"""Tool pocket generation: convert 2D outlines into 3D pockets and subtract from bin.

A tool pocket is a depression in the bin floor that the tool sits in.
Key design principles (matching Tooltrace.ai behavior):

1. **Pocket depth**: The pocket starts at the TOP of the bin and goes DOWN
   by pocket_depth_mm. It does NOT go all the way through — there's a solid
   floor below the tool so it doesn't fall out the bottom.

2. **No holes**: Tool pockets are solid depressions. We don't cut holes
   inside the tool outline (no doughnut effect). The tool sits in a
   solid pocket shaped like its outline.

3. **Cutout chamfer**: A beveled edge at the top of each pocket for easier
   tool insertion. Configurable from 0 (sharp) to 3mm.

4. **Rounded bottom**: A rounded transition from the pocket walls to the
   floor. Configurable radius, 0 = flat bottom.

5. **Finger holes**: User-placed spherical pockets at the edge of tools
   for lifting tools out. Default 15mm radius (Tooltrace.ai default).
   Users can place these wherever they want on each tool.

6. **Margin**: The pocket is slightly larger than the tool outline to
   provide clearance for inserting/removing the tool.
"""
from __future__ import annotations

import numpy as np
from build123d import (
    Box,
    Cylinder,
    Location,
    Part,
    Polygon,
    Sketch,
    Solid,
    Sphere,
    extrude,
    fillet,
)

from ..schemas import BinParams, FingerHole, ToolOutline
from ..utils.geometry import offset_polygon, to_np
from . import constants as C


def _rotate_points(pts: np.ndarray, angle_deg: float, cx: float, cy: float) -> np.ndarray:
    """Rotate points around a center by angle in degrees."""
    if abs(angle_deg) < 0.01:
        return pts
    angle_rad = np.radians(angle_deg)
    cos_a, sin_a = np.cos(angle_rad), np.sin(angle_rad)
    dx = pts[:, 0] - cx
    dy = pts[:, 1] - cy
    new_x = cx + dx * cos_a - dy * sin_a
    new_y = cy + dx * sin_a + dy * cos_a
    return np.column_stack([new_x, new_y])


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

    # Apply rotation if specified
    cx = float(np.mean(outer[:, 0]))
    cy = float(np.mean(outer[:, 1]))
    if abs(outline.rotation_deg) > 0.01:
        outer = _rotate_points(outer, outline.rotation_deg, cx, cy)

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
    total_h = params.height_units * C.HEIGHT_UNIT_MM
    # Extra height for chamfer + clean top cut
    chamfer_extra = max(params.cutout_chamfer_mm, 2.0)
    extrude_depth = pocket_depth + chamfer_extra

    # Extrude upward (+Z) from the sketch plane (Z=0) to Z=extrude_depth.
    pocket = extrude(sketch, amount=extrude_depth)

    # Apply chamfer on the top edge of the pocket (if enabled).
    # The top edges are the edges at the top of the extrusion.
    if params.cutout_chamfer_mm > 0:
        try:
            bb = pocket.bounding_box()
            top_z = bb.max.Z
            top_edges = [e for e in pocket.edges() if abs(e.center().Z - top_z) < 0.01]
            if top_edges:
                pocket = pocket.chamfer(params.cutout_chamfer_mm, None, top_edges)
        except Exception:
            pass  # chamfer can fail on complex geometries — skip if so

    # Apply rounded bottom (if enabled).
    # The bottom edges are at the bottom of the extrusion.
    if params.pocket_bottom_radius_mm > 0:
        try:
            bb = pocket.bounding_box()
            bottom_z = bb.min.Z
            bottom_edges = [e for e in pocket.edges() if abs(e.center().Z - bottom_z) < 0.01]
            if bottom_edges:
                pocket = pocket.fillet(params.pocket_bottom_radius_mm, bottom_edges)
        except Exception:
            pass  # fillet can fail on complex geometries — skip if so

    # Position the pocket in bin-local coordinates.
    translate_x = -bin_w_mm / 2
    translate_y = -bin_l_mm / 2

    # After extrude(+depth), the solid spans z=[0, extrude_depth].
    # We want the pocket top at total_h + chamfer_extra (above wall top for clean cut),
    # and the pocket bottom at total_h - pocket_depth.
    pocket_bottom_z = total_h - pocket_depth
    pocket = pocket.moved(Location((translate_x, translate_y, pocket_bottom_z)))

    return pocket


def build_finger_hole(
    hole: FingerHole, params: BinParams, bin_w_mm: float, bin_l_mm: float
) -> Solid | None:
    """Build a spherical finger hole at a user-specified position.

    A finger hole is a spherical pocket that cuts into the bin at the edge
    of a tool, making it easy to lift the tool out. The user places these
    wherever they want.
    """
    pocket_depth = hole.depth_mm if hole.depth_mm is not None else params.pocket_depth_mm
    total_h = params.height_units * C.HEIGHT_UNIT_MM

    # Convert to bin-local coords
    x_local = hole.x - bin_w_mm / 2
    y_local = hole.y - bin_l_mm / 2

    # Build a sphere that cuts through the top of the bin
    # The sphere center is at the pocket floor level, so the top half
    # cuts into the bin material above the floor.
    radius = hole.radius_mm
    sphere = Sphere(radius)
    # Position: center at the pocket floor level
    floor_z = total_h - pocket_depth
    sphere = sphere.moved(Location((x_local, y_local, floor_z)))

    return sphere


def build_finger_scoop(
    outline: ToolOutline, params: BinParams, bin_w_mm: float, bin_l_mm: float
) -> Solid | None:
    """Build an automatic finger scoop at the far end of a tool pocket.

    This is the auto-placed scoop (when finger_scoop is enabled).
    Users can also place custom finger holes via the finger_holes field.
    """
    outer = to_np(outline.outer)
    if len(outer) < 3:
        return None

    pocket_depth = outline.pocket_depth_mm if outline.pocket_depth_mm is not None else params.pocket_depth_mm
    total_h = params.height_units * C.HEIGHT_UNIT_MM

    # Apply rotation if specified
    cx = float(np.mean(outer[:, 0]))
    cy = float(np.mean(outer[:, 1]))
    if abs(outline.rotation_deg) > 0.01:
        outer = _rotate_points(outer, outline.rotation_deg, cx, cy)

    # Find the point on the outline farthest from the centroid
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

    margin = outline.margin_mm if outline.margin_mm is not None else params.tool_margin_mm
    scoop_radius = params.finger_scoop_diameter_mm / 2
    scoop_x = far_pt[0] + ux * (margin + scoop_radius * 0.3)
    scoop_y = far_pt[1] + uy * (margin + scoop_radius * 0.3)

    # Convert to bin-local coords
    scoop_x_local = scoop_x - bin_w_mm / 2
    scoop_y_local = scoop_y - bin_l_mm / 2

    # Build a sphere for a smoother finger scoop
    sphere = Sphere(scoop_radius)
    floor_z = total_h - pocket_depth
    sphere = sphere.moved(Location((scoop_x_local, scoop_y_local, floor_z)))

    return sphere


def subtract_pockets(bin_solid: Part, outlines: list[ToolOutline], params: BinParams) -> Part:
    """Subtract all tool pockets and finger holes from the bin solid."""
    bin_w = params.grid_w * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    bin_l = params.grid_l * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM

    # Build all pockets, scoops, and finger holes.
    cutters = []
    for outline in outlines:
        if not outline.visible:
            continue
        pocket = build_pocket(outline, params, bin_w, bin_l)
        if pocket is not None:
            cutters.append(pocket)

        # Auto finger scoop if enabled
        if getattr(params, 'finger_scoop', True):
            scoop = build_finger_scoop(outline, params, bin_w, bin_l)
            if scoop is not None:
                cutters.append(scoop)

        # User-placed finger holes
        for hole in outline.finger_holes:
            fh = build_finger_hole(hole, params, bin_w, bin_l)
            if fh is not None:
                cutters.append(fh)

    if not cutters:
        return bin_solid

    # Union all cutters into one, then subtract.
    combined = cutters[0]
    for c in cutters[1:]:
        combined = combined + c

    return bin_solid - combined
