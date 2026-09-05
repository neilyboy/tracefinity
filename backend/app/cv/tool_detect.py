"""Tool outline detection using OpenCV computer vision.

Pipeline (inspired by georgslazdans/outline-app):
1. Bilateral filter — preserves edges while removing noise
2. Grayscale + Gaussian blur — smooth for stable thresholding
3. Adaptive threshold — paper=white, tools=black
4. Canny edge detection — crisp tool boundaries
5. Morphological close — fill small gaps in the mask
6. Find contours with RETR_TREE — outer outlines + inner holes
7. Filter by area — remove noise and background
8. Light approxPolyDP smoothing — preserves corners, removes pixel jitter

The smoothing parameter (0.0-1.0) controls how aggressively the outline
is simplified. 0.0 = nearly raw contour, 0.3 = balanced, 1.0 = very smooth.
"""
from __future__ import annotations

import uuid

import cv2
import numpy as np

from ..config import settings
from ..schemas import Point, ToolOutline
from ..utils.geometry import polygon_area


def detect_tools(rectified: np.ndarray, scale_mm_per_px: float, smoothing: float = 0.3) -> list[ToolOutline]:
    """Detect tool outlines in the rectified image.

    Args:
        rectified: top-down image of the paper with tools
        scale_mm_per_px: millimetres per pixel from paper rectification
        smoothing: 0.0 = sharp/polygon, 0.3 = balanced, 1.0 = very smooth
    """
    h, w = rectified.shape[:2]
    min_area_px = settings.min_tool_area_mm2 / (scale_mm_per_px ** 2)
    max_area_px = 0.5 * h * w

    # Step 1: Bilateral filter — preserves edges while removing noise.
    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)
    filtered = cv2.bilateralFilter(gray, d=9, sigmaColor=75, sigmaSpace=75)

    # Step 2: Gaussian blur for stable thresholding.
    blurred = cv2.GaussianBlur(filtered, (15, 15), 0)

    # Step 3: Otsu threshold — automatically finds the optimal threshold
    # between bright paper and dark tools. More robust than adaptive
    # threshold for this use case because it uses a single global
    # threshold that cleanly separates the bimodal paper/tool distribution.
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Step 4: Canny edge detection — crisp boundaries, catches edges
    # that Otsu might miss on tools with similar brightness to paper.
    canny = cv2.Canny(blurred, 100, 200)

    # Combine: tools are where either threshold or Canny detects them.
    combined = cv2.bitwise_or(thresh, canny)

    # Step 5: Morphological close — fill small gaps in the mask.
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, close_kernel, iterations=1)

    # Step 6: Find contours with full hierarchy (outer + inner holes).
    # CHAIN_APPROX_TC89_L1 gives smoother raw contours than SIMPLE.
    contours, hierarchy = cv2.findContours(
        combined, cv2.RETR_TREE, cv2.CHAIN_APPROX_TC89_L1
    )
    if hierarchy is None:
        return []

    hierarchy = hierarchy[0]

    # Map each contour to its children (holes).
    parent_to_children: dict[int, list[int]] = {}
    for i, _ in enumerate(contours):
        parent = hierarchy[i][3]
        if parent != -1:
            parent_to_children.setdefault(parent, []).append(i)

    # Background brightness for hole detection (mean of paper outside tools).
    bg_brightness = float(cv2.mean(gray, mask=cv2.bitwise_not(combined))[0])

    outlines: list[ToolOutline] = []
    for i, cnt in enumerate(contours):
        if hierarchy[i][3] != -1:
            continue  # skip inner contours; handled per-parent

        area_px = cv2.contourArea(cnt)
        if area_px < min_area_px or area_px > max_area_px:
            continue

        # Reject thin slivers (shadows, paper edge artifacts).
        _, _, cw, ch = cv2.boundingRect(cnt)
        w_mm = cw * scale_mm_per_px
        h_mm = ch * scale_mm_per_px
        if min(w_mm, h_mm) < 3.0:
            continue
        if w_mm > 100 and h_mm < 15:
            continue

        outer_mm = _smooth_contour(cnt, scale_mm_per_px, smoothing)
        if len(outer_mm) < 3:
            continue

        # Detect holes: inner contours whose mean brightness matches
        # the background (paper showing through). This distinguishes
        # real holes (scissors finger holes) from dark labels.
        holes_mm = []
        min_hole_area_px = max(20.0, 25.0 / (scale_mm_per_px ** 2))
        for child_idx in parent_to_children.get(i, []):
            child_cnt = contours[child_idx]
            child_area = cv2.contourArea(child_cnt)
            if child_area < min_hole_area_px:
                continue
            # Check if this child region is bright (paper) vs dark (label).
            hole_mask = np.zeros(gray.shape, dtype=np.uint8)
            cv2.drawContours(hole_mask, [child_cnt], -1, 255, cv2.FILLED)
            hole_brightness = float(cv2.mean(gray, mask=hole_mask)[0])
            # A real hole shows the paper background (bright).
            # A dark label or reflection stays dark.
            if hole_brightness > bg_brightness - 30:
                hole_mm = _smooth_contour(child_cnt, scale_mm_per_px, smoothing)
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


def detect_tool_at_point(
    rectified: np.ndarray, scale_mm_per_px: float,
    click_x: int, click_y: int, smoothing: float = 0.3,
) -> ToolOutline | None:
    """Detect a single tool outline at a clicked point."""
    h, w = rectified.shape[:2]
    gray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)
    filtered = cv2.bilateralFilter(gray, d=9, sigmaColor=75, sigmaSpace=75)
    blurred = cv2.GaussianBlur(filtered, (15, 15), 0)

    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    canny = cv2.Canny(blurred, 100, 200)
    combined = cv2.bitwise_or(thresh, canny)
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, close_kernel, iterations=1)

    contours, hierarchy = cv2.findContours(
        combined, cv2.RETR_TREE, cv2.CHAIN_APPROX_TC89_L1
    )
    if not contours or hierarchy is None:
        return None

    hierarchy = hierarchy[0]
    min_area_px = settings.min_tool_area_mm2 / (scale_mm_per_px ** 2)

    parent_to_children: dict[int, list[int]] = {}
    for i, _ in enumerate(contours):
        parent = hierarchy[i][3]
        if parent != -1:
            parent_to_children.setdefault(parent, []).append(i)

    bg_brightness = float(cv2.mean(gray, mask=cv2.bitwise_not(combined))[0])

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
    outer_mm = _smooth_contour(cnt, scale_mm_per_px, smoothing)
    if len(outer_mm) < 3:
        return None

    holes_mm = []
    min_hole_area_px = max(20.0, 25.0 / (scale_mm_per_px ** 2))
    for child_idx in parent_to_children.get(best_idx, []):
        child_cnt = contours[child_idx]
        if cv2.contourArea(child_cnt) < min_hole_area_px:
            continue
        hole_mask = np.zeros(gray.shape, dtype=np.uint8)
        cv2.drawContours(hole_mask, [child_cnt], -1, 255, cv2.FILLED)
        hole_brightness = float(cv2.mean(gray, mask=hole_mask)[0])
        if hole_brightness > bg_brightness - 30:
            hole_mm = _smooth_contour(child_cnt, scale_mm_per_px, smoothing)
            if len(hole_mm) >= 3:
                holes_mm.append(hole_mm)

    return ToolOutline(
        id=str(uuid.uuid4())[:8],
        outer=outer_mm,
        holes=holes_mm,
        smoothing=smoothing,
    )


def _nearest_odd(n: int) -> int:
    """Return the nearest odd number >= n."""
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


def _smooth_contour(cnt: np.ndarray, scale_mm_per_px: float, smoothing: float = 0.3) -> list[Point]:
    """Smooth and simplify a contour using approxPolyDP.

    Uses the outline-app approach: epsilon is a fraction of the arc length.
    The smoothing parameter scales the fraction from very fine (0.0) to
    aggressive (1.0). This preserves corners while removing pixel jitter.
    """
    pts_px = cnt.reshape(-1, 2).astype(np.float64)
    if len(pts_px) < 3:
        return []

    # Convert to mm
    pts_mm = pts_px * scale_mm_per_px

    # approxPolyDP with epsilon proportional to arc length.
    # outline-app uses 0.0002 * arcLength; we scale by smoothing.
    # smoothing=0.0 -> 0.0001 (nearly raw), 0.3 -> 0.002, 1.0 -> 0.01
    max_deviation = 0.0001 + smoothing * 0.01
    arc_len = cv2.arcLength(pts_mm.astype(np.float32), True)
    epsilon = max_deviation * arc_len

    simplified = cv2.approxPolyDP(pts_mm.astype(np.float32), epsilon, True).reshape(-1, 2)

    # Remove points that are too close together (< 0.5mm)
    simplified = _remove_close_points(simplified, min_dist_mm=0.5)

    if len(simplified) < 3:
        return []

    # Cap at max vertices
    target_max = settings.max_outline_vertices
    if len(simplified) > target_max:
        # Increase epsilon to reduce vertex count
        ratio = len(simplified) / target_max
        epsilon *= ratio * 1.2
        simplified = cv2.approxPolyDP(pts_mm.astype(np.float32), epsilon, True).reshape(-1, 2)
        simplified = _remove_close_points(simplified, min_dist_mm=0.5)

    if len(simplified) < 3:
        return []

    return [Point(x=round(float(p[0]), 2), y=round(float(p[1]), 2)) for p in simplified]


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

    Aligns the tool's principal axis with the nearest coordinate axis
    (0, 90, 180, or 270 degrees). Like Tooltrace.ai's auto-rotate.
    """
    pts = np.array([[p.x, p.y] for p in outer])
    if len(pts) < 3:
        return 0.0

    cx = float(np.mean(pts[:, 0]))
    cy = float(np.mean(pts[:, 1]))

    best_angle = 0.0
    best_area = float('inf')

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
