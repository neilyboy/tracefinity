"""Gridfinity specification constants.

Reference: https://gridfinity.xyz/ and Zack Freedman's original spec.
All dimensions in millimetres.
"""
from __future__ import annotations

# Core unit: each gridfinity cell is 42x42mm.
GRID_UNIT_MM = 42.0

# Height unit: bins are built in increments of 7mm.
HEIGHT_UNIT_MM = 7.0

# Base (stacking socket) height. The bottom of every bin has this
# grid-compatible socket that slots into baseplates.
BASE_HEIGHT_MM = 4.0

# Clearance per side so bins fit in baseplates (bin footprint per unit).
BIN_CLEARANCE_MM = 0.5

# Effective bin footprint per unit cell (42 - 2*0.5).
BIN_UNIT_FOOTPRINT_MM = GRID_UNIT_MM - 2 * BIN_CLEARANCE_MM  # 41.0

# Socket profile: the stacking socket is slightly smaller than the bin footprint.
SOCKET_FOOTPRINT_MM = 38.5  # approximate; the socket has rounded corners
SOCKET_CORNER_RADIUS_MM = 4.0

# Corner rounding of the bin body itself.
BIN_CORNER_RADIUS_MM = 3.75

# Magnet holes: 6mm diameter, 2mm deep, in all 4 corners.
MAGNET_DIAMETER_MM = 6.0
MAGNET_DEPTH_MM = 2.0
MAGNET_INSET_MM = 8.0  # distance from corner

# Screw holes: M3.
SCREW_DIAMETER_MM = 3.35
SCREW_HEAD_DIAMETER_MM = 5.0

# Stacking lip: small overhang at the top so bins can stack.
LIP_OVERHANG_MM = 0.6
LIP_HEIGHT_MM = 1.2

# Label tab dimensions.
LABEL_TAB_HEIGHT_MM = 7.0
LABEL_TAB_WIDTH_MM = 42.0  # one unit wide
LABEL_TAB_THICKNESS_MM = 1.0

# Default wall thickness for compartments.
DEFAULT_WALL_THICKNESS_MM = 1.2

# Scoop (finger cutout) default.
DEFAULT_SCOOP_DEPTH_MM = 8.0
