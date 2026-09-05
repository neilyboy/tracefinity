"""Debug the full detect_paper_quad pipeline stage by stage.

Prints corner coordinates at each step so we can see where refinement goes wrong.
Also saves annotated images at each stage.
"""
from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, "backend")

from app.cv.paper_detect import (
    detect_paper_quad,
    order_corners,
    _quad_aspect_ratio,
    _expected_aspect_ratio,
    _is_valid_paper_quad,
    _refine_corners_by_edges,
    _fix_corner_by_parallelogram,
    _fix_corners_by_aspect_ratio,
    _edge_brightness_score,
    _quad_brightness,
    _quad_outside_brightness,
)

OUT = Path("debug_out")
OUT.mkdir(exist_ok=True)


def draw_quad(img, quad, color=(0, 255, 0), thickness=3, label=None):
    out = img.copy()
    pts = quad.astype(np.int32).reshape(-1, 1, 2)
    cv2.polylines(out, [pts], True, color, thickness)
    labels = ["TL", "TR", "BR", "BL"]
    for i, p in enumerate(quad.astype(int)):
        cv2.circle(out, tuple(p), 10, (0, 0, 255), -1)
        cv2.putText(out, f"{labels[i]}({p[0]},{p[1]})", (p[0]+15, p[1]+15),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 0), 2)
    if label:
        cv2.putText(out, label, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, color, 3)
    return out


def analyze_quad(gray, quad, img_area, paper_size, label=""):
    ordered = order_corners(quad)
    area = cv2.contourArea(ordered.astype(np.float32))
    ar = _quad_aspect_ratio(ordered)
    ear = _expected_aspect_ratio(paper_size)
    ar_err = min(abs(ar/ear-1), abs(ar*ear-1))
    ib = _quad_brightness(gray, ordered)
    ob = _quad_outside_brightness(gray, ordered)
    eb = _edge_brightness_score(gray, ordered)
    valid = _is_valid_paper_quad(gray, ordered, img_area, paper_size)
    h, w = gray.shape

    print(f"\n  [{label}]")
    print(f"    Corners (TL,TR,BR,BL):")
    for i, name in enumerate(["TL", "TR", "BR", "BL"]):
        cx, cy = float(ordered[i][0]), float(ordered[i][1])
        edge = cx < w*0.02 or cx > w*0.98 or cy < h*0.02 or cy > h*0.98
        print(f"      {name}: ({cx:.1f}, {cy:.1f})  near_edge={edge}")
    print(f"    Area: {area:.0f} ({area/img_area*100:.1f}% of image)")
    print(f"    Aspect ratio: {ar:.4f} (expected {ear:.4f}, err={ar_err:.4f})")
    print(f"    Brightness: inside={ib:.1f} outside={ob:.1f} ratio={ib/max(ob,1):.3f}")
    print(f"    Edge brightness score: {eb:.3f}")
    print(f"    Valid: {valid}")

    # Edge lengths
    for i in range(4):
        j = (i+1) % 4
        names = ["TL-TR", "TR-BR", "BR-BL", "BL-TL"]
        d = np.linalg.norm(ordered[j] - ordered[i])
        print(f"    Edge {names[i]}: {d:.1f}px")

    return ordered


def debug_full(path: str, paper_size: str = "letter"):
    name = Path(path).stem
    print(f"\n{'='*70}\nFull pipeline debug: {path}\n{'='*70}")

    image = cv2.imread(path)
    if image is None:
        print(f"  ERROR: could not read {path}")
        return

    # Downscale
    max_dim = 1500
    scale_factor = 1.0
    if max(image.shape[:2]) > max_dim:
        scale_factor = max_dim / max(image.shape[:2])
        small = cv2.resize(image, None, fx=scale_factor, fy=scale_factor)
    else:
        small = image

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    img_area = small.shape[0] * small.shape[1]

    # Run the actual detection
    print("\n  >>> Running detect_paper_quad()...")
    final = detect_paper_quad(image, paper_size)
    if final is None:
        print("  *** detect_paper_quad returned None ***")
        return

    # Scale final back to small image coords for comparison
    final_small = final * scale_factor
    print(f"\n  FINAL RESULT (scaled to {small.shape}):")
    analyze_quad(gray, final_small, img_area, paper_size, "FINAL")
    cv2.imwrite(str(OUT / f"{name}_FINAL.png"), draw_quad(small, final_small, (0, 255, 0), 5, "FINAL"))

    # Now let's manually run the pipeline to see intermediate stages
    # We need to replicate the internal logic to get the best candidate before refinement
    gray_blur = cv2.GaussianBlur(gray, (5, 5), 0)
    img_mean_brightness = float(gray.mean())

    candidates = []

    def add_candidate(quad, contour=None, priority=0):
        ordered = order_corners(quad)
        if _is_valid_paper_quad(gray, ordered, img_area, paper_size):
            area = cv2.contourArea(ordered.astype(np.float32))
            if contour is None:
                contour = np.array(ordered, dtype=np.int32).reshape(-1, 1, 2)
            candidates.append((area, ordered, priority, contour))

    from app.cv.paper_detect import _try_approx_quad

    # Strategy 1
    for offset in [10, 20, 30, 0, -10, 40, -20, 50, -30, 60]:
        thresh_val = int(img_mean_brightness + offset)
        if thresh_val < 40 or thresh_val > 250:
            continue
        _, bright_mask = cv2.threshold(gray_blur, thresh_val, 255, cv2.THRESH_BINARY)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
        bright_mask = cv2.morphologyEx(bright_mask, cv2.MORPH_CLOSE, kernel, iterations=3)
        bright_mask = cv2.morphologyEx(bright_mask, cv2.MORPH_OPEN, kernel, iterations=1)
        contours, _ = cv2.findContours(bright_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
            quad = _try_approx_quad(c)
            if quad is not None:
                add_candidate(quad, priority=10)

    # Strategy 2
    for blur_size in [(5, 5), (9, 9)]:
        blurred = cv2.GaussianBlur(gray, blur_size, 0)
        for low, high in [(30, 100), (50, 150), (75, 200)]:
            edges = cv2.Canny(blurred, low, high)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
            edges = cv2.dilate(edges, kernel, iterations=1)
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for c in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
                quad = _try_approx_quad(c)
                if quad is not None:
                    add_candidate(quad)

    # Strategy 3
    for block_size in [51, 31, 71]:
        for C_val in [5, 10, 15]:
            bw = cv2.adaptiveThreshold(
                gray_blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY, block_size, C_val,
            )
            contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for c in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
                quad = _try_approx_quad(c)
                if quad is not None:
                    add_candidate(quad)

    # Strategy 4
    _, otsu = cv2.threshold(gray_blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(otsu, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
        quad = _try_approx_quad(c)
        if quad is not None:
            add_candidate(quad)

    # Strategy 5
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
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
        quad = _try_approx_quad(c)
        if quad is not None:
            add_candidate(quad)

    if not candidates:
        print("  No candidates found in manual run")
        return

    # Score and sort like the real code
    expected_ar = _expected_aspect_ratio(paper_size)

    def score_candidate(area, corners, priority):
        ar = _quad_aspect_ratio(corners)
        ar_err = min(abs(ar / expected_ar - 1.0), abs(ar * expected_ar - 1.0))
        edge_brightness = _edge_brightness_score(gray, corners)
        return (priority, area * max(0.1, 1.0 - ar_err * 3.0) * edge_brightness)

    candidates.sort(key=lambda x: score_candidate(x[0], x[1], x[2]), reverse=True)
    best = candidates[0][1]
    best_contour = candidates[0][3]

    print(f"\n  STAGE 1: Best candidate (before refinement)")
    analyze_quad(gray, best, img_area, paper_size, "BEST_INITIAL")
    cv2.imwrite(str(OUT / f"{name}_stage1_initial.png"), draw_quad(small, best, (0, 255, 0), 4, "STAGE 1: Initial"))

    # Stage 2: Refine by edges
    refined = _refine_corners_by_edges(gray, best, best_contour)
    print(f"\n  STAGE 2: After _refine_corners_by_edges")
    analyze_quad(gray, refined, img_area, paper_size, "REFINED_EDGES")
    cv2.imwrite(str(OUT / f"{name}_stage2_refined.png"), draw_quad(small, refined, (255, 165, 0), 4, "STAGE 2: Edge Refined"))

    # Check if refinement was accepted
    if _is_valid_paper_quad(gray, refined, img_area, paper_size):
        best_ar_err = min(abs(_quad_aspect_ratio(best)/expected_ar-1), abs(_quad_aspect_ratio(best)*expected_ar-1))
        refined_ar_err = min(abs(_quad_aspect_ratio(refined)/expected_ar-1), abs(_quad_aspect_ratio(refined)*expected_ar-1))
        refined_area = cv2.contourArea(refined.astype(np.float32))
        accepted = refined_ar_err < best_ar_err and refined_area > candidates[0][0] * 0.80
        print(f"    Refinement accepted: {accepted} (ar_err: {best_ar_err:.4f} -> {refined_ar_err:.4f}, area: {candidates[0][0]:.0f} -> {refined_area:.0f})")
        if accepted:
            best = refined
    else:
        print(f"    Refined quad failed validation, keeping original")

    # Stage 3: Fix by parallelogram
    after_para = _fix_corner_by_parallelogram(gray, best, paper_size)
    print(f"\n  STAGE 3: After _fix_corner_by_parallelogram")
    analyze_quad(gray, after_para, img_area, paper_size, "PARALLELOGRAM")
    cv2.imwrite(str(OUT / f"{name}_stage3_parallelogram.png"), draw_quad(small, after_para, (255, 0, 255), 4, "STAGE 3: Parallelogram Fix"))
    best = after_para

    # Stage 4: Fix by aspect ratio
    after_ar = _fix_corners_by_aspect_ratio(best, paper_size)
    print(f"\n  STAGE 4: After _fix_corners_by_aspect_ratio")
    analyze_quad(gray, after_ar, img_area, paper_size, "ASPECT_FIX")
    cv2.imwrite(str(OUT / f"{name}_stage4_aspectfix.png"), draw_quad(small, after_ar, (0, 0, 255), 4, "STAGE 4: Aspect Fix"))
    best = after_ar

    print(f"\n  COMPARISON: Initial vs Final (in small image coords)")
    print(f"    Initial: {order_corners(candidates[0][1]).tolist()}")
    print(f"    Final:   {order_corners(best).tolist()}")
    print(f"    detect_paper_quad output (scaled): {order_corners(final_small).tolist()}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        debug_full(p)
