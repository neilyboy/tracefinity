"""Debug paper detection on test images.

Saves visualizations of each detection stage so we can see where it fails.
"""
from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, "backend")

from app.cv.paper_detect import (
    PAPER_BRIGHTNESS_RATIO,
    ASPECT_RATIO_TOLERANCE,
    EDGE_MARGIN_FRACTION,
    MIN_AREA_FRACTION,
    MAX_AREA_FRACTION,
    _is_valid_paper_quad,
    _quad_aspect_ratio,
    _expected_aspect_ratio,
    _try_approx_quad,
    order_corners,
    _edge_brightness_score,
)

OUT = Path("debug_out")
OUT.mkdir(exist_ok=True)


def draw_quad(img, quad, color=(0, 255, 0), thickness=3, label=None):
    out = img.copy()
    pts = quad.astype(np.int32).reshape(-1, 1, 2)
    cv2.polylines(out, [pts], True, color, thickness)
    for i, p in enumerate(quad.astype(int)):
        cv2.circle(out, tuple(p), 8, (0, 0, 255), -1)
        cv2.putText(out, str(i), tuple(p + (10, 10)), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 0, 0), 2)
    if label:
        cv2.putText(out, label, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 255), 2)
    return out


def debug_image(path: str, paper_size: str = "letter"):
    name = Path(path).stem
    print(f"\n{'='*60}\nProcessing {path} (paper={paper_size})\n{'='*60}")

    image = cv2.imread(path)
    if image is None:
        print(f"  ERROR: could not read {path}")
        return
    print(f"  Original size: {image.shape}")

    # Downscale like the real code
    max_dim = 1500
    scale_factor = 1.0
    if max(image.shape[:2]) > max_dim:
        scale_factor = max_dim / max(image.shape[:2])
        small = cv2.resize(image, None, fx=scale_factor, fy=scale_factor)
    else:
        small = image
    print(f"  Scaled to: {small.shape} (scale={scale_factor:.4f})")

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray_blur = cv2.GaussianBlur(gray, (5, 5), 0)
    img_area = small.shape[0] * small.shape[1]
    img_mean_brightness = float(gray.mean())
    print(f"  Image mean brightness: {img_mean_brightness:.1f}")
    print(f"  Image area: {img_area}")

    # Histogram of brightness
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).flatten()
    # Find peaks
    top_bright = np.argsort(hist[-50:])[-5:] + 205
    print(f"  Top brightness buckets (205-255): {top_bright}")
    print(f"  Brightness percentiles: 10th={np.percentile(gray,10):.0f} 50th={np.percentile(gray,50):.0f} 90th={np.percentile(gray,90):.0f} 99th={np.percentile(gray,99):.0f}")

    all_candidates = []

    # --- Strategy 1: Bright thresholding ---
    print("\n  --- Strategy 1: Bright thresholding ---")
    for offset in [10, 20, 30, 0, -10, 40, -20, 50, -30, 60]:
        thresh_val = int(img_mean_brightness + offset)
        if thresh_val < 40 or thresh_val > 250:
            continue
        _, bright_mask = cv2.threshold(gray_blur, thresh_val, 255, cv2.THRESH_BINARY)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
        bright_mask = cv2.morphologyEx(bright_mask, cv2.MORPH_CLOSE, kernel, iterations=3)
        bright_mask = cv2.morphologyEx(bright_mask, cv2.MORPH_OPEN, kernel, iterations=1)
        contours, _ = cv2.findContours(bright_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        big = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
        valid = 0
        for c in big:
            area = cv2.contourArea(c)
            quad = _try_approx_quad(c)
            if quad is not None:
                ordered = order_corners(quad)
                valid_quad = _is_valid_paper_quad(gray, ordered, img_area, paper_size)
                if valid_quad:
                    all_candidates.append((area, ordered, 10, c, f"S1_off{offset}"))
                    valid += 1
        print(f"    offset={offset:+d} thresh={thresh_val} contours={len(contours)} big={len(big)} valid_quads={valid} top_area={cv2.contourArea(big[0]) if big else 0:.0f}")
        # Save the mask for the most promising offsets
        if offset in [10, 20, 30, 0, -10]:
            vis = small.copy()
            cv2.drawContours(vis, big, -1, (0, 255, 0), 2)
            cv2.imwrite(str(OUT / f"{name}_s1_off{offset:+d}_mask.png"), bright_mask)
            cv2.imwrite(str(OUT / f"{name}_s1_off{offset:+d}_contours.png"), vis)

    # --- Strategy 2: Canny ---
    print("\n  --- Strategy 2: Canny edges ---")
    for blur_size in [(5, 5), (9, 9)]:
        blurred = cv2.GaussianBlur(gray, blur_size, 0)
        for low, high in [(30, 100), (50, 150), (75, 200)]:
            edges = cv2.Canny(blurred, low, high)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
            edges = cv2.dilate(edges, kernel, iterations=1)
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            big = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
            valid = 0
            for c in big:
                area = cv2.contourArea(c)
                quad = _try_approx_quad(c)
                if quad is not None:
                    ordered = order_corners(quad)
                    if _is_valid_paper_quad(gray, ordered, img_area, paper_size):
                        all_candidates.append((area, ordered, 5, c, f"S2_{low}_{high}"))
                        valid += 1
            print(f"    blur={blur_size} low={low} high={high} contours={len(contours)} valid={valid} top_area={cv2.contourArea(big[0]) if big else 0:.0f}")

    # --- Strategy 3: Adaptive threshold ---
    print("\n  --- Strategy 3: Adaptive threshold ---")
    for block_size in [51, 31, 71]:
        for C_val in [5, 10, 15]:
            bw = cv2.adaptiveThreshold(
                gray_blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY, block_size, C_val,
            )
            contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            big = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
            valid = 0
            for c in big:
                quad = _try_approx_quad(c)
                if quad is not None:
                    ordered = order_corners(quad)
                    if _is_valid_paper_quad(gray, ordered, img_area, paper_size):
                        all_candidates.append((cv2.contourArea(c), ordered, 3, c, f"S3_{block_size}_{C_val}"))
                        valid += 1
            print(f"    block={block_size} C={C_val} contours={len(contours)} valid={valid} top_area={cv2.contourArea(big[0]) if big else 0:.0f}")

    # --- Strategy 4: Otsu ---
    print("\n  --- Strategy 4: Otsu ---")
    _, otsu = cv2.threshold(gray_blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    print(f"    Otsu threshold value: {int(np.unique(otsu[otsu==255]).size)}")
    contours, _ = cv2.findContours(otsu, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    big = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
    valid = 0
    for c in big:
        quad = _try_approx_quad(c)
        if quad is not None:
            ordered = order_corners(quad)
            if _is_valid_paper_quad(gray, ordered, img_area, paper_size):
                all_candidates.append((cv2.contourArea(c), ordered, 3, c, "S4_otsu"))
                valid += 1
    print(f"    contours={len(contours)} valid={valid} top_area={cv2.contourArea(big[0]) if big else 0:.0f}")
    cv2.imwrite(str(OUT / f"{name}_s4_otsu.png"), otsu)

    # --- Strategy 5: Floodfill ---
    print("\n  --- Strategy 5: Floodfill from center ---")
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
    big = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
    valid = 0
    for c in big:
        quad = _try_approx_quad(c)
        if quad is not None:
            ordered = order_corners(quad)
            if _is_valid_paper_quad(gray, ordered, img_area, paper_size):
                all_candidates.append((cv2.contourArea(c), ordered, 3, c, "S5_flood"))
                valid += 1
    print(f"    contours={len(contours)} valid={valid} top_area={cv2.contourArea(big[0]) if big else 0:.0f}")
    cv2.imwrite(str(OUT / f"{name}_s5_flood.png"), flood_mask)

    # --- Summary ---
    print(f"\n  TOTAL VALID CANDIDATES: {len(all_candidates)}")
    if not all_candidates:
        print("  *** NO VALID CANDIDATES FOUND ***")
        # Show the biggest contours from each strategy for debugging
        print("  Saving top contours from each strategy for inspection...")
        # Save the biggest contour from otsu and bright threshold
        for label, mask_img in [("otsu", otsu), ("bright_off20", None)]:
            if mask_img is not None:
                contours, _ = cv2.findContours(mask_img, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                if contours:
                    big = max(contours, key=cv2.contourArea)
                    vis = small.copy()
                    cv2.drawContours(vis, [big], -1, (0, 255, 0), 3)
                    quad = _try_approx_quad(big)
                    if quad is not None:
                        vis = draw_quad(vis, quad, (0, 0, 255), 3, label)
                    cv2.imwrite(str(OUT / f"{name}_topcontour_{label}.png"), vis)
                    # Diagnose why it failed validation
                    ordered = order_corners(quad) if quad is not None else None
                    if ordered is not None:
                        area = cv2.contourArea(ordered.astype(np.float32))
                        print(f"    [{label}] area={area:.0f} ({area/img_area*100:.1f}% of image)")
                        print(f"      min_area={MIN_AREA_FRACTION*img_area:.0f} max_area={MAX_AREA_FRACTION*img_area:.0f}")
                        # Edge margin check
                        h2, w2 = gray.shape
                        mx, my = w2 * EDGE_MARGIN_FRACTION, h2 * EDGE_MARGIN_FRACTION
                        for i in range(4):
                            cx, cy = float(ordered[i][0]), float(ordered[i][1])
                            edge_violation = cx < mx or cx > w2 - mx or cy < my or cy > h2 - my
                            print(f"      corner {i}: ({cx:.0f},{cy:.0f}) edge_violation={edge_violation}")
                        # Brightness
                        from app.cv.paper_detect import _quad_brightness, _quad_outside_brightness
                        ib = _quad_brightness(gray, ordered)
                        ob = _quad_outside_brightness(gray, ordered)
                        print(f"      inside_brightness={ib:.1f} outside_brightness={ob:.1f} ratio={ib/max(ob,1):.3f} (need {PAPER_BRIGHTNESS_RATIO})")
                        # Aspect ratio
                        ar = _quad_aspect_ratio(ordered)
                        ear = _expected_aspect_ratio(paper_size)
                        print(f"      aspect_ratio={ar:.3f} expected={ear:.3f} err1={abs(ar/ear-1):.3f} err2={abs(ar*ear-1):.3f} (tol={ASPECT_RATIO_TOLERANCE})")
        return

    # Sort and show top candidates
    all_candidates.sort(key=lambda x: (x[2], x[0]), reverse=True)
    print("\n  Top candidates:")
    for i, (area, corners, prio, contour, src) in enumerate(all_candidates[:10]):
        ar = _quad_aspect_ratio(corners)
        ear = _expected_aspect_ratio(paper_size)
        ar_err = min(abs(ar/ear-1), abs(ar*ear-1))
        eb = _edge_brightness_score(gray, corners)
        print(f"    #{i} src={src} area={area:.0f} ({area/img_area*100:.1f}%) ar={ar:.3f} ar_err={ar_err:.3f} edge_bright={eb:.3f} prio={prio}")

    # Draw top 5 candidates on the image
    vis = small.copy()
    colors = [(0, 255, 0), (255, 0, 0), (0, 165, 255), (255, 0, 255), (0, 255, 255)]
    for i, (area, corners, prio, contour, src) in enumerate(all_candidates[:5]):
        c = colors[i % len(colors)]
        pts = corners.astype(np.int32).reshape(-1, 1, 2)
        cv2.polylines(vis, [pts], True, c, 3)
        cv2.putText(vis, f"#{i} {src}", (20, 40 + i * 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, c, 2)
    cv2.imwrite(str(OUT / f"{name}_candidates.png"), vis)

    # Also draw the best one large
    best = all_candidates[0]
    vis_best = draw_quad(small, best[1], (0, 255, 0), 5, f"BEST: {best[4]} area={best[0]:.0f}")
    cv2.imwrite(str(OUT / f"{name}_best.png"), vis_best)
    print(f"\n  Best candidate: {best[4]} area={best[0]:.0f}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        debug_image(p)
