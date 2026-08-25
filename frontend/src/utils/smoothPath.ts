// Convert a list of 2D points into a smooth closed SVG path using cubic bezier curves.
// Uses Catmull-Rom spline converted to cubic bezier — the same technique used by
// tooltrace.ai for smooth, rounded tool outlines.

export interface Pt {
  x: number
  y: number
}

/**
 * Build a smooth closed SVG path string from a list of points.
 * Uses Catmull-Rom splines converted to cubic bezier curves.
 *
 * @param pts Array of {x, y} points (at least 3)
 * @param tension Controls how much curves bulge (0.0 = sharp polygon, 0.3 = balanced, 1.0 = max)
 * @returns SVG path string like "M x y C ... Z"
 */
export function smoothClosedPath(pts: Pt[], tension: number = 0.3): string {
  const n = pts.length
  if (n < 3 || tension <= 0.001) {
    // Not enough points for curves, or tension is zero — use straight lines
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ' Z'
  }

  const segments: string[] = []
  segments.push(`M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`)

  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]

    // Catmull-Rom to Bezier conversion
    const cp1x = p1.x + (p2.x - p0.x) * tension / 3
    const cp1y = p1.y + (p2.y - p0.y) * tension / 3
    const cp2x = p2.x - (p3.x - p1.x) * tension / 3
    const cp2y = p2.y - (p3.y - p1.y) * tension / 3

    segments.push(`C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`)
  }

  segments.push('Z')
  return segments.join(' ')
}
