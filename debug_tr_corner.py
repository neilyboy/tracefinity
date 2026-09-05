"""Debug the top-right corner specifically.

Examines brightness profiles along the top and right edges to understand
why the TR corner is being placed incorrectly.
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
    _refine_edges_by_brightness_scan,
)

OUT = Path("debug_out")
OUT.mkdir(exist_ok=True)


def debug_tr_corner(path: str, paper_size: str = "letter"):
    name = Path(path).stem
    print(f"\n{'='*70}\nTop-right corner debug: {path}\n{'='*70}")

    image = cv2.imread(path)
    max_dim = 1500
    scale_factor = 1.0
    if max(image.shape[:2]) > max_dim:
        scale_factor = max_dim / max(image.shape[:2])
        small = cv2.resize(image, None, fx=scale_factor, fy=scale_factor)
    else:
        small = image

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    smooth = cv2.GaussianBlur(gray, (15, 15), 0)
    h_img, w_img = gray.shape

    # Get the detected corners
    final = detect_paper_quad(image, paper_size)
    final_small = final * scale_factor
    ordered = order_corners(final_small)
    TL, TR, BR, BL = ordered[0], ordered[1], ordered[2], ordered[3]

    print(f"\n  Detected corners (scaled):")
    print(f"    TL: ({TL[0]:.1f}, {TL[1]:.1f})")
    print(f"    TR: ({TR[0]:.1f}, {TR[1]:.1f})")
    print(f"    BR: ({BR[0]:.1f}, {BR[1]:.1f})")
    print(f"    BL: ({BL[0]:.1f}, {BL[1]:.1f})")

    # Also get the initial detection (before refinement)
    # Re-run the pipeline manually to get the initial best candidate
    gray_blur = cv2.GaussianBlur(gray, (5, 5), 0)
    img_area = small.shape[0] * small.shape[1]
    img_mean = float(gray.mean())

    from app.cv.paper_detect import _try_approx_quad, _is_valid_paper_quad, _edge_brightness_score

    candidates = []
    def add_candidate(quad, priority=0):
        o = order_corners(quad)
        if _is_valid_paper_quad(gray, o, img_area, paper_size):
            area = cv2.contourArea(o.astype(np.float32))
            candidates.append((area, o, priority))

    for offset in [10, 20, 30, 0, -10, 40, -20, 50, -30, 60]:
        thresh_val = int(img_mean + offset)
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

    expected_ar = _expected_aspect_ratio(paper_size)
    def score_candidate(area, corners, priority):
        ar = _quad_aspect_ratio(corners)
        ar_err = min(abs(ar / expected_ar - 1.0), abs(ar * expected_ar - 1.0))
        eb = _edge_brightness_score(gray, corners)
        return (priority, area * max(0.1, 1.0 - ar_err * 3.0) * eb)

    candidates.sort(key=lambda x: score_candidate(x[0], x[1], x[2]), reverse=True)
    initial = candidates[0][1]
    iTL, iTR, iBR, iBL = initial[0], initial[1], initial[2], initial[3]

    print(f"\n  Initial detection (before refinement):")
    print(f"    TL: ({iTL[0]:.1f}, {iTL[1]:.1f})")
    print(f"    TR: ({iTR[0]:.1f}, {iTR[1]:.1f})")
    print(f"    BR: ({iBR[0]:.1f}, {iBR[1]:.1f})")
    print(f"    BL: ({iBL[0]:.1f}, {iBL[1]:.1f})")

    # Now examine the top edge (TL to TR) in detail
    print(f"\n  --- TOP EDGE (TL->TR) brightness scan ---")
    centroid = initial.mean(axis=0)
    edge_dir = (iTR - iTL) / np.linalg.norm(iTR - iTL)
    normal = np.array([edge_dir[1], -edge_dir[0]])
    mid = (iTL + iTR) / 2
    if np.dot(normal, mid - centroid) < 0:
        normal = -normal

    edge_len = np.linalg.norm(iTR - iTL)
    search_outside = int(edge_len * 0.15)
    search_inside = int(edge_len * 0.05)

    print(f"    edge_dir=({edge_dir[0]:.3f},{edge_dir[1]:.3f}) normal=({normal[0]:.3f},{normal[1]:.3f})")
    print(f"    edge_len={edge_len:.1f} search_outside={search_outside} search_inside={search_inside}")

    # For each sample point along top edge, show the brightness profile
    for t in np.linspace(0.15, 0.85, 12):
        base_pt = iTL * (1 - t) + iTR * t
        profile = []
        for d in range(search_outside, -search_inside, -2):
            pt = base_pt + normal * d
            px, py = int(pt[0]), int(pt[1])
            if 0 <= px < w_img and 0 <= py < h_img:
                profile.append((d, float(smooth[py, px])))
        # Find max gradient
        best_grad = 0
        best_d = 0
        for i in range(1, len(profile)):
            grad = profile[i][1] - profile[i-1][1]
            if grad > best_grad:
                best_grad = grad
                best_d = profile[i][0]
        # Print a summary
        bright_vals = [f"{v:.0f}" for d, v in profile[::5]]
        print(f"    t={t:.2f} pos=({base_pt[0]:.0f},{base_pt[1]:.0f}) best_grad={best_grad:.1f} at d={best_d} profile_sample={bright_vals}")

    # Now examine the RIGHT edge (TR to BR) in detail
    print(f"\n  --- RIGHT EDGE (TR->BR) brightness scan ---")
    edge_dir = (iBR - iTR) / np.linalg.norm(iBR - iTR)
    normal = np.array([edge_dir[1], -edge_dir[0]])
    mid = (iTR + iBR) / 2
    if np.dot(normal, mid - centroid) < 0:
        normal = -normal

    edge_len = np.linalg.norm(iBR - iTR)
    search_outside = int(edge_len * 0.15)
    search_inside = int(edge_len * 0.05)

    print(f"    edge_dir=({edge_dir[0]:.3f},{edge_dir[1]:.3f}) normal=({normal[0]:.3f},{normal[1]:.3f})")
    print(f"    edge_len={edge_len:.1f} search_outside={search_outside} search_inside={search_inside}")

    for t in np.linspace(0.15, 0.85, 12):
        base_pt = iTR * (1 - t) + iBR * t
        profile = []
        for d in range(search_outside, -search_inside, -2):
            pt = base_pt + normal * d
            px, py = int(pt[0]), int(pt[1])
            if 0 <= px < w_img and 0 <= py < h_img:
                profile.append((d, float(smooth[py, px])))
        best_grad = 0
        best_d = 0
        for i in range(1, len(profile)):
            grad = profile[i][1] - profile[i-1][1]
            if grad > best_grad:
                best_grad = grad
                best_d = profile[i][0]
        bright_vals = [f"{v:.0f}" for d, v in profile[::5]]
        print(f"    t={t:.2f} pos=({base_pt[0]:.0f},{base_pt[1]:.0f}) best_grad={best_grad:.1f} at d={best_d} profile_sample={bright_vals}")

    # Now let's look at the actual brightness in a grid around the TR corner
    print(f"\n  --- Brightness grid around TR corner ---")
    print(f"    Initial TR: ({iTR[0]:.0f}, {iTR[1]:.0f})")
    print(f"    Final TR:   ({TR[0]:.0f}, {TR[1]:.0f})")

    # Scan a 60x60 grid around the initial TR corner
    cx, cy = int(iTR[0]), int(iTR[1])
    grid_range = 40
    print(f"    Grid (rows=y, cols=x), center=({cx},{cy}):")
    print(f"    Each cell shows brightness. 'X' = paper (>100), '.' = dark (<100)")
    for dy in range(-grid_range, grid_range+1, 10):
        row_str = ""
        for dx in range(-grid_range, grid_range+1, 5):
            px, py = cx + dx, cy + dy
            if 0 <= px < w_img and 0 <= py < h_img:
                v = float(gray[py, px])
                if v > 150:
                    row_str += "X"
                elif v > 100:
                    row_str += "x"
                elif v > 50:
                    row_str += "o"
                else:
                    row_str += "."
            else:
                row_str += " "
        label = f"y={cy+dy:+d}"
        print(f"      {label:>8s} {row_str}")

    # Also draw an annotated image zoomed in on the TR corner
    zoom_range = 100
    x0 = max(0, int(iTR[0]) - zoom_range)
    x1 = min(w_img, int(iTR[0]) + zoom_range)
    y0 = max(0, int(iTR[1]) - zoom_range)
    y1 = min(h_img, int(iTR[1]) + zoom_range)
    zoom = small[y0:y1, x0:x1].copy()
    # Draw initial TR
    cv2.circle(zoom, (int(iTR[0]) - x0, int(iTR[1]) - y0), 8, (255, 0, 0), 2)
    cv2.putText(zoom, "INIT", (int(iTR[0]) - x0 + 10, int(iTR[1]) - y0), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 0), 2)
    # Draw final TR
    cv2.circle(zoom, (int(TR[0]) - x0, int(TR[1]) - y0), 8, (0, 255, 0), 2)
    cv2.putText(zoom, "FINAL", (int(TR[0]) - x0 + 10, int(TR[1]) - y0 + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
    # Draw all 4 corners for context
    for i, (c, lbl) in enumerate([(iTL, "iTL"), (iTR, "iTR"), (iBR, "iBR"), (iBL, "iBL")]):
        if x0 <= c[0] < x1 and y0 <= c[1] < y1:
            cv2.circle(zoom, (int(c[0]) - x0, int(c[1]) - y0), 5, (255, 0, 255), 1)
    # Scale up 2x
    zoom = cv2.resize(zoom, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(str(OUT / f"{name}_TR_zoom.png"), zoom)
    print(f"\n    Saved TR corner zoom to {OUT}/{name}_TR_zoom.png")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        debug_tr_corner(p)
