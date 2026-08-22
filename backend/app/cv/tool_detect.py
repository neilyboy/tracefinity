"""Tool outline detection using FastSAM AI segmentation.

Uses the Fast Segment Anything Model (FastSAM) based on YOLOv8-seg to
detect tool outlines. This produces much smoother, more accurate outlines
than threshold-based methods, and doesn't miss tools with poor contrast.

The pipeline:
1. Run FastSAM on the rectified image to get all object masks
2. Filter masks to tool-sized ones (not background/paper)
3. Merge overlapping/adjacent masks (FastSAM sometimes splits one tool)
4. Extract contours with morphological smoothing
5. Apply Catmull-Rom spline for smooth, rounded outlines
"""
from __future__ import annotations

import uuid

import cv2
import numpy as np

from ..config import settings
from ..schemas import Point, ToolOutline
from ..utils.geometry import polygon_area

# Lazy-loaded model instance
_fastsam_model = None


def _get_model():
    """Lazy-load the FastSAM model (only once)."""
    global _fastsam_model
    if _fastsam_model is None:
        import os
        from ultralytics import FastSAM
        # Look for model in data dir, or let ultralytics auto-download
        model_path = os.path.join(settings.data_dir, "FastSAM-s.pt")
        if os.path.exists(model_path):
            _fastsam_model = FastSAM(model_path)
        else:
            _fastsam_model = FastSAM("FastSAM-s.pt")  # auto-downloads
    return _fastsam_model


def detect_tools(rectified: np.ndarray, scale_mm_per_px: float) -> list[ToolOutline]:
    """Detect tool outlines in the rectified image using FastSAM.

    Tools are detected via AI segmentation, not thresholding. This produces
    smooth, accurate outlines and doesn't miss tools with poor contrast.
    """
    h, w = rectified.shape[:2]

    # Step 1: Run FastSAM inference
    # imgsz=1536 gives higher-resolution masks with smoother boundaries
    model = _get_model()
    results = model(
        rectified,
        device="cpu",
        retina_masks=True,
        imgsz=1536,
        conf=0.25,
        iou=0.7,
    )
    masks = results[0].masks.data
    if len(masks) == 0:
        return []

    # Step 2: Filter to tool-sized masks
    min_area_px = settings.min_tool_area_mm2 / (scale_mm_per_px ** 2)
    max_area_px = 0.25 * h * w  # exclude background/paper

    # Paper dimensions in mm — reject masks close to paper size
    paper_w_mm = rectified.shape[1] * scale_mm_per_px
    paper_h_mm = rectified.shape[0] * scale_mm_per_px

    tool_masks = []
    for mask in masks:
        mask_np = mask.cpu().numpy()
        area_px = int(mask_np.sum())
        if area_px < min_area_px or area_px > max_area_px:
            continue
        # Check dimensions — reject shadows
        ys, xs = np.where(mask_np > 0)
        if len(xs) == 0:
            continue
        w_mm = (xs.max() - xs.min()) * scale_mm_per_px
        h_mm = (ys.max() - ys.min()) * scale_mm_per_px
        if min(w_mm, h_mm) < 3.0:
            continue
        # Reject wide thin streaks (shadows along paper edges)
        if w_mm > 100 and h_mm < 15:
            continue
        # Reject masks that are too large (likely the paper itself)
        # Tools should be smaller than 60% of the paper in either dimension
        if w_mm > paper_w_mm * 0.6 or h_mm > paper_h_mm * 0.6:
            continue
        # FastSAM "better_quality" morphological smoothing:
        # Close fills small holes, open removes small bumps.
        # This produces much smoother mask boundaries before contour extraction.
        mask_np = cv2.morphologyEx(mask_np.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        mask_np = cv2.morphologyEx(mask_np, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        tool_masks.append(mask_np)

    if not tool_masks:
        return []

    # Step 3: Merge overlapping/adjacent masks.
    # FastSAM sometimes splits one tool into multiple pieces.
    # We group masks by overlap, then union each group.
    merged_masks = _merge_overlapping_masks(tool_masks, scale_mm_per_px)

    # Step 3b: Post-merge filter — reject any merged mask that's too large
    # (merging can combine separate tools into one big blob)
    paper_w_mm = w * scale_mm_per_px
    paper_h_mm = h * scale_mm_per_px
    merged_masks = [
        m for m in merged_masks
        if not (
            (np.where(m > 0)[1].max() - np.where(m > 0)[1].min()) * scale_mm_per_px > paper_w_mm * 0.6
            or (np.where(m > 0)[0].max() - np.where(m > 0)[0].min()) * scale_mm_per_px > paper_h_mm * 0.6
        )
    ]

    # Step 3b: Combine merged masks into one binary image for contour extraction.
    combined = np.zeros((h, w), dtype=np.uint8)
    for mask in merged_masks:
        combined = np.maximum(combined, mask)

    # Step 4: Morphological rounding for smooth shapes.
    # Dilate then erode with a circular kernel rounds all corners.
    round_radius = max(3, int(2.0 / scale_mm_per_px))
    round_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (round_radius * 2 + 1, round_radius * 2 + 1))
    combined = cv2.dilate(combined, round_kernel, iterations=1)
    combined = cv2.erode(combined, round_kernel, iterations=1)

    # Step 5: Extract contours
    contours, hierarchy = cv2.findContours(combined, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return []

    hierarchy = hierarchy[0]
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

        # Find holes
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

    # Filter out thin/slender detections
    outlines = [
        o for o in outlines
        if _is_likely_tool(np.array([[p.x, p.y] for p in o.outer]))
    ]

    return outlines


def _merge_overlapping_masks(masks: list[np.ndarray], scale_mm_per_px: float) -> list[np.ndarray]:
    """Merge masks that overlap significantly or are very close together.

    FastSAM sometimes splits one tool into multiple pieces. We group masks
    that have >10% IoU overlap or are within 5mm of each other, then union
    each group into a single mask.
    """
    if len(masks) <= 1:
        return [m.astype(np.uint8) for m in masks]

    # Convert masks to uint8
    masks = [(m > 0).astype(np.uint8) for m in masks]

    # Compute bounding boxes for all masks
    bboxes = []
    for m in masks:
        ys, xs = np.where(m > 0)
        if len(xs) == 0:
            bboxes.append(None)
            continue
        bboxes.append((xs.min(), ys.min(), xs.max(), ys.max()))

    # Build groups using union-find
    n = len(masks)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        px, py = find(x), find(y)
        if px != py:
            parent[px] = py

    # Check all pairs for overlap or proximity
    merge_dist_px = int(2.0 / scale_mm_per_px)  # 2mm gap threshold (tight)
    for i in range(n):
        if bboxes[i] is None:
            continue
        for j in range(i + 1, n):
            if bboxes[j] is None:
                continue
            # Check bounding box proximity
            ix1, iy1, ix2, iy2 = bboxes[i]
            jx1, jy1, jx2, jy2 = bboxes[j]
            # Expand boxes by merge_dist and check intersection
            if (ix1 - merge_dist_px < jx2 and jx1 - merge_dist_px < ix2 and
                iy1 - merge_dist_px < jy2 and jy1 - merge_dist_px < iy2):
                # Check actual mask overlap — only merge if significant overlap
                # (not just touching). This prevents separate tools from merging.
                intersection = int(np.sum(masks[i] & masks[j]))
                min_area = min(int(masks[i].sum()), int(masks[j].sum()))
                overlap_ratio = intersection / max(min_area, 1)
                if overlap_ratio > 0.15:  # at least 15% of the smaller mask overlaps
                    union(i, j)

    # Union masks in each group
    groups = {}
    for i in range(n):
        root = find(i)
        if root not in groups:
            groups[root] = []
        groups[root].append(i)

    merged = []
    for members in groups.values():
        combined = np.zeros_like(masks[0])
        for idx in members:
            combined = combined | masks[idx]
        merged.append(combined)

    return merged


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
       This preserves shape better than uniform DP simplification.
    4. The frontend renders smooth bezier curves through these points.
    """
    target_max = settings.max_outline_vertices

    pts_px = cnt.reshape(-1, 2).astype(np.float64)
    if len(pts_px) < 3:
        return []

    # Resample to high density for smooth Gaussian smoothing
    pts_px = _resample_contour(pts_px, num_points=max(500, len(pts_px)))

    # Gaussian smooth — removes per-pixel jaggedness from the mask boundary.
    # sigma=3.0 in pixel space gives smooth curves without losing shape details.
    pts_px = _gaussian_smooth_2d(pts_px, sigma=3.0)

    # Convert to mm
    pts_mm = pts_px * scale_mm_per_px

    # Curvature-based simplification: keep points where curvature is high
    # (corners, curves) and decimate where curvature is low (straight edges).
    # This gives smooth curves with fewer points on straight sections.
    target_pts = min(target_max, max(24, len(pts_mm) // 8))
    pts_mm = _simplify_by_curvature(pts_mm, target_pts=target_pts)

    # Remove any points that ended up too close together
    pts_mm = _remove_close_points(pts_mm, min_dist_mm=0.5)

    return [Point(x=round(float(p[0]), 2), y=round(float(p[1]), 2)) for p in pts_mm]


def _simplify_by_curvature(pts: np.ndarray, target_pts: int) -> np.ndarray:
    """Simplify a closed contour by keeping high-curvature points.

    Points where the outline curves sharply (corners, rounded ends) are
    kept. Points on straight sections are decimated. This preserves the
    shape's character better than uniform simplification.

    A fraction of evenly-spaced points is also kept to maintain shape
    on long straight edges.
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
        # Normalized dot product gives cosine of angle change
        cos_angle = np.dot(v1, v2) / (len1 * len2)
        cos_angle = np.clip(cos_angle, -1, 1)
        curvatures[i] = 1.0 - cos_angle  # 0 = straight, 2 = sharp turn

    # Select points: 70% by highest curvature, 30% evenly spaced
    n_by_curv = int(target_pts * 0.7)
    n_even = target_pts - n_by_curv

    # Top curvature points
    high_curv_idx = set(np.argsort(curvatures)[-n_by_curv:].tolist())
    # Evenly spaced points (for straight edge coverage)
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


def _catmull_rom_closed(pts: np.ndarray, subdivisions: int = 8) -> np.ndarray:
    """Catmull-Rom spline interpolation for a closed curve."""
    n = len(pts)
    if n < 4:
        return pts
    result = []
    for i in range(n):
        p0 = pts[(i - 1) % n]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n]
        for j in range(subdivisions):
            t = j / subdivisions
            t2 = t * t
            t3 = t2 * t
            x = 0.5 * (
                (2 * p1[0]) + (-p0[0] + p2[0]) * t +
                (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
            )
            y = 0.5 * (
                (2 * p1[1]) + (-p0[1] + p2[1]) * t +
                (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
            )
            result.append([x, y])
    return np.array(result, dtype=np.float64)


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
