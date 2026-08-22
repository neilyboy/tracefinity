"""Build a Gridfinity bin solid using build123d.

This module creates the base bin (without tool pockets). Pockets are
applied separately in pockets.py.
"""
from __future__ import annotations

from build123d import (
    Axis,
    Box,
    Cylinder,
    Location,
    Part,
    Plane,
    Sketch,
    Solid,
    Vector,
    extrude,
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
    compartments_x: int = 1,
    compartments_y: int = 1,
) -> Solid:
    """Build a gridfinity bin solid (without tool pockets).

    Args:
        grid_w: width in grid units (42mm each)
        grid_l: length in grid units
        height_units: height in 7mm units (includes the 4mm base)
    Returns:
        A build123d Solid.
    """
    bin_w = grid_w * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    bin_l = grid_l * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    total_h = height_units * C.HEIGHT_UNIT_MM

    # --- Base (stacking socket) ---
    # The socket is a 4mm tall block with a smaller top that slots into baseplates.
    # Simplified: a box with chamfered/rounded top edges forming the socket profile.
    base = Box(bin_w, bin_l, C.BASE_HEIGHT_MM)
    # Round the top edges of the socket slightly (simplified profile).
    # In a full impl this would use the exact gridfinity socket curve.

    # --- Walls + compartment cavity ---
    wall_h = total_h - C.BASE_HEIGHT_MM
    if wall_h > 0:
        walls_outer = Box(bin_w, bin_l, wall_h)
        # Position walls above base
        walls_outer = walls_outer.moved(Location((0, 0, C.BASE_HEIGHT_MM + wall_h / 2)))
        # Subtract inner cavity
        inner_w = bin_w - 2 * wall_thickness_mm
        inner_l = bin_l - 2 * wall_thickness_mm
        cavity = Box(inner_w, inner_l, wall_h + 0.1)
        cavity = cavity.moved(Location((0, 0, C.BASE_HEIGHT_MM + wall_h / 2)))
        walls = walls_outer - cavity
    else:
        walls = Box(0.1, 0.1, 0.1)

    # Combine base + walls
    bin_solid = Part(base) + Part(walls)

    # --- Stacking lip ---
    if lip and wall_h > 0:
        lip_outer = Box(
            bin_w + 2 * C.LIP_OVERHANG_MM,
            bin_l + 2 * C.LIP_OVERHANG_MM,
            C.LIP_HEIGHT_MM,
        )
        lip_z = total_h + C.LIP_HEIGHT_MM / 2
        lip_outer = lip_outer.moved(Location((0, 0, lip_z)))
        lip_inner = Box(bin_w - 2 * wall_thickness_mm, bin_l - 2 * wall_thickness_mm, C.LIP_HEIGHT_MM + 0.1)
        lip_inner = lip_inner.moved(Location((0, 0, lip_z)))
        lip_part = lip_outer - lip_inner
        bin_solid = bin_solid + Part(lip_part)

    # --- Magnet holes ---
    if magnet_holes:
        bin_solid = _add_magnet_holes(bin_solid, grid_w, grid_l, base_thickness_mm)

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

    return bin_solid


def _corner_positions(grid_w: int, grid_l: int) -> list[tuple[float, float]]:
    """Return the 4 corner positions (relative to bin center) for magnet/screw holes.

    Gridfinity bins have magnet holes in the corners of each unit cell,
    but for a multi-unit bin we place them at the 4 outer corners.
    """
    bin_w = grid_w * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    bin_l = grid_l * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    inset = C.MAGNET_INSET_MM
    return [
        (-bin_w / 2 + inset, -bin_l / 2 + inset),
        (bin_w / 2 - inset, -bin_l / 2 + inset),
        (-bin_w / 2 + inset, bin_l / 2 - inset),
        (bin_w / 2 - inset, bin_l / 2 - inset),
    ]


def _add_magnet_holes(bin_solid, grid_w, grid_l, base_thickness_mm) -> Part:
    """Subtract 6x2mm magnet holes from the base corners."""
    holes = []
    for cx, cy in _corner_positions(grid_w, grid_l):
        # Hole goes up from the bottom of the base.
        hole = Cylinder(C.MAGNET_DIAMETER_MM / 2, C.MAGNET_DEPTH_MM)
        # Position: at the corner, z from bottom of base up.
        hole = hole.moved(Location((cx, cy, C.MAGNET_DEPTH_MM / 2)))
        holes.append(hole)
    for h in holes:
        bin_solid = bin_solid - h
    return bin_solid


def _add_screw_holes(bin_solid, grid_w, grid_l) -> Part:
    """Subtract M3 screw through-holes from base corners."""
    holes = []
    for cx, cy in _corner_positions(grid_w, grid_l):
        hole = Cylinder(C.SCREW_DIAMETER_MM / 2, C.BASE_HEIGHT_MM + 0.1)
        hole = hole.moved(Location((cx, cy, C.BASE_HEIGHT_MM / 2)))
        holes.append(hole)
    for h in holes:
        bin_solid = bin_solid - h
    return bin_solid


def _add_dividers(
    bin_solid, grid_w, grid_l, wall_thickness, base_thickness, total_h,
    compartments_x, compartments_y,
) -> Part:
    """Add internal divider walls to create compartments."""
    bin_w = grid_w * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    bin_l = grid_l * C.GRID_UNIT_MM - 2 * C.BIN_CLEARANCE_MM
    wall_h = total_h - C.BASE_HEIGHT_MM - base_thickness

    # X dividers (run along Y axis)
    if compartments_x > 1:
        inner_w = bin_w - 2 * wall_thickness
        spacing = inner_w / compartments_x
        for i in range(1, compartments_x):
            x = -inner_w / 2 + i * spacing
            div = Box(wall_thickness, bin_l - 2 * wall_thickness, wall_h)
            div = div.moved(Location((x, 0, C.BASE_HEIGHT_MM + base_thickness + wall_h / 2)))
            bin_solid = bin_solid + Part(div)

    # Y dividers (run along X axis)
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
    # Scoop is a cylindrical cut at the bottom-front of the compartment.
    scoop = Cylinder(scoop_depth, scoop_w + 0.1)
    # Orient cylinder along X axis (so it spans the width)
    scoop = scoop.rotate(axis=Axis.Y, angle=90)
    # Position at the front-bottom interior
    scoop = scoop.moved(Location((0, bin_l / 2 - wall_thickness - scoop_depth / 2, C.BASE_HEIGHT_MM)))
    bin_solid = bin_solid - scoop
    return bin_solid
