"""Paper/reference detection and scale calibration.

Uses multiple strategies to robustly find the paper sheet, collects ALL valid
candidates, and returns the LARGEST one (the paper should be the biggest
bright region in the photo).
"""
from __future__ import annotations

import cv2
import numpy as np

from ..config import PAPER_SIZES_MM

MIN_AREA_FRACTION = 0.05
MAX_AREA_FRACTION = 0.90
# Paper must be at least this much brighter than the surrounding background.
PAPER_BRIGHTNESS_RATIO = 1.03
# Aspect ratio tolerance (perspective distortion can be significant).
ASPECT_RATIO_TOLERANCE = 0.5
# Reject candidates with corners too close to the image edge (fraction of dimension).
EDGE_MARGIN_FRACTION = 0.02


def order_corners(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as [top-left, top-right, bottom-right, bottom-left]."""
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    d = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(d)]
    rect[3] = pts[np.argmax(d)]
    return rect


def _quad_brightness(gray: np.ndarray, corners: np.ndarray) -> float:
    mask = np.zeros(gray.shape, dtype=np.uint8)
    pts = corners.astype(np.int32).reshape(-1, 1, 2)
    cv2.fillPoly(mask, [pts], 255)
    return float(cv2.mean(gray, mask=mask)[0])


def _quad_outside_brightness(gray: np.ndarray, corners: np.ndarray) -> float:
    mask = np.zeros(gray.shape, dtype=np.uint8)
    pts = corners.astype(np.int32).reshape(-1, 1, 2)
    cv2.fillPoly(mask, [pts], 255)
    inv_mask = cv2.bitwise_not(mask)
    if inv_mask.sum() == 0:
        return 0.0
    return float(cv2.mean(gray, mask=inv_mask)[0])


def _quad_aspect_ratio(corners: np.ndarray) -> float:
    ordered = order_corners(corners)
    w = np.linalg.norm(ordered[1] - ordered[0])
    h = np.linalg.norm(ordered[3] - ordered[0])
    if h < 1e-6:
        return 0.0
    return float(w / h)


def _expected_aspect_ratio(paper_size: str) -> float:
    w, h = PAPER_SIZES_MM[paper_size]
    return w / h


def _is_valid_paper_quad(
    gray: np.ndarray, corners: np.ndarray, img_area: int, paper_size: str
) -> bool:
    """Check if a detected quad is a valid paper sheet."""
    area = cv2.contourArea(corners.astype(np.float32))
    if area < MIN_AREA_FRACTION * img_area:
        return False
    if area > MAX_AREA_FRACTION * img_area:
        return False

    # Check for degenerate quads (corners too close together)
    ordered = order_corners(corners)
    for i in range(4):
        j = (i + 1) % 4
        dist = np.linalg.norm(ordered[j] - ordered[i])
        if dist < 10:  # corners must be at least 10px apart
            return False

    # Reject candidates that touch the image edge (likely full-image false positives)
    h, w = gray.shape
    margin_x = w * EDGE_MARGIN_FRACTION
    margin_y = h * EDGE_MARGIN_FRACTION
    for i in range(4):
        cx, cy = float(ordered[i][0]), float(ordered[i][1])
        if cx < margin_x or cx > w - margin_x or cy < margin_y or cy > h - margin_y:
            return False

    inside_brightness = _quad_brightness(gray, corners)
    outside_brightness = _quad_outside_brightness(gray, corners)

    # Paper must be brighter than the background.
    if outside_brightness > 1.0:
        if inside_brightness < outside_brightness * PAPER_BRIGHTNESS_RATIO:
            return False
    elif inside_brightness < 50:
        return False

    # Aspect ratio check (with tolerance for perspective + 90° rotation).
    detected_ar = _quad_aspect_ratio(corners)
    expected_ar = _expected_aspect_ratio(paper_size)
    if expected_ar <= 0:
        return False
    ar_err_1 = abs(detected_ar / expected_ar - 1.0) if detected_ar > 0 else float('inf')
    ar_err_2 = abs(detected_ar * expected_ar - 1.0) if detected_ar > 0 else float('inf')
    if min(ar_err_1, ar_err_2) > ASPECT_RATIO_TOLERANCE:
        return False

    return True


def _refine_corner(gray: np.ndarray, corner: np.ndarray, search_radius: int = 30) -> np.ndarray:
    """Refine a corner position by finding the strongest edge response nearby.

    Looks in a small window around the corner for the point with the highest
    gradient magnitude (strongest edge), which is likely the true paper corner.
    """
    cx, cy = int(corner[0]), int(corner[1])
    h, w = gray.shape
    x0 = max(0, cx - search_radius)
    x1 = min(w, cx + search_radius + 1)
    y0 = max(0, cy - search_radius)
    y1 = min(h, cy + search_radius + 1)

    window = gray[y0:y1, x0:x1]
    if window.size < 4:
        return corner

    # Compute gradient magnitude.
    gx = cv2.Sobel(window, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(window, cv2.CV_64F, 0, 1, ksize=3)
    mag = np.sqrt(gx ** 2 + gy ** 2)

    # Find the strongest edge point in the window.
    # Weight towards the center to avoid jumping to unrelated edges.
    yy, xx = np.mgrid[0:mag.shape[0], 0:mag.shape[1]]
    dist_from_center = np.sqrt((xx - search_radius) ** 2 + (yy - search_radius) ** 2)
    # Penalize points far from the original corner.
    score = mag - 0.5 * dist_from_center
    best_idx = np.unravel_index(np.argmax(score), score.shape)
    best_y, best_x = best_idx

    return np.array([x0 + best_x, y0 + best_y], dtype=np.float32)


def _refine_corners(gray: np.ndarray, corners: np.ndarray, search_radius: int = 30) -> np.ndarray:
    """Refine all 4 corners by snapping to the strongest nearby edge."""
    refined = np.zeros_like(corners)
    for i in range(4):
        refined[i] = _refine_corner(gray, corners[i], search_radius)
    return refined


def _try_approx_quad(contour: np.ndarray) -> np.ndarray | None:
    """Try to approximate a contour as a 4-point quad."""
    peri = cv2.arcLength(contour, True)
    # Try convex hull first (removes small bumps from shadows/noise)
    hull = cv2.convexHull(contour)
    hull_peri = cv2.arcLength(hull, True)
    for eps_frac in (0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1):
        approx = cv2.approxPolyDP(hull, eps_frac * hull_peri, True)
        if len(approx) == 4:
            return approx.reshape(4, 2).astype(np.float32)

    # Try on the raw contour with more epsilon values
    for eps_frac in (0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04, 0.045, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15):
        approx = cv2.approxPolyDP(contour, eps_frac * peri, True)
        if len(approx) == 4:
            return approx.reshape(4, 2).astype(np.float32)

    # Fallback: minAreaRect on the hull
    for eps_frac in (0.02, 0.04, 0.06, 0.08):
        approx = cv2.approxPolyDP(hull, eps_frac * hull_peri, True)
        if 3 <= len(approx) <= 8:
            rect = cv2.minAreaRect(approx.reshape(-1, 1, 2).astype(np.float32))
            box = cv2.boxPoints(rect)
            return box.astype(np.float32)
    return None


def detect_paper_quad(image: np.ndarray, paper_size: str = "letter") -> np.ndarray | None:
    """Detect the paper sheet as a 4-corner quadrilateral.

    Collects ALL valid candidates from multiple strategies and returns
    the one with the largest area (the paper should be the biggest bright region).
    """
    # Downscale very large images for faster processing.
    max_dim = 1500
    scale_factor = 1.0
    if max(image.shape[:2]) > max_dim:
        scale_factor = max_dim / max(image.shape[:2])
        small = cv2.resize(image, None, fx=scale_factor, fy=scale_factor)
    else:
        small = image

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray_blur = cv2.GaussianBlur(gray, (5, 5), 0)
    img_area = small.shape[0] * small.shape[1]
    img_mean_brightness = float(gray.mean())

    candidates: list[tuple[float, np.ndarray, int]] = []  # (area, corners, priority)

    def add_candidate(quad: np.ndarray, priority: int = 0) -> None:
        ordered = order_corners(quad)
        if _is_valid_paper_quad(gray, ordered, img_area, paper_size):
            area = cv2.contourArea(ordered.astype(np.float32))
            candidates.append((area, ordered, priority))

    def scale_back(corners_small: np.ndarray) -> np.ndarray:
        return corners_small / scale_factor

    # --- Strategy 1: Bright-region thresholding (relative to mean) ---
    # Try offsets from +30 down to -30. Lower thresholds catch paper in shadows
    # or dim lighting, but too low catches the background too.
    for offset in [10, 20, 30, 0, -10, 40, -20, 50, -30, 60]:
        thresh_val = int(img_mean_brightness + offset)
        if thresh_val < 40 or thresh_val > 250:
            continue
        _, bright_mask = cv2.threshold(gray_blur, thresh_val, 255, cv2.THRESH_BINARY)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
        bright_mask = cv2.morphologyEx(bright_mask, cv2.MORPH_CLOSE, kernel, iterations=3)
        bright_mask = cv2.morphologyEx(bright_mask, cv2.MORPH_OPEN, kernel, iterations=1)
        contours, _ = cv2.findContours(bright_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        for c in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
            quad = _try_approx_quad(c)
            if quad is not None:
                add_candidate(quad, priority=10)  # Strategy 1: highest priority

    # --- Strategy 2: Edge-based (Canny) ---
    for blur_size in [(5, 5), (9, 9)]:
        blurred = cv2.GaussianBlur(gray, blur_size, 0)
        for low, high in [(30, 100), (50, 150), (75, 200)]:
            edges = cv2.Canny(blurred, low, high)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
            edges = cv2.dilate(edges, kernel, iterations=1)
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                continue
            for c in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
                quad = _try_approx_quad(c)
                if quad is not None:
                    add_candidate(quad)

    # --- Strategy 3: Adaptive threshold ---
    for block_size in [51, 31, 71]:
        for C_val in [5, 10, 15]:
            bw = cv2.adaptiveThreshold(
                gray_blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY, block_size, C_val,
            )
            contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                continue
            for c in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
                quad = _try_approx_quad(c)
                if quad is not None:
                    add_candidate(quad)

    # --- Strategy 4: Otsu ---
    _, otsu = cv2.threshold(gray_blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(otsu, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        for c in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
            quad = _try_approx_quad(c)
            if quad is not None:
                add_candidate(quad)

    # --- Strategy 5: Floodfill from center ---
    h, w = gray.shape
    seed = (w // 2, h // 2)
    flood = gray.copy()
    mask_flood = np.zeros((h + 2, w + 2), dtype=np.uint8)
    cv2.floodFill(flood, mask_flood, seed, 0, (20, 20, 20), (20, 20, 20), cv2.FLOODFILL_MASK_ONLY)
    flood_mask = mask_flood[1:-1, 1:-1]
    flood_mask = (flood_mask * 255).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    flood_mask = cv2.morphologyEx(flood_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(flood_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        for c in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
            quad = _try_approx_quad(c)
            if quad is not None:
                add_candidate(quad)

    if not candidates:
        return None

    # Score each candidate: combine area (bigger is better) with aspect ratio
    # quality (closer to expected is better). This prevents a candidate with
    # a wrong corner (larger area but worse aspect ratio) from winning.
    expected_ar = _expected_aspect_ratio(paper_size)

    def score_candidate(area: float, corners: np.ndarray, priority: int) -> tuple:
        ar = _quad_aspect_ratio(corners)
        ar_err = min(abs(ar / expected_ar - 1.0), abs(ar * expected_ar - 1.0))
        # Score = (priority, area * (1 - ar_err * 3)). Priority is primary sort key.
        return (priority, area * max(0.1, 1.0 - ar_err * 3.0))

    candidates.sort(key=lambda x: score_candidate(x[0], x[1], x[2]), reverse=True)
    best = candidates[0][1]

    # Refine corners by snapping to strongest nearby edges.
    # This fixes cases where the quad approximation got 3/4 corners right
    # but one is slightly off (e.g. due to a shadow or crease).
    search_r = max(20, int(min(gray.shape) * 0.03))
    refined = _refine_corners(gray, best, search_radius=search_r)
    # Verify the refined corners are still valid (not worse than original).
    if _is_valid_paper_quad(gray, refined, img_area, paper_size):
        refined_area = cv2.contourArea(refined.astype(np.float32))
        if refined_area > candidates[0][0] * 0.85:
            best = refined

    return scale_back(best)


def rectify_paper(image: np.ndarray, corners: np.ndarray, paper_size: str) -> tuple[np.ndarray, float]:
    """Perspective-rectify the image so the paper fills the frame at known size."""
    paper_w_mm, paper_h_mm = PAPER_SIZES_MM[paper_size]
    target_w_px = int(paper_w_mm * 3)
    target_h_px = int(paper_h_mm * 3)
    dst = np.array(
        [[0, 0], [target_w_px - 1, 0], [target_w_px - 1, target_h_px - 1], [0, target_h_px - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(corners, dst)
    rectified = cv2.warpPerspective(image, matrix, (target_w_px, target_h_px))
    scale_mm_per_px = paper_w_mm / target_w_px
    return rectified, scale_mm_per_px


def detect_and_rectify(image: np.ndarray, paper_size: str) -> dict:
    """Full paper detection + rectification."""
    corners = detect_paper_quad(image, paper_size)
    if corners is None:
        raise RuntimeError("Could not detect a paper sheet in the image. Try manual corner placement.")
    rectified, scale = rectify_paper(image, corners, paper_size)
    return {
        "corners_px": corners.tolist(),
        "rectified_image": rectified,
        "scale_mm_per_px": scale,
        "w_px": rectified.shape[1],
        "h_px": rectified.shape[0],
    }
