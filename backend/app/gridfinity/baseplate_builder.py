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


# A real gridfinity baseplate always has a flat, solid bottom slab that the
# socket taper rises from — there is no variant with literally zero floor
# (that would mean holes straight through). This is the minimum flat base
# thickness applied even when the user sets "base thickness" to 0 in the UI
# (which means "no EXTRA base beyond this minimum").
MIN_FLAT_BASE_MM = 1.0


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
# (dead code removed — see _build_puzzle_segment / _build_dovetail_tab below)
# ---------------------------------------------------------------------------

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

    # Effective base slab thickness. A real gridfinity baseplate ALWAYS has a
    # flat, solid bottom that the socket taper rises from — "0" in the UI
    # means "no extra base beyond the minimum", not "no floor at all".
    # The minimum is bumped up further if magnets or edge-clip connectors
    # need room to sit in solid material.
    base_h = max(params.base_thickness_mm, MIN_FLAT_BASE_MM)
    if params.magnet_holes:
        base_h = max(base_h, C.MAGNET_DEPTH_MM + 0.4)
    if params.connector_type == "edge_clips":
        base_h = max(base_h, MIN_BASE_THICKNESS_FOR_CLIPS)

    total_h = C.BASEPLATE_SOCKET_DEPTH_MM + base_h

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

    # 4. Add magnet holes (the base slab is always thick enough now — see base_h)
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

    # 8. Cut the plate into segments with dovetail connectors
    segments = _segment_bounds(grid_w, grid_l, cuts_x, cuts_y)
    segment_parts = []
    for (sx_start, sx_end, sy_start, sy_end) in segments:
        seg_w = (sx_end - sx_start) * C.GRID_UNIT_MM
        seg_l = (sy_end - sy_start) * C.GRID_UNIT_MM
        seg_cx = -plate_w / 2 + (sx_start + sx_end) / 2 * C.GRID_UNIT_MM
        seg_cy = -plate_l / 2 + (sy_start + sy_end) / 2 * C.GRID_UNIT_MM

        if params.connector_type == "edge_clips":
            # Build a dovetail-locking segment boundary, confined to the
            # solid flat base slab (base_h) so it never touches the taper.
            seg_shape = _build_puzzle_segment(
                sx_start, sx_end, sy_start, sy_end,
                grid_w, grid_l, cuts_x, cuts_y, params, total_h, base_h,
            )
        else:
            # Simple straight cut
            seg_shape = Box(seg_w + 2, seg_l + 2, total_h + 4)
            seg_shape = seg_shape.moved(Location((seg_cx, seg_cy, total_h / 2)))

        try:
            intersect_result = plate.intersect(seg_shape)
            if not intersect_result:
                continue
            seg_part = intersect_result[0]
        except Exception:
            continue

        # 9. Add seam magnets if requested
        if params.connector_type == "magnets":
            seg_part = _add_seam_magnets(
                seg_part, sx_start, sx_end, sy_start, sy_end,
                grid_w, grid_l, cuts_x, cuts_y, total_h,
            )

        # 10. Re-apply partial cutouts
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


# ---------------------------------------------------------------------------
# Dovetail connectors — confined to the solid base slab
# ---------------------------------------------------------------------------
#
# The gridfinity socket section is tapered (38.5mm opening -> 41.5mm at the
# bottom of the socket), so the wall between adjacent cells is only
# 0.25-1.75mm thick there. Any tab/slot cut in that region either breaks
# through the wall (open gaps) or gets clipped by the neighboring cell's
# socket cavity when the segment is re-intersected with the plate (broken/
# non-manifold geometry).
#
# The fix: dovetail tabs are built ONLY within the solid base slab
# (Z = 0..base_thickness_mm), which is a plain flat box with no taper and
# no per-cell cuts. A tab there is guaranteed structurally sound. This means
# edge clips REQUIRE a minimum base thickness — see MIN_BASE_THICKNESS_FOR_CLIPS.

MIN_BASE_THICKNESS_FOR_CLIPS = 1.6  # mm — minimum solid base needed for tabs to work
DOVETAIL_EXTRA_MM = 1.0  # how much wider the tab tip is than its base, per side


def _build_puzzle_segment(
    seg_x_start: int, seg_x_end: int, seg_y_start: int, seg_y_end: int,
    grid_w: int, grid_l: int,
    cuts_x: list[int], cuts_y: list[int],
    params: BaseplateParams,
    total_h: float,
    base_h: float,
) -> Solid:
    """Build a segment intersection shape with dovetail tabs in the base slab only.

    The shape is split into two Z layers to avoid double walls at seams:

    1. Socket section (Z = base_h .. total_h): exact segment bounds with NO
       margin at cut lines. This ensures each segment gets exactly half the
       wall at the seam — no overlap, no double walls. A tiny margin (0.01mm)
       is used only at the plate's outer edges for clean boolean ops.

    2. Base slab (Z = 0 .. base_h): segment bounds + margin + dovetail tabs/
       slots. The tabs protrude past the cut line for locking; the margin
       ensures clean intersection at the outer edges.

    Dovetail tabs are confined to the base slab (Z = 0..base_h) so they
    never touch the tapered socket geometry.
    """
    plate_w = grid_w * C.GRID_UNIT_MM
    plate_l = grid_l * C.GRID_UNIT_MM

    seg_w = (seg_x_end - seg_x_start) * C.GRID_UNIT_MM
    seg_l = (seg_y_end - seg_y_start) * C.GRID_UNIT_MM
    seg_x_min = -plate_w / 2 + seg_x_start * C.GRID_UNIT_MM
    seg_x_max = -plate_w / 2 + seg_x_end * C.GRID_UNIT_MM
    seg_y_min = -plate_l / 2 + seg_y_start * C.GRID_UNIT_MM
    seg_y_max = -plate_l / 2 + seg_y_end * C.GRID_UNIT_MM
    seg_cx = (seg_x_min + seg_x_max) / 2
    seg_cy = (seg_y_min + seg_y_max) / 2

    # Determine which edges are internal (cut lines) vs external (plate edges)
    x_cuts_set = set(cuts_x)
    y_cuts_set = set(cuts_y)
    # Internal edges: cut lines that border this segment
    left_is_cut = seg_x_start in x_cuts_set
    right_is_cut = seg_x_end in x_cuts_set
    below_is_cut = seg_y_start in y_cuts_set
    above_is_cut = seg_y_end in y_cuts_set

    # --- Socket section: exact bounds, no margin at cut lines ---
    # Use 0.01mm margin at cut lines (for clean boolean), 1mm at outer edges
    socket_margin_left = 0.01 if left_is_cut else 1.0
    socket_margin_right = 0.01 if right_is_cut else 1.0
    socket_margin_below = 0.01 if below_is_cut else 1.0
    socket_margin_above = 0.01 if above_is_cut else 1.0

    socket_h = total_h - base_h
    socket_box = Box(
        seg_w + socket_margin_left + socket_margin_right,
        seg_l + socket_margin_below + socket_margin_above,
        socket_h + 0.02,
    )
    socket_box = socket_box.moved(Location((
        seg_cx + (socket_margin_right - socket_margin_left) / 2,
        seg_cy + (socket_margin_above - socket_margin_below) / 2,
        base_h + socket_h / 2,
    )))

    # --- Base slab: full margin + dovetail tabs ---
    base_margin = 1.0
    base_box = Box(seg_w + 2 * base_margin, seg_l + 2 * base_margin, base_h + 0.02)
    base_box = base_box.moved(Location((seg_cx, seg_cy, base_h / 2)))

    shape = base_box + socket_box

    # Add dovetail tabs/slots to the base slab section only
    tab_w = params.clip_width_mm
    tab_d = params.clip_depth_mm
    tol = params.clip_tolerance_mm

    # --- Vertical cut lines (X cuts) ---
    for cx in cuts_x:
        cut_x_mm = -plate_w / 2 + cx * C.GRID_UNIT_MM
        is_left = seg_x_end == cx
        is_right = seg_x_start == cx
        if not (is_left or is_right):
            continue

        seg_y_center = (seg_y_min + seg_y_max) / 2
        seg_y_len = seg_y_max - seg_y_min
        n_tabs = max(1, min(3, int(seg_y_len / (tab_w * 6))))
        if n_tabs == 1:
            tab_ys = [seg_y_center]
        else:
            spacing = seg_y_len / (n_tabs + 1)
            tab_ys = [seg_y_min + spacing * (i + 1) for i in range(n_tabs)]

        for ty in tab_ys:
            if is_left:
                tab = _build_dovetail_tab(tab_d, tab_w, base_h, "+x")
                tab = tab.moved(Location((cut_x_mm, ty, 0)))
                try:
                    shape = shape + tab
                except Exception:
                    pass
            elif is_right:
                slot = _build_dovetail_slot(tab_d, tab_w, base_h, tol, "-x")
                slot = slot.moved(Location((cut_x_mm, ty, 0)))
                try:
                    shape = shape - slot
                except Exception:
                    pass

    # --- Horizontal cut lines (Y cuts) ---
    for cy_cut in cuts_y:
        cut_y_mm = -plate_l / 2 + cy_cut * C.GRID_UNIT_MM
        is_below = seg_y_end == cy_cut
        is_above = seg_y_start == cy_cut
        if not (is_below or is_above):
            continue

        seg_x_center = (seg_x_min + seg_x_max) / 2
        seg_x_len = seg_x_max - seg_x_min
        n_tabs = max(1, min(3, int(seg_x_len / (tab_w * 6))))
        if n_tabs == 1:
            tab_xs = [seg_x_center]
        else:
            spacing = seg_x_len / (n_tabs + 1)
            tab_xs = [seg_x_min + spacing * (i + 1) for i in range(n_tabs)]

        for tx in tab_xs:
            if is_below:
                tab = _build_dovetail_tab(tab_d, tab_w, base_h, "+y")
                tab = tab.moved(Location((tx, cut_y_mm, 0)))
                try:
                    shape = shape + tab
                except Exception:
                    pass
            elif is_above:
                slot = _build_dovetail_slot(tab_d, tab_w, base_h, tol, "-y")
                slot = slot.moved(Location((tx, cut_y_mm, 0)))
                try:
                    shape = shape - slot
                except Exception:
                    pass

    return shape


def _build_dovetail_tab(depth: float, width: float, height: float, direction: str) -> Solid:
    """Build a dovetail-shaped tab (trapezoidal, wider at the tip).

    Confined to Z = 0..height (the solid base slab, no taper). direction is
    "+x" or "+y" — which way the tab protrudes from the segment edge.
    """
    extra = DOVETAIL_EXTRA_MM
    if direction == "+x":
        pts = [
            (0, -width / 2),
            (0, width / 2),
            (depth, width / 2 + extra),
            (depth, -width / 2 - extra),
        ]
    else:  # "+y"
        pts = [
            (-width / 2, 0),
            (width / 2, 0),
            (width / 2 + extra, depth),
            (-width / 2 - extra, depth),
        ]
    try:
        sketch = Sketch() + Polygon(pts)
        solid = extrude(sketch, amount=height)
        bb = solid.bounding_box()
        solid = solid.moved(Location((0, 0, -bb.min.Z)))
        return solid
    except Exception:
        if direction == "+x":
            return Box(depth, width + 2 * extra, height).moved(Location((depth / 2, 0, height / 2)))
        else:
            return Box(width + 2 * extra, depth, height).moved(Location((0, depth / 2, height / 2)))


def _build_dovetail_slot(depth: float, width: float, height: float, tol: float, direction: str) -> Solid:
    """Build a dovetail-shaped slot cutter matching _build_dovetail_tab, with tolerance.

    Confined to Z = 0..height. direction is "-x" or "-y" — the slot opens at
    the segment edge (slightly outside, for a clean cut) and goes inward.
    """
    extra = DOVETAIL_EXTRA_MM
    slot_depth = depth + tol
    base_w = width + 2 * tol
    tip_w = width + 2 * extra + 2 * tol

    if direction == "-x":
        pts = [
            (-1, -base_w / 2),
            (-1, base_w / 2),
            (slot_depth, tip_w / 2),
            (slot_depth, -tip_w / 2),
        ]
    else:  # "-y"
        pts = [
            (-base_w / 2, -1),
            (base_w / 2, -1),
            (tip_w / 2, slot_depth),
            (-tip_w / 2, slot_depth),
        ]
    try:
        sketch = Sketch() + Polygon(pts)
        solid = extrude(sketch, amount=height)
        bb = solid.bounding_box()
        solid = solid.moved(Location((0, 0, -bb.min.Z)))
        return solid
    except Exception:
        if direction == "-x":
            return Box(slot_depth + 1, tip_w, height).moved(Location((slot_depth / 2 - 0.5, 0, height / 2)))
        else:
            return Box(tip_w, slot_depth + 1, height).moved(Location((0, slot_depth / 2 - 0.5, height / 2)))


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
