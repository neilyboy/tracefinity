"""Tests for the gridfinity bin builder."""
import pytest

from app.gridfinity.bin_builder import build_bin
from app.gridfinity.constants import GRID_UNIT_MM, HEIGHT_UNIT_MM, BASE_HEIGHT_MM


def test_basic_bin_dimensions():
    """Test that a basic bin has correct dimensions."""
    solid = build_bin(grid_w=2, grid_l=3, height_units=4, magnet_holes=False, scoop=False, lip=False)
    bb = solid.bounding_box()
    size = bb.size
    # 2x3 grid = 84x126mm, 4 units = 28mm
    assert abs(size.X - 2 * GRID_UNIT_MM) < 5
    assert abs(size.Y - 3 * GRID_UNIT_MM) < 5
    assert abs(size.Z - 4 * HEIGHT_UNIT_MM) < 5


def test_bin_with_magnets():
    """Test that magnet holes don't break the build."""
    solid = build_bin(grid_w=1, grid_l=1, height_units=2, magnet_holes=True, scoop=False, lip=False)
    bb = solid.bounding_box()
    assert bb.size.Z > 0


def test_bin_with_scoop():
    """Test that scoop doesn't break the build."""
    solid = build_bin(grid_w=2, grid_l=2, height_units=4, magnet_holes=False, scoop=True, lip=False)
    bb = solid.bounding_box()
    assert bb.size.Z > 0


def test_bin_with_lip():
    """Test that lip adds height."""
    solid_no_lip = build_bin(grid_w=1, grid_l=1, height_units=4, lip=False, scoop=False, magnet_holes=False, pocket_depth_mm=5)
    solid_with_lip = build_bin(grid_w=1, grid_l=1, height_units=4, lip=True, scoop=False, magnet_holes=False, pocket_depth_mm=5)
    h_no = solid_no_lip.bounding_box().size.Z
    h_with = solid_with_lip.bounding_box().size.Z
    assert h_with > h_no


def test_bin_with_dividers():
    """Test that compartments/dividers work."""
    solid = build_bin(
        grid_w=3, grid_l=3, height_units=3,
        compartments_x=3, compartments_y=3,
        scoop=False, magnet_holes=False, lip=False,
    )
    bb = solid.bounding_box()
    assert bb.size.X > 0
