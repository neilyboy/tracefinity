"""Assemble a complete gridfinity model: bin + tool pockets + labels."""
from __future__ import annotations

import numpy as np
from build123d import Axis, Box, Location, Part, Plane, Polygon, Sketch, Solid, Text, Mode, extrude

from ..schemas import Design
from ..utils.geometry import offset_polygon, to_np
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

    # Add/subtract text labels on the top surface
    if design.labels:
        bin_solid = _apply_labels(bin_solid, design.labels, p)

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
            # Create text sketch on XY plane
            with BuildSketch(Plane.XY) as text_sketch:
                Text(label.text, font_size=label.font_size_mm, align=(0, 0))
            text_face = text_sketch.sketch

            # Extrude to create the text solid
            text_solid = extrude(text_face, amount=label.depth_mm)

            # Rotate around Z axis (text rotation in the XY plane)
            if abs(label.rotation_deg) > 0.01:
                text_solid = text_solid.rotate(axis=Axis.Z, angle=label.rotation_deg)

            # Position: text sits on top surface
            # Convert label coords (bin-local, top-left origin) to build123d coords (centered at origin)
            x_local = label.x - params.grid_w * C.GRID_UNIT_MM / 2
            y_local = label.y - params.grid_l * C.GRID_UNIT_MM / 2

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

    This creates a thin flat plate (typically 2-3mm thick) with the tool outlines
    cut through it. You can print this to test-fit tools before committing to the
    full bin, or print it in a different color to lay inside the bin as a two-tone
    insert layer.
    """
    p = design.params
    bin_w = p.grid_w * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    bin_l = p.grid_l * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM

    # Flat plate thickness — use a thin layer (default 2mm)
    plate_thickness = 2.0

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

        # Build the cutout solid
        pts = [(float(pt[0]), float(pt[1])) for pt in offset_outer][::-1]
        try:
            face = Polygon(pts)
            sketch = Sketch() + face
            cutter = extrude(sketch, amount=plate_thickness * 3)
            # Position in bin-local coords
            cutter = cutter.moved(Location((-bin_w / 2, -bin_l / 2, -plate_thickness)))
            cutters.append(cutter)
        except Exception:
            continue

    if not cutters:
        return plate

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

    result = plate - combined
    return result
