"""Tool outline detection using OpenCV computer vision.

Uses traditional OpenCV techniques (bilateral filter, adaptive threshold,
contour detection) to find tool outlines on a sheet of paper. This approach
is faster and more reliable than AI segmentation for tools on uniform paper
backgrounds, because:

1. It detects ALL dark objects on the light paper (no missed tools)
2. It doesn't detect things outside the paper (no false positives)
3. It doesn't fragment or over-merge objects
4. It's much faster (milliseconds vs seconds for AI inference)

The pipeline (inspired by georgslazdans/outline-app):
1. Shading correction — removes paper wrinkles and uneven lighting
2. Bilateral filter — preserves edges while removing noise
3. Adaptive threshold — paper=white, tools=black (handles uneven lighting)
4. Morphological close/open — fills small holes and removes specks
5. Find contours — extract tool outlines and their inner holes
6. Filter by size + shape — remove noise and background artifacts
7. Smooth and simplify — produce clean outlines for rendering
"""
from __future__ import annotations

import uuid

import cv2
import numpy as np

from ..config import settings
from ..schemas import Point, ToolOutline
from ..utils.geometry import polygon_area


def detect_tools(rectified: np.ndarray, scale_mm_per_px: float, smoothing: float = 0.3) -> list[ToolOutline]:
    """Detect tool outlines in the rectified image using OpenCV.

    The rectified image is a top-down view of the paper with tools on it.
    Paper is light, tools are dark. We use adaptive thresholding to separate
    them, then extract contours.

    Args:
        rectified: top-down image of the paper with tools
        scale_mm_per_px: millimetres per pixel from paper rectification
        smoothing: 0.0 = sharp/polygon, 0.3 = balanced, 1.0 = very smooth
    """
    h, w = rectified.shape[:2]
    min_area_px = settings.min_tool_area_mm2 / (scale_mm_per_px ** 2)
    max_area_px = 0.5 * h * w  # exclude background/paper

    # Step 1: Grayscale + shading correction
    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)
    filtered = _preprocess_gray(gray)

    # Step 2: Adaptive threshold — paper=white(255), tools=black(0).
    # C=8 is less sensitive to small shadows/wrinkles than C=5.
    block_size = _nearest_odd(max(31, int(20 / scale_mm_per_px)))
    thresh = cv2.adaptiveThreshold(
        filtered, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, block_size, C=8,
    )

    # Step 3: Morphological operations to clean up the binary image.
    # Close fills small holes inside tools (labels, reflections).
    # Open removes small noise specks.
    close_kernel = np.ones((5, 5), np.uint8)
    open_kernel = np.ones((3, 3), np.uint8)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, close_kernel, iterations=2)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, open_kernel, iterations=1)

    # Step 4: Find contours — external and their inner holes.
    contours, hierarchy = cv2.findContours(thresh, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return []

    hierarchy = hierarchy[0]
    parent_to_holes = {}
    for i, _ in enumerate(contours):
        parent = hierarchy[i][3]
        if parent != -1:
            parent_to_holes.setdefault(parent, []).append(i)

    outlines: list[ToolOutline] = []
    for i, cnt in enumerate(contours):
        if hierarchy[i][3] != -1:
            continue  # skip inner contours; we'll gather them per parent

        area_px = cv2.contourArea(cnt)
        if area_px < min_area_px or area_px > max_area_px:
            continue

        # Check dimensions — reject shadows and noise
        _, _, cw, ch = cv2.boundingRect(cnt)
        w_mm = cw * scale_mm_per_px
        h_mm = ch * scale_mm_per_px
        if min(w_mm, h_mm) < 3.0:
            continue
        if w_mm > 100 and h_mm < 15:
            continue

        # Reject low-solidity slivers (paper wrinkles, shadows).
        hull = cv2.convexHull(cnt)
        hull_area = cv2.contourArea(hull)
        if hull_area > 0 and area_px / hull_area < 0.25:
            continue

        outer_mm = _smooth_simplify_contour(cnt, scale_mm_per_px, smoothing)
        if len(outer_mm) < 3:
            continue

        # Collect inner holes for this tool. Large holes (e.g., scissors
        # finger holes) are returned; tiny specks are ignored. The designer
        # can later choose which holes to keep or fill.
        holes_mm = []
        min_hole_area = 25.0 / (scale_mm_per_px ** 2)
        for hi in parent_to_holes.get(i, []):
            hcnt = contours[hi]
            if cv2.contourArea(hcnt) < min_hole_area:
                continue
            # Verify the hole is actually inside the outer contour.
            if not all(
                cv2.pointPolygonTest(cnt, (float(p[0][0]), float(p[0][1])), False) >= 0
                for p in hcnt
            ):
                continue
            hole_mm = _smooth_simplify_contour(hcnt, scale_mm_per_px, smoothing)
            if len(hole_mm) >= 3:
                holes_mm.append(hole_mm)

        outlines.append(
            ToolOutline(
                id=str(uuid.uuid4())[:8],
                outer=outer_mm,
                holes=holes_mm,
                smoothing=smoothing,
            )
        )

    outlines.sort(
        key=lambda o: polygon_area(np.array([[p.x, p.y] for p in o.outer])),
        reverse=True,
    )

    # Filter out thin/slender detections that aren't real tools
    outlines = [
        o for o in outlines
        if _is_likely_tool(np.array([[p.x, p.y] for p in o.outer]))
    ]

    return outlines


def detect_tool_at_point(rectified: np.ndarray, scale_mm_per_px: float, click_x: int, click_y: int, smoothing: float = 0.3) -> ToolOutline | None:
    """Detect a single tool outline at a clicked point.

    This implements Tooltrace-style click-based detection: the user clicks
    on a tool, and we detect the outline of just that tool. We use the same
    adaptive threshold as auto-detection, then find the contour that contains
    the clicked point.
    """
    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)
    filtered = _preprocess_gray(gray)

    block_size = _nearest_odd(max(31, int(20 / scale_mm_per_px)))
    thresh = cv2.adaptiveThreshold(
        filtered, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, block_size, C=10,
    )
    close_kernel = np.ones((5, 5), np.uint8)
    open_kernel = np.ones((3, 3), np.uint8)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, close_kernel, iterations=2)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, open_kernel, iterations=1)

    contours, hierarchy = cv2.findContours(thresh, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    min_area_px = settings.min_tool_area_mm2 / (scale_mm_per_px ** 2)
    hierarchy = hierarchy[0] if hierarchy is not None else []

    parent_to_holes = {}
    for i, _ in enumerate(contours):
        parent = hierarchy[i][3]
        if parent != -1:
            parent_to_holes.setdefault(parent, []).append(i)

    best_idx = -1
    best_area = 0
    for i, cnt in enumerate(contours):
        if hierarchy[i][3] != -1:
            continue
        area = cv2.contourArea(cnt)
        if area < min_area_px:
            continue
        if cv2.pointPolygonTest(cnt, (click_x, click_y), False) >= 0:
            if area > best_area:
                best_idx = i
                best_area = area

    if best_idx == -1:
        return None

    cnt = contours[best_idx]
    outer_mm = _smooth_simplify_contour(cnt, scale_mm_per_px, smoothing)
    if len(outer_mm) < 3:
        return None

    holes_mm = []
    min_hole_area = 25.0 / (scale_mm_per_px ** 2)
    for hi in parent_to_holes.get(best_idx, []):
        hcnt = contours[hi]
        if cv2.contourArea(hcnt) < min_hole_area:
            continue
        hole_mm = _smooth_simplify_contour(hcnt, scale_mm_per_px, smoothing)
        if len(hole_mm) >= 3:
            holes_mm.append(hole_mm)

    return ToolOutline(
        id=str(uuid.uuid4())[:8],
        outer=outer_mm,
        holes=holes_mm,
        smoothing=smoothing,
    )


def _preprocess_gray(gray: np.ndarray) -> np.ndarray:
    """Remove low-frequency shading (paper wrinkles, uneven lighting).

    We estimate the background with a large Gaussian blur, then subtract it
    from the original so that shading variations are suppressed while
    high-contrast tool edges remain. The result is re-centered around 128.
    """
    # Large blur to estimate low-frequency paper background. Kernel size is
    # at least 51px and at most 1/4 of the smaller image dimension.
    k = max(51, min(gray.shape[:2]) // 4)
    k = _nearest_odd(k)
    background = cv2.GaussianBlur(gray, (k, k), 0)

    # corrected = gray + (128 - background)
    # This makes paper regions ~128 and dark tools ~0, regardless of shading.
    offset = cv2.subtract(np.full_like(gray, 128), background)
    corrected = cv2.add(gray, offset)

    # Bilateral filter removes noise while preserving edges.
    return cv2.bilateralFilter(corrected, d=9, sigmaColor=75, sigmaSpace=75)


def _nearest_odd(n: int) -> int:
    """Return the nearest odd number >= n (for adaptiveThreshold block size)."""
    if n % 2 == 0:
        return n + 1
    return max(3, n)


def _is_likely_tool(pts: np.ndarray, max_aspect: float = 25.0, min_width_mm: float = 3.0) -> bool:
    """Check if a detected outline is likely a real tool."""
    xs = pts[:, 0]
    ys = pts[:, 1]
    w = float(xs.max() - xs.min())
    h = float(ys.max() - ys.min())
    if w < 1e-6 or h < 1e-6:
        return False
    if min(w, h) < min_width_mm:
        return False
    aspect = max(w, h) / min(w, h)
    if aspect > max_aspect:
        return False
    if w > 100 and h < 15:
        return False
    return True


def _smooth_simplify_contour(cnt: np.ndarray, scale_mm_per_px: float, smoothing: float = 0.3) -> list[Point]:
    """Produce a clean, smooth outline from a raw contour.

    Strategy:
    1. Resample to evenly-spaced points (kills pixel-level jaggedness)
    2. Gaussian smooth the contour (removes remaining noise)
    3. Douglas-Peucker simplification, with epsilon scaled by smoothing:
       - low smoothing keeps sharp corners
       - high smoothing produces rounder, simpler curves
    4. Remove very close points
    """
    target_max = settings.max_outline_vertices

    pts_px = cnt.reshape(-1, 2).astype(np.float64)
    if len(pts_px) < 3:
        return []

    # Resample to high density for smooth Gaussian smoothing
    pts_px = _resample_contour(pts_px, num_points=max(400, len(pts_px)))

    # Gaussian smooth — removes per-pixel jaggedness from the mask boundary.
    # sigma scales with the smoothing parameter.
    if smoothing > 0:
        base_sigma = 1.0 + smoothing * 7.0
        pts_px = _gaussian_smooth_2d(pts_px, sigma=base_sigma)
        if smoothing > 0.3:
            pts_px = _gaussian_smooth_2d(pts_px, sigma=base_sigma * 0.5)

    # Convert to mm for simplification (so tolerances are in physical units)
    pts_mm = pts_px * scale_mm_per_px

    # Douglas-Peucker simplification with tolerance based on smoothing.
    # For sharp (smoothing=0), keep a lot of points; for smooth (1.0), decimate.
    if len(pts_mm) > target_max:
        perim = float(np.sqrt(np.sum((np.roll(pts_mm, -1, axis=0) - pts_mm) ** 2, axis=1)).sum())
        factor = 4.0 + smoothing * 6.0
        epsilon = perim / (target_max * factor)
        epsilon = max(0.05, min(epsilon, 5.0 * (smoothing + 0.1)))
        pts_mm = cv2.approxPolyDP(pts_mm.astype(np.float32), epsilon, True).reshape(-1, 2).astype(np.float64)

    # Remove any points that ended up too close together
    pts_mm = _remove_close_points(pts_mm, min_dist_mm=0.5)

    if len(pts_mm) < 3:
        return []

    return [Point(x=round(float(p[0]), 2), y=round(float(p[1]), 2)) for p in pts_mm]


def _resample_contour(pts: np.ndarray, num_points: int) -> np.ndarray:
    """Resample a closed contour to evenly-spaced points by arc length."""
    if len(pts) < 2:
        return pts
    rolled = np.roll(pts, -1, axis=0)
    seg_lengths = np.sqrt(np.sum((rolled - pts) ** 2, axis=1))
    total_length = seg_lengths.sum()
    if total_length < 1e-6:
        return pts
    cum_lengths = np.zeros(len(pts) + 1)
    cum_lengths[1:] = np.cumsum(seg_lengths)
    target_lengths = np.linspace(0, total_length, num_points, endpoint=False)
    result = np.zeros((num_points, 2), dtype=np.float64)
    for i, target in enumerate(target_lengths):
        seg_idx = np.searchsorted(cum_lengths, target) - 1
        seg_idx = max(0, min(seg_idx, len(pts) - 1))
        seg_start = cum_lengths[seg_idx]
        seg_end = cum_lengths[seg_idx + 1]
        if seg_end - seg_start < 1e-6:
            result[i] = pts[seg_idx]
        else:
            t = (target - seg_start) / (seg_end - seg_start)
            result[i] = pts[seg_idx] * (1 - t) + pts[(seg_idx + 1) % len(pts)] * t
    return result


def _gaussian_smooth_2d(pts: np.ndarray, sigma: float = 2.0) -> np.ndarray:
    """Gaussian smooth a closed 2D point sequence."""
    if len(pts) < 3 or sigma <= 0:
        return pts
    radius = max(1, int(sigma * 3))
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    kernel = np.exp(-(x ** 2) / (2 * sigma ** 2))
    kernel /= kernel.sum()
    padded = np.vstack([pts[-radius:], pts, pts[:radius]])
    smoothed = np.zeros_like(pts, dtype=np.float64)
    smoothed[:, 0] = np.convolve(padded[:, 0], kernel, mode='valid')
    smoothed[:, 1] = np.convolve(padded[:, 1], kernel, mode='valid')
    return smoothed


def _remove_close_points(pts: np.ndarray, min_dist_mm: float = 1.0) -> np.ndarray:
    """Remove points that are too close together."""
    if len(pts) < 3:
        return pts
    result = [pts[0]]
    for i in range(1, len(pts)):
        dist = np.linalg.norm(pts[i] - result[-1])
        if dist >= min_dist_mm:
            result.append(pts[i])
    if len(result) > 1:
        dist = np.linalg.norm(result[-1] - result[0])
        if dist < min_dist_mm:
            result = result[:-1]
    out = np.array(result, dtype=np.float64)
    if len(out) < 3:
        return pts
    return out


def auto_rotate_angle(outer: list[Point]) -> float:
    """Find the rotation angle that minimizes the bounding box area.

    This aligns the tool's principal axis with the nearest coordinate axis
    (0°, 90°, 180°, or 270°), making the tool straight up-and-down or
    left-and-right. Like Tooltrace.ai's auto-rotate feature.

    Returns the rotation angle in degrees (0-90).
    """
    pts = np.array([[p.x, p.y] for p in outer])
    if len(pts) < 3:
        return 0.0

    cx = float(np.mean(pts[:, 0]))
    cy = float(np.mean(pts[:, 1]))

    best_angle = 0.0
    best_area = float('inf')

    # Try angles from 0 to 90 degrees in 1-degree steps
    for angle in range(0, 91):
        angle_rad = np.radians(angle)
        cos_a, sin_a = np.cos(angle_rad), np.sin(angle_rad)
        dx = pts[:, 0] - cx
        dy = pts[:, 1] - cy
        new_x = dx * cos_a - dy * sin_a
        new_y = dx * sin_a + dy * cos_a
        w = new_x.max() - new_x.min()
        h = new_y.max() - new_y.min()
        area = w * h
        if area < best_area:
            best_area = area
            best_angle = float(angle)

    return best_angle
