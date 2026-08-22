"""Tests for tool outline detection."""
import cv2
import numpy as np
import pytest

from app.cv.tool_detect import detect_tools


@pytest.fixture
def rectified_paper_with_tools():
    """Create a rectified white paper image with dark tool shapes."""
    img = np.ones((900, 700, 3), dtype=np.uint8) * 240
    # Rectangle (wrench)
    cv2.rectangle(img, (100, 150), (300, 200), (40, 40, 40), -1)
    # Circle (handle)
    cv2.circle(img, (450, 400), 50, (30, 30, 30), -1)
    # Ring (circle with hole)
    cv2.circle(img, (200, 600), 60, (35, 35, 35), 10)
    return img


def test_detect_tools_finds_shapes(rectified_paper_with_tools):
    """Test that tool detection finds the dark shapes."""
    outlines = detect_tools(rectified_paper_with_tools, scale_mm_per_px=0.3)
    assert len(outlines) >= 2  # at least the rectangle and circle
    for o in outlines:
        assert len(o.outer) >= 3
        assert o.id  # has an id


def test_detect_tools_coordinates_in_mm(rectified_paper_with_tools):
    """Test that outline coordinates are in mm (not pixels)."""
    scale = 0.3  # mm per px
    outlines = detect_tools(rectified_paper_with_tools, scale_mm_per_px=scale)
    assert len(outlines) > 0
    # The rectangle is at px (100,150)-(300,200), so in mm:
    # ~30mm x 15mm. Check that coordinates are in that range.
    tool = outlines[0]
    xs = [p.x for p in tool.outer]
    ys = [p.y for p in tool.outer]
    width_mm = max(xs) - min(xs)
    height_mm = max(ys) - min(ys)
    # Should be roughly 60mm x 15mm (200px * 0.3 = 60mm, 50px * 0.3 = 15mm)
    assert 10 < width_mm < 100
    assert 5 < height_mm < 50


def test_detect_tools_rejects_small_noise():
    """Test that tiny contours are rejected."""
    img = np.ones((500, 500, 3), dtype=np.uint8) * 240
    # Tiny dot (noise)
    cv2.circle(img, (250, 250), 3, (30, 30, 30), -1)
    # Real tool
    cv2.rectangle(img, (100, 100), (200, 180), (40, 40, 40), -1)
    outlines = detect_tools(img, scale_mm_per_px=0.3)
    # Should only find the rectangle, not the tiny dot
    assert len(outlines) == 1
