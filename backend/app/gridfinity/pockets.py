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


def _simplify_polygon(pts: np.ndarray, epsilon: float = 0.3) -> np.ndarray:
    """Simplify a polygon using Douglas-Peucker algorithm.

    This reduces the number of points while preserving the shape, which is
    critical for OCP boolean operations — complex polygons with many
    close-together points can cause boolean subtraction to fail silently.
    """
    import cv2

    contour = pts.astype(np.float32).reshape(-1, 1, 2)
    simplified = cv2.approxPolyDP(contour, epsilon, True)
    return simplified.reshape(-1, 2)


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

    # Simplify the polygon to prevent OCP boolean operation failures.
    # Complex polygons with many close-together points (from tool detection
    # smoothing) can cause the boolean subtraction to fail silently, producing
    # a 0-volume result and a 0-byte STL. Douglas-Peucker simplification with
    # a small epsilon (0.3mm) preserves the shape while reducing point count.
    offset_outer = _simplify_polygon(offset_outer, epsilon=0.3)

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

    # Apply corner radius to vertical edges (if enabled).
    # These are the edges connecting the top and bottom faces — rounding
    # them gives the pocket rounded vertical corners.
    if params.pocket_corner_radius_mm > 0:
        try:
            bb = pocket.bounding_box()
            bottom_z = bb.min.Z
            top_z = bb.max.Z
            # Vertical edges are those whose Z center is between top and bottom
            # (not at either face). They connect the top and bottom polygons.
            vert_edges = [
                e for e in pocket.edges()
                if abs(e.center().Z - bottom_z) > 0.1 and abs(e.center().Z - top_z) > 0.1
            ]
            if vert_edges:
                pocket = pocket.fillet(params.pocket_corner_radius_mm, vert_edges)
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

    A finger hole is a spherical pocket that cuts into the bin from the TOP
    surface downward, making it easy to lift the tool out. The user places
    these wherever they want on each tool.

    The sphere CENTER is placed at the bin's top surface (total_h).
    This means only the bottom half of the sphere cuts into the bin,
    creating a bowl-shaped scoop. The top half is above the bin and
    does nothing (it's outside the solid, so subtraction has no effect).
    """
    total_h = params.height_units * C.HEIGHT_UNIT_MM

    # Convert to bin-local coords
    x_local = hole.x - bin_w_mm / 2
    y_local = hole.y - bin_l_mm / 2

    # Place sphere center at the top surface.
    # Only the bottom half cuts into the bin material, creating a bowl.
    radius = hole.radius_mm
    sphere = Sphere(radius)
    sphere = sphere.moved(Location((x_local, y_local, total_h)))

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

    # Build a sphere with center at the top surface.
    # Only the bottom half cuts into the bin, creating a bowl-shaped scoop.
    sphere = Sphere(scoop_radius)
    sphere = sphere.moved(Location((scoop_x_local, scoop_y_local, total_h)))

    return sphere


def subtract_pockets(bin_solid: Part, outlines: list[ToolOutline], params: BinParams) -> Part:
    """Subtract all tool pockets and finger holes from the bin solid.

    The cutters are intersected with a bounding box representing the bin interior
    (inside the outer walls, above the base) before subtraction. This prevents
    pockets and finger scoops from consuming the walls or base, which could
    otherwise leave the bin empty (0-volume) and produce a 0-byte STL.
    """
    bin_w = params.grid_w * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    bin_l = params.grid_l * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    total_h = params.height_units * C.HEIGHT_UNIT_MM

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

    # Union all cutters into one.
    combined = cutters[0]
    for c in cutters[1:]:
        try:
            combined = combined + c
        except Exception:
            pass  # skip cutters that fail to union

    # Intersect with the bin interior bounding box to prevent cutters from
    # consuming the walls. The interior is inside the walls, so pockets can
    # cut the floor but not the walls. This prevents a large pocket from
    # consuming the entire bin and producing a 0-volume (0-byte STL) result.
    wall_t = params.wall_thickness_mm
    interior_w = bin_w - 2 * wall_t
    interior_l = bin_l - 2 * wall_t
    interior = Box(interior_w, interior_l, total_h * 2)
    interior = interior.moved(Location((0, 0, total_h)))
    try:
        combined = combined & interior
    except Exception:
        pass  # if intersection fails, proceed with original cutters

    result = bin_solid - combined
    return result
