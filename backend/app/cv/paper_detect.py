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


def _edge_brightness_score(gray: np.ndarray, corners: np.ndarray) -> float:
    """Score how well the quad matches the paper (bright, consistent brightness).

    Samples points along each edge and computes the mean brightness.
    A quad that correctly outlines the paper will have high, consistent
    brightness at all edges. A quad that includes shadows will have
    low brightness at some edges.

    Returns a score 0.0-1.0 where 1.0 means perfectly bright, consistent edges.
    """
    h, w = gray.shape
    ordered = order_corners(corners)
    edge_brightnesses = []

    for i in range(4):
        p1 = ordered[i]
        p2 = ordered[(i + 1) % 4]
        # Sample 10 points along this edge
        brightnesses = []
        for t in np.linspace(0.1, 0.9, 10):
            px = p1[0] * (1 - t) + p2[0] * t
            py = p1[1] * (1 - t) + p2[1] * t
            ix, iy = int(px), int(py)
            if 0 <= ix < w and 0 <= iy < h:
                brightnesses.append(float(gray[iy, ix]))
        if brightnesses:
            edge_brightnesses.append(np.mean(brightnesses))

    if not edge_brightnesses:
        return 0.5

    mean_brightness = np.mean(edge_brightnesses)
    min_brightness = np.min(edge_brightnesses)

    # Score based on mean brightness (paper should be bright > 100)
    # and consistency (min edge should be close to mean).
    # Normalize: brightness 0-255, target ~120+ for dim paper.
    brightness_score = min(1.0, mean_brightness / 120.0)
    # Penalize edges that are much darker than the mean (shadows).
    consistency_score = min_brightness / max(mean_brightness, 1.0)

    return brightness_score * consistency_score


def _refine_corners_by_edges(gray: np.ndarray, corners: np.ndarray, contour: np.ndarray) -> np.ndarray:
    """Refine corners by fitting lines to the contour edges and computing intersections.

    This is more robust than brightness-based refinement because it uses the
    actual contour shape to determine where the paper edges are, even in
    shadows or uneven lighting.

    For each of the 4 edges (TL-TR, TR-BR, BR-BL, BL-TL), we:
    1. Find contour points near that edge
    2. Fit a line using least squares (RANSAC-like, rejecting outliers)
    3. Compute the 4 intersections of adjacent lines
    """
    ordered = order_corners(corners)
    pts = contour.reshape(-1, 2).astype(np.float64)

    if len(pts) < 8:
        return ordered

    lines = []  # Each line: (point, direction)
    for i in range(4):
        p1 = ordered[i]
        p2 = ordered[(i + 1) % 4]
        # Edge midpoint and length
        mid = (p1 + p2) / 2
        edge_len = np.linalg.norm(p2 - p1)
        if edge_len < 1e-6:
            lines.append((mid, np.array([1.0, 0.0])))
            continue

        # Edge direction
        edge_dir = (p2 - p1) / edge_len
        # Normal to edge (points inward toward paper center)
        normal = np.array([-edge_dir[1], edge_dir[0]])

        # Find contour points near this edge (within 15% of edge length)
        threshold = edge_len * 0.15
        # Distance from each contour point to the edge line
        vecs = pts - mid
        # Project onto normal (perpendicular distance from edge line)
        dists = np.abs(vecs[:, 0] * normal[0] + vecs[:, 1] * normal[1])
        # Project onto edge direction (to ensure point is between the corners)
        projections = vecs[:, 0] * edge_dir[0] + vecs[:, 1] * edge_dir[1]
        in_range = (projections > -edge_len * 0.1) & (projections < edge_len * 1.1)

        # Filter: close to the edge line AND between the corners
        mask = (dists < threshold) & in_range
        nearby = pts[mask]

        if len(nearby) < 5:
            lines.append((mid, edge_dir))
            continue

        # Fit a line using least squares.
        # Use PCA: the principal component is the line direction.
        center_pt = nearby.mean(axis=0)
        centered = nearby - center_pt
        # SVD to find principal direction
        _, _, vh = np.linalg.svd(centered, full_matrices=False)
        line_dir = vh[0]  # Principal component

        lines.append((center_pt, line_dir))

    # Compute intersections of adjacent lines.
    # Corner i = intersection of edge (i-1)%4 and edge i.
    refined = np.zeros((4, 2), dtype=np.float32)
    for i in range(4):
        p1, d1 = lines[(i - 1) % 4]
        p2, d2 = lines[i]
        refined[i] = _line_intersection(p1, d1, p2, d2)

    return refined


def _line_intersection(p1: np.ndarray, d1: np.ndarray, p2: np.ndarray, d2: np.ndarray) -> np.ndarray:
    """Compute the intersection of two lines (point + direction)."""
    # Line 1: p1 + t * d1
    # Line 2: p2 + s * d2
    # Solve: p1 + t * d1 = p2 + s * d2
    # t * d1 - s * d2 = p2 - p1
    # [d1x, -d2x] [t]   [p2x - p1x]
    # [d1y, -d2y] [s] = [p2y - p1y]
    A = np.array([[d1[0], -d2[0]], [d1[1], -d2[1]]])
    b = p2 - p1
    det = A[0, 0] * A[1, 1] - A[0, 1] * A[1, 0]
    if abs(det) < 1e-6:
        # Lines are parallel — return the midpoint
        return ((p1 + p2) / 2).astype(np.float32)
    params = np.linalg.solve(A, b)
    intersection = p1 + params[0] * d1
    return intersection.astype(np.float32)


def _refine_corners(gray: np.ndarray, corners: np.ndarray, search_radius: int = 50) -> np.ndarray:
    """Refine all 4 corners (placeholder — real refinement is done by _refine_corners_by_edges)."""
    return corners


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

    candidates: list[tuple[float, np.ndarray, int, np.ndarray]] = []  # (area, corners, priority, contour)

    def add_candidate(quad: np.ndarray, contour: np.ndarray = None, priority: int = 0) -> None:
        ordered = order_corners(quad)
        if _is_valid_paper_quad(gray, ordered, img_area, paper_size):
            area = cv2.contourArea(ordered.astype(np.float32))
            if contour is None:
                contour = np.array(ordered, dtype=np.int32).reshape(-1, 1, 2)
            candidates.append((area, ordered, priority, contour))

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
    # quality (closer to expected is better) and edge brightness consistency
    # (paper should be uniformly bright inside the quad, not include dark shadows).
    expected_ar = _expected_aspect_ratio(paper_size)

    def score_candidate(area: float, corners: np.ndarray, priority: int) -> tuple:
        ar = _quad_aspect_ratio(corners)
        ar_err = min(abs(ar / expected_ar - 1.0), abs(ar * expected_ar - 1.0))
        # Check brightness consistency: sample points along each edge and
        # in the interior. A good paper quad has bright, consistent brightness.
        # A quad that includes shadows will have low brightness at edges.
        edge_brightness = _edge_brightness_score(gray, corners)
        # Score = (priority, area * (1 - ar_err * 3) * edge_brightness)
        return (priority, area * max(0.1, 1.0 - ar_err * 3.0) * edge_brightness)

    candidates.sort(key=lambda x: score_candidate(x[0], x[1], x[2]), reverse=True)
    best = candidates[0][1]
    best_contour = candidates[0][3]

    # Refine corners by fitting lines to the contour edges.
    # Only use the refinement if it improves the aspect ratio (makes it closer
    # to the expected paper aspect ratio). This prevents the refinement from
    # making things worse when the contour is noisy.
    refined = _refine_corners_by_edges(gray, best, best_contour)
    if _is_valid_paper_quad(gray, refined, img_area, paper_size):
        expected_ar = _expected_aspect_ratio(paper_size)
        best_ar_err = min(
            abs(_quad_aspect_ratio(best) / expected_ar - 1.0),
            abs(_quad_aspect_ratio(best) * expected_ar - 1.0),
        )
        refined_ar_err = min(
            abs(_quad_aspect_ratio(refined) / expected_ar - 1.0),
            abs(_quad_aspect_ratio(refined) * expected_ar - 1.0),
        )
        # Only use refined if it has better aspect ratio AND similar area
        refined_area = cv2.contourArea(refined.astype(np.float32))
        if refined_ar_err < best_ar_err and refined_area > candidates[0][0] * 0.80:
            best = refined

    # Fix wrong corners using the parallelogram constraint + brightness.
    # If 3 of 4 corners are correct but one is off (e.g., due to a shadow),
    # the parallelogram prediction (BR = TR + BL - TL) gives a better corner.
    # We replace a corner if it's in a dark area (past the paper edge) and
    # the prediction is brighter (on the paper).
    best = _fix_corner_by_parallelogram(gray, best, paper_size)

    # Fix perspective skew using the known paper aspect ratio.
    # When the camera isn't perpendicular to the paper, opposite edges
    # have different lengths. We use the known paper dimensions to correct.
    best = _fix_corners_by_aspect_ratio(best, paper_size)

    return scale_back(best)


def _refine_edges_by_gradient(gray: np.ndarray, corners: np.ndarray) -> np.ndarray:
    """Refine each edge by finding the paper-to-background brightness boundary.

    For each edge, we search perpendicular to the edge (from outside inward)
    for the point where brightness transitions from dark (countertop) to
    bright (paper). This is the actual paper boundary.

    We then recompute corner positions from the refined edge lines.
    """
    ordered = order_corners(corners)
    h_img, w_img = gray.shape

    # Smooth the grayscale image for stable brightness measurements
    smooth = cv2.GaussianBlur(gray, (9, 9), 0)

    # Determine paper brightness from the center of the detected quad
    centroid = ordered.mean(axis=0)
    cx, cy = int(centroid[0]), int(centroid[1])
    r = 20
    paper_brightness = float(smooth[
        max(0, cy - r):min(h_img, cy + r),
        max(0, cx - r):min(w_img, cx + r)
    ].mean())
    # Threshold: 75% of paper brightness is the paper boundary
    brightness_threshold = paper_brightness * 0.75

    lines = []  # Each: (point_on_line, direction)

    for i in range(4):
        p1 = ordered[i]
        p2 = ordered[(i + 1) % 4]
        edge_len = np.linalg.norm(p2 - p1)
        if edge_len < 1e-6:
            lines.append((p1, np.array([1.0, 0.0])))
            continue

        edge_dir = (p2 - p1) / edge_len
        # Normal to edge — points outward (away from paper center)
        normal = np.array([edge_dir[1], -edge_dir[0]])
        mid = (p1 + p2) / 2
        if np.dot(normal, mid - centroid) < 0:
            normal = -normal

        # For each sample point along the edge, search from OUTSIDE IN
        # to find where brightness crosses the threshold (paper boundary).
        # Starting from outside ensures we find the paper edge, not tool edges.
        search_radius = max(int(edge_len * 0.08), 30)
        boundary_pts = []

        for t in np.linspace(0.1, 0.9, 15):
            base_pt = p1 * (1 - t) + p2 * t
            # Search from far outside inward
            found = False
            for d in range(search_radius, -search_radius, -2):
                pt = base_pt + normal * d
                px, py = int(pt[0]), int(pt[1])
                if not (0 <= px < w_img and 0 <= py < h_img):
                    continue
                if float(smooth[py, px]) >= brightness_threshold:
                    boundary_pts.append(pt.copy())
                    found = True
                    break
            if not found:
                # Keep the original position
                boundary_pts.append(base_pt.copy())

        # Use the boundary points to find WHERE the edge is (the center point),
        # but keep the original edge DIRECTION (paper edges are straight).
        boundary_arr = np.array(boundary_pts)
        center_pt = boundary_arr.mean(axis=0)
        lines.append((center_pt, edge_dir))

    # Recompute corners from line intersections.
    # Edges are ordered: [top, right, bottom, left] (edge i goes from corner i to corner (i+1)%4).
    # Corner i is the intersection of edge (i-1)%4 and edge i.
    #   TL (0) = left(3) ∩ top(0)
    #   TR (1) = top(0) ∩ right(1)
    #   BR (2) = right(1) ∩ bottom(2)
    #   BL (3) = bottom(2) ∩ left(3)
    refined = np.zeros((4, 2), dtype=np.float32)
    for i in range(4):
        p1, d1 = lines[(i - 1) % 4]
        p2, d2 = lines[i]
        refined[i] = _line_intersection(p1, d1, p2, d2)

    # Validate: each refined corner should be close to the original
    # (within 20% of the average adjacent edge length).
    # If refinement moved corners too far, it probably found wrong edges.
    for i in range(4):
        e1_len = np.linalg.norm(ordered[(i + 1) % 4] - ordered[i])
        e2_len = np.linalg.norm(ordered[i] - ordered[(i - 1) % 4])
        max_move = min(e1_len, e2_len) * 0.20
        dist = np.linalg.norm(refined[i] - ordered[i])
        if dist > max_move:
            return ordered  # refinement too aggressive, keep original

    return refined


def _fix_corner_by_parallelogram(gray: np.ndarray, corners: np.ndarray, paper_size: str) -> np.ndarray:
    """Fix a wrong corner using the parallelogram constraint and brightness.

    If 3 of 4 corners are correct but one is off (e.g., due to a shadow),
    we compute the 4th corner using the parallelogram assumption:
    BR = TR + (BL - TL). For each corner, if the current corner is in a dark
    area (past the paper edge) and the prediction is brighter (on the paper),
    we use the prediction.
    """
    ordered = order_corners(corners)
    h_img, w_img = gray.shape

    best = ordered.copy()

    for i in range(4):
        TL, TR, BR, BL = ordered[0], ordered[1], ordered[2], ordered[3]
        predictions = [TR + BL - BR, TL + BR - BL, TR + BL - TL, TL + BR - TR]
        predicted = predictions[i]

        def corner_brightness(pt):
            px, py = int(pt[0]), int(pt[1])
            if not (0 <= px < w_img and 0 <= py < h_img):
                return 0.0
            r = 15
            y0, y1 = max(0, py - r), min(h_img, py + r + 1)
            x0, x1 = max(0, px - r), min(w_img, px + r + 1)
            return float(gray[y0:y1, x0:x1].mean())

        curr_b = corner_brightness(ordered[i])
        pred_b = corner_brightness(predicted)

        px, py = int(predicted[0]), int(predicted[1])
        in_bounds = 0 <= px < w_img and 0 <= py < h_img

        if in_bounds and curr_b < 100 and pred_b > curr_b + 15:
            best = best.copy()
            best[i] = predicted

    return best


def _fix_corners_by_aspect_ratio(corners: np.ndarray, paper_size: str) -> np.ndarray:
    """Correct perspective skew using the known paper aspect ratio.

    When the camera isn't perpendicular to the paper, opposite edges
    have different lengths (perspective foreshortening). We use the known
    paper dimensions to detect and correct this.

    Strategy: The longer of two opposite edges is closer to the true length.
    We adjust the shorter edge's corners outward along the edge direction
    to match the longer edge, preserving the known aspect ratio.
    """
    ordered = order_corners(corners)
    TL, TR, BR, BL = ordered[0], ordered[1], ordered[2], ordered[3]

    paper_w_mm, paper_h_mm = PAPER_SIZES_MM[paper_size]
    expected_ar = paper_w_mm / paper_h_mm  # e.g., 0.7727 for Letter

    # Current edge lengths
    top = float(np.linalg.norm(TR - TL))
    bottom = float(np.linalg.norm(BR - BL))
    left = float(np.linalg.norm(BL - TL))
    right = float(np.linalg.norm(BR - TR))

    if top < 1e-6 or bottom < 1e-6 or left < 1e-6 or right < 1e-6:
        return corners

    # Check if opposite edges differ significantly (>3%)
    tb_ratio = max(top, bottom) / min(top, bottom)
    lr_ratio = max(left, right) / min(left, right)

    if tb_ratio < 1.03 and lr_ratio < 1.03:
        # No significant skew — nothing to fix
        return corners

    best = ordered.copy()

    # Correct top/bottom skew: make the shorter edge match the longer
    # by moving the shorter edge's corners outward along the edge direction.
    if tb_ratio >= 1.03:
        if top < bottom:
            # Top is shorter — extend TL and TR outward
            scale = bottom / top
            mid_top = (TL + TR) / 2
            TL_new = mid_top + (TL - mid_top) * scale
            TR_new = mid_top + (TR - mid_top) * scale
            best[0] = TL_new
            best[1] = TR_new
        else:
            # Bottom is shorter — extend BL and BR outward
            scale = top / bottom
            mid_bot = (BL + BR) / 2
            BL_new = mid_bot + (BL - mid_bot) * scale
            BR_new = mid_bot + (BR - mid_bot) * scale
            best[3] = BL_new
            best[2] = BR_new

    # Recompute edges after top/bottom correction
    TL, TR, BR, BL = best[0], best[1], best[2], best[3]
    left = float(np.linalg.norm(BL - TL))
    right = float(np.linalg.norm(BR - TR))

    # Correct left/right skew
    if lr_ratio >= 1.03:
        if left < right:
            scale = right / left
            mid_left = (TL + BL) / 2
            TL_new = mid_left + (TL - mid_left) * scale
            BL_new = mid_left + (BL - mid_left) * scale
            best[0] = TL_new
            best[3] = BL_new
        else:
            scale = left / right
            mid_right = (TR + BR) / 2
            TR_new = mid_right + (TR - mid_right) * scale
            BR_new = mid_right + (BR - mid_right) * scale
            best[1] = TR_new
            best[2] = BR_new

    # Verify the correction improved things
    TL, TR, BR, BL = best[0], best[1], best[2], best[3]
    new_top = float(np.linalg.norm(TR - TL))
    new_bottom = float(np.linalg.norm(BR - BL))
    new_left = float(np.linalg.norm(BL - TL))
    new_right = float(np.linalg.norm(BR - TR))
    new_tb = max(new_top, new_bottom) / min(new_top, new_bottom) if min(new_top, new_bottom) > 0 else 999
    new_lr = max(new_left, new_right) / min(new_left, new_right) if min(new_left, new_right) > 0 else 999

    # Only accept if it improved
    if new_tb <= tb_ratio and new_lr <= lr_ratio:
        return best
    else:
        return corners


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
