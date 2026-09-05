"""Tool outline detection using OpenCV computer vision.

Pipeline:
1. Bilateral filter + Gaussian blur — reduce noise, smooth for thresholding
2. Otsu threshold — separate dark tools from bright paper
3. Morphological close/open — fill small gaps, remove specks
4. Component merging — join split parts of the same tool (e.g., a bright
   metal barrel between dark end caps)
5. GrabCut per component — refine the mask using colour/edge models to
   recover bright reflections and labels
6. Find contours with RETR_TREE — outer outlines + inner holes
7. Hole filtering — keep inner contours that are bright paper (scissors
   finger holes, tape measure cutouts), ignore dark labels
8. Contour smoothing — resample + small Gaussian smooth + approxPolyDP

The smoothing parameter (0.0-1.0) controls how aggressively the outline is
simplified. 0.0 = nearly raw, 0.3 = balanced, 1.0 = very smooth.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Literal

import cv2
import numpy as np

from ..config import settings
from ..schemas import Point, ToolOutline
from ..utils.geometry import polygon_area


TraceEngine = Literal["auto", "hybrid", "fastsam"]
_FASTSAM_MODEL = None


def trace_engine_status() -> list[dict[str, str | bool]]:
    fastsam_importable = _fastsam_importable()
    fastsam_ready = fastsam_importable and _find_fastsam_weights() is not None
    return [
        {"id": "auto", "name": "Auto", "available": True, "ready": True, "description": "Uses FastSAM when its weights are installed, otherwise Hybrid OpenCV."},
        {"id": "hybrid", "name": "Hybrid OpenCV", "available": True, "ready": True, "description": "Fast local tracing with thresholding, component merging, and GrabCut."},
        {"id": "fastsam", "name": "FastSAM", "available": fastsam_importable, "ready": fastsam_ready, "description": "AI-assisted segmentation for reflective tools and difficult boundaries."},
    ]


def resolve_trace_engine(engine: TraceEngine) -> Literal["hybrid", "fastsam"]:
    if engine not in {"auto", "hybrid", "fastsam"}:
        raise ValueError(f"Unknown trace engine: {engine}")
    if engine == "auto":
        return "fastsam" if _find_fastsam_weights() is not None and _fastsam_importable() else "hybrid"
    return engine


def detect_tools(
    rectified: np.ndarray,
    scale_mm_per_px: float,
    smoothing: float = 0.3,
    engine: TraceEngine = "hybrid",
) -> list[ToolOutline]:
    resolved = resolve_trace_engine(engine)
    if resolved == "hybrid":
        return _detect_tools_hybrid(rectified, scale_mm_per_px, smoothing)
    return _detect_tools_fastsam(rectified, scale_mm_per_px, smoothing)


def _detect_tools_hybrid(rectified: np.ndarray, scale_mm_per_px: float, smoothing: float = 0.3) -> list[ToolOutline]:
    """Detect tool outlines in the rectified image.

    Args:
        rectified: top-down image of the paper with tools
        scale_mm_per_px: millimetres per pixel from paper rectification
        smoothing: 0.0 = sharp/polygon, 0.3 = balanced, 1.0 = very smooth
    """
    h, w = rectified.shape[:2]
    min_area_px = settings.min_tool_area_mm2 / (scale_mm_per_px ** 2)
    max_area_px = 0.5 * h * w

    gray, blurred = _preprocess(rectified)

    # Initial Otsu threshold. Shadows may be included, but GrabCut and later
    # morphological/edge steps clean them up for most cases.
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Small close to fill tiny boundary gaps; leave larger holes intact.
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, close_kernel, iterations=1)
    open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, open_kernel, iterations=1)

    # Merge close connected components so tools split by bright reflections
    # (e.g., metal pen barrel between dark caps) become one object.
    merged = _merge_close_components(thresh, min_dist_px=25)

    # Refine each merged component with GrabCut. This recovers bright tool
    # surfaces (metal reflections, coloured labels) that the threshold missed.
    refined = _refine_with_grabcut(rectified, merged, min_area_px)

    # Remove small specks without filling larger holes (like scissors finger holes).
    refined = cv2.morphologyEx(refined, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)

    contours, hierarchy = cv2.findContours(
        refined, cv2.RETR_TREE, cv2.CHAIN_APPROX_TC89_L1
    )
    if hierarchy is None:
        return []

    hierarchy = hierarchy[0]
    parent_to_children: dict[int, list[int]] = {}
    for i, _ in enumerate(contours):
        parent = hierarchy[i][3]
        if parent != -1:
            parent_to_children.setdefault(parent, []).append(i)

    bg_brightness = float(cv2.mean(gray, mask=cv2.bitwise_not(refined))[0])

    outlines: list[ToolOutline] = []
    for i, cnt in enumerate(contours):
        if hierarchy[i][3] != -1:
            continue

        area_px = cv2.contourArea(cnt)
        if area_px < min_area_px or area_px > max_area_px:
            continue

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

        holes_mm = []
        min_hole_area_px = max(20.0, 50.0 / (scale_mm_per_px ** 2))
        for child_idx in parent_to_children.get(i, []):
            child_cnt = contours[child_idx]
            if cv2.contourArea(child_cnt) < min_hole_area_px:
                continue
            hole_mask = np.zeros(gray.shape, dtype=np.uint8)
            cv2.drawContours(hole_mask, [child_cnt], -1, 255, cv2.FILLED)
            hole_brightness = float(cv2.mean(gray, mask=hole_mask)[0])
            # Bright interior = real hole (paper showing through).
            # Dark interior = label/reflection that should remain solid.
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

    outlines = [
        o for o in outlines
        if _is_likely_tool(np.array([[p.x, p.y] for p in o.outer]))
    ]

    return outlines


def _fastsam_importable() -> bool:
    try:
        from ultralytics import FastSAM  # noqa: F401
        return True
    except (ImportError, OSError):
        return False


def _fastsam_weight_candidates() -> list[Path]:
    configured = os.getenv("TRACEFINITY_FASTSAM_MODEL")
    candidates = [Path(configured)] if configured else []
    candidates.extend([
        settings.data_dir / "models" / "FastSAM-s.pt",
        Path.cwd() / "FastSAM-s.pt",
        Path.cwd().parent / "FastSAM-s.pt",
    ])
    return candidates


def _find_fastsam_weights() -> Path | None:
    return next((path for path in _fastsam_weight_candidates() if path.is_file()), None)


def _load_fastsam():
    global _FASTSAM_MODEL
    if _FASTSAM_MODEL is not None:
        return _FASTSAM_MODEL
    try:
        from ultralytics import FastSAM
    except (ImportError, OSError) as exc:
        raise RuntimeError("FastSAM is unavailable. Install compatible CPU torch, torchvision, and ultralytics packages.") from exc
    weights = _find_fastsam_weights()
    if weights is None:
        from ultralytics.utils.downloads import safe_download
        model_dir = settings.data_dir / "models"
        model_dir.mkdir(parents=True, exist_ok=True)
        weights = model_dir / "FastSAM-s.pt"
        safe_download(
            url="https://github.com/ultralytics/assets/releases/download/v8.4.0/FastSAM-s.pt",
            file=weights,
            unzip=False,
            exist_ok=True,
        )
    _FASTSAM_MODEL = FastSAM(str(weights))
    return _FASTSAM_MODEL


def _detect_tools_fastsam(
    rectified: np.ndarray, scale_mm_per_px: float, smoothing: float
) -> list[ToolOutline]:
    hybrid = _detect_tools_hybrid(rectified, scale_mm_per_px, smoothing)
    if not hybrid:
        return []

    model = _load_fastsam()
    try:
        results = model(
            rectified,
            device="cpu",
            retina_masks=True,
            imgsz=1024,
            conf=0.25,
            iou=0.9,
            verbose=False,
        )
    except Exception as exc:
        raise RuntimeError(f"FastSAM inference failed: {exc}") from exc
    if not results or results[0].masks is None:
        return hybrid

    h, w = rectified.shape[:2]
    candidates: list[np.ndarray] = []
    for tensor in results[0].masks.data:
        mask = (tensor.detach().cpu().numpy() > 0.5).astype(np.uint8) * 255
        if mask.shape != (h, w):
            mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)
        area = cv2.countNonZero(mask)
        if area < settings.min_tool_area_mm2 / (scale_mm_per_px ** 2) or area > 0.5 * h * w:
            continue
        candidates.append(mask)

    used: set[int] = set()
    refined: list[ToolOutline] = []
    for outline in hybrid:
        base_mask = _outline_mask(outline, scale_mm_per_px, (h, w))
        base_area = max(1, cv2.countNonZero(base_mask))
        best_idx = -1
        best_score = 0.0
        for idx, mask in enumerate(candidates):
            if idx in used:
                continue
            intersection = cv2.countNonZero(cv2.bitwise_and(base_mask, mask))
            if intersection / base_area < 0.25:
                continue
            union = cv2.countNonZero(cv2.bitwise_or(base_mask, mask))
            score = intersection / max(1, union)
            if score > best_score:
                best_score = score
                best_idx = idx
        if best_idx < 0:
            refined.append(outline)
            continue
        growth = max(3, round(6.0 / scale_mm_per_px))
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (growth * 2 + 1, growth * 2 + 1))
        search_region = cv2.dilate(base_mask, kernel, iterations=1)
        candidate_mask = cv2.bitwise_and(candidates[best_idx], search_region)
        candidate = _tool_outline_from_mask(
            candidate_mask, rectified, scale_mm_per_px, smoothing, outline.id
        )
        if candidate is None:
            refined.append(outline)
            continue
        combined_holes = list(candidate.holes)
        candidate_outer = np.array([[point.x, point.y] for point in candidate.outer], dtype=np.float32)
        existing_centers = [
            np.mean(np.array([[point.x, point.y] for point in hole]), axis=0)
            for hole in combined_holes
        ]
        for hole in outline.holes:
            center = np.mean(np.array([[point.x, point.y] for point in hole]), axis=0)
            if cv2.pointPolygonTest(candidate_outer, (float(center[0]), float(center[1])), False) < 0:
                continue
            if any(np.linalg.norm(center - existing) < 3.0 for existing in existing_centers):
                continue
            combined_holes.append(hole)
            existing_centers.append(center)
        candidate = candidate.model_copy(update={"holes": combined_holes})
        used.add(best_idx)
        refined.append(candidate)

    refined.sort(
        key=lambda o: polygon_area(np.array([[p.x, p.y] for p in o.outer])),
        reverse=True,
    )
    return refined


def _outline_mask(outline: ToolOutline, scale_mm_per_px: float, shape: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    outer = np.array(
        [[round(p.x / scale_mm_per_px), round(p.y / scale_mm_per_px)] for p in outline.outer],
        dtype=np.int32,
    )
    cv2.fillPoly(mask, [outer], 255)
    for hole in outline.holes:
        points = np.array(
            [[round(p.x / scale_mm_per_px), round(p.y / scale_mm_per_px)] for p in hole],
            dtype=np.int32,
        )
        cv2.fillPoly(mask, [points], 0)
    return mask


def _tool_outline_from_mask(
    mask: np.ndarray,
    image: np.ndarray,
    scale_mm_per_px: float,
    smoothing: float,
    outline_id: str,
) -> ToolOutline | None:
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_TC89_L1)
    if hierarchy is None:
        return None
    hierarchy = hierarchy[0]
    top_level = [i for i, item in enumerate(hierarchy) if item[3] == -1]
    if not top_level:
        return None
    outer_idx = max(top_level, key=lambda i: cv2.contourArea(contours[i]))
    outer = _smooth_contour(contours[outer_idx], scale_mm_per_px, smoothing)
    if len(outer) < 3:
        return None
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    background = float(cv2.mean(gray, mask=cv2.bitwise_not(mask))[0])
    min_hole_area = max(20.0, 50.0 / (scale_mm_per_px ** 2))
    holes: list[list[Point]] = []
    for idx, item in enumerate(hierarchy):
        if item[3] != outer_idx or cv2.contourArea(contours[idx]) < min_hole_area:
            continue
        region = np.zeros(mask.shape, dtype=np.uint8)
        cv2.drawContours(region, [contours[idx]], -1, 255, cv2.FILLED)
        if float(cv2.mean(gray, mask=region)[0]) <= background - 30:
            continue
        hole = _smooth_contour(contours[idx], scale_mm_per_px, smoothing)
        if len(hole) >= 3:
            holes.append(hole)
    return ToolOutline(id=outline_id, outer=outer, holes=holes, smoothing=smoothing)


def detect_tool_at_point(
    rectified: np.ndarray, scale_mm_per_px: float,
    click_x: int, click_y: int, smoothing: float = 0.3,
    engine: TraceEngine = "hybrid",
) -> ToolOutline | None:
    """Detect a single tool outline at a clicked point."""
    if engine != "hybrid":
        matches = []
        for outline in detect_tools(rectified, scale_mm_per_px, smoothing, engine):
            contour = np.array(
                [[p.x / scale_mm_per_px, p.y / scale_mm_per_px] for p in outline.outer],
                dtype=np.float32,
            )
            if cv2.pointPolygonTest(contour, (float(click_x), float(click_y)), False) >= 0:
                matches.append(outline)
        return min(
            matches,
            key=lambda outline: abs(polygon_area(np.array([[p.x, p.y] for p in outline.outer]))),
            default=None,
        )

    h, w = rectified.shape[:2]
    min_area_px = settings.min_tool_area_mm2 / (scale_mm_per_px ** 2)

    gray, blurred = _preprocess(rectified)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, close_kernel, iterations=1)
    open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, open_kernel, iterations=1)

    merged = _merge_close_components(thresh, min_dist_px=25)
    refined = _refine_with_grabcut(rectified, merged, min_area_px)
    refined = cv2.morphologyEx(refined, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)

    contours, hierarchy = cv2.findContours(
        refined, cv2.RETR_TREE, cv2.CHAIN_APPROX_TC89_L1
    )
    if not contours or hierarchy is None:
        return None

    hierarchy = hierarchy[0]
    parent_to_children: dict[int, list[int]] = {}
    for i, _ in enumerate(contours):
        parent = hierarchy[i][3]
        if parent != -1:
            parent_to_children.setdefault(parent, []).append(i)

    bg_brightness = float(cv2.mean(gray, mask=cv2.bitwise_not(refined))[0])

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
    min_hole_area_px = max(20.0, 50.0 / (scale_mm_per_px ** 2))
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


def _preprocess(image: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return grayscale and blurred images for thresholding."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    filtered = cv2.bilateralFilter(gray, d=9, sigmaColor=75, sigmaSpace=75)
    blurred = cv2.GaussianBlur(filtered, (15, 15), 0)
    return gray, blurred


def _merge_close_components(mask: np.ndarray, min_dist_px: int = 15) -> np.ndarray:
    """Merge connected components that are within min_dist_px of each other."""
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
        mask, connectivity=8
    )
    if num_labels <= 2:
        return mask

    new_mask = np.zeros_like(mask)
    used = set()
    struct = np.ones((min_dist_px * 2 + 1, min_dist_px * 2 + 1), np.uint8)

    for i in range(1, num_labels):
        if i in used:
            continue
        comp = (labels == i).astype(np.uint8) * 255
        dilated = cv2.dilate(comp, struct, iterations=1)
        group = [i]
        used.add(i)
        for j in range(i + 1, num_labels):
            if j in used:
                continue
            if np.any((labels == j) & (dilated > 0)):
                group.append(j)
                used.add(j)
        for gid in group:
            new_mask[labels == gid] = 255
    return new_mask


def _refine_with_grabcut(
    image: np.ndarray, merged_mask: np.ndarray, min_area_px: float
) -> np.ndarray:
    """Refine each connected component with GrabCut."""
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
        merged_mask, connectivity=8
    )
    refined = np.zeros_like(merged_mask)
    h, w = image.shape[:2]

    for label_id in range(1, num_labels):
        area = stats[label_id, cv2.CC_STAT_AREA]
        if area < 50:
            continue
        comp_mask = (labels == label_id).astype(np.uint8) * 255
        if area < min_area_px:
            refined[comp_mask > 0] = 255
            continue

        refined_mask = _grabcut_refine_component(image, comp_mask)
        refined[refined_mask > 0] = 255
    return refined


def _grabcut_refine_component(image: np.ndarray, init_mask: np.ndarray, iterations: int = 5) -> np.ndarray:
    """Refine a single binary mask using GrabCut.

    Finds inner contours of init_mask (e.g., scissors finger holes) and
    explicitly marks them as sure background so GrabCut doesn't fill them.
    """
    h, w = image.shape[:2]
    if cv2.countNonZero(init_mask) == 0:
        return init_mask

    sure_fg = cv2.erode(init_mask, np.ones((5, 5), np.uint8), iterations=2)
    ys, xs = np.where(init_mask > 0)
    x1, y1, x2, y2 = xs.min(), ys.min(), xs.max(), ys.max()
    margin = 25
    x1 = max(0, x1 - margin)
    y1 = max(0, y1 - margin)
    x2 = min(w, x2 + margin)
    y2 = min(h, y2 + margin)

    # Identify holes in the initial mask so GrabCut preserves them.
    hole_mask = np.zeros_like(init_mask)
    contours, hierarchy = cv2.findContours(
        init_mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE
    )
    if hierarchy is not None:
        hierarchy = hierarchy[0]
        for i, _ in enumerate(contours):
            if hierarchy[i][3] != -1:  # child contour = hole
                cv2.drawContours(hole_mask, [contours[i]], -1, 255, cv2.FILLED)

    mask = np.full((h, w), cv2.GC_PR_BGD, dtype=np.uint8)
    mask_bg = np.ones((h, w), dtype=np.uint8) * 255
    mask_bg[y1:y2, x1:x2] = 0
    mask[mask_bg > 0] = cv2.GC_BGD
    # Holes inside the component are sure background
    mask[hole_mask > 0] = cv2.GC_BGD
    mask[init_mask > 0] = cv2.GC_PR_FGD
    mask[sure_fg > 0] = cv2.GC_FGD

    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(image, mask, None, bgd, fgd, iterCount=iterations, mode=cv2.GC_INIT_WITH_MASK)
    return np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)


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
    """Smooth and simplify a contour for clean output.

    Resample to evenly-spaced points, apply a small Gaussian smooth to
    remove pixel-level jaggedness, then run approxPolyDP to keep corners
    sharp. The smoothing parameter controls the final simplification.
    """
    pts_px = cnt.reshape(-1, 2).astype(np.float64)
    if len(pts_px) < 3:
        return []

    # Resample to a high resolution to get even point spacing.
    pts_px = _resample_contour(pts_px, num_points=max(400, len(pts_px)))

    # Small Gaussian smooth to remove jagged mask edges.
    # sigma_mm is 0.2 to 1.5 mm depending on smoothing.
    if smoothing > 0:
        sigma_mm = 0.2 + smoothing * 1.3
        pts_px = _gaussian_smooth_2d(pts_px, sigma_mm / scale_mm_per_px)

    # Convert to mm for simplification.
    pts_mm = pts_px * scale_mm_per_px

    # approxPolyDP with epsilon scaled by smoothing.
    max_deviation = 0.0001 + smoothing * 0.005
    arc_len = cv2.arcLength(pts_mm.astype(np.float32), True)
    epsilon = max_deviation * arc_len
    simplified = cv2.approxPolyDP(pts_mm.astype(np.float32), epsilon, True).reshape(-1, 2)

    simplified = _remove_close_points(simplified, min_dist_mm=0.5)

    target_max = settings.max_outline_vertices
    if len(simplified) > target_max:
        ratio = len(simplified) / target_max
        epsilon *= ratio * 1.2
        simplified = cv2.approxPolyDP(pts_mm.astype(np.float32), epsilon, True).reshape(-1, 2)
        simplified = _remove_close_points(simplified, min_dist_mm=0.5)

    if len(simplified) < 3:
        return []

    return [Point(x=round(float(p[0]), 2), y=round(float(p[1]), 2)) for p in simplified]


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


def _gaussian_smooth_2d(pts: np.ndarray, sigma_px: float) -> np.ndarray:
    """Gaussian smooth a closed 2D point sequence."""
    if len(pts) < 3 or sigma_px <= 0.5:
        return pts
    radius = max(2, int(sigma_px * 3))
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    kernel = np.exp(-(x ** 2) / (2 * sigma_px ** 2))
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
        if np.linalg.norm(pts[i] - result[-1]) >= min_dist_mm:
            result.append(pts[i])
    if len(result) > 1:
        dist = np.linalg.norm(result[-1] - result[0])
        if dist < min_dist_mm:
            result = result[:-1]
    out = np.array(result, dtype=np.float64)
    if len(out) < 3:
        return pts
    return out


def merge_tool_outlines(outlines: list[ToolOutline]) -> ToolOutline:
    if len(outlines) < 2:
        raise ValueError("Select at least two outlines to merge.")
    if any(len(outline.outer) < 3 for outline in outlines):
        raise ValueError("Every selected outline must contain at least three points.")
    all_points = [point for outline in outlines for path in [outline.outer, *outline.holes] for point in path]
    min_x = min(point.x for point in all_points) - 3
    min_y = min(point.y for point in all_points) - 3
    max_x = max(point.x for point in all_points) + 3
    max_y = max(point.y for point in all_points) + 3
    resolution = 5.0
    width = max(1, round((max_x - min_x) * resolution))
    height = max(1, round((max_y - min_y) * resolution))
    if width > 5000 or height > 5000:
        raise ValueError("Outline coordinates exceed the supported editing area.")
    mask = np.zeros((height, width), dtype=np.uint8)

    def pixels(path: list[Point]) -> np.ndarray:
        return np.array(
            [[round((point.x - min_x) * resolution), round((point.y - min_y) * resolution)] for point in path],
            dtype=np.int32,
        )

    for outline in outlines:
        cv2.fillPoly(mask, [pixels(outline.outer)], 255)
        for hole in outline.holes:
            cv2.fillPoly(mask, [pixels(hole)], 0)

    bridge = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, bridge, iterations=1)
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_TC89_L1)
    if hierarchy is None:
        raise ValueError("The selected outlines could not be merged.")
    hierarchy = hierarchy[0]
    top = [index for index, item in enumerate(hierarchy) if item[3] == -1 and cv2.contourArea(contours[index]) > 25]
    if len(top) != 1:
        raise ValueError("The selected outlines are too far apart to merge. Move them within 4 mm and try again.")

    def points(contour: np.ndarray) -> list[Point]:
        raw = contour.reshape(-1, 2).astype(np.float32)
        simplified = cv2.approxPolyDP(raw, 1.0, True).reshape(-1, 2)
        return [
            Point(x=round(float(point[0] / resolution + min_x), 2), y=round(float(point[1] / resolution + min_y), 2))
            for point in simplified
        ]

    outer_index = top[0]
    holes = [
        points(contours[index])
        for index, item in enumerate(hierarchy)
        if item[3] == outer_index and cv2.contourArea(contours[index]) > 25
    ]
    return outlines[0].model_copy(
        update={"id": str(uuid.uuid4())[:8], "outer": points(contours[outer_index]), "holes": holes}
    )


def split_tool_outline(
    outline: ToolOutline, start: Point, end: Point, gap_mm: float = 1.0
) -> list[ToolOutline]:
    if len(outline.outer) < 3:
        raise ValueError("The outline must contain at least three points.")
    if not 0.1 <= gap_mm <= 5.0:
        raise ValueError("Cut width must be between 0.1 and 5 mm.")
    all_points = [point for path in [outline.outer, *outline.holes] for point in path]
    min_x = min([point.x for point in all_points] + [start.x, end.x]) - 3
    min_y = min([point.y for point in all_points] + [start.y, end.y]) - 3
    max_x = max([point.x for point in all_points] + [start.x, end.x]) + 3
    max_y = max([point.y for point in all_points] + [start.y, end.y]) + 3
    resolution = 5.0
    width = max(1, round((max_x - min_x) * resolution))
    height = max(1, round((max_y - min_y) * resolution))
    if width > 5000 or height > 5000:
        raise ValueError("Outline coordinates exceed the supported editing area.")
    mask = np.zeros((height, width), dtype=np.uint8)

    def pixels(path: list[Point]) -> np.ndarray:
        return np.array(
            [[round((point.x - min_x) * resolution), round((point.y - min_y) * resolution)] for point in path],
            dtype=np.int32,
        )

    cv2.fillPoly(mask, [pixels(outline.outer)], 255)
    for hole in outline.holes:
        cv2.fillPoly(mask, [pixels(hole)], 0)
    start_px = (round((start.x - min_x) * resolution), round((start.y - min_y) * resolution))
    end_px = (round((end.x - min_x) * resolution), round((end.y - min_y) * resolution))
    cv2.line(mask, start_px, end_px, 0, max(2, round(gap_mm * resolution)))

    contours, hierarchy = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_TC89_L1)
    if hierarchy is None:
        raise ValueError("The cut line did not split the outline.")
    hierarchy = hierarchy[0]
    top = [index for index, item in enumerate(hierarchy) if item[3] == -1 and cv2.contourArea(contours[index]) > 25]
    if len(top) < 2:
        raise ValueError("Draw the cut line completely across the tool outline.")

    def points(contour: np.ndarray) -> list[Point]:
        simplified = cv2.approxPolyDP(contour.reshape(-1, 2).astype(np.float32), 1.0, True).reshape(-1, 2)
        return [
            Point(x=round(float(point[0] / resolution + min_x), 2), y=round(float(point[1] / resolution + min_y), 2))
            for point in simplified
        ]

    result = []
    for outer_index in top:
        holes = [
            points(contours[index])
            for index, item in enumerate(hierarchy)
            if item[3] == outer_index and cv2.contourArea(contours[index]) > 25
        ]
        result.append(outline.model_copy(update={
            "id": str(uuid.uuid4())[:8],
            "outer": points(contours[outer_index]),
            "holes": holes,
        }))
    result.sort(key=lambda item: abs(polygon_area(np.array([[p.x, p.y] for p in item.outer]))), reverse=True)
    return result


def auto_rotate_angle(outer: list[Point]) -> float:
    """Find the rotation angle that minimizes the bounding box area."""
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
