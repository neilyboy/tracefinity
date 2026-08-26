"""Assemble a complete gridfinity model: bin + tool pockets + labels."""
from __future__ import annotations

import numpy as np
from build123d import Axis, Box, BuildSketch, Location, Part, Plane, Polygon, Sketch, Solid, Text, Mode, Align, extrude

from ..fonts import get_font_path
from ..schemas import Design
from ..utils.geometry import catmull_rom_smooth, offset_polygon, to_np
from .bin_builder import build_bin
from .pockets import subtract_pockets, _rotate_points, _simplify_polygon
from . import constants as C


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
        compartments_x=p.compartments_x,
        compartments_y=p.compartments_y,
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
