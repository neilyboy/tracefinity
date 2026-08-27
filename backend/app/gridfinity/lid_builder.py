"""Gridfinity bin lid generator.

Generates lids that snap onto Gridfinity bins. The lid has the same
footprint as the bin, with a recessed top that fits over the bin's
stacking lip, and the proper Gridfinity base profile on the bottom
so it can also stack on baseplates.
"""
from __future__ import annotations

from build123d import (
    Box, Part, Location, Plane, BuildSketch, Text, Align,
    extrude, fillet, chamfer, Axis,
)

from . import constants as C
from ..schemas import Design
from ..fonts import get_font_path


def generate_lid(design: Design) -> Part:
    """Generate a Gridfinity bin lid.

    The lid:
    - Has the Gridfinity base profile on the bottom (stacks on baseplates)
    - Has a recess on the top that fits over the bin's stacking lip
    - Optional text label embossed on top
    """
    p = design.params
    grid_w = p.grid_w
    grid_l = p.grid_l

    bin_w = grid_w * C.GRID_UNIT_MM - C.BIN_CLEARANCE_MM
    bin_l = grid_l * C.GRID_UNIT_MM - C.BIN_CLEARANCE_MM

    # Lid parameters
    lid_thickness = 1.6  # base lid thickness
    recess_depth = C.LIP_HEIGHT_MM + 0.4  # slightly deeper than lip for clearance
    recess_gap = 0.3  # gap between lid recess and bin lip

    # The recess fits over the bin's stacking lip
    # Lip outer = bin + 2 * LIP_OVERHANG, so recess inner = lip outer + gap
    lip_outer_w = bin_w + 2 * C.LIP_OVERHANG_MM
    lip_outer_l = bin_l + 2 * C.LIP_OVERHANG_MM
    recess_w = lip_outer_w + 2 * recess_gap
    recess_l = lip_outer_l + 2 * recess_gap

    total_h = C.BASE_HEIGHT_MM + lid_thickness + recess_depth

    # --- Build the lid body ---
    # Start with a solid block
    body = Box(bin_w, bin_l, total_h)
    body = body.moved(Location((0, 0, total_h / 2)))

    # --- Cut the recess on top (fits over bin lip) ---
    recess = Box(recess_w, recess_l, recess_depth + 0.1)
    recess = recess.moved(Location((0, 0, total_h - recess_depth / 2)))
    body = body - Part(recess)

    # --- Add the Gridfinity base profile on the bottom ---
    # Simple version: chamfered bottom that fits into baseplates
    # Bottom 4mm has the socket profile
    base_w = grid_w * C.GRID_UNIT_MM - C.BIN_CLEARANCE_MM
    base_l = grid_l * C.GRID_UNIT_MM - C.BIN_CLEARANCE_MM
    socket_w = grid_w * C.SOCKET_BOTTOM_SIZE_MM + (grid_w - 1) * (C.GRID_UNIT_MM - C.SOCKET_BOTTOM_SIZE_MM)
    socket_l = grid_l * C.SOCKET_BOTTOM_SIZE_MM + (grid_l - 1) * (C.GRID_UNIT_MM - C.SOCKET_BOTTOM_SIZE_MM)

    # Cut the socket inset from the bottom
    socket_cut = Box(socket_w, socket_l, C.BASE_BOTTOM_THICKNESS + 0.1)
    socket_cut = socket_cut.moved(Location((0, 0, C.BASE_BOTTOM_THICKNESS / 2)))
    body = body - Part(socket_cut)

    # Chamfer the bottom edge for easy insertion
    try:
        bb = body.bounding_box()
        bottom_z = bb.min.Z
        bottom_edges = [e for e in body.edges() if abs(e.center().Z - bottom_z) < 0.01]
        if bottom_edges:
            body = body.chamfer(C.BASE_BOTTOM_CHAMFER, None, bottom_edges)
    except Exception:
        pass  # chamfer can fail, skip if so

    # Round the top edges of the recess for easier fit
    try:
        bb = body.bounding_box()
        top_z = bb.max.Z
        top_edges = [e for e in body.edges() if abs(e.center().Z - top_z) < 0.01]
        if top_edges:
            body = body.fillet(0.5, top_edges)
    except Exception:
        pass

    # --- Add optional text label on top ---
    flat_labels = [l for l in design.labels if l.target == "flat" and l.text.strip()]
    if flat_labels:
        body = _apply_lid_labels(body, flat_labels, p, total_h)

    # --- Add magnet holes if enabled ---
    if p.magnet_holes:
        from build123d import Cylinder
        positions = _get_magnet_positions(grid_w, grid_l, bin_w, bin_l)
        for (mx, my) in positions:
            magnet = Cylinder(C.MAGNET_DIAMETER_MM / 2, C.MAGNET_DEPTH_MM)
            magnet = magnet.moved(Location((mx, my, C.BASE_HEIGHT_MM - C.MAGNET_DEPTH_MM / 2)))
            body = body - Part(magnet)

    return body


def _get_magnet_positions(grid_w: int, grid_l: int, bin_w: float, bin_l: float):
    """Get magnet hole positions for each cell corner."""
    positions = []
    for cx in range(grid_w):
        for cy in range(grid_l):
            # Cell center
            cell_x = -bin_w / 2 + (cx + 0.5) * C.GRID_UNIT_MM
            cell_y = -bin_l / 2 + (cy + 0.5) * C.GRID_UNIT_MM
            # Magnet positions at corners offset from center
            for dx in [-1, 1]:
                for dy in [-1, 1]:
                    mx = cell_x + dx * (C.GRID_UNIT_MM / 2 - C.MAGNET_INSET_MM)
                    my = cell_y + dy * (C.GRID_UNIT_MM / 2 - C.MAGNET_INSET_MM)
                    # Only add if within bin bounds
                    if abs(mx) < bin_w / 2 - 1 and abs(my) < bin_l / 2 - 1:
                        positions.append((mx, my))
    return positions


def _apply_lid_labels(body, labels, params, total_h):
    """Apply text labels to the lid top surface."""
    grid_w_mm = params.grid_w * C.GRID_UNIT_MM
    grid_l_mm = params.grid_l * C.GRID_UNIT_MM

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

            # Convert label coords (SVG: Y-down) to build123d coords (Y-up)
            x_local = label.x - grid_w_mm / 2
            y_local = grid_l_mm / 2 - label.y

            # Negate rotation: SVG uses CW (Y-down), build123d uses CCW (Y-up)
            rot = -label.rotation_deg if abs(label.rotation_deg) > 0.01 else 0

            if label.cutout:
                # Cut into the lid surface
                text_solid = extrude(text_face, amount=label.depth_mm + 0.5)
                if rot != 0:
                    text_solid = text_solid.rotate(axis=Axis.Z, angle=rot)
                text_solid = text_solid.moved(Location((x_local, y_local, total_h - label.depth_mm)))
                body = body - Part(text_solid)
            else:
                # Raised on top surface
                text_solid = extrude(text_face, amount=label.depth_mm)
                if rot != 0:
                    text_solid = text_solid.rotate(axis=Axis.Z, angle=rot)
                text_solid = text_solid.moved(Location((x_local, y_local, total_h)))
                body = body + Part(text_solid)
        except Exception:
            pass  # text rendering can fail, skip silently

    return body
