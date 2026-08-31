"""Gridfinity bin lid generator.

Generates lids that snap onto Gridfinity bins. The lid sits on top of
the bin with a recess on the bottom that fits over the bin's stacking
lip. The top is flat (optionally with an embossed text label). The
bottom has no Gridfinity base pattern or magnet holes — a lid covers
a bin, it doesn't stack on a baseplate.
"""
from __future__ import annotations

from build123d import (
    Box, Part, Location, Plane, BuildSketch, Text, Align,
    extrude, fillet, Axis,
)

from . import constants as C
from ..schemas import Design
from ..fonts import get_font_path


def generate_lid(design: Design) -> Part:
    """Generate a Gridfinity bin lid.

    The lid:
    - Has a recess on the bottom that fits over the bin's stacking lip
    - Has a flat top (optionally with embossed text label)
    - No Gridfinity base pattern or magnet holes on the bottom
    """
    p = design.params
    grid_w = p.grid_w
    grid_l = p.grid_l

    bin_w = grid_w * C.GRID_UNIT_MM - C.BIN_CLEARANCE_MM
    bin_l = grid_l * C.GRID_UNIT_MM - C.BIN_CLEARANCE_MM

    # Lid parameters
    lid_thickness = 1.6  # solid top thickness above the recess
    recess_depth = C.LIP_HEIGHT_MM + 0.4  # slightly deeper than lip for clearance
    recess_gap = 0.3  # gap between lid recess and bin lip
    wall_thickness = 1.2  # wall around the recess

    # The recess fits over the bin's stacking lip
    # Lip outer = bin + 2 * LIP_OVERHANG, so recess inner = lip outer + gap
    lip_outer_w = bin_w + 2 * C.LIP_OVERHANG_MM
    lip_outer_l = bin_l + 2 * C.LIP_OVERHANG_MM
    recess_w = lip_outer_w + 2 * recess_gap
    recess_l = lip_outer_l + 2 * recess_gap

    # Lid outer dimensions must be larger than the recess to leave walls
    lid_w = recess_w + 2 * wall_thickness
    lid_l = recess_l + 2 * wall_thickness

    total_h = lid_thickness + recess_depth

    # --- Build the lid body ---
    # Solid block, bottom at Z=0, top at Z=total_h
    body = Box(lid_w, lid_l, total_h)
    body = body.moved(Location((0, 0, total_h / 2)))

    # --- Cut the recess on the bottom (fits over bin lip) ---
    recess = Box(recess_w, recess_l, recess_depth + 0.1)
    recess = recess.moved(Location((0, 0, (recess_depth + 0.1) / 2 - 0.05)))
    body = body - Part(recess)

    # Round the bottom edges of the recess for easier fit over the lip
    try:
        bottom_z = 0.0
        recess_bottom_edges = [
            e for e in body.edges()
            if abs(e.center().Z - bottom_z) < 0.01
        ]
        if recess_bottom_edges:
            body = body.fillet(0.4, recess_bottom_edges)
    except Exception:
        pass

    # Round the top edges slightly for a nicer finish
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
        body = _apply_lid_labels(body, flat_labels, p, total_h, lid_w, lid_l)

    return body


def _apply_lid_labels(body, labels, params, total_h, lid_w, lid_l):
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
