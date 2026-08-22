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
1. Bilateral filter — preserves edges while removing noise
2. Adaptive threshold — paper=white, tools=black (handles uneven lighting)
3. Morphological close — fills small holes in tool masks
4. Find contours — extract tool outlines
5. Filter by size — remove noise and background
6. Smooth and simplify — produce clean outlines for rendering
"""
from __future__ import annotations

import uuid

import cv2
import numpy as np

from ..config import settings
from ..schemas import Point, ToolOutline
from ..utils.geometry import polygon_area


def detect_tools(rectified: np.ndarray, scale_mm_per_px: float) -> list[ToolOutline]:
    """Detect tool outlines in the rectified image using OpenCV.

    The rectified image is a top-down view of the paper with tools on it.
    Paper is light, tools are dark. We use adaptive thresholding to separate
    them, then extract contours.
    """
    h, w = rectified.shape[:2]
    min_area_px = settings.min_tool_area_mm2 / (scale_mm_per_px ** 2)
    max_area_px = 0.5 * h * w  # exclude background/paper

    # Step 1: Convert to grayscale
    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)

    # Step 2: Bilateral filter — preserves edges while removing noise.
    # This is critical for clean contours. d=9 is a good balance between
    # noise removal and edge preservation.
    filtered = cv2.bilateralFilter(gray, d=9, sigmaColor=75, sigmaSpace=75)

    # Step 3: Adaptive threshold — paper=white(255), tools=black(0).
    # THRESH_BINARY_INV makes tools white (255) on black (0) background.
    # blockSize=51 handles uneven lighting across the paper.
    # C=10 subtracts from the mean, so only clearly darker regions become tools.
    block_size = _nearest_odd(max(31, int(20 / scale_mm_per_px)))
    thresh = cv2.adaptiveThreshold(
        filtered, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, block_size, C=10,
    )

    # Step 4: Morphological operations to clean up the binary image.
    # Close fills small holes inside tools (from reflections, text, etc.)
    # Open removes small noise specks.
    close_kernel = np.ones((5, 5), np.uint8)
    open_kernel = np.ones((3, 3), np.uint8)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, close_kernel, iterations=2)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, open_kernel, iterations=1)

    # Step 5: Find contours — external contours only (no holes inside tools)
    contours, hierarchy = cv2.findContours(thresh, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return []

    hierarchy = hierarchy[0]
    outlines: list[ToolOutline] = []

    for i, cnt in enumerate(contours):
        if hierarchy[i][3] != -1:
            continue  # skip inner contours (holes)
        area_px = cv2.contourArea(cnt)
        if area_px < min_area_px or area_px > max_area_px:
            continue

        # Check dimensions — reject shadows and noise
        ys, xs = np.where(thresh > 0)  # not used; use contour bbox instead
        x, y, cw, ch = cv2.boundingRect(cnt)
        w_mm = cw * scale_mm_per_px
        h_mm = ch * scale_mm_per_px
        if min(w_mm, h_mm) < 3.0:
            continue
        # Reject wide thin streaks (shadows along paper edges)
        if w_mm > 100 and h_mm < 15:
            continue

        outer_mm = _smooth_simplify_contour(cnt, scale_mm_per_px)
        if len(outer_mm) < 3:
            continue

        # Find holes (inner contours of this outer contour)
        holes_mm: list[list[Point]] = []
        child = hierarchy[i][2]
        while child != -1:
            child_cnt = contours[child]
            child_area = cv2.contourArea(child_cnt)
            if child_area > min_area_px * 0.1:
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


def detect_tool_at_point(rectified: np.ndarray, scale_mm_per_px: float, click_x: int, click_y: int) -> ToolOutline | None:
    """Detect a single tool outline at a clicked point.

    This implements Tooltrace-style click-based detection: the user clicks
    on a tool, and we detect the outline of just that tool. We use the same
    adaptive threshold as auto-detection, then find the contour that contains
    the clicked point.
    """
    h, w = rectified.shape[:2]
    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)
    filtered = cv2.bilateralFilter(gray, d=9, sigmaColor=75, sigmaSpace=75)

    # Same adaptive threshold as auto-detection
    block_size = _nearest_odd(max(31, int(20 / scale_mm_per_px)))
    thresh = cv2.adaptiveThreshold(
        filtered, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, block_size, C=10,
    )
    close_kernel = np.ones((5, 5), np.uint8)
    open_kernel = np.ones((3, 3), np.uint8)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, close_kernel, iterations=2)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, open_kernel, iterations=1)

    # Find all contours and return the one containing the click point
    contours, hierarchy = cv2.findContours(thresh, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    min_area_px = settings.min_tool_area_mm2 / (scale_mm_per_px ** 2)
    hierarchy = hierarchy[0] if hierarchy is not None else []

    # Find the outer contour that contains the click point
    best_cnt = None
    best_area = 0
    for i, cnt in enumerate(contours):
        if hierarchy[i][3] != -1:
            continue  # skip inner contours
        area = cv2.contourArea(cnt)
        if area < min_area_px:
            continue
        if cv2.pointPolygonTest(cnt, (click_x, click_y), False) >= 0:
            if area > best_area:
                best_cnt = cnt
                best_area = area

    if best_cnt is None:
        return None

    outer_mm = _smooth_simplify_contour(best_cnt, scale_mm_per_px)
    if len(outer_mm) < 3:
        return None

    return ToolOutline(
        id=str(uuid.uuid4())[:8],
        outer=outer_mm,
        holes=[],
    )


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


def _smooth_simplify_contour(cnt: np.ndarray, scale_mm_per_px: float) -> list[Point]:
    """Produce a clean, smooth outline from a raw contour.

    Strategy:
    1. Resample to evenly-spaced points (kills pixel-level jaggedness)
    2. Gaussian smooth the contour (removes remaining noise)
    3. Curvature-based simplification: keep more points where the outline
       curves (corners, rounded ends) and fewer where it's straight.
    4. The frontend renders smooth bezier curves through these points.
    """
    target_max = settings.max_outline_vertices

    pts_px = cnt.reshape(-1, 2).astype(np.float64)
    if len(pts_px) < 3:
        return []

    # Resample to high density for smooth Gaussian smoothing
    pts_px = _resample_contour(pts_px, num_points=max(500, len(pts_px)))

    # Gaussian smooth — removes per-pixel jaggedness from the mask boundary.
    pts_px = _gaussian_smooth_2d(pts_px, sigma=3.0)

    # Convert to mm
    pts_mm = pts_px * scale_mm_per_px

    # Curvature-based simplification: keep points where curvature is high
    # (corners, curves) and decimate where curvature is low (straight edges).
    target_pts = min(target_max, max(24, len(pts_mm) // 8))
    pts_mm = _simplify_by_curvature(pts_mm, target_pts=target_pts)

    # Remove any points that ended up too close together
    pts_mm = _remove_close_points(pts_mm, min_dist_mm=0.5)

    return [Point(x=round(float(p[0]), 2), y=round(float(p[1]), 2)) for p in pts_mm]


def _simplify_by_curvature(pts: np.ndarray, target_pts: int) -> np.ndarray:
    """Simplify a closed contour by keeping high-curvature points.

    Points where the outline curves sharply (corners, rounded ends) are
    kept. Points on straight sections are decimated.
    """
    n = len(pts)
    if n <= target_pts or n < 6:
        return pts

    # Compute curvature at each point (angle change between adjacent segments)
    curvatures = np.zeros(n)
    for i in range(n):
        p0 = pts[(i - 1) % n]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        v1 = p1 - p0
        v2 = p2 - p1
        len1 = np.linalg.norm(v1)
        len2 = np.linalg.norm(v2)
        if len1 < 1e-6 or len2 < 1e-6:
            curvatures[i] = 0
            continue
        cos_angle = np.dot(v1, v2) / (len1 * len2)
        cos_angle = np.clip(cos_angle, -1, 1)
        curvatures[i] = 1.0 - cos_angle  # 0 = straight, 2 = sharp turn

    # Select points: 70% by highest curvature, 30% evenly spaced
    n_by_curv = int(target_pts * 0.7)
    n_even = target_pts - n_by_curv

    high_curv_idx = set(np.argsort(curvatures)[-n_by_curv:].tolist())
    even_idx = set(np.linspace(0, n - 1, n_even, dtype=int).tolist())

    keep_idx = sorted(high_curv_idx | even_idx)
    return pts[keep_idx]


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
    if len(pts) < 3:
        return pts
    radius = max(1, int(sigma * 3))
    x = np.arange(-radius, radius + 1)
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
    return np.array(result, dtype=np.float64)
