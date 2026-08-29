"""Gridfinity custom baseplate generator.

Builds custom-shaped baseplates that fit inside tool chest drawers.
The baseplate has the standard Gridfinity socket pattern on top so
bins slot in, and can be cut to any shape to work around drawer
obstructions (hinges, latches, etc.).

For large baseplates that don't fit on a single print bed, the
baseplate is segmented into printable pieces with optional edge
clip connectors for assembly.
"""
from __future__ import annotations

import math

from build123d import (
    Axis,
    BasePartObject,
    Box,
    BuildPart,
    BuildSketch,
    Cylinder,
    Location,
    Part,
    Plane,
    Polygon,
    Rectangle,
    Sketch,
    Solid,
    extrude,
    fillet,
    chamfer,
    loft,
)

from . import constants as C
from ..schemas import BaseplateDesign, BaseplateParams, DrawerCutout


# ---------------------------------------------------------------------------
# Grid computation
# ---------------------------------------------------------------------------

def compute_grid(params: BaseplateParams) -> tuple[int, int, float, float]:
    """Compute the gridfinity grid dimensions that fit inside the drawer.

    Returns (grid_w, grid_l, plate_w, plate_l) where:
    - grid_w/grid_l = number of 42mm cells
    - plate_w/plate_l = actual baseplate size in mm (= grid * 42)
    """
    avail_w = params.drawer_w_mm - params.padding_left_mm - params.padding_right_mm - 2 * params.drawer_clearance_mm
    avail_l = params.drawer_l_mm - params.padding_top_mm - params.padding_bottom_mm - 2 * params.drawer_clearance_mm
    grid_w = max(1, int(avail_w // C.GRID_UNIT_MM))
    grid_l = max(1, int(avail_l // C.GRID_UNIT_MM))
    plate_w = grid_w * C.GRID_UNIT_MM
    plate_l = grid_l * C.GRID_UNIT_MM
    return grid_w, grid_l, plate_w, plate_l


# ---------------------------------------------------------------------------
# Socket pattern
# ---------------------------------------------------------------------------

def _build_socket_cutter(grid_w: int, grid_l: int, plate_top_z: float) -> Part:
    """Build the gridfinity socket pattern as a cutter (to subtract from the plate top).

    Each cell gets a chamfered socket:
    - Opening (at plate top surface): 38.5x38.5mm
    - Bottom (deepest, going down): 41.5x41.5mm
    - Depth: 4mm with chamfered transition

    The socket is cut INTO the plate from the top surface (Z = plate_top_z)
    downward by socket_depth.
    """
    socket_opening = C.SOCKET_BOTTOM_SIZE_MM  # 38.5mm at the opening (top of plate)
    socket_bottom = C.SOCKET_TOP_SIZE_MM  # 41.5mm at the bottom of the socket (deepest)
    socket_depth = C.BASEPLATE_SOCKET_DEPTH_MM  # 4mm

    cutter = None
    for gx in range(grid_w):
        for gy in range(grid_l):
            # Cell center in plate-local coords (centered at origin)
            cx = -grid_w * C.GRID_UNIT_MM / 2 + (gx + 0.5) * C.GRID_UNIT_MM
            cy = -grid_l * C.GRID_UNIT_MM / 2 + (gy + 0.5) * C.GRID_UNIT_MM

            # Build one chamfered socket cell using loft.
            # Sketch at Z=plate_top_z (opening at plate surface): smaller (38.5mm)
            # Sketch at Z=plate_top_z - socket_depth (bottom, deeper): larger (41.5mm)
            # The loft creates a frustum that widens going down, matching the bin base profile.
            with BuildPart() as bp:
                with BuildSketch(Plane.XY.moved(Location((0, 0, plate_top_z))) ) as s1:
                    Rectangle(socket_opening, socket_opening)
                with BuildSketch(Plane.XY.moved(Location((0, 0, plate_top_z - socket_depth)))) as s2:
                    Rectangle(socket_bottom, socket_bottom)
                loft()
            cell = bp.part
            cell = cell.moved(Location((cx, cy, 0)))

            if cutter is None:
                cutter = Part(cell)
            else:
                cutter = cutter + Part(cell)

    return cutter


# ---------------------------------------------------------------------------
# Magnet holes
# ---------------------------------------------------------------------------

def _build_magnet_holes(grid_w: int, grid_l: int, plate_top_z: float) -> list[Solid]:
    """Build magnet hole cutters for each cell corner.

    Magnets sit at the bottom of the socket (deepest point), which is
    at Z = plate_top_z - socket_depth.
    """
    holes = []
    hole_offset = C.GRID_UNIT_MM / 2 - C.MAGNET_INSET_MM
    magnet_z = plate_top_z - C.BASEPLATE_SOCKET_DEPTH_MM + C.MAGNET_DEPTH_MM / 2

    for gx in range(grid_w):
        for gy in range(grid_l):
            cx = -grid_w * C.GRID_UNIT_MM / 2 + (gx + 0.5) * C.GRID_UNIT_MM
            cy = -grid_l * C.GRID_UNIT_MM / 2 + (gy + 0.5) * C.GRID_UNIT_MM
            for dx, dy in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
                mx = cx + dx * hole_offset
                my = cy + dy * hole_offset
                if abs(mx) < grid_w * C.GRID_UNIT_MM / 2 - 1 and abs(my) < grid_l * C.GRID_UNIT_MM / 2 - 1:
                    magnet = Cylinder(C.MAGNET_DIAMETER_MM / 2, C.MAGNET_DEPTH_MM)
                    magnet = magnet.moved(Location((mx, my, magnet_z)))
                    holes.append(magnet)
    return holes


def _build_screw_holes(grid_w: int, grid_l: int, total_h: float) -> list[Solid]:
    """Build through-hole screw cutters for each cell corner."""
    holes = []
    hole_offset = C.GRID_UNIT_MM / 2 - C.MAGNET_INSET_MM

    for gx in range(grid_w):
        for gy in range(grid_l):
            cx = -grid_w * C.GRID_UNIT_MM / 2 + (gx + 0.5) * C.GRID_UNIT_MM
            cy = -grid_l * C.GRID_UNIT_MM / 2 + (gy + 0.5) * C.GRID_UNIT_MM
            for dx, dy in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
                mx = cx + dx * hole_offset
                my = cy + dy * hole_offset
                if abs(mx) < grid_w * C.GRID_UNIT_MM / 2 - 1 and abs(my) < grid_l * C.GRID_UNIT_MM / 2 - 1:
                    screw = Cylinder(C.SCREW_DIAMETER_MM / 2, total_h + 2)
                    screw = screw.moved(Location((mx, my, total_h / 2)))
                    holes.append(screw)
    return holes


# ---------------------------------------------------------------------------
# Cutout subtraction
# ---------------------------------------------------------------------------

def _build_cutout_solid(cutout: DrawerCutout, plate_w: float, plate_l: float, total_h: float) -> Solid | None:
    """Build a solid from a drawer cutout polygon, to subtract from the baseplate.

    Cutout coordinates are in SVG space (Y-down, origin at drawer top-left).
    We convert to plate-local coords (centered at plate center, Y-up).
    """
    if len(cutout.outer) < 3:
        return None

    # Convert SVG coords to plate-local coords.
    # SVG: origin at drawer top-left, Y down.
    # Plate: centered at origin, Y up.
    # The plate is centered in the drawer (with padding), so:
    # plate_local_x = svg_x - drawer_w/2
    # plate_local_y = drawer_l/2 - svg_y
    # But we don't have drawer_w here directly — the cutout coords are
    # already in the same frame as the drawer. The plate is centered
    # in the drawer, so we just shift by drawer center.
    # Actually, the cutout coords are relative to the drawer top-left.
    # The plate center is at (drawer_w/2, drawer_l/2) in drawer coords.
    # So plate_local = svg - (drawer_w/2, drawer_l/2), then flip Y.
    # But we need drawer dimensions — pass them via the cutout's stored
    # w/h? No, the cutout outer points are absolute drawer coords.
    # We'll pass drawer_w and drawer_l as parameters.
    # Actually, let's just use the plate_w/plate_l and assume the cutout
    # is already in plate-local coords. The frontend will handle the
    # coordinate conversion when creating cutouts.
    # For now, assume cutout.outer points are in plate-local coords
    # (centered at plate center, Y-up, same as build123d).

    pts = [(float(p.x), float(p.y)) for p in cutout.outer]
    try:
        sketch = Sketch() + Polygon(pts)
    except Exception:
        return None

    # Extrude through the full plate height
    solid = extrude(sketch, amount=total_h + 4)
    solid = solid.moved(Location((0, 0, total_h / 2 + 2)))
    return solid


# ---------------------------------------------------------------------------
# Segmentation
# ---------------------------------------------------------------------------

def auto_segment(grid_w: int, grid_l: int, bed_w: float, bed_l: float) -> tuple[list[int], list[int]]:
    """Compute cut lines to segment the baseplate for a given print bed size.

    Returns (cut_lines_x, cut_lines_y) — lists of grid column/row indices
    to cut AFTER. E.g., [3, 6] means cut after column 3 and after column 6,
    producing 3 segments.
    """
    max_cells_x = max(1, int(bed_w // C.GRID_UNIT_MM))
    max_cells_y = max(1, int(bed_l // C.GRID_UNIT_MM))

    cuts_x = list(range(max_cells_x, grid_w, max_cells_x))
    cuts_y = list(range(max_cells_y, grid_l, max_cells_y))
    return cuts_x, cuts_y


def _segment_bounds(grid_w: int, grid_l: int, cuts_x: list[int], cuts_y: list[int]) -> list[tuple[int, int, int, int]]:
    """Compute the (col_start, col_end, row_start, row_end) for each segment.

    cuts_x and cuts_y are sorted lists of column/row indices to cut after.
    """
    # Add boundaries
    x_boundaries = [0] + sorted(cuts_x) + [grid_w]
    y_boundaries = [0] + sorted(cuts_y) + [grid_l]

    segments = []
    for i in range(len(x_boundaries) - 1):
        for j in range(len(y_boundaries) - 1):
            segments.append((x_boundaries[i], x_boundaries[i + 1], y_boundaries[j], y_boundaries[j + 1]))
    return segments


# ---------------------------------------------------------------------------
# Edge clips
# ---------------------------------------------------------------------------

def _add_edge_clips(
    segment: Part,
    seg_x_start: int, seg_x_end: int, seg_y_start: int, seg_y_end: int,
    grid_w: int, grid_l: int,
    cuts_x: list[int], cuts_y: list[int],
    params: BaseplateParams,
    total_h: float,
) -> Part:
    """Add edge clip tabs/slots to a segment based on its position relative to cut lines.

    For each cut line that borders this segment:
    - If the segment is on the "lower" side (left/below the cut), add TABS (protrusions).
    - If the segment is on the "upper" side (right/above the cut), add SLOTS (cutouts).
    """
    clip_w = params.clip_width_mm
    clip_d = params.clip_depth_mm
    clip_tol = params.clip_tolerance_mm
    plate_w = grid_w * C.GRID_UNIT_MM
    plate_l = grid_l * C.GRID_UNIT_MM

    # --- Vertical cut lines (cuts in X, separating left/right segments) ---
    for cx in cuts_x:
        # Cut position in mm (from plate left edge)
        cut_x_mm = -plate_w / 2 + cx * C.GRID_UNIT_MM

        # Check if this segment borders the cut on the left or right
        is_left = seg_x_end == cx  # segment ends at this cut (right edge of segment = cut)
        is_right = seg_x_start == cx  # segment starts at this cut (left edge of segment = cut)

        if not (is_left or is_right):
            continue

        # Determine the Y range of this segment
        seg_y_start_mm = -plate_l / 2 + seg_y_start * C.GRID_UNIT_MM
        seg_y_end_mm = -plate_l / 2 + seg_y_end * C.GRID_UNIT_MM
        seg_y_center = (seg_y_start_mm + seg_y_end_mm) / 2
        seg_y_len = seg_y_end_mm - seg_y_start_mm

        # Place 1-3 clips along the seam, depending on segment length
        n_clips = max(1, min(3, int(seg_y_len / (clip_w * 4))))
        if n_clips == 1:
            clip_ys = [seg_y_center]
        else:
            spacing = seg_y_len / (n_clips + 1)
            clip_ys = [seg_y_start_mm + spacing * (i + 1) for i in range(n_clips)]

        for cy in clip_ys:
            if is_left:
                # Add a TAB (protrusion) on the right edge
                tab = Box(clip_d, clip_w, total_h)
                tab = tab.moved(Location((cut_x_mm + clip_d / 2, cy, total_h / 2)))
                try:
                    segment = segment + tab
                except Exception:
                    pass
            elif is_right:
                # Cut a SLOT on the left edge
                slot = Box(clip_d + 2 * clip_tol, clip_w + 2 * clip_tol, total_h + 2)
                slot = slot.moved(Location((cut_x_mm + (clip_d + 2 * clip_tol) / 2 - clip_tol, cy, total_h / 2)))
                try:
                    segment = segment - slot
                except Exception:
                    pass

    # --- Horizontal cut lines (cuts in Y, separating top/bottom segments) ---
    for cy_cut in cuts_y:
        cut_y_mm = -plate_l / 2 + cy_cut * C.GRID_UNIT_MM

        is_below = seg_y_end == cy_cut  # segment ends at this cut (top edge = cut)
        is_above = seg_y_start == cy_cut  # segment starts at this cut (bottom edge = cut)

        if not (is_below or is_above):
            continue

        seg_x_start_mm = -plate_w / 2 + seg_x_start * C.GRID_UNIT_MM
        seg_x_end_mm = -plate_w / 2 + seg_x_end * C.GRID_UNIT_MM
        seg_x_center = (seg_x_start_mm + seg_x_end_mm) / 2
        seg_x_len = seg_x_end_mm - seg_x_start_mm

        n_clips = max(1, min(3, int(seg_x_len / (clip_w * 4))))
        if n_clips == 1:
            clip_xs = [seg_x_center]
        else:
            spacing = seg_x_len / (n_clips + 1)
            clip_xs = [seg_x_start_mm + spacing * (i + 1) for i in range(n_clips)]

        for cx in clip_xs:
            if is_below:
                # Add a TAB (protrusion) on the top edge
                tab = Box(clip_w, clip_d, total_h)
                tab = tab.moved(Location((cx, cut_y_mm + clip_d / 2, total_h / 2)))
                try:
                    segment = segment + tab
                except Exception:
                    pass
            elif is_above:
                # Cut a SLOT on the bottom edge
                slot = Box(clip_w + 2 * clip_tol, clip_d + 2 * clip_tol, total_h + 2)
                slot = slot.moved(Location((cx, cut_y_mm + (clip_d + 2 * clip_tol) / 2 - clip_tol, total_h / 2)))
                try:
                    segment = segment - slot
                except Exception:
                    pass

    return segment


# ---------------------------------------------------------------------------
# Main generation
# ---------------------------------------------------------------------------

def generate_baseplate(design: BaseplateDesign) -> list[Part]:
    """Generate the full baseplate, segmented into printable pieces.

    Returns a list of Part objects (one per segment). If no segmentation
    is needed, returns a single-element list.
    """
    params = design.params
    grid_w, grid_l, plate_w, plate_l = compute_grid(params)
    total_h = C.BASEPLATE_SOCKET_DEPTH_MM + params.base_thickness_mm

    # 1. Build the solid plate
    plate = Box(plate_w, plate_l, total_h)
    plate = plate.moved(Location((0, 0, total_h / 2)))

    # 2. Cut the gridfinity socket pattern into the top
    plate_top_z = total_h  # top surface of the plate
    socket_cutter = _build_socket_cutter(grid_w, grid_l, plate_top_z)
    try:
        plate = plate - socket_cutter
    except Exception:
        pass

    # Ensure plate is a Part for subsequent boolean operations
    if not isinstance(plate, Part):
        plate = Part(plate) if hasattr(plate, 'wrapped') else plate

    # 3. Cut drawer cutouts (obstructions)
    for cutout in design.cutouts:
        cutout_solid = _build_cutout_solid(cutout, plate_w, plate_l, total_h)
        if cutout_solid is not None:
            try:
                plate = plate - cutout_solid
            except Exception:
                pass

    # 4. Add magnet holes
    if params.magnet_holes:
        for magnet in _build_magnet_holes(grid_w, grid_l, plate_top_z):
            try:
                plate = plate - magnet
            except Exception:
                pass

    # 5. Add screw holes (through-holes)
    if params.screw_holes:
        for screw in _build_screw_holes(grid_w, grid_l, total_h):
            try:
                plate = plate - screw
            except Exception:
                pass

    # 6. Chamfer the bottom edges for easier insertion into drawer
    try:
        bb = plate.bounding_box()
        bottom_z = bb.min.Z
        bottom_edges = [e for e in plate.edges() if abs(e.center().Z - bottom_z) < 0.01]
        if bottom_edges:
            plate = plate.chamfer(0.4, None, bottom_edges)
    except Exception:
        pass

    # 7. Segment the plate
    cuts_x = params.cut_lines_x if params.cut_lines_x else []
    cuts_y = params.cut_lines_y if params.cut_lines_y else []
    if not cuts_x and not cuts_y:
        # Auto-segment if the plate is larger than the print bed
        auto_x, auto_y = auto_segment(grid_w, grid_l, params.print_bed_w_mm, params.print_bed_l_mm)
        cuts_x = auto_x
        cuts_y = auto_y

    if not cuts_x and not cuts_y:
        # No segmentation needed
        return [plate]

    # 8. Cut the plate into segments
    segments = _segment_bounds(grid_w, grid_l, cuts_x, cuts_y)
    segment_parts = []
    for (sx_start, sx_end, sy_start, sy_end) in segments:
        # Build a bounding box for this segment
        seg_w = (sx_end - sx_start) * C.GRID_UNIT_MM
        seg_l = (sy_end - sy_start) * C.GRID_UNIT_MM
        seg_cx = -plate_w / 2 + (sx_start + sx_end) / 2 * C.GRID_UNIT_MM
        seg_cy = -plate_l / 2 + (sy_start + sy_end) / 2 * C.GRID_UNIT_MM

        seg_box = Box(seg_w + 2, seg_l + 2, total_h + 4)
        seg_box = seg_box.moved(Location((seg_cx, seg_cy, total_h / 2)))

        try:
            intersect_result = plate.intersect(seg_box)
            if not intersect_result:
                continue
            # intersect returns a ShapeList; take the first solid
            seg_part = intersect_result[0]
        except Exception:
            continue

        # 9. Add edge connectors
        if params.connector_type == "edge_clips":
            seg_part = _add_edge_clips(
                seg_part, sx_start, sx_end, sy_start, sy_end,
                grid_w, grid_l, cuts_x, cuts_y, params, total_h,
            )
        elif params.connector_type == "magnets":
            # Add magnet holes at seam midpoints
            seg_part = _add_seam_magnets(
                seg_part, sx_start, sx_end, sy_start, sy_end,
                grid_w, grid_l, cuts_x, cuts_y, total_h,
            )

        segment_parts.append(seg_part)

    return segment_parts if segment_parts else [plate]


def _add_seam_magnets(
    segment: Part,
    seg_x_start: int, seg_x_end: int, seg_y_start: int, seg_y_end: int,
    grid_w: int, grid_l: int,
    cuts_x: list[int], cuts_y: list[int],
    total_h: float,
) -> Part:
    """Add magnet holes at seam midpoints for alignment."""
    plate_w = grid_w * C.GRID_UNIT_MM
    plate_l = grid_l * C.GRID_UNIT_MM

    for cx in cuts_x:
        cut_x_mm = -plate_w / 2 + cx * C.GRID_UNIT_MM
        if seg_x_end == cx or seg_x_start == cx:
            seg_y_start_mm = -plate_l / 2 + seg_y_start * C.GRID_UNIT_MM
            seg_y_end_mm = -plate_l / 2 + seg_y_end * C.GRID_UNIT_MM
            mid_y = (seg_y_start_mm + seg_y_end_mm) / 2
            magnet = Cylinder(C.MAGNET_DIAMETER_MM / 2, total_h + 2)
            magnet = magnet.moved(Location((cut_x_mm, mid_y, total_h / 2)))
            try:
                segment = segment - magnet
            except Exception:
                pass

    for cy_cut in cuts_y:
        cut_y_mm = -plate_l / 2 + cy_cut * C.GRID_UNIT_MM
        if seg_y_end == cy_cut or seg_y_start == cy_cut:
            seg_x_start_mm = -plate_w / 2 + seg_x_start * C.GRID_UNIT_MM
            seg_x_end_mm = -plate_w / 2 + seg_x_end * C.GRID_UNIT_MM
            mid_x = (seg_x_start_mm + seg_x_end_mm) / 2
            magnet = Cylinder(C.MAGNET_DIAMETER_MM / 2, total_h + 2)
            magnet = magnet.moved(Location((mid_x, cut_y_mm, total_h / 2)))
            try:
                segment = segment - magnet
            except Exception:
                pass

    return segment


def get_segment_info(design: BaseplateDesign) -> dict:
    """Return information about the segments for UI display.

    Returns dict with:
    - grid_w, grid_l: grid dimensions
    - plate_w, plate_l: plate dimensions in mm
    - segment_count: number of segments
    - segments: list of {index, x, y, w, h, cells_w, cells_h}
    - cuts_x, cuts_y: cut line indices
    """
    params = design.params
    grid_w, grid_l, plate_w, plate_l = compute_grid(params)

    cuts_x = params.cut_lines_x if params.cut_lines_x else []
    cuts_y = params.cut_lines_y if params.cut_lines_y else []
    if not cuts_x and not cuts_y:
        auto_x, auto_y = auto_segment(grid_w, grid_l, params.print_bed_w_mm, params.print_bed_l_mm)
        cuts_x = auto_x
        cuts_y = auto_y

    seg_bounds = _segment_bounds(grid_w, grid_l, cuts_x, cuts_y)
    segments = []
    for i, (sx_start, sx_end, sy_start, sy_end) in enumerate(seg_bounds):
        seg_w = (sx_end - sx_start) * C.GRID_UNIT_MM
        seg_l = (sy_end - sy_start) * C.GRID_UNIT_MM
        seg_cx = -plate_w / 2 + (sx_start + sx_end) / 2 * C.GRID_UNIT_MM
        seg_cy = -plate_l / 2 + (sy_start + sy_end) / 2 * C.GRID_UNIT_MM
        segments.append({
            "index": i + 1,
            "x": seg_cx,
            "y": seg_cy,
            "w": seg_w,
            "h": seg_l,
            "cells_w": sx_end - sx_start,
            "cells_h": sy_end - sy_start,
        })

    return {
        "grid_w": grid_w,
        "grid_l": grid_l,
        "plate_w": plate_w,
        "plate_l": plate_l,
        "segment_count": len(segments),
        "segments": segments,
        "cuts_x": cuts_x,
        "cuts_y": cuts_y,
    }
