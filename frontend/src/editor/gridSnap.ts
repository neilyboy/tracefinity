// Gridfinity grid snapping helpers.
import { GRID_UNIT_MM } from './constants'

export { GRID_UNIT_MM }

/**
 * Compute the suggested bin grid size (W x L in units) from tool outlines.
 * Finds the bounding box of all tools and rounds up to grid units,
 * adding 1 unit margin.
 */
export function suggestGridSize(
  outlines: { outer: { x: number; y: number }[] }[],
  marginUnits: number = 1,
): { grid_w: number; grid_l: number } {
  if (outlines.length === 0) return { grid_w: 2, grid_l: 2 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const o of outlines) {
    for (const p of o.outer) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  const w = maxX - minX
  const l = maxY - minY
  const grid_w = Math.max(1, Math.ceil(w / GRID_UNIT_MM) + marginUnits)
  const grid_l = Math.max(1, Math.ceil(l / GRID_UNIT_MM) + marginUnits)
  return { grid_w: Math.min(grid_w, 20), grid_l: Math.min(grid_l, 20) }
}
