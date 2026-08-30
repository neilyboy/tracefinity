"""Gridfinity specification constants.

Reference: https://gridfinity.xyz/ and Zack Freedman's original spec.
Also: https://github.com/jeroen94704/gridfinitycreator/blob/main/grid_constants.py
All dimensions in millimetres.
"""
from __future__ import annotations

# Core unit: each gridfinity cell is 42x42mm.
GRID_UNIT_MM = 42.0

# Height unit: bins are built in increments of 7mm.
HEIGHT_UNIT_MM = 7.0

# Tolerance so bins fit in baseplates.
BRICK_SIZE_TOLERANCE_MM = 0.5

# Effective bin footprint per unit cell (42 - 0.5 = 41.5mm per unit).
# The bin outer dimension = grid_units * 42 - 0.5
BIN_CLEARANCE_MM = BRICK_SIZE_TOLERANCE_MM

# --- Base (stacking socket) profile ---
# The base is the bottom ~4mm of every bin that slots into baseplates.
# It has a specific chamfered profile.
BASE_HEIGHT_MM = 4.0  # total height of the stacking socket

# Bottom of the base (the part that goes into the baseplate socket)
BASE_BOTTOM_THICKNESS = 2.6
BASE_BOTTOM_CHAMFER = 0.8  # chamfer at the very bottom
BASE_BOTTOM_FILLET = 1.6   # fillet radius at bottom

# Top of the base (transitions to the bin body)
BASE_TOP_THICKNESS = 2.15
BASE_TOP_FILLET = 3.75  # matches the 3.75mm corner radius

# The stacking socket is smaller than the bin footprint.
# Socket bottom: 38.5mm per cell (fits into baseplate)
# Socket top: 41.5mm per cell (matches bin footprint = 42 - 0.5 clearance)
SOCKET_BOTTOM_SIZE_MM = 38.5  # per cell, the part that goes into baseplate
SOCKET_TOP_SIZE_MM = 41.5     # per cell, matches bin footprint
SOCKET_BOTTOM_INSET = GRID_UNIT_MM - SOCKET_BOTTOM_SIZE_MM  # 3.5mm inset per side

# Corner rounding of the bin body itself (matches gridfinity spec).
BIN_CORNER_RADIUS_MM = 3.75

# --- Magnet holes ---
# 6mm diameter, 2mm deep, in all 4 corners of every unit cell.
MAGNET_DIAMETER_MM = 6.5  # slightly oversized for fit
MAGNET_DEPTH_MM = 2.0
MAGNET_INSET_MM = 8.0  # distance from bin edge to magnet center

# --- Screw holes ---
# M3 screws, go through the base.
SCREW_DIAMETER_MM = 3.0
SCREW_DEPTH_MM = 6.0

# --- Stacking lip ---
# The lip at the top of the bin allows stacking.
LIP_OVERHANG_MM = 0.6   # how far the lip sticks out
LIP_HEIGHT_MM = 4.4     # total lip height
LIP_CHAMFER = 0.4       # chamfer at the top of the lip

# --- Floor ---
# The solid floor between the base and the compartment cavity.
# Tool pockets are cut into this floor.
FLOOR_THICKNESS = 2.25  # standard floor thickness (makes base exactly 1U)

# --- Label tab ---
LABEL_TAB_HEIGHT_MM = 7.0
LABEL_TAB_WIDTH_MM = 42.0
LABEL_TAB_THICKNESS_MM = 1.0

# --- Walls ---
DEFAULT_WALL_THICKNESS_MM = 1.2

# --- Scoop (finger cutout) ---
DEFAULT_SCOOP_DEPTH_MM = 8.0

# --- Baseplate ---
# Based on Kennetek's gridfinity-rebuilt-openscad reference implementation.
# https://github.com/kennetek/gridfinity-rebuilt-openscad
#
# The baseplate socket profile (cut into the top of the plate) has three
# sections, all with 45° chamfers:
#
#   Z=0 (bottom):     narrowest  — socket_bottom_size (36.3mm)
#   Z=0..0.7:         45° chamfer widening out by 0.7mm per side
#   Z=0.7..2.5:       vertical section (1.8mm tall) at socket_neck_size (37.7mm)
#   Z=2.5..4.65:      45° chamfer widening out by 2.15mm per side
#   Z=4.65 (top):     widest — full grid size (42mm)
#
# Total profile height: 4.65mm. Baseplate height = 5mm (includes 0.35mm
# clearance above the profile to ensure the bin base contacts the lip).

# Profile section heights (mm)
BASEPLATE_PROFILE_BOTTOM_CHAMFER_H = 0.7   # bottom 45° chamfer height
BASEPLATE_PROFILE_VERTICAL_H = 1.8         # vertical section height
BASEPLATE_PROFILE_TOP_CHAMFER_H = 2.15     # top 45° chamfer height
BASEPLATE_PROFILE_TOTAL_H = (
    BASEPLATE_PROFILE_BOTTOM_CHAMFER_H
    + BASEPLATE_PROFILE_VERTICAL_H
    + BASEPLATE_PROFILE_TOP_CHAMFER_H
)  # 4.65mm

# Profile horizontal insets (mm, per side)
BASEPLATE_PROFILE_BOTTOM_CHAMFER_INSET = 0.7    # bottom chamfer horizontal
BASEPLATE_PROFILE_TOP_CHAMFER_INSET = 2.15      # top chamfer horizontal
BASEPLATE_PROFILE_TOTAL_INSET = (
    BASEPLATE_PROFILE_BOTTOM_CHAMFER_INSET
    + BASEPLATE_PROFILE_TOP_CHAMFER_INSET
)  # 2.85mm per side

# Socket sizes (mm, square)
BASEPLATE_SOCKET_TOP_SIZE = GRID_UNIT_MM  # 42mm at the very top (full grid size)
BASEPLATE_SOCKET_NECK_SIZE = (
    BASEPLATE_SOCKET_TOP_SIZE - 2 * BASEPLATE_PROFILE_TOP_CHAMFER_INSET
)  # 37.7mm at the vertical neck
BASEPLATE_SOCKET_BOTTOM_SIZE = (
    BASEPLATE_SOCKET_NECK_SIZE - 2 * BASEPLATE_PROFILE_BOTTOM_CHAMFER_INSET
)  # 36.3mm at the very bottom (narrowest)

# Total baseplate height (socket profile + clearance)
BASEPLATE_HEIGHT_MM = 5.0  # standard gridfinity baseplate height
BASEPLATE_CLEARANCE_H = BASEPLATE_HEIGHT_MM - BASEPLATE_PROFILE_TOTAL_H  # 0.35mm

# Corner radius
BASEPLATE_OUTER_RADIUS = 4.0  # outer corner radius of the baseplate
BASEPLATE_INNER_RADIUS = 1.15  # inner corner radius of the socket cavity

# Base slab (below the socket profile)
BASEPLATE_DEFAULT_THICKNESS_MM = 2.4  # default extra base thickness below socket
BASEPLATE_MIN_THICKNESS_MM = 0.0      # 0 = filament-saving mode (through holes)
BASEPLATE_MAX_THICKNESS_MM = 10.0

# Default edge clip dimensions for segmented baseplates
BASEPLATE_CLIP_WIDTH_MM = 6.0
BASEPLATE_CLIP_DEPTH_MM = 3.0
BASEPLATE_CLIP_TOLERANCE_MM = 0.2
# Print bed presets (mm) — common consumer printers
PRINT_BED_PRESETS = {
    "ender_3": (220, 220),
    "ender_3_v2":  (235, 235),
    "prusa_mk3": (250, 210),
    "prusa_mk4": (250, 210),
    "bambu_x1": (256, 256),
    "bambu_p1s": (256, 256),
    "voron_2_4": (350, 350),
    "elegoo_neptune_3": (225, 225),
    "elegoo_neptune_4": (225, 225),
    "creality_cr10": (300, 300),
    "custom": (220, 220),
}
