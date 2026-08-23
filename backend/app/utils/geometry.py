"""Geometry helpers for polygons (mm coordinate space)."""
from __future__ import annotations

import math
from typing import Sequence

import numpy as np


def to_np(points: Sequence[tuple[float, float] | object]) -> np.ndarray:
    """Convert a sequence of Point-like objects to an (N, 2) float array."""
    if len(points) == 0:
        return np.zeros((0, 2), dtype=float)
    arr = []
    for p in points:
        if hasattr(p, "x"):
            arr.append([float(p.x), float(p.y)])
        else:
            arr.append([float(p[0]), float(p[1])])
    return np.array(arr, dtype=float)


def polygon_area(pts: np.ndarray) -> float:
    """Shoelace area (absolute value) for an (N,2) array."""
    if len(pts) < 3:
        return 0.0
    x, y = pts[:, 0], pts[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def polygon_perimeter(pts: np.ndarray) -> float:
    if len(pts) < 2:
        return 0.0
    rolled = np.roll(pts, -1, axis=0)
    return float(np.sum(np.sqrt(np.sum((rolled - pts) ** 2, axis=1))))


def bbox(pts: np.ndarray) -> tuple[float, float, float, float]:
    """Return (min_x, min_y, max_x, max_y)."""
    if len(pts) == 0:
        return (0.0, 0.0, 0.0, 0.0)
    return (
        float(pts[:, 0].min()),
        float(pts[:, 1].min()),
        float(pts[:, 0].max()),
        float(pts[:, 1].max()),
    )


def centroid(pts: np.ndarray) -> tuple[float, float]:
    if len(pts) == 0:
        return (0.0, 0.0)
    return (float(pts[:, 0].mean()), float(pts[:, 1].mean()))


def translate(pts: np.ndarray, dx: float, dy: float) -> np.ndarray:
    return pts + np.array([dx, dy])


def rotate(pts: np.ndarray, angle_deg: float, cx: float = 0.0, cy: float = 0.0) -> np.ndarray:
    """Rotate points around (cx, cy) by angle_deg degrees."""
    a = math.radians(angle_deg)
    c, s = math.cos(a), math.sin(a)
    R = np.array([[c, -s], [s, c]])
    return (pts - np.array([cx, cy])) @ R.T + np.array([cx, cy])


def chaikin_smooth(pts: np.ndarray, iterations: int = 1) -> np.ndarray:
    """Chaikin's corner-cutting smoothing. Closed polygon."""
    if len(pts) < 3 or iterations < 1:
        return pts
    pts = np.asarray(pts, dtype=float)
    for _ in range(iterations):
        rolled = np.roll(pts, -1, axis=0)
        q = 0.75 * pts + 0.25 * rolled
        r = 0.25 * pts + 0.75 * rolled
        new = np.empty((len(pts) * 2, 2), dtype=float)
        new[0::2] = q
        new[1::2] = r
        pts = new
    return pts


def catmull_rom_smooth(pts: np.ndarray, samples_per_segment: int = 10, tension: float = 0.3) -> np.ndarray:
    """Sample a Catmull-Rom spline through the points to create a smooth closed polygon.

    This matches the frontend's smoothClosedPath() which uses Catmull-Rom converted
    to cubic Bezier with the given tension. We sample the Bezier curve at regular
    intervals to produce a dense polygon that approximates the smooth curve.

    Args:
        pts: (N, 2) array of polygon vertices
        samples_per_segment: number of points to sample per spline segment
        tension: controls how much curves bulge (0.3 = balanced, matching frontend)
    """
    n = len(pts)
    if n < 3:
        return pts
    pts = np.asarray(pts, dtype=float)

    result = []
    for i in range(n):
        p0 = pts[(i - 1) % n]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n]

        # Catmull-Rom to Bezier control points (same as frontend)
        cp1 = p1 + (p2 - p0) * tension / 3.0
        cp2 = p2 - (p3 - p1) * tension / 3.0

        # Sample the cubic Bezier curve
        for s in range(samples_per_segment):
            t = s / samples_per_segment
            mt = 1 - t
            # B(t) = (1-t)^3 * P1 + 3*(1-t)^2*t * cp1 + 3*(1-t)*t^2 * cp2 + t^3 * P2
            x = mt**3 * p1[0] + 3 * mt**2 * t * cp1[0] + 3 * mt * t**2 * cp2[0] + t**3 * p2[0]
            y = mt**3 * p1[1] + 3 * mt**2 * t * cp1[1] + 3 * mt * t**2 * cp2[1] + t**3 * p2[1]
            result.append([x, y])

    return np.array(result, dtype=float)


def offset_polygon(pts: np.ndarray, distance: float) -> np.ndarray:
    """Offset a closed polygon outward (positive) or inward (negative).

    Uses a simple per-vertex normal averaging approach. Good enough for
    tool margins where shapes are not extremely concave. For production-grade
    offsets, pyclipper would be ideal but adds a dependency.
    """
    if len(pts) < 3 or abs(distance) < 1e-6:
        return pts.copy()
    n = len(pts)
    offset_pts = np.zeros_like(pts, dtype=float)
    for i in range(n):
        prev = pts[(i - 1) % n]
        curr = pts[i]
        nxt = pts[(i + 1) % n]
        # Edge vectors
        e1 = curr - prev
        e2 = nxt - curr
        # Normalize
        l1 = np.linalg.norm(e1)
        l2 = np.linalg.norm(e2)
        if l1 < 1e-9 or l2 < 1e-9:
            offset_pts[i] = curr
            continue
        # Outward normals (for CCW polygon, outward = rotate edge -90deg)
        n1 = np.array([-e1[1], e1[0]]) / l1
        n2 = np.array([-e2[1], e2[0]]) / l2
        # Average normal direction
        avg_n = (n1 + n2)
        norm = np.linalg.norm(avg_n)
        if norm < 1e-9:
            offset_pts[i] = curr
            continue
        avg_n = avg_n / norm
        # Miter length
        miter = 1.0 / max(0.1, np.dot(avg_n, n1))
        offset_pts[i] = curr + avg_n * distance * miter
    return offset_pts


def ensure_ccw(pts: np.ndarray) -> np.ndarray:
    """Ensure polygon is counter-clockwise (for fill-rule consistency)."""
    if len(pts) < 3:
        return pts
    x, y = pts[:, 0], pts[:, 1]
    signed = 0.5 * (np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
    if signed < 0:
        return pts[::-1].copy()
    return pts


def ensure_cw(pts: np.ndarray) -> np.ndarray:
    """Ensure polygon is clockwise."""
    if len(pts) < 3:
        return pts
    x, y = pts[:, 0], pts[:, 1]
    signed = 0.5 * (np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
    if signed > 0:
        return pts[::-1].copy()
    return pts
