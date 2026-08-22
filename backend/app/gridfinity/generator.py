"""Assemble a complete gridfinity model: bin + tool pockets."""
from __future__ import annotations

from build123d import Part, Solid

from ..schemas import Design
from .bin_builder import build_bin
from .pockets import subtract_pockets


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
        compartments_x=p.compartments_x,
        compartments_y=p.compartments_y,
    )
    bin_solid = subtract_pockets(bin_solid, design.outlines, p)
    return bin_solid
