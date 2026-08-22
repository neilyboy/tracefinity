// Pointer event helpers for vertex dragging in the SVG editor.
import type { Point } from '../types'

export interface DragState {
  toolId: string
  vertexIdx: number // -1 for whole-tool drag
  startClientX: number
  startClientY: number
  startToolPos: Point[] // snapshot of outer vertices at drag start
}

/**
 * Convert a client (screen) coordinate to SVG mm coordinates using
 * the SVG element's CTM (current transform matrix) inverse.
 */
export function clientToSvgMm(
  svgEl: SVGSVGElement,
  clientX: number,
  clientY: number,
): Point {
  const pt = svgEl.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svgEl.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const svgPt = pt.matrixTransform(ctm.inverse())
  return { x: svgPt.x, y: svgPt.y }
}

/**
 * Snap a value to the nearest grid increment.
 */
export function snapToGrid(value: number, grid: number, enabled: boolean): number {
  if (!enabled) return value
  return Math.round(value / grid) * grid
}

/**
 * Snap to a finer increment (for vertex-level precision).
 */
export function snapFine(value: number, increment: number = 0.5): number {
  return Math.round(value / increment) * increment
}
