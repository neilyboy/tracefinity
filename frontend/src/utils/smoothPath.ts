// Convert a list of 2D points into a smooth closed SVG path using cubic bezier curves.
// Uses Catmull-Rom spline converted to cubic bezier — the same technique used by
// tooltrace.ai for smooth, rounded tool outlines.
//
// Also supports per-vertex bezier control handles (Inkscape-style) when provided.

import type { VertexHandle } from '../types'

export interface Pt {
  x: number
  y: number
}

/**
 * Build a smooth closed SVG path string from a list of points.
 * Uses Catmull-Rom splines converted to cubic bezier curves.
 *
 * When handles are provided, each vertex uses its explicit cp_out/cp_in
 * control points instead of Catmull-Rom. Vertices with handle type "auto"
 * fall back to Catmull-Rom for that segment. Vertices with type "straight"
 * produce a straight line segment.
 *
 * @param pts Array of {x, y} points (at least 3)
 * @param tension Controls how much curves bulge (0.0 = sharp polygon, 0.3 = balanced, 1.0 = max)
 * @param handles Optional per-vertex bezier handles (parallel array to pts)
 * @returns SVG path string like "M x y C ... Z"
 */
export function smoothClosedPath(pts: Pt[], tension: number = 0.3, handles?: VertexHandle[]): string {
  const n = pts.length
  if (n < 3) {
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ' Z'
  }

  // If no handles at all, or all handles are "auto", use the fast Catmull-Rom path
  const hasHandles = handles && handles.length === n && handles.some((h) => h && h.type !== 'auto')
  if (!hasHandles && tension <= 0.001) {
    // Straight lines
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ' Z'
  }

  if (!hasHandles) {
    // Pure Catmull-Rom (original behavior)
    return catmullRomPath(pts, tension)
  }

  // Mixed mode: some vertices have explicit handles, others use Catmull-Rom
  return mixedBezierPath(pts, tension, handles!)
}

/**
 * Pure Catmull-Rom to cubic bezier path (original behavior).
 */
function catmullRomPath(pts: Pt[], tension: number): string {
  const n = pts.length
  const segments: string[] = []
  segments.push(`M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`)

  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]

    const cp1x = p1.x + (p2.x - p0.x) * tension / 3
    const cp1y = p1.y + (p2.y - p0.y) * tension / 3
    const cp2x = p2.x - (p3.x - p1.x) * tension / 3
    const cp2y = p2.y - (p3.y - p1.y) * tension / 3

    segments.push(`C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`)
  }

  segments.push('Z')
  return segments.join(' ')
}

/**
 * Mixed bezier path: uses explicit handles where available, Catmull-Rom elsewhere.
 *
 * For each segment from vertex i to vertex i+1:
 * - If vertex i has type "straight", use a line (L)
 * - If vertex i has cp_out and vertex i+1 has cp_in, use explicit cubic bezier (C)
 * - Otherwise, compute Catmull-Rom control points for this segment
 */
function mixedBezierPath(pts: Pt[], tension: number, handles: VertexHandle[]): string {
  const n = pts.length
  const segments: string[] = []
  segments.push(`M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`)

  for (let i = 0; i < n; i++) {
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const h1 = handles[i]
    const h2 = handles[(i + 1) % n]

    // Check if either endpoint wants a straight segment
    const h1Straight = h1 && h1.type === 'straight'
    const h1Auto = !h1 || h1.type === 'auto'
    const h2Auto = !h2 || h2.type === 'auto'

    if (h1Straight) {
      // Straight line to next vertex
      segments.push(`L ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`)
      continue
    }

    if (!h1Auto && h1.cp_out && !h2Auto && h2.cp_in) {
      // Both vertices have explicit handles — use them directly
      segments.push(`C ${h1.cp_out.x.toFixed(2)} ${h1.cp_out.y.toFixed(2)} ${h2.cp_in.x.toFixed(2)} ${h2.cp_in.y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`)
      continue
    }

    if (!h1Auto && h1.cp_out && h2Auto) {
      // Outgoing handle from p1 is explicit, but p2's incoming is auto.
      // Use p1's cp_out and compute p2's cp_in from Catmull-Rom.
      const p3 = pts[(i + 2) % n]
      const cp2x = p2.x - (p3.x - p1.x) * tension / 3
      const cp2y = p2.y - (p3.y - p1.y) * tension / 3
      segments.push(`C ${h1.cp_out.x.toFixed(2)} ${h1.cp_out.y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`)
      continue
    }

    if (h1Auto && !h2Auto && h2.cp_in) {
      // p1's outgoing is auto, but p2's incoming is explicit.
      const p0 = pts[(i - 1 + n) % n]
      const cp1x = p1.x + (p2.x - p0.x) * tension / 3
      const cp1y = p1.y + (p2.y - p0.y) * tension / 3
      segments.push(`C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${h2.cp_in.x.toFixed(2)} ${h2.cp_in.y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`)
      continue
    }

    // Both auto — full Catmull-Rom for this segment
    const p0 = pts[(i - 1 + n) % n]
    const p3 = pts[(i + 2) % n]
    const cp1x = p1.x + (p2.x - p0.x) * tension / 3
    const cp1y = p1.y + (p2.y - p0.y) * tension / 3
    const cp2x = p2.x - (p3.x - p1.x) * tension / 3
    const cp2y = p2.y - (p3.y - p1.y) * tension / 3
    segments.push(`C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`)
  }

  segments.push('Z')
  return segments.join(' ')
}

/**
 * Compute default bezier control points for a vertex based on its neighbors.
 * Used when converting an "auto" vertex to "smooth" — gives initial handle
 * positions that match the Catmull-Rom curve.
 *
 * @param prev Previous vertex in the path
 * @param vertex The vertex to compute handles for
 * @param next Next vertex in the path
 * @param tension Smoothing tension (same as used in Catmull-Rom)
 * @returns { cp_in, cp_out } — control points relative to the vertex
 */
export function computeAutoHandles(prev: Pt, vertex: Pt, next: Pt, tension: number = 0.3): { cp_in: Pt, cp_out: Pt } {
  // Catmull-Rom: cp_out = vertex + (next - prev) * tension / 3
  //              cp_in  = vertex - (next - prev) * tension / 3
  const dx = (next.x - prev.x) * tension / 3
  const dy = (next.y - prev.y) * tension / 3
  return {
    cp_out: { x: vertex.x + dx, y: vertex.y + dy },
    cp_in: { x: vertex.x - dx, y: vertex.y - dy },
  }
}

/**
 * When a vertex handle is "smooth", cp_in and cp_out must be collinear
 * (mirrored across the vertex). Given one handle, compute the other.
 */
export function mirrorHandle(vertex: Pt, knownHandle: Pt): Pt {
  return {
    x: 2 * vertex.x - knownHandle.x,
    y: 2 * vertex.y - knownHandle.y,
  }
}
