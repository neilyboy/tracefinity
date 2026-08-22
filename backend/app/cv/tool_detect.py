"""Tool outline detection from a rectified paper image.

Produces clean, smooth, professional-looking outlines suitable for cutting.
The pipeline: threshold → morphological cleanup → contour extraction →
Gaussian smoothing of the contour points → Douglas-Peucker simplification →
Chaikin corner-cutting for smooth curves.
"""
from __future__ import annotations

import uuid

import cv2
import numpy as np

from ..config import settings
from ..schemas import Point, ToolOutline
from ..utils.geometry import chaikin_smooth, polygon_area


def detect_tools(rectified: np.ndarray, scale_mm_per_px: float) -> list[ToolOutline]:
    """Detect tool outlines in the rectified image.

    Tools are assumed to be dark objects on white/light paper.
    Returns a list of ToolOutline with coordinates in millimetres.
    """
    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)

    # Tools are darker than paper. Use Otsu to separate.
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Clean up: close small gaps inside tools, open to remove noise.
    # Use a larger close kernel to merge nearby edges of the same tool.
    kernel_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    kernel_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, kernel_close, iterations=2)
    bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, kernel_open, iterations=1)

    # Additional blur + re-threshold to smooth ragged edges before contour extraction.
    bw = cv2.GaussianBlur(bw, (7, 7), 0)
    _, bw = cv2.threshold(bw, 127, 255, cv2.THRESH_BINARY)

    # Use RETR_CCOMP to get 2-level hierarchy: outer contours + holes.
    contours, hierarchy = cv2.findContours(bw, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)

    if hierarchy is None:
        return []

    hierarchy = hierarchy[0]
    min_area_px = settings.min_tool_area_mm2 / (scale_mm_per_px ** 2)

    outlines: list[ToolOutline] = []

    for i, cnt in enumerate(contours):
        if hierarchy[i][3] != -1:
            continue
        area_px = cv2.contourArea(cnt)
        if area_px < min_area_px:
            continue

        outer_mm = _smooth_simplify_contour(cnt, scale_mm_per_px)
        if len(outer_mm) < 3:
            continue

        # Find holes: children of this contour.
        holes_mm: list[list[Point]] = []
        child = hierarchy[i][2]
        while child != -1:
            child_cnt = contours[child]
            child_area = cv2.contourArea(child_cnt)
            if child_area > min_area_px * 0.3:
                hole_mm = _smooth_simplify_contour(child_cnt, scale_mm_per_px)
                if len(hole_mm) >= 3:
                    holes_mm.append(hole_mm)
            child = hierarchy[child][0]

        outlines.append(
            ToolOutline(
                id=str(uuid.uuid4())[:8],
                outer=outer_mm,
                holes=holes_mm,
            )
        )

    outlines.sort(key=lambda o: polygon_area(np.array([[p.x, p.y] for p in o.outer])), reverse=True)

    # Filter out thin/slender detections that are likely shadows or paper edges,
    # not actual tools. A real tool should have a reasonable width-to-height ratio.
    outlines = [
        o for o in outlines
        if _is_likely_tool(np.array([[p.x, p.y] for p in o.outer]))
    ]

    return outlines


def _is_likely_tool(pts: np.ndarray, max_aspect: float = 12.0, min_width_mm: float = 3.0) -> bool:
    """Check if a detected outline is likely a real tool (not a shadow or edge).

    Rejects outlines that are extremely thin (high aspect ratio) or very small
    in one dimension, which are typically shadows or paper edge artifacts.
    """
    xs = pts[:, 0]
    ys = pts[:, 1]
    w = float(xs.max() - xs.min())
    h = float(ys.max() - ys.min())
    if w < 1e-6 or h < 1e-6:
        return False
    if min(w, h) < min_width_mm:
        return False
    aspect = max(w, h) / min(w, h)
    return aspect <= max_aspect


def _smooth_simplify_contour(cnt: np.ndarray, scale_mm_per_px: float) -> list[Point]:
    """Produce a clean, smooth outline from a raw contour.

    Pipeline:
    1. Resample the contour to evenly-spaced points (removes density variations)
    2. Gaussian smooth the point sequence (kills jaggedness)
    3. Douglas-Peucker simplify (reduce to key vertices)
    4. Chaikin corner-cutting (round the corners for a professional look)
    """
    target_max = settings.max_outline_vertices

    # Step 1: Resample contour to evenly-spaced points.
    pts_px = cnt.reshape(-1, 2).astype(np.float64)
    if len(pts_px) < 3:
        return []
    pts_px = _resample_contour(pts_px, num_points=max(200, len(pts_px)))

    # Step 2: Gaussian smooth in pixel space (kills per-pixel jaggedness).
    pts_px = _gaussian_smooth_2d(pts_px, sigma=3.0)

    # Step 3: Douglas-Peucker simplify with a generous epsilon for clean shapes.
    # Start at 2mm and increase if too many vertices. Larger epsilon = fewer,
    # cleaner corners.
    peri = cv2.arcLength(pts_px.reshape(-1, 1, 2).astype(np.float32), True)
    eps_mm = 2.0
    eps_px = eps_mm / scale_mm_per_px

    approx = cv2.approxPolyDP(
        pts_px.reshape(-1, 1, 2).astype(np.float32), eps_px, True
    )
    while len(approx) > target_max and eps_mm < 15.0:
        eps_mm *= 1.4
        eps_px = eps_mm / scale_mm_per_px
        approx = cv2.approxPolyDP(
            pts_px.reshape(-1, 1, 2).astype(np.float32), eps_px, True
        )

    pts_mm = approx.reshape(-1, 2).astype(np.float64) * scale_mm_per_px

    # Step 4: Chaikin corner-cutting for smooth, rounded curves.
    # 3 iterations gives professional-looking rounded outlines.
    if len(pts_mm) >= 4:
        pts_mm = chaikin_smooth(pts_mm, iterations=3)
        # Re-simplify after Chaikin to keep vertex count bounded and remove
        # tiny edges. Use a minimum edge length of 1.5mm.
        if len(pts_mm) > target_max or True:  # Always clean up after Chaikin
            pts_px2 = (pts_mm / scale_mm_per_px).reshape(-1, 1, 2).astype(np.float32)
            peri2 = cv2.arcLength(pts_px2, True)
            # Use at least 1.5mm epsilon to remove tiny Chaikin-generated edges
            cleanup_eps = max(1.5, eps_mm * 0.5) / scale_mm_per_px
            approx2 = cv2.approxPolyDP(pts_px2, cleanup_eps, True)
            pts_mm = approx2.reshape(-1, 2).astype(np.float64) * scale_mm_per_px

    return [Point(x=round(float(p[0]), 2), y=round(float(p[1]), 2)) for p in pts_mm]


def _resample_contour(pts: np.ndarray, num_points: int) -> np.ndarray:
    """Resample a closed contour to have evenly-spaced points by arc length."""
    if len(pts) < 2:
        return pts

    # Compute cumulative arc length.
    rolled = np.roll(pts, -1, axis=0)
    seg_lengths = np.sqrt(np.sum((rolled - pts) ** 2, axis=1))
    total_length = seg_lengths.sum()
    if total_length < 1e-6:
        return pts

    cum_lengths = np.zeros(len(pts) + 1)
    cum_lengths[1:] = np.cumsum(seg_lengths)

    # Interpolate at evenly-spaced arc lengths.
    target_lengths = np.linspace(0, total_length, num_points, endpoint=False)
    result = np.zeros((num_points, 2), dtype=np.float64)

    for i, target in enumerate(target_lengths):
        # Find which segment this target falls in.
        seg_idx = np.searchsorted(cum_lengths, target) - 1
        seg_idx = max(0, min(seg_idx, len(pts) - 1))
        # Interpolate within the segment.
        seg_start = cum_lengths[seg_idx]
        seg_end = cum_lengths[seg_idx + 1]
        if seg_end - seg_start < 1e-6:
            result[i] = pts[seg_idx]
        else:
            t = (target - seg_start) / (seg_end - seg_start)
            result[i] = pts[seg_idx] * (1 - t) + pts[(seg_idx + 1) % len(pts)] * t

    return result


def _gaussian_smooth_2d(pts: np.ndarray, sigma: float = 2.0) -> np.ndarray:
    """Gaussian smooth a closed 2D point sequence.

    Smooths X and Y independently using a 1D Gaussian with circular boundary.
    """
    if len(pts) < 3:
        return pts

    # Build a 1D Gaussian kernel.
    radius = max(1, int(sigma * 3))
    x = np.arange(-radius, radius + 1)
    kernel = np.exp(-(x ** 2) / (2 * sigma ** 2))
    kernel /= kernel.sum()

    # Pad circularly (closed contour).
    padded = np.vstack([pts[-radius:], pts, pts[:radius]])

    smoothed = np.zeros_like(pts, dtype=np.float64)
    smoothed[:, 0] = np.convolve(padded[:, 0], kernel, mode='valid')
    smoothed[:, 1] = np.convolve(padded[:, 1], kernel, mode='valid')

    return smoothed
