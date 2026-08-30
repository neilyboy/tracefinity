"""Gridfinity custom baseplate generator.

Builds custom-shaped baseplates that fit inside tool chest drawers.
The baseplate has the standard Gridfinity socket pattern on top so
bins slot in, and can be cut to any shape to work around drawer
obstructions (hinges, latches, etc.).

For large baseplates that don't fit on a single print bed, the
baseplate is segmented into printable pieces with optional edge
clip connectors for assembly.

Socket profile follows the Kennetek gridfinity-rebuilt-openscad
reference implementation:
  https://github.com/kennetek/gridfinity-rebuilt-openscad

Profile (bottom to top):
  Z=0:      36.3mm  (narrowest, bottom of socket)
  Z=0.7:    37.7mm  (after 0.7mm 45° bottom chamfer)
  Z=2.5:    37.7mm  (after 1.8mm vertical section)
  Z=4.65:   42mm    (after 2.15mm 45° top chamfer = full grid size)
  Z=5.0:    42mm    (0.35mm clearance above profile)
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


# Minimum base slab thickness needed for dovetail edge clips to work.
# When the user selects edge clips with base_thickness=0 (filament-saving),
# the segments get simple flat edges instead.
MIN_BASE_FOR_CLIPS = 1.6

# Dovetail tab dimensions
DOVETAIL_EXTRA_MM = 1.0  # how much wider the tab tip is than its base, per side


# ---------------------------------------------------------------------------
# Grid computation
# ---------------------------------------------------------------------------

def compute_grid(params: BaseplateParams) -> tuple[int, int, float, float]:
    """Compute the gridfinity grid dimensions that fit inside the drawer.

    Returns (grid_w, grid_l, plate_w, plate_l) where:
    - grid_w/grid_l = number of 42mm cells
    - plate_w/plate_l = actual baseplate size in mm — fills the entire
      drawer (minus padding/clearance), not just the grid cells. The
      leftover space beyond the grid becomes solid filler material.
    """
    avail_w = params.drawer_w_mm - params.padding_left_mm - params.padding_right_mm - 2 * params.drawer_clearance_mm
    avail_l = params.drawer_l_mm - params.padding_top_mm - params.padding_bottom_mm - 2 * params.drawer_clearance_mm
    grid_w = max(1, int(avail_w // C.GRID_UNIT_MM))
    grid_l = max(1, int(avail_l // C.GRID_UNIT_MM))
    # Plate fills the entire available drawer space, not just grid cells
    plate_w = avail_w
    plate_l = avail_l
    return grid_w, grid_l, plate_w, plate_l


def auto_segment(grid_w: int, grid_l: int, bed_w: float, bed_l: float) -> tuple[list[int], list[int]]:
    """Auto-compute cut lines so each segment fits on the print bed."""
    margin = 10  # mm safety margin
    max_cells_x = max(1, int((bed_w - margin) // C.GRID_UNIT_MM))
    max_cells_y = max(1, int((bed_l - margin) // C.GRID_UNIT_MM))
    cuts_x = list(range(max_cells_x, grid_w, max_cells_x))
    cuts_y = list(range(max_cells_y, grid_l, max_cells_y))
    return cuts_x, cuts_y


def _segment_bounds(grid_w: int, grid_l: int, cuts_x: list[int], cuts_y: list[int]) -> list[tuple[int, int, int, int]]:
    """Compute the (col_start, col_end, row_start, row_end) for each segment."""
    x_boundaries = [0] + sorted(cuts_x) + [grid_w]
    y_boundaries = [0] + sorted(cuts_y) + [grid_l]
    segments = []
    for i in range(len(x_boundaries) - 1):
        for j in range(len(y_boundaries) - 1):
            segments.append((x_boundaries[i], x_boundaries[i + 1], y_boundaries[j], y_boundaries[j + 1]))
    return segments


# ---------------------------------------------------------------------------
# Socket cutter — Kennetek spec profile with sharp 45° chamfers
# ---------------------------------------------------------------------------

def _build_socket_cutter(grid_w: int, grid_l: int, plate_top_z: float, through_hole: bool = False) -> Part:
    """Build the gridfinity socket pattern as a cutter (to subtract from the plate).

    Each cell gets a three-section socket profile matching the Kennetek spec:
    1. Bottom chamfer (0.7mm, 45°): narrows from 37.7mm to 36.3mm
    2. Vertical section (1.8mm): straight walls at 37.7mm
    3. Top chamfer (2.15mm, 45°): widens from 37.7mm to 42mm

    Uses extrude(taper=...) for each section to create SHARP 45° chamfer
    edges (loft creates smooth/rounded transitions instead).

    If through_hole=True, the cutter extends below the socket profile to
    cut all the way through the plate (filament-saving mode).

    Optimization: builds one cell, then creates translated copies and fuses
    them all at once via a compound (much faster than sequential fusing).
    """
    # Build one cell at origin, then translate copies
    base_cell = _build_single_socket_cell(
        C.BASEPLATE_SOCKET_BOTTOM_SIZE, C.BASEPLATE_SOCKET_NECK_SIZE, C.BASEPLATE_SOCKET_TOP_SIZE,
        C.BASEPLATE_PROFILE_BOTTOM_CHAMFER_H, C.BASEPLATE_PROFILE_VERTICAL_H,
        C.BASEPLATE_PROFILE_TOP_CHAMFER_H, C.BASEPLATE_CLEARANCE_H,
        through_hole, plate_top_z,
    )

    # Create all translated copies as a list of Solids
    cells = []
    for gx in range(grid_w):
        for gy in range(grid_l):
            cx = -grid_w * C.GRID_UNIT_MM / 2 + (gx + 0.5) * C.GRID_UNIT_MM
            cy = -grid_l * C.GRID_UNIT_MM / 2 + (gy + 0.5) * C.GRID_UNIT_MM
            cells.append(base_cell.moved(Location((cx, cy, 0))))

    # Fuse all cells at once using Compound (avoids N-1 sequential boolean ops)
    from build123d import Compound
    compound = Compound(children=cells)
    # Convert to a single fused solid
    cutter = compound.fuse()
    return cutter if isinstance(cutter, Part) else Part(cutter)


def _build_single_socket_cell(
    bottom_size: float, neck_size: float, top_size: float,
    bottom_chamfer_h: float, vertical_h: float, top_chamfer_h: float,
    clearance_h: float,
    through_hole: bool, plate_top_z: float,
) -> Solid:
    """Build a single socket cell cutter with the three-section Kennetek profile.

    Uses extrude(taper=...) for sharp 45° chamfers. The cell is built
    bottom-up and then positioned so the top is at plate_top_z.
    """
    # Build from bottom to top
    # Section 1: Bottom chamfer (36.3mm -> 37.7mm, 0.7mm tall, -45° taper)
    with BuildPart() as bp1:
        with BuildSketch(Plane.XY) as s:
            Rectangle(bottom_size, bottom_size)
        extrude(amount=bottom_chamfer_h, taper=-45)
    section1 = bp1.part

    # Section 2: Vertical (37.7mm, 1.8mm tall, no taper)
    with BuildPart() as bp2:
        with BuildSketch(Plane.XY.moved(Location((0, 0, bottom_chamfer_h)))) as s:
            Rectangle(neck_size, neck_size)
        extrude(amount=vertical_h)
    section2 = bp2.part

    # Section 3: Top chamfer (37.7mm -> 42mm, 2.15mm tall, -45° taper)
    with BuildPart() as bp3:
        with BuildSketch(Plane.XY.moved(Location((0, 0, bottom_chamfer_h + vertical_h)))) as s:
            Rectangle(neck_size, neck_size)
        extrude(amount=top_chamfer_h, taper=-45)
    section3 = bp3.part

    # Section 4: Clearance (42mm, 0.35mm tall, no taper)
    with BuildPart() as bp4:
        with BuildSketch(Plane.XY.moved(Location((0, 0, bottom_chamfer_h + vertical_h + top_chamfer_h)))) as s:
            Rectangle(top_size, top_size)
        extrude(amount=clearance_h + 0.1)  # slight overshoot for clean boolean
    section4 = bp4.part

    cell = section1 + section2 + section3 + section4

    # If through-hole, extend the bottom section down through the plate
    if through_hole:
        # Extend the bottom_size section downward to Z=0 (or below)
        through_depth = plate_top_z - (bottom_chamfer_h + vertical_h + top_chamfer_h + clearance_h) + 1.0
        if through_depth > 0:
            with BuildPart() as bp5:
                with BuildSketch(Plane.XY.moved(Location((0, 0, -through_depth)))) as s:
                    Rectangle(bottom_size, bottom_size)
                extrude(amount=through_depth)
            cell = cell + bp5.part

    # Position so the top of the cell is at plate_top_z
    bb = cell.bounding_box()
    cell = cell.moved(Location((0, 0, plate_top_z - bb.max.Z)))

    return cell


# ---------------------------------------------------------------------------
# Magnet holes
# ---------------------------------------------------------------------------

def _build_magnet_holes(grid_w: int, grid_l: int, plate_top_z: float, base_h: float) -> Part | None:
    """Build magnet hole cutters for all cell corners as a single fused part.

    Magnets sit at the bottom of the socket (deepest point), which is
    at Z = plate_top_z - BASEPLATE_HEIGHT_MM (the bottom of the socket profile).
    Holes go downward into the base slab from there.

    Returns a single fused Part (or None if no holes) for efficient
    single-pass subtraction from the plate.
    """
    magnet_d = C.MAGNET_DIAMETER_MM
    magnet_depth = C.MAGNET_DEPTH_MM
    inset = 8.0  # mm from cell edge to magnet center
    socket_bottom_z = plate_top_z - C.BASEPLATE_HEIGHT_MM

    # Build one cylinder at origin, then create translated copies
    base_hole = Cylinder(magnet_d / 2, magnet_depth + 0.1)
    base_hole = base_hole.moved(Location((0, 0, -magnet_depth / 2 - 0.05)))

    holes = []
    for gx in range(grid_w):
        for gy in range(grid_l):
            cx = -grid_w * C.GRID_UNIT_MM / 2 + (gx + 0.5) * C.GRID_UNIT_MM
            cy = -grid_l * C.GRID_UNIT_MM / 2 + (gy + 0.5) * C.GRID_UNIT_MM

            for dx in [-1, 1]:
                for dy in [-1, 1]:
                    mx = cx + dx * (C.GRID_UNIT_MM / 2 - inset)
                    my = cy + dy * (C.GRID_UNIT_MM / 2 - inset)
                    holes.append(base_hole.moved(Location((mx, my, socket_bottom_z))))

    if not holes:
        return None

    from build123d import Compound
    compound = Compound(children=holes)
    fused = compound.fuse()
    return fused if isinstance(fused, Part) else Part(fused)


# ---------------------------------------------------------------------------
# Screw holes
# ---------------------------------------------------------------------------

def _build_screw_holes(grid_w: int, grid_l: int, total_h: float) -> Part | None:
    """Build screw hole cutters (M3 through-holes) at cell corners as a single fused part."""
    screw_d = C.SCREW_DIAMETER_MM
    inset = 8.0

    base_hole = Cylinder(screw_d / 2, total_h + 2)
    base_hole = base_hole.moved(Location((0, 0, total_h / 2)))

    holes = []
    for gx in range(grid_w):
        for gy in range(grid_l):
            cx = -grid_w * C.GRID_UNIT_MM / 2 + (gx + 0.5) * C.GRID_UNIT_MM
            cy = -grid_l * C.GRID_UNIT_MM / 2 + (gy + 0.5) * C.GRID_UNIT_MM

            for dx in [-1, 1]:
                for dy in [-1, 1]:
                    mx = cx + dx * (C.GRID_UNIT_MM / 2 - inset)
                    my = cy + dy * (C.GRID_UNIT_MM / 2 - inset)
                    holes.append(base_hole.moved(Location((mx, my, 0))))

    if not holes:
        return None

    from build123d import Compound
    compound = Compound(children=holes)
    fused = compound.fuse()
    return fused if isinstance(fused, Part) else Part(fused)


# ---------------------------------------------------------------------------
# Drawer cutouts
# ---------------------------------------------------------------------------

def _build_cutout_solid(
    cutout: DrawerCutout,
    drawer_w: float, drawer_l: float,
    plate_w: float, plate_l: float,
    total_h: float,
) -> Solid | None:
    """Build a solid representing a drawer obstruction to subtract from the plate."""
    try:
        cx = cutout.center_x_mm
        cy = cutout.center_y_mm
        w = cutout.width_mm
        h = cutout.height_mm
        cutout_type = getattr(cutout, 'cutout_type', 'through')
        depth = getattr(cutout, 'depth_mm', total_h)

        if cutout_type == 'partial':
            cut_h = depth
        else:
            cut_h = total_h + 2

        # Build as a box centered at (cx, cy)
        solid = Box(w, h, cut_h)
        solid = solid.moved(Location((cx, cy, cut_h / 2 if cutout_type == 'partial' else total_h / 2)))

        # Apply rotation if specified
        rot_deg = getattr(cutout, 'rotation_deg', 0)
        if rot_deg:
            solid = solid.moved(Location((cx, cy, 0), None))
            # Rotate around Z
            from build123d import Rot
            solid = solid.moved(Rot(Axis.Z, rot_deg))
            solid = solid.moved(Location((-cx, -cy, 0), None))

        return solid
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Dovetail connectors (for base-slab mode only)
# ---------------------------------------------------------------------------

def _build_dovetail_tab(depth: float, width: float, height: float, direction: str) -> Solid:
    """Build a dovetail locking tab with 45° chamfered top.

    The tab is a trapezoid (dovetail: wider at the protruding tip) with:
    - Straight walls for most of the height
    - 45° chamfer on all top edges (support-free when printed)

    Confined to Z = 0..height. direction is "+x" or "+y".
    """
    extra = DOVETAIL_EXTRA_MM
    chamfer_size = min(height * 0.35, 1.2)  # 45° chamfer on top edges

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
        from build123d import BuildPart, BuildSketch, Plane, chamfer as bp_chamfer
        with BuildPart() as bp:
            with BuildSketch(Plane.XY):
                Polygon(pts)
            extrude(amount=height)
            # Chamfer top edges (at Z = height)
            top_edges = [e for e in bp.edges() if abs(e.position_at(0.5).Z - height) < 0.01]
            if top_edges:
                bp_chamfer(top_edges, length=chamfer_size)

        tab = bp.part
        bb = tab.bounding_box()
        tab = tab.moved(Location((0, 0, -bb.min.Z)))
        return tab
    except Exception:
        # Fallback: simple extruded dovetail (no chamfer)
        sk = Sketch() + Polygon(pts)
        tab = extrude(sk, amount=height)
        bb = tab.bounding_box()
        tab = tab.moved(Location((0, 0, -bb.min.Z)))
        return tab


def _build_dovetail_slot(depth: float, width: float, height: float, tol: float, direction: str) -> Solid:
    """Build a through-hole dovetail slot — fully support-free.

    The slot is a through-hole through the BASE ONLY (Z = -1 to height+1).
    It does NOT extend above the base into the tray's floor/walls area.

    No ceiling = no horizontal overhangs = no supports needed.
    The tab slides in from the side and locks horizontally via dovetail.

    direction is "-x" or "-y" — the slot opens at the segment edge.
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
        sk = Sketch() + Polygon(pts)
        # Through-hole through the base only: Z = -1 to height+1
        # extrude goes in -Z (result is Z=[-(h+2), 0]), then move up by h+1
        slot = extrude(sk, amount=height + 2)
        slot = slot.moved(Location((0, 0, height + 1)))  # Z = [-1, height+1]
        return slot
    except Exception:
        if direction == "-x":
            return Box(slot_depth + 1, tip_w, height + 2).moved(Location((slot_depth / 2 - 0.5, 0, 0)))
        else:
            return Box(tip_w, slot_depth + 1, height + 2).moved(Location((0, slot_depth / 2 - 0.5, 0)))


# ---------------------------------------------------------------------------
# Segment shape builder
# ---------------------------------------------------------------------------

def _build_segment_shape(
    seg_x_start: int, seg_x_end: int, seg_y_start: int, seg_y_end: int,
    grid_w: int, grid_l: int,
    plate_w: float, plate_l: float,
    cuts_x: list[int], cuts_y: list[int],
    params: BaseplateParams,
    total_h: float,
    base_h: float,
    use_clips: bool,
) -> Solid:
    """Build the intersection shape for one segment.

    Two Z layers:
    1. Socket section (Z = base_h .. total_h): exact bounds, no margin at
       cut lines — prevents double walls at seams.
    2. Base slab (Z = 0 .. base_h): full margin + dovetail tabs/slots
       (only if use_clips is True and base_h > 0).

    The grid cells are centered within the plate. The first segment in
    each direction extends to the plate edge (including filler material),
    and the last segment extends to the opposite plate edge.
    """
    grid_w_mm = grid_w * C.GRID_UNIT_MM
    grid_l_mm = grid_l * C.GRID_UNIT_MM
    # Grid is centered in the plate; offset from plate center to grid edge
    grid_x_offset = (plate_w - grid_w_mm) / 2  # filler on each side
    grid_y_offset = (plate_l - grid_l_mm) / 2

    # Segment bounds in grid coordinates
    seg_w = (seg_x_end - seg_x_start) * C.GRID_UNIT_MM
    seg_l = (seg_y_end - seg_y_start) * C.GRID_UNIT_MM
    # Grid-local coordinates (centered at origin)
    seg_x_min_grid = -grid_w_mm / 2 + seg_x_start * C.GRID_UNIT_MM
    seg_x_max_grid = -grid_w_mm / 2 + seg_x_end * C.GRID_UNIT_MM
    seg_y_min_grid = -grid_l_mm / 2 + seg_y_start * C.GRID_UNIT_MM
    seg_y_max_grid = -grid_l_mm / 2 + seg_y_end * C.GRID_UNIT_MM

    # Convert to plate coordinates (shift by grid offset)
    seg_x_min = seg_x_min_grid - grid_x_offset
    seg_x_max = seg_x_max_grid - grid_x_offset
    seg_y_min = seg_y_min_grid - grid_y_offset
    seg_y_max = seg_y_max_grid - grid_y_offset
    seg_cx = (seg_x_min + seg_x_max) / 2
    seg_cy = (seg_y_min + seg_y_max) / 2

    # Determine which edges are internal (cut lines) vs external (plate edges)
    x_cuts_set = set(cuts_x)
    y_cuts_set = set(cuts_y)
    left_is_cut = seg_x_start in x_cuts_set
    right_is_cut = seg_x_end in x_cuts_set
    below_is_cut = seg_y_start in y_cuts_set
    above_is_cut = seg_y_end in y_cuts_set

    # --- Socket section: exact bounds, no margin at cut lines ---
    # First/last segments extend to the plate edge (including filler material)
    socket_margin_left = 0.01 if left_is_cut else 1.0
    socket_margin_right = 0.01 if right_is_cut else 1.0
    socket_margin_below = 0.01 if below_is_cut else 1.0
    socket_margin_above = 0.01 if above_is_cut else 1.0

    # Extend to plate edges for outer segments (filler material)
    plate_x_min = -plate_w / 2
    plate_x_max = plate_w / 2
    plate_y_min = -plate_l / 2
    plate_y_max = plate_l / 2

    # If this is the first segment in X, extend left to plate edge
    if seg_x_start == 0:
        socket_margin_left = seg_x_min - plate_x_min + 1.0
    # If this is the last segment in X, extend right to plate edge
    if seg_x_end == grid_w:
        socket_margin_right = plate_x_max - seg_x_max + 1.0
    # If this is the first segment in Y, extend down to plate edge
    if seg_y_start == 0:
        socket_margin_below = seg_y_min - plate_y_min + 1.0
    # If this is the last segment in Y, extend up to plate edge
    if seg_y_end == grid_l:
        socket_margin_above = plate_y_max - seg_y_max + 1.0

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

    if base_h <= 0:
        # Filament-saving mode: no base slab, just the socket section
        return socket_box

    # --- Base slab: full margin + optional dovetail tabs ---
    # Use the same extended margins as the socket section (includes filler)
    base_box = Box(
        seg_w + socket_margin_left + socket_margin_right,
        seg_l + socket_margin_below + socket_margin_above,
        base_h + 0.02,
    )
    base_box = base_box.moved(Location((
        seg_cx + (socket_margin_right - socket_margin_left) / 2,
        seg_cy + (socket_margin_above - socket_margin_below) / 2,
        base_h / 2,
    )))

    shape = base_box + socket_box

    if not use_clips:
        return shape

    # Add dovetail tabs/slots to the base slab section
    tab_w = params.clip_width_mm
    tab_d = params.clip_depth_mm
    tol = params.clip_tolerance_mm

    # --- Vertical cut lines (X cuts) ---
    # Cut lines are at grid cell boundaries, in plate coordinates
    for cx in cuts_x:
        cut_x_mm = -grid_w_mm / 2 + cx * C.GRID_UNIT_MM - grid_x_offset
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
        cut_y_mm = -grid_l_mm / 2 + cy_cut * C.GRID_UNIT_MM - grid_y_offset
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


# ---------------------------------------------------------------------------
# Seam magnets
# ---------------------------------------------------------------------------

def _add_seam_magnets(
    segment: Part,
    seg_x_start: int, seg_x_end: int, seg_y_start: int, seg_y_end: int,
    grid_w: int, grid_l: int,
    plate_w: float, plate_l: float,
    cuts_x: list[int], cuts_y: list[int],
    total_h: float,
) -> Part:
    """Add magnet holes at seam midpoints for alignment."""
    grid_w_mm = grid_w * C.GRID_UNIT_MM
    grid_l_mm = grid_l * C.GRID_UNIT_MM
    grid_x_offset = (plate_w - grid_w_mm) / 2
    grid_y_offset = (plate_l - grid_l_mm) / 2

    for cx in cuts_x:
        cut_x_mm = -grid_w_mm / 2 + cx * C.GRID_UNIT_MM - grid_x_offset
        seg_y_center = -grid_l_mm / 2 + (seg_y_start + seg_y_end) / 2 * C.GRID_UNIT_MM - grid_y_offset
        if seg_x_start == cx or seg_x_end == cx:
            hole = Cylinder(C.MAGNET_DIAMETER_MM / 2, C.MAGNET_DEPTH_MM + 0.1)
            hole = hole.moved(Location((cut_x_mm, seg_y_center, total_h - C.MAGNET_DEPTH_MM / 2)))
            try:
                segment = segment - hole
            except Exception:
                pass

    for cy in cuts_y:
        cut_y_mm = -grid_l_mm / 2 + cy * C.GRID_UNIT_MM - grid_y_offset
        seg_x_center = -grid_w_mm / 2 + (seg_x_start + seg_x_end) / 2 * C.GRID_UNIT_MM - grid_x_offset
        if seg_y_start == cy or seg_y_end == cy:
            hole = Cylinder(C.MAGNET_DIAMETER_MM / 2, C.MAGNET_DEPTH_MM + 0.1)
            hole = hole.moved(Location((seg_x_center, cut_y_mm, total_h - C.MAGNET_DEPTH_MM / 2)))
            try:
                segment = segment - hole
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

    # Effective base slab thickness.
    # Start with the user's requested base thickness, then auto-raise it
    # if magnets or edge clips need more room. This means that even with
    # base_thickness=0, selecting magnets or edge clips will force a base
    # slab (overriding filament-saving mode).
    base_h = max(0.0, params.base_thickness_mm)
    if params.magnet_holes:
        base_h = max(base_h, C.MAGNET_DEPTH_MM + 0.4)  # 2.4mm
    if params.screw_holes:
        base_h = max(base_h, C.SCREW_DEPTH_MM * 0.5)   # need room for screw
    if params.connector_type == "edge_clips":
        base_h = max(base_h, MIN_BASE_FOR_CLIPS)       # 1.6mm

    # Filament-saving mode (through holes) only applies when there are no
    # magnets, screws, or edge clips that require a base slab.
    filament_saving = (base_h <= 0)

    total_h = C.BASEPLATE_HEIGHT_MM + base_h  # 5mm socket + base slab

    # 1. Build the solid plate
    plate = Box(plate_w, plate_l, total_h)
    plate = plate.moved(Location((0, 0, total_h / 2)))

    # 2. Cut the gridfinity socket pattern into the top
    plate_top_z = total_h
    socket_cutter = _build_socket_cutter(grid_w, grid_l, plate_top_z, through_hole=filament_saving)
    try:
        plate = plate - socket_cutter
    except Exception:
        pass

    if not isinstance(plate, Part):
        try:
            plate = Part(plate)
        except Exception:
            pass

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

    # 4. Add magnet holes (only with a base slab) — single fused cutter
    if params.magnet_holes and base_h > 0:
        magnet_cutter = _build_magnet_holes(grid_w, grid_l, plate_top_z, base_h)
        if magnet_cutter is not None:
            try:
                plate = plate - magnet_cutter
            except Exception:
                pass

    # 5. Add screw holes (only with a base slab) — single fused cutter
    if params.screw_holes and base_h > 0:
        screw_cutter = _build_screw_holes(grid_w, grid_l, total_h)
        if screw_cutter is not None:
            try:
                plate = plate - screw_cutter
            except Exception:
                pass

    # 6. Segment the plate
    cuts_x = params.cut_lines_x if params.cut_lines_x else []
    cuts_y = params.cut_lines_y if params.cut_lines_y else []
    if not cuts_x and not cuts_y:
        auto_x, auto_y = auto_segment(grid_w, grid_l, params.print_bed_w_mm, params.print_bed_l_mm)
        cuts_x = auto_x
        cuts_y = auto_y

    if not cuts_x and not cuts_y:
        return [plate]

    # Determine connector type for this configuration
    use_clips = (
        params.connector_type == "edge_clips"
        and base_h >= MIN_BASE_FOR_CLIPS
    )

    # 7. Cut the plate into segments
    segments = _segment_bounds(grid_w, grid_l, cuts_x, cuts_y)
    segment_parts = []
    for (sx_start, sx_end, sy_start, sy_end) in segments:
        seg_shape = _build_segment_shape(
            sx_start, sx_end, sy_start, sy_end,
            grid_w, grid_l, plate_w, plate_l,
            cuts_x, cuts_y, params, total_h, base_h, use_clips,
        )

        try:
            intersect_result = plate.intersect(seg_shape)
            if not intersect_result:
                continue
            seg_part = intersect_result[0]
        except Exception:
            continue

        # Add seam magnets if requested
        if params.connector_type == "magnets":
            seg_part = _add_seam_magnets(
                seg_part, sx_start, sx_end, sy_start, sy_end,
                grid_w, grid_l, plate_w, plate_l,
                cuts_x, cuts_y, total_h,
            )

        # Re-apply partial cutouts after segmentation
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

        # Ensure we return a Part (intersect returns a ShapeList of Solids)
        if not isinstance(seg_part, Part):
            try:
                seg_part = Part(seg_part)
            except Exception:
                pass
        segment_parts.append(seg_part)

    return segment_parts if segment_parts else [plate]


def get_segment_info(design: BaseplateDesign) -> dict:
    """Get info about the baseplate and its segments for the frontend/router.

    Returns a dict with:
    - grid_w, grid_l: number of cells
    - plate_w, plate_l: plate size in mm
    - segments: list of per-segment dicts
    """
    params = design.params
    grid_w, grid_l, plate_w, plate_l = compute_grid(params)

    cuts_x = params.cut_lines_x if params.cut_lines_x else []
    cuts_y = params.cut_lines_y if params.cut_lines_y else []
    if not cuts_x and not cuts_y:
        auto_x, auto_y = auto_segment(grid_w, grid_l, params.print_bed_w_mm, params.print_bed_l_mm)
        cuts_x = auto_x
        cuts_y = auto_y

    segments_list = []
    grid_w_mm = grid_w * C.GRID_UNIT_MM
    grid_l_mm = grid_l * C.GRID_UNIT_MM
    grid_x_offset = (plate_w - grid_w_mm) / 2
    grid_y_offset = (plate_l - grid_l_mm) / 2

    if not cuts_x and not cuts_y:
        segments_list.append({
            "index": 1, "cells_w": grid_w, "cells_h": grid_l,
            "w": plate_w, "h": plate_l, "x": 0, "y": 0,
        })
    else:
        seg_bounds = _segment_bounds(grid_w, grid_l, cuts_x, cuts_y)
        for i, (sx_start, sx_end, sy_start, sy_end) in enumerate(seg_bounds):
            # Grid-local bounds
            w = (sx_end - sx_start) * C.GRID_UNIT_MM
            h = (sy_end - sy_start) * C.GRID_UNIT_MM
            x_grid = -grid_w_mm / 2 + sx_start * C.GRID_UNIT_MM + w / 2
            y_grid = -grid_l_mm / 2 + sy_start * C.GRID_UNIT_MM + h / 2
            # Convert to plate coordinates
            x = x_grid - grid_x_offset
            y = y_grid - grid_y_offset
            # For outer segments, extend w/h to include filler
            actual_w = w
            actual_h = h
            if sx_start == 0:
                actual_w += grid_x_offset
                x -= grid_x_offset / 2
            if sx_end == grid_w:
                actual_w += grid_x_offset
                x += grid_x_offset / 2
            if sy_start == 0:
                actual_h += grid_y_offset
                y -= grid_y_offset / 2
            if sy_end == grid_l:
                actual_h += grid_y_offset
                y += grid_y_offset / 2
            segments_list.append({
                "index": i + 1,
                "cells_w": sx_end - sx_start,
                "cells_h": sy_end - sy_start,
                "w": actual_w, "h": actual_h, "x": x, "y": y,
            })

    return {
        "grid_w": grid_w,
        "grid_l": grid_l,
        "plate_w": plate_w,
        "plate_l": plate_l,
        "segment_count": len(segments_list),
        "segments": segments_list,
        "cuts_x": cuts_x,
        "cuts_y": cuts_y,
    }
