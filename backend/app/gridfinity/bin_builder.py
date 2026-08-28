"""Build a Gridfinity bin solid using build123d.

This creates a proper Gridfinity-compatible bin with:
- Per-cell stacking socket base (chamfered profile that slots into baseplates)
- Magnet holes in each cell corner
- Solid floor for tool pockets
- Walls with stacking lip
- Tool pockets cut into the floor
"""
from __future__ import annotations

from build123d import (
    Axis,
    Box,
    BuildPart,
    BuildSketch,
    Cylinder,
    Location,
    Part,
    Plane,
    Polygon,
    Rectangle,
    Solid,
    Sphere,
    extrude,
    fillet,
    chamfer,
    loft,
    Text,
    Mode,
    Align,
)

from . import constants as C


def build_bin(
    grid_w: int,
    grid_l: int,
    height_units: int,
    *,
    wall_thickness_mm: float = C.DEFAULT_WALL_THICKNESS_MM,
    base_thickness_mm: float = 0.8,
    magnet_holes: bool = True,
    screw_holes: bool = False,
    scoop: bool = True,
    scoop_depth_mm: float = C.DEFAULT_SCOOP_DEPTH_MM,
    tabs: str = "none",
    lip: bool = True,
    label_tab: bool = False,
    label_text: str = "",
    label_font_size_mm: float = 6.0,
    label_depth_mm: float = 0.6,
    compartments_x: int = 1,
    compartments_y: int = 1,
    pocket_depth_mm: float = 15.0,
    use_flat_insert: bool = False,
    flat_thickness_mm: float = 2.0,
) -> Solid:
    """Build a gridfinity bin solid (without tool pockets).

    The bin has the proper Gridfinity base profile with per-cell chamfered
    sockets, magnet holes, a solid floor, walls, and stacking lip.
    """
    bin_w = grid_w * C.GRID_UNIT_MM - C.BIN_CLEARANCE_MM
    bin_l = grid_l * C.GRID_UNIT_MM - C.BIN_CLEARANCE_MM
    total_h = height_units * C.HEIGHT_UNIT_MM

    # --- Per-cell stacking socket base ---
    base = _build_per_cell_socket_base(grid_w, grid_l)

    # --- Solid floor ---
    # A solid block above the base that tool pockets will be cut into.
    floor_h = max(pocket_depth_mm, C.FLOOR_THICKNESS)
    floor_h = min(floor_h, total_h - C.BASE_HEIGHT_MM)
    if floor_h < 1.0:
        floor_h = 1.0

    floor = Box(bin_w, bin_l, floor_h)
    floor = floor.moved(Location((0, 0, C.BASE_HEIGHT_MM + floor_h / 2)))

    # --- Walls above the floor ---
    wall_h = total_h - C.BASE_HEIGHT_MM - floor_h
    if wall_h > 0.5:
        walls_outer = Box(bin_w, bin_l, wall_h)
        walls_outer = walls_outer.moved(Location((0, 0, C.BASE_HEIGHT_MM + floor_h + wall_h / 2)))
        inner_w = bin_w - 2 * wall_thickness_mm
        inner_l = bin_l - 2 * wall_thickness_mm
        cavity = Box(inner_w, inner_l, wall_h + 0.1)
        cavity = cavity.moved(Location((0, 0, C.BASE_HEIGHT_MM + floor_h + wall_h / 2)))
        walls = walls_outer - cavity
    else:
        walls = Box(0.1, 0.1, 0.1)

    # Combine base + floor + walls
    bin_solid = Part(base) + Part(floor) + Part(walls)

    # --- Stacking lip ---
    if lip and wall_h > 0:
        lip_outer = Box(
            bin_w + 2 * C.LIP_OVERHANG_MM,
            bin_l + 2 * C.LIP_OVERHANG_MM,
            C.LIP_HEIGHT_MM,
        )
        lip_z = total_h + C.LIP_HEIGHT_MM / 2
        lip_outer = lip_outer.moved(Location((0, 0, lip_z)))
        lip_inner = Box(
            bin_w - 2 * wall_thickness_mm,
            bin_l - 2 * wall_thickness_mm,
            C.LIP_HEIGHT_MM + 0.1,
        )
        lip_inner = lip_inner.moved(Location((0, 0, lip_z)))
        lip_part = lip_outer - lip_inner
        bin_solid = bin_solid + Part(lip_part)

        # --- Flat insert recess ---
        # When use_flat_insert is enabled, recess the floor top inside the walls
        # by flat_thickness_mm so the flat insert sits flush with the wall top.
        # The flat insert fills this recess; its top is at the wall top (total_h),
        # so the stacking lip sits on top at the correct height.
        if use_flat_insert and flat_thickness_mm > 0:
            recess_w = bin_w - 2 * wall_thickness_mm
            recess_l = bin_l - 2 * wall_thickness_mm
            # Floor top is at Z = BASE_HEIGHT_MM + floor_h
            floor_top_z = C.BASE_HEIGHT_MM + floor_h
            # Recess removes from floor_top - flat_thickness to floor_top + 0.1
            # (slightly into wall area for clean boolean cut)
            recess_h = flat_thickness_mm + 0.1
            recess_z = floor_top_z - flat_thickness_mm / 2 + 0.05
            recess = Box(recess_w, recess_l, recess_h)
            recess = recess.moved(Location((0, 0, recess_z)))
            bin_solid = bin_solid - Part(recess)

    # --- Magnet holes (in each cell corner) ---
    if magnet_holes:
        bin_solid = _add_magnet_holes(bin_solid, grid_w, grid_l)

    # --- Screw holes ---
    if screw_holes:
        bin_solid = _add_screw_holes(bin_solid, grid_w, grid_l)

    # --- Compartments (dividers) ---
    if compartments_x > 1 or compartments_y > 1:
        bin_solid = _add_dividers(
            bin_solid, grid_w, grid_l, wall_thickness_mm, base_thickness_mm,
            total_h, compartments_x, compartments_y,
        )

    # --- Scoop ---
    if scoop and wall_h > C.DEFAULT_SCOOP_DEPTH_MM:
        bin_solid = _add_scoop(bin_solid, bin_w, bin_l, wall_thickness_mm, total_h, scoop_depth_mm)

    # --- Label tab ---
    if label_tab:
        bin_solid = _add_label_tab(
            bin_solid, bin_w, bin_l, wall_thickness_mm, total_h,
            label_text, label_font_size_mm, label_depth_mm,
        )

    # --- Print support tabs ---
    if tabs != "none" and lip:
        bin_solid = _add_print_tabs(bin_solid, bin_w, bin_l, total_h, tabs)

    return bin_solid


def _build_per_cell_socket_base(grid_w: int, grid_l: int) -> Solid:
    """Build a proper Gridfinity base with per-cell chamfered sockets.

    Each 42x42mm cell has its own chamfered socket:
    - Bottom: ~38.5x38.5mm (fits into baseplate socket)
    - Top: ~41.5x41.5mm (matches bin footprint per unit)
    - Height: 4mm with chamfered transition
    - The gaps between sockets form the grid pattern

    Magnet holes go in the corners of each cell.
    """
    bin_w = grid_w * C.GRID_UNIT_MM - C.BIN_CLEARANCE_MM
    bin_l = grid_l * C.GRID_UNIT_MM - C.BIN_CLEARANCE_MM

    # Socket dimensions per cell
    socket_bottom = C.SOCKET_BOTTOM_SIZE_MM  # 38.5mm
    socket_top = C.SOCKET_TOP_SIZE_MM  # 41.5mm
    base_h = C.BASE_HEIGHT_MM  # 4mm

    base = None
    for gx in range(grid_w):
        for gy in range(grid_l):
            # Cell center in bin-local coords (centered at origin)
            cx = -bin_w / 2 + (gx + 0.5) * C.GRID_UNIT_MM
            cy = -bin_l / 2 + (gy + 0.5) * C.GRID_UNIT_MM

            # Build one chamfered cell socket using loft
            with BuildPart() as bp:
                with BuildSketch(Plane.XY) as s1:
                    Rectangle(socket_bottom, socket_bottom)
                with BuildSketch(Plane.XY.moved(Location((0, 0, base_h)))) as s2:
                    Rectangle(socket_top, socket_top)
                loft()
            cell = bp.part
            cell = cell.moved(Location((cx, cy, 0)))

            if base is None:
                base = cell
            else:
                base = base + cell

    return base


def _cell_corner_positions(grid_w: int, grid_l: int) -> list[tuple[float, float]]:
    """Return magnet/screw hole positions for each cell corner.

    Gridfinity bins have magnet holes in the corners of each unit cell,
    positioned at a specific offset from the cell center.
    """
    bin_w = grid_w * C.GRID_UNIT_MM - C.BIN_CLEARANCE_MM
    bin_l = grid_l * C.GRID_UNIT_MM - C.BIN_CLEARANCE_MM

    positions = []
    # Magnet holes are at each cell corner, offset from cell center
    # The offset is approximately 8mm from the bin edge
    hole_offset = C.GRID_UNIT_MM / 2 - C.MAGNET_INSET_MM  # ~13mm from cell center

    for gx in range(grid_w):
        for gy in range(grid_l):
            cx = -bin_w / 2 + (gx + 0.5) * C.GRID_UNIT_MM
            cy = -bin_l / 2 + (gy + 0.5) * C.GRID_UNIT_MM
            # 4 corners per cell
            for dx, dy in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
                positions.append((cx + dx * hole_offset, cy + dy * hole_offset))

    # Deduplicate (corners shared between cells)
    seen = set()
    unique = []
    for px, py in positions:
        key = (round(px, 1), round(py, 1))
        if key not in seen:
            seen.add(key)
            unique.append((px, py))
    return unique


def _add_magnet_holes(bin_solid, grid_w, grid_l) -> Part:
    """Subtract 6.5x2mm magnet holes from the base cell corners."""
    for cx, cy in _cell_corner_positions(grid_w, grid_l):
        hole = Cylinder(C.MAGNET_DIAMETER_MM / 2, C.MAGNET_DEPTH_MM)
        hole = hole.moved(Location((cx, cy, C.MAGNET_DEPTH_MM / 2)))
        bin_solid = bin_solid - hole
    return bin_solid


def _add_screw_holes(bin_solid, grid_w, grid_l) -> Part:
    """Subtract M3 screw through-holes from base cell corners."""
    for cx, cy in _cell_corner_positions(grid_w, grid_l):
        hole = Cylinder(C.SCREW_DIAMETER_MM / 2, C.SCREW_DEPTH_MM)
        hole = hole.moved(Location((cx, cy, C.SCREW_DEPTH_MM / 2)))
        bin_solid = bin_solid - hole
    return bin_solid


def _add_dividers(
    bin_solid, grid_w, grid_l, wall_thickness, base_thickness, total_h,
    compartments_x, compartments_y,
) -> Part:
    """Add internal divider walls to create compartments."""
    bin_w = grid_w * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    bin_l = grid_l * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    wall_h = total_h - C.BASE_HEIGHT_MM - base_thickness

    if compartments_x > 1:
        inner_w = bin_w - 2 * wall_thickness
        spacing = inner_w / compartments_x
        for i in range(1, compartments_x):
            x = -inner_w / 2 + i * spacing
            div = Box(wall_thickness, bin_l - 2 * wall_thickness, wall_h)
            div = div.moved(Location((x, 0, C.BASE_HEIGHT_MM + base_thickness + wall_h / 2)))
            bin_solid = bin_solid + Part(div)

    if compartments_y > 1:
        inner_l = bin_l - 2 * wall_thickness
        spacing = inner_l / compartments_y
        for i in range(1, compartments_y):
            y = -inner_l / 2 + i * spacing
            div = Box(bin_w - 2 * wall_thickness, wall_thickness, wall_h)
            div = div.moved(Location((0, y, C.BASE_HEIGHT_MM + base_thickness + wall_h / 2)))
            bin_solid = bin_solid + Part(div)

    return bin_solid


def _add_scoop(bin_solid, bin_w, bin_l, wall_thickness, total_h, scoop_depth) -> Part:
    """Add a scoop (finger cutout) on the front edge of the bin."""
    wall_h = total_h - C.BASE_HEIGHT_MM
    scoop_w = bin_w - 2 * wall_thickness
    scoop = Cylinder(scoop_depth, scoop_w + 0.1)
    scoop = scoop.rotate(axis=Axis.Y, angle=90)
    scoop = scoop.moved(Location((0, bin_l / 2 - wall_thickness - scoop_depth / 2, C.BASE_HEIGHT_MM)))
    bin_solid = bin_solid - scoop
    return bin_solid


def _add_print_tabs(bin_solid, bin_w, bin_l, total_h, tab_style) -> Part:
    """Add print support tabs below the stacking lip.

    These are small rectangular tabs that support the lip overhang during
    3D printing, reducing sag. 'split' puts tabs on all 4 sides with gaps.
    'aligned' puts continuous tabs on the front and back only.
    """
    tab_h = 1.2  # tab thickness
    tab_t = C.LIP_OVERHANG_MM + 0.2  # matches lip overhang
    lip_top = total_h + C.LIP_HEIGHT_MM
    tab_z = lip_top - tab_h / 2

    if tab_style == "aligned":
        # Continuous tabs on front and back only
        for y_pos in [bin_l / 2 + tab_t / 2, -bin_l / 2 - tab_t / 2]:
            tab = Box(bin_w, tab_t, tab_h)
            tab = tab.moved(Location((0, y_pos, tab_z)))
            bin_solid = bin_solid + Part(tab)
    else:  # split
        # Tabs on all 4 sides with gaps for removal
        tab_len = 10  # mm per tab
        gap = 5  # mm gap between tabs

        # Front and back
        for y_pos in [bin_l / 2 + tab_t / 2, -bin_l / 2 - tab_t / 2]:
            x = -bin_w / 2 + tab_len / 2
            while x < bin_w / 2:
                tab = Box(min(tab_len, bin_w / 2 - x + tab_len / 2), tab_t, tab_h)
                tab = tab.moved(Location((x, y_pos, tab_z)))
                bin_solid = bin_solid + Part(tab)
                x += tab_len + gap

        # Left and right
        for x_pos in [bin_w / 2 + tab_t / 2, -bin_w / 2 - tab_t / 2]:
            y = -bin_l / 2 + tab_len / 2
            while y < bin_l / 2:
                tab = Box(tab_t, min(tab_len, bin_l / 2 - y + tab_len / 2), tab_h)
                tab = tab.moved(Location((x_pos, y, tab_z)))
                bin_solid = bin_solid + Part(tab)
                y += tab_len + gap

    return bin_solid


def _add_label_tab(
    bin_solid, bin_w, bin_l, wall_thickness, total_h,
    label_text, font_size, label_depth,
) -> Part:
    """Add a label tab on the front wall of the bin with optional embossed text.

    The label tab is a flat area on the front of the bin where you can write
    or stick a label. If label_text is provided, it's embossed (raised) on the tab.
    """
    # Tab dimensions: spans the full width, sits at the top of the front wall
    tab_w = min(C.LABEL_TAB_WIDTH_MM, bin_w - 2 * wall_thickness)
    tab_h = C.LABEL_TAB_HEIGHT_MM
    tab_t = C.LABEL_TAB_THICKNESS_MM  # how far it sticks out

    # Position: centered on front wall, near the top
    tab_y = bin_l / 2 + tab_t / 2  # sticks out from the front
    tab_z = total_h - tab_h / 2 - 2  # near the top of the bin

    tab = Box(tab_w, tab_t, tab_h)
    tab = tab.moved(Location((0, tab_y, tab_z)))
    bin_solid = bin_solid + Part(tab)

    # Add embossed text if provided
    if label_text and label_depth > 0:
        try:
            # Create text sketch and extrude it
            with BuildSketch(Plane.XY) as text_sketch:
                Text(label_text, font_size=font_size, font_path=None, align=Align.CENTER)
            text_face = text_sketch.sketch
            text_solid = extrude(text_face, amount=label_depth)
            # Position text on the front face of the label tab
            # Rotate -90° around X so text faces outward (+Y = front of bin)
            # +90° would face it inward, making it read backwards from outside
            text_solid = text_solid.rotate(axis=Axis.X, angle=-90)
            text_solid = text_solid.moved(Location((0, bin_l / 2 + tab_t + label_depth / 2, tab_z)))
            bin_solid = bin_solid + Part(text_solid)
        except Exception:
            pass  # text rendering can fail if font not available — skip silently

    return bin_solid
