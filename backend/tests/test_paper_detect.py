"""Tests for paper detection and calibration."""
import cv2
import numpy as np
import pytest

from app.cv.paper_detect import detect_paper_quad, rectify_paper, order_corners


@pytest.fixture
def synthetic_paper_image():
    """Create an image with a white paper sheet on a dark background."""
    img = np.zeros((1200, 1000, 3), dtype=np.uint8)
    img[:] = (30, 30, 35)
    # White paper
    cv2.rectangle(img, (150, 150), (850, 1050), (235, 235, 235), -1)
    return img


def test_order_corners():
    """Test that corners are ordered TL, TR, BR, BL."""
    pts = np.array([[100, 100], [200, 100], [200, 200], [100, 200]], dtype=np.float32)
    ordered = order_corners(pts)
    # TL should have smallest sum
    assert ordered[0][0] + ordered[0][1] == 200  # (100,100)
    # BR should have largest sum
    assert ordered[2][0] + ordered[2][1] == 400  # (200,200)


def test_detect_paper_quad(synthetic_paper_image):
    """Test that paper detection finds 4 corners."""
    corners = detect_paper_quad(synthetic_paper_image)
    assert corners is not None
    assert corners.shape == (4, 2)


def test_rectify_paper(synthetic_paper_image):
    """Test that rectification produces correct scale."""
    corners = detect_paper_quad(synthetic_paper_image)
    assert corners is not None
    rectified, scale = rectify_paper(synthetic_paper_image, corners, "letter")
    # Letter is 215.9 x 279.4 mm, at 3 px/mm target
    assert abs(scale - 215.9 / (215.9 * 3)) < 0.01
    assert rectified.shape[0] > 0
    assert rectified.shape[1] > 0
