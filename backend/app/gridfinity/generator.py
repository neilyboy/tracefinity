"""Assemble a complete gridfinity model: bin + tool pockets + labels."""
from __future__ import annotations

import numpy as np
from build123d import Axis, Box, BuildSketch, Location, Part, Plane, Polygon, Sketch, Solid, Text, Mode, Align, extrude, Compound

from ..fonts import get_font_path
from ..schemas import Design
from ..utils.geometry import catmull_rom_smooth, offset_polygon, to_np
from .bin_builder import build_bin
from .pockets import subtract_pockets, _rotate_points, _simplify_polygon
from . import constants as C
from .baseplate_builder import _build_dovetail_tab, _build_dovetail_slot, DOVETAIL_EXTRA_MM


def generate_gridfinity(design: Design) -> Solid:
    """Generate the full 3D gridfinity model for a design."""
    p = design.params
    bin_solid = build_bin(
        grid_w=p.grid_w,
        grid_l=p.grid_l,
        height_units=p.height_units,
        wall_thickness_mm=p.wall_thickness_mm,
        base_thickness_mm=p.base_thickness_mm,
        magnet_holes=p.magnet_holes,
        screw_holes=p.screw_holes,
        scoop=p.scoop,
        scoop_depth_mm=p.scoop_depth_mm,
        tabs=p.tabs,
        lip=p.lip,
        label_tab=p.label_tab,
        label_text=p.label_text,
        label_font_size_mm=p.label_font_size_mm,
        label_depth_mm=p.label_depth_mm,
        label_engrave=p.label_engrave,
        label_tab_inset=p.label_tab_inset,
        compartments_x=p.compartments_x,
        compartments_y=p.compartments_y,
        divider_thickness_mm=p.divider_thickness_mm,
        divider_taper_deg=p.divider_taper_deg,
        divider_chamfer_mm=p.divider_chamfer_mm,
        divider_corner_radius_mm=p.divider_corner_radius_mm,
        pocket_depth_mm=p.pocket_depth_mm,
        use_flat_insert=getattr(p, 'use_flat_insert', False),
        flat_thickness_mm=p.flat_thickness_mm,
    )
    bin_solid = subtract_pockets(bin_solid, design.outlines, p)

    # Add/subtract text labels on the top surface (tray-targeted only)
    tray_labels = [l for l in design.labels if l.target == "tray" and l.text.strip()]
    if tray_labels:
        bin_solid = _apply_labels(bin_solid, tray_labels, p)

    return bin_solid


def _apply_labels(bin_solid, labels, params) -> Part:
    """Apply text labels to the bin's top surface.

    Labels can be cutout (engraved into the surface) or raised (embossed above).
    They sit on the top surface of the bin, accounting for the stacking lip.
    """
    total_h = params.height_units * C.HEIGHT_UNIT_MM
    # Top surface Z (accounting for lip)
    top_z = total_h + (C.LIP_HEIGHT_MM if params.lip else 0)

    for label in labels:
        if not label.text.strip():
            continue
        try:
            # Resolve font path (None for system fonts like Arial)
            font_path = get_font_path(label.font)
            # Create text sketch on XY plane
            with BuildSketch(Plane.XY) as text_sketch:
                Text(
                    label.text,
                    font_size=label.font_size_mm,
                    align=Align.CENTER,
                    font_path=font_path,
                )
            text_face = text_sketch.sketch

            # Extrude to create the text solid
            text_solid = extrude(text_face, amount=label.depth_mm)

            # Rotate around Z axis — negate angle: SVG CW (Y-down) → build123d CCW (Y-up)
            if abs(label.rotation_deg) > 0.01:
                text_solid = text_solid.rotate(axis=Axis.Z, angle=-label.rotation_deg)

            # Position: text sits on top surface
            # Convert label coords (SVG: top-left origin, Y-down) to build123d coords
            # (centered at origin, Y-up). Flip Y so export matches editor view.
            x_local = label.x - params.grid_w * C.GRID_UNIT_MM / 2
            y_local = params.grid_l * C.GRID_UNIT_MM / 2 - label.y

            if label.cutout:
                # Engrave into the surface: subtract text from bin
                # Text solid spans Z=[0, depth], place it so top is at top_z
                text_solid = text_solid.moved(Location((x_local, y_local, top_z - label.depth_mm)))
                bin_solid = bin_solid - text_solid
            else:
                # Raised above surface: add text on top of bin
                # Text solid spans Z=[0, depth], place it so bottom is at top_z
                text_solid = text_solid.moved(Location((x_local, y_local, top_z)))
                bin_solid = bin_solid + text_solid

        except Exception:
            # Text rendering can fail if font not available — skip silently
            continue

    return bin_solid


def generate_flat_outlines(design: Design) -> Solid:
    """Generate a flat plate with tool cutouts for two-tone insert printing.

    When use_flat_insert is True:
    - The plate is sized to fit inside the tray's lip walls (not the full bin footprint)
    - Finger scoops are cut through the plate at each tool's far end
    - The plate sits inside the lip recess of the tray

    When use_flat_insert is False:
    - The plate is the full bin footprint (test-fit mode)

    Labels with target='flat' are applied to this plate:
    - cutout=True: text is cut completely through the plate (like a stencil).
      Use a stencil-friendly font — letters with enclosed counters (A, B, O, etc.)
      will lose their inner pieces. This is by design for see-through labeling.
    - cutout=False: text is raised on top of the plate surface.
    """
    from build123d import Cylinder, Sphere
    from ..schemas import FingerHole

    p = design.params
    bin_w = p.grid_w * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    bin_l = p.grid_l * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM

    # Flat plate thickness — configurable
    plate_thickness = p.flat_thickness_mm

    # When use_flat_insert is enabled, size the plate to fit inside the lip walls.
    # The lip inner opening is bin_w - 2*wall_thickness_mm.
    # Add a small clearance (0.2mm) for a snug but removable fit.
    if p.use_flat_insert:
        clearance = 0.2
        plate_w = bin_w - 2 * p.wall_thickness_mm - 2 * clearance
        plate_l = bin_l - 2 * p.wall_thickness_mm - 2 * clearance
    else:
        plate_w = bin_w
        plate_l = bin_l

    # Build the flat plate
    plate = Part(Box(plate_w, plate_l, plate_thickness))
    plate = plate.moved(Location((0, 0, plate_thickness / 2)))

    grid_w_mm = p.grid_w * C.GRID_UNIT_MM
    grid_l_mm = p.grid_l * C.GRID_UNIT_MM

    # Collect ALL cutters (tool outlines + finger holes) and subtract them
    # in a single boolean operation. Subtracting cylinders one by one from
    # a plate with complex tool cutouts causes OCP numerical precision issues.
    cutters = []

    # --- Tool outline cutters ---
    for outline in design.outlines:
        if not outline.visible:
            continue
        outer = to_np(outline.outer)
        if len(outer) < 3:
            continue

        margin = outline.margin_mm if outline.margin_mm is not None else p.tool_margin_mm

        # Apply rotation (negated inside _rotate_points: SVG CW → build123d CCW)
        cx = float(np.mean(outer[:, 0]))
        cy = float(np.mean(outer[:, 1]))
        if abs(outline.rotation_deg) > 0.01:
            outer = _rotate_points(outer, outline.rotation_deg, cx, cy)

        # Offset the RAW polygon first (fewer points = no self-intersections),
        # then smooth the offset result. Smoothing 600+ points then offsetting
        # causes self-intersections at sharp curves, producing invalid solids.
        offset_outer = offset_polygon(outer, -margin)

        # Smooth the offset polygon to match SVG editor's smooth curves
        smoothed = catmull_rom_smooth(offset_outer, samples_per_segment=12, tension=outline.smoothing)

        # Simplify to reduce point count for OCP boolean stability
        smoothed = _simplify_polygon(smoothed, epsilon=0.2)

        # Build the cutout solid.
        # Y-flip: SVG Y-down → build123d Y-up (PrusaSlicer shows Y+ at top).
        # Y-flip reverses winding (CW→CCW), so reverse points to restore CCW.
        pts = [(float(pt[0]), grid_l_mm - float(pt[1])) for pt in smoothed][::-1]
        try:
            face = Polygon(pts)
            sketch = Sketch() + face

            # Subtract holes from the cutter (holes = areas where material stays)
            if outline.holes:
                for hole_pts_raw in outline.holes:
                    hole_np = to_np(hole_pts_raw)
                    if len(hole_np) < 3:
                        continue
                    if abs(outline.rotation_deg) > 0.01:
                        hcx = float(np.mean(hole_np[:, 0]))
                        hcy = float(np.mean(hole_np[:, 1]))
                        hole_np = _rotate_points(hole_np, outline.rotation_deg, hcx, hcy)
                    offset_hole = offset_polygon(hole_np, -margin)
                    smoothed_hole = catmull_rom_smooth(offset_hole, samples_per_segment=12, tension=outline.smoothing)
                    smoothed_hole = _simplify_polygon(smoothed_hole, epsilon=0.2)
                    hole_pts = [(float(p[0]), grid_l_mm - float(p[1])) for p in smoothed_hole]
                    try:
                        hole_face = Polygon(hole_pts)
                        sketch = sketch - hole_face
                    except Exception:
                        pass

            cutter = extrude(sketch, amount=plate_thickness * 3)
            # Position in bin-local coords using grid dimensions (42mm units)
            cutter = cutter.moved(Location((-grid_w_mm / 2, -grid_l_mm / 2, -plate_thickness)))
            cutters.append(cutter)
        except Exception:
            continue

    # --- User-placed finger holes ---
    for outline in design.outlines:
        if not outline.visible:
            continue
        for hole in getattr(outline, 'finger_holes', []):
            fh_x_local = hole.x - grid_w_mm / 2
            fh_y_local = grid_l_mm / 2 - hole.y
            fh_cyl = Cylinder(hole.radius_mm, plate_thickness * 3)
            fh_cyl = fh_cyl.moved(Location((fh_x_local, fh_y_local, 0)))
            cutters.append(fh_cyl)

    if cutters:
        # Union all cutters
        combined = cutters[0]
        for c in cutters[1:]:
            try:
                combined = combined + c
            except Exception:
                pass

        # Intersect with plate bounds to keep cutouts inside
        interior = Box(plate_w, plate_l, plate_thickness * 3)
        interior = interior.moved(Location((0, 0, plate_thickness)))
        try:
            combined = combined & interior
        except Exception:
            pass

        plate = plate - combined

    # Apply flat-targeted labels
    flat_labels = [l for l in design.labels if l.target == "flat" and l.text.strip()]
    if flat_labels:
        plate = _apply_flat_labels(plate, flat_labels, p, plate_thickness)

    return plate


def _apply_flat_labels(plate, labels, params, plate_thickness) -> Part:
    """Apply text labels to the flat plate.

    cutout=True: text is cut completely through the plate (stencil style).
    cutout=False: text is raised on top of the plate surface.
    """
    for label in labels:
        try:
            font_path = get_font_path(label.font)
            with BuildSketch(Plane.XY) as text_sketch:
                Text(
                    label.text,
                    font_size=label.font_size_mm,
                    align=Align.CENTER,
                    font_path=font_path,
                )
            text_face = text_sketch.sketch

            # Convert label coords (SVG: Y-down) to build123d coords (Y-up).
            # Y-flip + negated rotation: this was verified correct for text.
            # (Tool cutout uses the same Y-flip but for polygon winding.)
            x_local = label.x - params.grid_w * C.GRID_UNIT_MM / 2
            y_local = params.grid_l * C.GRID_UNIT_MM / 2 - label.y

            # Negate rotation: SVG uses CW (Y-down), build123d uses CCW (Y-up)
            rot = -label.rotation_deg if abs(label.rotation_deg) > 0.01 else 0

            if label.cutout:
                # Cut through the entire plate
                text_solid = extrude(text_face, amount=plate_thickness * 3)
                if rot != 0:
                    text_solid = text_solid.rotate(axis=Axis.Z, angle=rot)
                text_solid = text_solid.moved(Location((x_local, y_local, -plate_thickness)))
                plate = plate - text_solid
            else:
                # Raised on top surface
                text_solid = extrude(text_face, amount=label.depth_mm)
                if rot != 0:
                    text_solid = text_solid.rotate(axis=Axis.Z, angle=rot)
                text_solid = text_solid.moved(Location((x_local, y_local, plate_thickness)))
                plate = plate + text_solid

        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Flat label '{label.text}' failed: {e}")
            continue

    return plate


# ---------------------------------------------------------------------------
# Tray segmentation for large prints
# ---------------------------------------------------------------------------

def _auto_segment_tray(grid_w: int, grid_l: int, bed_w: float, bed_l: float) -> tuple[list[int], list[int]]:
    """Auto-compute cut lines so each segment fits on the print bed."""
    margin = 15  # mm safety margin (trays need more than baseplates due to walls)
    max_cells_x = max(1, int((bed_w - margin) // C.GRID_UNIT_MM))
    max_cells_y = max(1, int((bed_l - margin) // C.GRID_UNIT_MM))
    cuts_x = list(range(max_cells_x, grid_w, max_cells_x))
    cuts_y = list(range(max_cells_y, grid_l, max_cells_y))
    return cuts_x, cuts_y


def _tray_needs_segmentation(design: Design) -> bool:
    """Check if the tray needs to be segmented based on print bed size."""
    p = design.params
    tray_w = p.grid_w * C.GRID_UNIT_MM
    tray_l = p.grid_l * C.GRID_UNIT_MM
    if p.force_segment:
        return True
    return tray_w > p.print_bed_w_mm or tray_l > p.print_bed_l_mm


def _build_tray_segment_shape(
    seg_x_start: int, seg_x_end: int, seg_y_start: int, seg_y_end: int,
    grid_w: int, grid_l: int,
    cuts_x: list[int], cuts_y: list[int],
    total_h: float,
    use_clips: bool,
    clip_w: float = 8.0,
    clip_d: float = 4.0,
    clip_tol: float = 0.2,
) -> Solid:
    """Build the intersection shape for one tray segment.

    The shape covers the full height of the tray. At cut lines, the shape
    uses exact bounds (no margin) to avoid double walls. At outer edges,
    a margin ensures clean intersection. Dovetail tabs/slots are added
    at the base of the tray (bottom 4mm) for locking.
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

    # Determine which edges are cut lines
    x_cuts_set = set(cuts_x)
    y_cuts_set = set(cuts_y)
    left_is_cut = seg_x_start in x_cuts_set
    right_is_cut = seg_x_end in x_cuts_set
    below_is_cut = seg_y_start in y_cuts_set
    above_is_cut = seg_y_end in y_cuts_set

    # Margins: 0.01mm at cut lines (clean cut), 2mm at outer edges
    margin_left = 0.01 if left_is_cut else 2.0
    margin_right = 0.01 if right_is_cut else 2.0
    margin_below = 0.01 if below_is_cut else 2.0
    margin_above = 0.01 if above_is_cut else 2.0

    shape = Box(
        seg_w + margin_left + margin_right,
        seg_l + margin_below + margin_above,
        total_h + 4,
    )
    shape = shape.moved(Location((
        seg_cx + (margin_right - margin_left) / 2,
        seg_cy + (margin_above - margin_below) / 2,
        total_h / 2,
    )))

    if not use_clips:
        return shape

    # Add dovetail tabs/slots at the base (bottom 4mm of the tray)
    tab_h = min(4.0, total_h * 0.3)  # tabs in the bottom portion

    # --- Vertical cut lines (X cuts) ---
    for cx in cuts_x:
        cut_x_mm = -plate_w / 2 + cx * C.GRID_UNIT_MM
        is_left = seg_x_end == cx
        is_right = seg_x_start == cx
        if not (is_left or is_right):
            continue

        seg_y_center = (seg_y_min + seg_y_max) / 2
        seg_y_len = seg_y_max - seg_y_min
        n_tabs = max(1, min(3, int(seg_y_len / (clip_w * 6))))
        if n_tabs == 1:
            tab_ys = [seg_y_center]
        else:
            spacing = seg_y_len / (n_tabs + 1)
            tab_ys = [seg_y_min + spacing * (i + 1) for i in range(n_tabs)]

        for ty in tab_ys:
            if is_left:
                tab = _build_dovetail_tab(clip_d, clip_w, tab_h, "+x")
                tab = tab.moved(Location((cut_x_mm, ty, 0)))
                try:
                    shape = shape + tab
                except Exception:
                    pass
            elif is_right:
                slot = _build_dovetail_slot(clip_d, clip_w, tab_h, clip_tol, "-x")
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
        n_tabs = max(1, min(3, int(seg_x_len / (clip_w * 6))))
        if n_tabs == 1:
            tab_xs = [seg_x_center]
        else:
            spacing = seg_x_len / (n_tabs + 1)
            tab_xs = [seg_x_min + spacing * (i + 1) for i in range(n_tabs)]

        for tx in tab_xs:
            if is_below:
                tab = _build_dovetail_tab(clip_d, clip_w, tab_h, "+y")
                tab = tab.moved(Location((tx, cut_y_mm, 0)))
                try:
                    shape = shape + tab
                except Exception:
                    pass
            elif is_above:
                slot = _build_dovetail_slot(clip_d, clip_w, tab_h, clip_tol, "-y")
                slot = slot.moved(Location((tx, cut_y_mm, 0)))
                try:
                    shape = shape - slot
                except Exception:
                    pass

    return shape


def _segment_bounds(grid_w: int, grid_l: int, cuts_x: list[int], cuts_y: list[int]) -> list[tuple[int, int, int, int]]:
    """Compute (col_start, col_end, row_start, row_end) for each segment."""
    x_boundaries = [0] + sorted(cuts_x) + [grid_w]
    y_boundaries = [0] + sorted(cuts_y) + [grid_l]
    segments = []
    for i in range(len(x_boundaries) - 1):
        for j in range(len(y_boundaries) - 1):
            segments.append((x_boundaries[i], x_boundaries[i + 1], y_boundaries[j], y_boundaries[j + 1]))
    return segments


def generate_gridfinity_segmented(design: Design) -> list[Part]:
    """Generate the full tray, then split it into printable segments.

    Returns a list of Part objects (one per segment). If no segmentation
    is needed, returns a single-element list with the full tray.
    """
    p = design.params

    # Check if segmentation is needed
    if not _tray_needs_segmentation(design):
        return [generate_gridfinity(design)]

    # Generate the full tray first
    full_tray = generate_gridfinity(design)

    # Compute cut lines
    cuts_x = p.cut_lines_x if p.cut_lines_x else []
    cuts_y = p.cut_lines_y if p.cut_lines_y else []
    if not cuts_x and not cuts_y:
        cuts_x, cuts_y = _auto_segment_tray(p.grid_w, p.grid_l, p.print_bed_w_mm, p.print_bed_l_mm)

    if not cuts_x and not cuts_y:
        return [full_tray]

    # Total height of the tray (for segment shape)
    total_h = p.height_units * C.HEIGHT_UNIT_MM
    if p.lip:
        total_h += C.LIP_HEIGHT_MM

    use_clips = p.tray_connector_type == "edge_clips"

    # Split the tray into segments
    segments = _segment_bounds(p.grid_w, p.grid_l, cuts_x, cuts_y)
    segment_parts = []
    for (sx_start, sx_end, sy_start, sy_end) in segments:
        seg_shape = _build_tray_segment_shape(
            sx_start, sx_end, sy_start, sy_end,
            p.grid_w, p.grid_l, cuts_x, cuts_y,
            total_h, use_clips,
        )

        try:
            intersect_result = full_tray.intersect(seg_shape)
            if not intersect_result:
                continue
            # intersect may return multiple disconnected solids — fuse them all
            if hasattr(intersect_result, '__iter__') and not isinstance(intersect_result, (Part, Solid)):
                solids = list(intersect_result)
            else:
                solids = [intersect_result]
            if not solids:
                continue
            # Fuse all pieces into one
            seg_part = solids[0]
            for s in solids[1:]:
                try:
                    seg_part = seg_part + s
                except Exception:
                    pass
        except Exception:
            continue

        # Ensure it's a Part
        if not isinstance(seg_part, Part):
            try:
                seg_part = Part(seg_part)
            except Exception:
                pass

        segment_parts.append(seg_part)

    return segment_parts if segment_parts else [full_tray]


def get_tray_segment_info(design: Design) -> dict:
    """Get info about tray segments for the frontend.

    Returns a dict with grid dimensions, segment count, and per-segment info.
    """
    p = design.params
    tray_w = p.grid_w * C.GRID_UNIT_MM
    tray_l = p.grid_l * C.GRID_UNIT_MM

    cuts_x = p.cut_lines_x if p.cut_lines_x else []
    cuts_y = p.cut_lines_y if p.cut_lines_y else []
    if not cuts_x and not cuts_y and _tray_needs_segmentation(design):
        cuts_x, cuts_y = _auto_segment_tray(p.grid_w, p.grid_l, p.print_bed_w_mm, p.print_bed_l_mm)

    needs_segment = bool(cuts_x or cuts_y)

    segments_list = []
    if not needs_segment:
        segments_list.append({
            "index": 1, "cells_w": p.grid_w, "cells_h": p.grid_l,
            "w": tray_w, "h": tray_l, "x": 0, "y": 0,
        })
    else:
        seg_bounds = _segment_bounds(p.grid_w, p.grid_l, cuts_x, cuts_y)
        for i, (sx_start, sx_end, sy_start, sy_end) in enumerate(seg_bounds):
            w = (sx_end - sx_start) * C.GRID_UNIT_MM
            h = (sy_end - sy_start) * C.GRID_UNIT_MM
            x = -tray_w / 2 + sx_start * C.GRID_UNIT_MM + w / 2
            y = -tray_l / 2 + sy_start * C.GRID_UNIT_MM + h / 2
            segments_list.append({
                "index": i + 1,
                "cells_w": sx_end - sx_start,
                "cells_h": sy_end - sy_start,
                "w": w, "h": h, "x": x, "y": y,
            })

    return {
        "grid_w": p.grid_w,
        "grid_l": p.grid_l,
        "tray_w": tray_w,
        "tray_l": tray_l,
        "segment_count": len(segments_list),
        "segments": segments_list,
        "cuts_x": cuts_x,
        "cuts_y": cuts_y,
        "needs_segment": needs_segment,
    }
