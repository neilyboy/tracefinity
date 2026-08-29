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

def _build_cutout_solid(
    cutout: DrawerCutout,
    drawer_w: float, drawer_l: float,
    plate_w: float, plate_l: float,
    total_h: float,
) -> Solid | None:
    """Build a solid from a drawer cutout polygon, to subtract from the baseplate.

    Cutout coordinates are in SVG space (origin at drawer top-left, Y-down).
    The plate is centered in the drawer. We convert to plate-local coords
    (centered at plate center, Y-up, matching build123d).

    If rotation_deg is non-zero, the polygon points are rotated around the
    cutout center (x, y) before conversion.

    For "through" cutouts: extrudes through the full plate height.
    For "partial" cutouts: extrudes from the BOTTOM up by depth_mm,
    so the top surface remains flat for trays to sit on.
    """
    if len(cutout.outer) < 3:
        return None

    # Apply rotation around the cutout center if needed
    rotation_deg = getattr(cutout, 'rotation_deg', 0.0) or 0.0
    cx = float(cutout.x)
    cy = float(cutout.y)
    if abs(rotation_deg) > 0.01:
        import math
        angle = -rotation_deg * math.pi / 180  # negative = SVG Y-down rotation
        cos_a = math.cos(angle)
        sin_a = math.sin(angle)
        rotated_pts = []
        for p in cutout.outer:
            # Translate to origin, rotate, translate back
            dx = float(p.x) - cx
            dy = float(p.y) - cy
            rx = cx + dx * cos_a - dy * sin_a
            ry = cy + dx * sin_a + dy * cos_a
            rotated_pts.append((rx, ry))
        raw_pts = rotated_pts
    else:
        raw_pts = [(float(p.x), float(p.y)) for p in cutout.outer]

    # Convert SVG coords (drawer top-left, Y-down) to plate-local (centered, Y-up)
    # plate_local_x = svg_x - drawer_w/2
    # plate_local_y = drawer_l/2 - svg_y
    pts = [(x - drawer_w / 2, drawer_l / 2 - y) for x, y in raw_pts]
    try:
        sketch = Sketch() + Polygon(pts)
    except Exception:
        return None

    cutout_type = getattr(cutout, 'cutout_type', 'through')
    depth_mm = getattr(cutout, 'depth_mm', 3.0)

    if cutout_type == "partial":
        # Partial cutout: extrude from the bottom (Z=0) upward by depth_mm.
        # The plate sits from Z=0 to Z=total_h. We cut from Z=0 to Z=depth_mm.
        extrude_height = min(depth_mm, total_h) + 0.1  # slight overshoot
        solid = extrude(sketch, amount=extrude_height)
        solid = solid.moved(Location((0, 0, extrude_height / 2)))
    else:
        # Through cutout: extrude through the full plate height
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
# Edge clips (dovetail locking tabs)
# ---------------------------------------------------------------------------

# How much wider the dovetail tab is at the tip vs the base (per side)
DOVETAIL_EXTRA_MM = 0.5


def _build_dovetail_tab(
    depth: float, width: float, height: float,
    direction: str,  # "+x", "-x", "+y", "-y"
    z_offset: float = 0.0,  # bottom Z position of the tab
) -> Solid:
    """Build a dovetail-shaped tab solid.

    The tab is trapezoidal in plan view: narrower at the base (segment edge)
    and wider at the tip (protruding end), creating a dovetail lock.

    direction indicates which way the tab protrudes from the segment edge.
    z_offset positions the tab at a specific Z height (for socket-only tabs).
    """
    extra = DOVETAIL_EXTRA_MM
    if direction in ("+x", "-x"):
        base_w = width
        tip_w = width + 2 * extra
        pts = [
            (0, -base_w / 2),
            (0, base_w / 2),
            (depth, tip_w / 2),
            (depth, -tip_w / 2),
        ]
    else:  # "+y" or "-y"
        base_w = width
        tip_w = width + 2 * extra
        pts = [
            (-base_w / 2, 0),
            (base_w / 2, 0),
            (tip_w / 2, depth),
            (-tip_w / 2, depth),
        ]

    try:
        sketch = Sketch() + Polygon(pts)
        solid = extrude(sketch, amount=height)
        # Normalize to Z=0..height, then apply z_offset
        bb = solid.bounding_box()
        solid = solid.moved(Location((0, 0, -bb.min.Z + z_offset)))
        return solid
    except Exception:
        if direction in ("+x", "-x"):
            return Box(depth, width, height).moved(Location((depth / 2, 0, height / 2 + z_offset)))
        else:
            return Box(width, depth, height).moved(Location((0, depth / 2, height / 2 + z_offset)))


def _build_dovetail_slot(
    depth: float, width: float, height: float, tol: float,
    direction: str,  # "+x", "-x", "+y", "-y"
    z_offset: float = 0.0,  # bottom Z position of the slot
) -> Solid:
    """Build a dovetail-shaped slot cutter (to subtract from the segment).

    The slot is slightly larger than the tab by tolerance, and extends
    a bit beyond the segment edge to ensure clean cuts.

    For "+x"/"+y" direction: slot opens at the segment edge and goes inward.
    For "-x"/"-y" direction: slot opens at the segment edge and goes inward
    (in the negative axis direction).
    """
    extra = DOVETAIL_EXTRA_MM
    slot_depth = depth + tol + 1
    base_w = width + 2 * tol
    tip_w = width + 2 * extra + 2 * tol

    if direction == "+x":
        # Slot opens at X=1 (just outside segment edge at X=0) and goes in -X
        pts = [
            (1, -base_w / 2),        # opening bottom (outside segment)
            (1, base_w / 2),         # opening top
            (-slot_depth, tip_w / 2),# inside top (deeper into segment, wider)
            (-slot_depth, -tip_w / 2),# inside bottom
        ]
    elif direction == "-x":
        # Slot opens at X=-1 (outside) and goes in +X
        pts = [
            (-1, -base_w / 2),       # opening bottom (outside segment)
            (-1, base_w / 2),        # opening top
            (slot_depth, tip_w / 2), # inside top (deeper, wider)
            (slot_depth, -tip_w / 2),# inside bottom
        ]
    elif direction == "+y":
        # Slot opens at Y=1 (outside) and goes in -Y
        pts = [
            (-base_w / 2, 1),        # opening left
            (base_w / 2, 1),         # opening right
            (tip_w / 2, -slot_depth),# inside right (deeper, wider)
            (-tip_w / 2, -slot_depth),# inside left
        ]
    else:  # "-y"
        # Slot opens at Y=-1 (outside) and goes in +Y
        pts = [
            (-base_w / 2, -1),       # opening left
            (base_w / 2, -1),        # opening right
            (tip_w / 2, slot_depth), # inside right (deeper, wider)
            (-tip_w / 2, slot_depth),# inside left
        ]

    try:
        sketch = Sketch() + Polygon(pts)
        solid = extrude(sketch, amount=height + 1)  # +1 for top overshoot only
        # Normalize Z to span Z=z_offset..z_offset+height+1 (no bottom overshoot
        # to avoid cutting into the base below the socket section)
        bb = solid.bounding_box()
        solid = solid.moved(Location((0, 0, z_offset - bb.min.Z if bb.min.Z < z_offset else 0)))
        if solid.bounding_box().min.Z > z_offset:
            solid = solid.moved(Location((0, 0, z_offset - solid.bounding_box().min.Z)))
        return solid
    except Exception:
        # Fallback to simple box
        if direction in ("+x", "-x"):
            return Box(slot_depth + 1, tip_w, height + 1).moved(Location((slot_depth / 2 - 0.5, 0, height / 2 + z_offset)))
        else:
            return Box(tip_w, slot_depth + 1, height + 1).moved(Location((0, slot_depth / 2 - 0.5, height / 2 + z_offset)))


def _add_edge_clips(
    segment: Part,
    seg_x_start: int, seg_x_end: int, seg_y_start: int, seg_y_end: int,
    grid_w: int, grid_l: int,
    cuts_x: list[int], cuts_y: list[int],
    params: BaseplateParams,
    total_h: float,
) -> Part:
    """Add dovetail edge clip tabs/slots to a segment.

    For each cut line that borders this segment:
    - If the segment is on the "lower" side (left/below the cut), add TABS (protrusions).
    - If the segment is on the "upper" side (right/above the cut), add SLOTS (cutouts).

    The tabs are dovetail-shaped (wider at the tip) so they lock into the
    matching slots. Assemble by sliding the tab segment down into the slot segment.
    """
    clip_w = params.clip_width_mm
    clip_d = params.clip_depth_mm
    clip_tol = params.clip_tolerance_mm
    plate_w = grid_w * C.GRID_UNIT_MM
    plate_l = grid_l * C.GRID_UNIT_MM

    # Tabs/slots are only socket-height tall (4mm), positioned at the top of
    # the plate where the sockets are. The base (bottom) stays solid so the
    # segment has a continuous flat bottom with no open gaps.
    socket_h = C.BASEPLATE_SOCKET_DEPTH_MM  # 4mm
    z_off = total_h - socket_h  # bottom of socket section (= base_thickness)

    # --- Vertical cut lines (cuts in X, separating left/right segments) ---
    for cx in cuts_x:
        cut_x_mm = -plate_w / 2 + cx * C.GRID_UNIT_MM

        is_left = seg_x_end == cx
        is_right = seg_x_start == cx

        if not (is_left or is_right):
            continue

        seg_y_start_mm = -plate_l / 2 + seg_y_start * C.GRID_UNIT_MM
        seg_y_end_mm = -plate_l / 2 + seg_y_end * C.GRID_UNIT_MM
        seg_y_center = (seg_y_start_mm + seg_y_end_mm) / 2
        seg_y_len = seg_y_end_mm - seg_y_start_mm

        n_clips = max(1, min(3, int(seg_y_len / (clip_w * 4))))
        if n_clips == 1:
            clip_ys = [seg_y_center]
        else:
            spacing = seg_y_len / (n_clips + 1)
            clip_ys = [seg_y_start_mm + spacing * (i + 1) for i in range(n_clips)]

        for cy in clip_ys:
            if is_left:
                # Add a dovetail TAB protruding in +X from the right edge (socket section only)
                tab = _build_dovetail_tab(clip_d, clip_w, socket_h, "+x", z_off)
                tab = tab.moved(Location((cut_x_mm, cy, 0)))
                try:
                    segment = segment + tab
                except Exception:
                    pass
            elif is_right:
                # Cut a dovetail SLOT going in -X from the left edge (socket section only)
                slot = _build_dovetail_slot(clip_d, clip_w, socket_h, clip_tol, "-x", z_off)
                slot = slot.moved(Location((cut_x_mm, cy, 0)))
                try:
                    segment = segment - slot
                except Exception:
                    pass

    # --- Horizontal cut lines (cuts in Y, separating top/bottom segments) ---
    for cy_cut in cuts_y:
        cut_y_mm = -plate_l / 2 + cy_cut * C.GRID_UNIT_MM

        is_below = seg_y_end == cy_cut
        is_above = seg_y_start == cy_cut

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
                # Add a dovetail TAB protruding in +Y from the top edge (socket section only)
                tab = _build_dovetail_tab(clip_d, clip_w, socket_h, "+y", z_off)
                tab = tab.moved(Location((cx, cut_y_mm, 0)))
                try:
                    segment = segment + tab
                except Exception:
                    pass
            elif is_above:
                # Cut a dovetail SLOT going in -Y from the bottom edge (socket section only)
                slot = _build_dovetail_slot(clip_d, clip_w, socket_h, clip_tol, "-y", z_off)
                slot = slot.moved(Location((cx, cut_y_mm, 0)))
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
        cutout_solid = _build_cutout_solid(
            cutout, params.drawer_w_mm, params.drawer_l_mm, plate_w, plate_l, total_h
        )
        if cutout_solid is not None:
            try:
                plate = plate - cutout_solid
            except Exception:
                pass

    # 4. Add magnet holes (only if there's a base — magnets need a floor to sit on)
    if params.magnet_holes and params.base_thickness_mm > 0:
        for magnet in _build_magnet_holes(grid_w, grid_l, plate_top_z):
            try:
                plate = plate - magnet
            except Exception:
                pass

    # 5. Add screw holes (through-holes) — only meaningful with a base
    if params.screw_holes and params.base_thickness_mm > 0:
        for screw in _build_screw_holes(grid_w, grid_l, total_h):
            try:
                plate = plate - screw
            except Exception:
                pass

    # 6. No chamfer — the gridfinity socket loft creates the proper taper.
    # The bottom is flat at Z=0 for 3D printing (flat side down on build plate).

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

        # 10. Re-apply partial cutouts after edge clips, so tabs that fall
        # within a partial cutout area don't obstruct the recessed region.
        # (Edge clip tabs are added in step 9 and can fill back in over
        # partial cutout areas — this removes that material again.)
        for cutout in design.cutouts:
            if getattr(cutout, 'cutout_type', 'through') != 'partial':
                continue
            cutout_solid = _build_cutout_solid(
                cutout, params.drawer_w_mm, params.drawer_l_mm, plate_w, plate_l, total_h
            )
            if cutout_solid is not None:
                try:
                    seg_part = seg_part - cutout_solid
                except Exception:
                    pass

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
