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

            # Rotate around Z axis (text rotation in the XY plane)
            if abs(label.rotation_deg) > 0.01:
                text_solid = text_solid.rotate(axis=Axis.Z, angle=label.rotation_deg)

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
    """Generate a flat plate with tool cutouts for test-fitting and two-tone printing.

    This creates a thin flat plate with the tool outlines cut through it. You can
    print this to test-fit tools before committing to the full bin, or print it in
    a different color to lay inside the bin as a two-tone insert layer.

    Labels with target='flat' are applied to this plate:
    - cutout=True: text is cut completely through the plate (like a stencil).
      Use a stencil-friendly font — letters with enclosed counters (A, B, O, etc.)
      will lose their inner pieces. This is by design for see-through labeling.
    - cutout=False: text is raised on top of the plate surface.
    """
    p = design.params
    bin_w = p.grid_w * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    bin_l = p.grid_l * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM

    # Flat plate thickness — configurable
    plate_thickness = p.flat_thickness_mm

    # Build the flat plate
    plate = Part(Box(bin_w, bin_l, plate_thickness))
    plate = plate.moved(Location((0, 0, plate_thickness / 2)))

    # Cut tool outlines through the plate
    cutters = []
    for outline in design.outlines:
        if not outline.visible:
            continue
        outer = to_np(outline.outer)
        if len(outer) < 3:
            continue

        margin = outline.margin_mm if outline.margin_mm is not None else p.tool_margin_mm

        # Apply rotation
        cx = float(np.mean(outer[:, 0]))
        cy = float(np.mean(outer[:, 1]))
        if abs(outline.rotation_deg) > 0.01:
            outer = _rotate_points(outer, outline.rotation_deg, cx, cy)

        # Offset by margin
        offset_outer = offset_polygon(outer, margin)
        offset_outer = _simplify_polygon(offset_outer, epsilon=0.3)

        # Apply Catmull-Rom smoothing to match the SVG editor's smooth curves
        smoothed = catmull_rom_smooth(offset_outer, samples_per_segment=10, tension=0.3)

        # Build the cutout solid.
        # Mirror both X and Y (180° rotation) so the flat export matches the SVG
        # editor when viewed from the bottom in a slicer (the natural viewing
        # direction for a flat plate). 180° rotation preserves CCW winding.
        grid_w_mm = p.grid_w * C.GRID_UNIT_MM
        grid_l_mm = p.grid_l * C.GRID_UNIT_MM
        pts = [(grid_w_mm - float(pt[0]), grid_l_mm - float(pt[1])) for pt in smoothed]
        try:
            face = Polygon(pts)
            sketch = Sketch() + face
            cutter = extrude(sketch, amount=plate_thickness * 3)
            # Position in bin-local coords using grid dimensions (42mm units)
            cutter = cutter.moved(Location((-grid_w_mm / 2, -grid_l_mm / 2, -plate_thickness)))
            cutters.append(cutter)
        except Exception:
            continue

    if cutters:
        # Union all cutters
        combined = cutters[0]
        for c in cutters[1:]:
            try:
                combined = combined + c
            except Exception:
                pass

        # Intersect with plate bounds to keep cutouts inside
        interior = Box(bin_w, bin_l, plate_thickness * 3)
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

            # Convert label coords to build123d coords.
            # Mirror both X and Y (180° rotation) to match the tool cutout
            # orientation — flat export is viewed from the bottom in slicers.
            x_local = params.grid_w * C.GRID_UNIT_MM / 2 - label.x
            y_local = params.grid_l * C.GRID_UNIT_MM / 2 - label.y

            if label.cutout:
                # Cut through the entire plate
                text_solid = extrude(text_face, amount=plate_thickness * 3)
                if abs(label.rotation_deg) > 0.01:
                    text_solid = text_solid.rotate(axis=Axis.Z, angle=label.rotation_deg)
                text_solid = text_solid.moved(Location((x_local, y_local, -plate_thickness)))
                plate = plate - text_solid
            else:
                # Raised on top surface
                text_solid = extrude(text_face, amount=label.depth_mm)
                if abs(label.rotation_deg) > 0.01:
                    text_solid = text_solid.rotate(axis=Axis.Z, angle=label.rotation_deg)
                text_solid = text_solid.moved(Location((x_local, y_local, plate_thickness)))
                plate = plate + text_solid

        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Flat label '{label.text}' failed: {e}")
            continue

    return plate
