// Central editor state via zustand.
import { create } from 'zustand'
import type { BinParams, Design, PaperSize, Point, ToolOutline, TextLabel } from '../types'
import { DEFAULT_PARAMS } from '../types'

interface EditorState {
  // The current design being edited
  design: Design
  selectedToolId: string | null
  selectedToolIds: string[]  // multi-select (includes selectedToolId)
  // UI state
  view: 'upload' | 'calibrate' | 'trace' | 'editor'
  loading: boolean
  error: string | null
  // History for undo/redo
  history: Design[]
  historyIndex: number
  // Symmetry editing
  symmetryAxis: 'x' | 'y' | null  // null = symmetry off
  symmetryMode: 'live' | 'manual'  // live = mirror vertex drags in real-time, manual = use buttons

  // Actions
  setView: (view: EditorState['view']) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setDesign: (design: Design) => void
  setParams: (params: Partial<BinParams>) => void
  selectTool: (id: string | null) => void
  toggleToolSelection: (id: string) => void
  selectTools: (ids: string[]) => void
  updateTool: (id: string, updates: Partial<ToolOutline>) => void
  deleteTool: (id: string) => void
  addTool: (tool: ToolOutline) => void
  addTools: (tools: ToolOutline[]) => void
  duplicateTool: (id: string) => void
  duplicateToolN: (id: string, count: number, spacing: number) => void
  arrayTool: (id: string, rows: number, cols: number, spacingX: number, spacingY: number) => void
  moveTool: (id: string, dx: number, dy: number) => void
  moveTools: (ids: string[], dx: number, dy: number) => void
  rotateTools: (ids: string[], angleDeg: number) => void
  alignTools: (ids: string[], alignment: 'left' | 'right' | 'center-h' | 'top' | 'bottom' | 'center-v') => void
  distributeTools: (ids: string[], axis: 'h' | 'v') => void
  updateVertex: (toolId: string, vertexIdx: number, pos: Point) => void
  addVertex: (toolId: string, afterIdx: number, pos: Point) => void
  deleteVertex: (toolId: string, vertexIdx: number) => void
  toggleToolVisible: (id: string) => void
  scaleTool: (id: string, scaleFactor: number) => void
  mirrorTool: (id: string, axis: 'x' | 'y') => void
  // Symmetry actions
  setSymmetryAxis: (axis: 'x' | 'y' | null) => void
  setSymmetryMode: (mode: 'live' | 'manual') => void
  mirrorHalf: (toolId: string, axis: 'x' | 'y', source: 'left' | 'right' | 'top' | 'bottom') => void
  symmetrize: (toolId: string, axis: 'x' | 'y') => void
  // Labels
  addLabel: (label: TextLabel) => void
  updateLabel: (id: string, updates: Partial<TextLabel>) => void
  deleteLabel: (id: string) => void
  moveLabel: (id: string, dx: number, dy: number) => void
  setPaperSize: (size: PaperSize) => void
  setName: (name: string) => void
  undo: () => void
  redo: () => void
  pushHistory: () => void
  reset: () => void
}

const emptyDesign: Design = {
  id: null,
  name: 'Untitled',
  paper_size: 'letter',
  scale_mm_per_px: 0,
  rectified_w_px: 0,
  rectified_h_px: 0,
  paper_corners_px: [],
  outlines: [],
  labels: [],
  params: { ...DEFAULT_PARAMS },
  image_filename: null,
}

export const useEditor = create<EditorState>((set, get) => ({
  design: { ...emptyDesign },
  selectedToolId: null,
  selectedToolIds: [],
  view: 'upload',
  loading: false,
  error: null,
  history: [],
  historyIndex: -1,
  symmetryAxis: null,
  symmetryMode: 'live',

  setView: (view) => set({ view }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  setDesign: (design) => set({ design, view: 'editor', selectedToolId: null, selectedToolIds: [], history: [design], historyIndex: 0 }),

  setParams: (params) => {
    get().pushHistory()
    set((s) => ({ design: { ...s.design, params: { ...s.design.params, ...params } } }))
  },

  selectTool: (id) => set({ selectedToolId: id, selectedToolIds: id ? [id] : [] }),

  toggleToolSelection: (id) => set((s) => {
    const exists = s.selectedToolIds.includes(id)
    const newIds = exists ? s.selectedToolIds.filter((x) => x !== id) : [...s.selectedToolIds, id]
    return {
      selectedToolIds: newIds,
      selectedToolId: newIds.length === 1 ? newIds[0] : (newIds.length === 0 ? null : s.selectedToolId),
    }
  }),

  selectTools: (ids) => set({
    selectedToolIds: ids,
    selectedToolId: ids.length === 1 ? ids[0] : (ids.length === 0 ? null : ids[0]),
  }),

  updateTool: (id, updates) => {
    get().pushHistory()
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => (o.id === id ? { ...o, ...updates } : o)),
      },
    }))
  },

  deleteTool: (id) => {
    get().pushHistory()
    set((s) => ({
      design: { ...s.design, outlines: s.design.outlines.filter((o) => o.id !== id) },
      selectedToolId: s.selectedToolId === id ? null : s.selectedToolId,
    }))
  },

  addTool: (tool) => {
    get().pushHistory()
    set((s) => ({ design: { ...s.design, outlines: [...s.design.outlines, tool] } }))
  },

  addTools: (tools) => {
    get().pushHistory()
    set((s) => ({ design: { ...s.design, outlines: [...s.design.outlines, ...tools] } }))
  },

  duplicateTool: (id) => {
    const tool = get().design.outlines.find((o) => o.id === id)
    if (!tool) return
    get().pushHistory()
    const newId = `tool_${Date.now()}`
    // Offset the duplicate by 10mm so it doesn't overlap
    const offset = 10
    const dup: ToolOutline = {
      ...tool,
      id: newId,
      outer: tool.outer.map((p) => ({ x: p.x + offset, y: p.y + offset })),
      holes: tool.holes.map((h) => h.map((p) => ({ x: p.x + offset, y: p.y + offset }))),
      finger_holes: (tool.finger_holes ?? []).map((fh) => ({
        ...fh,
        x: fh.x + offset,
        y: fh.y + offset,
      })),
    }
    set((s) => ({
      design: { ...s.design, outlines: [...s.design.outlines, dup] },
      selectedToolId: newId,
    }))
  },

  duplicateToolN: (id, count, spacing) => {
    const tool = get().design.outlines.find((o) => o.id === id)
    if (!tool || count < 1) return
    get().pushHistory()
    // Compute bounding box to determine offset distance
    const xs = tool.outer.map((p) => p.x)
    const ys = tool.outer.map((p) => p.y)
    const w = Math.max(...xs) - Math.min(...xs)
    const h = Math.max(...ys) - Math.min(...ys)
    const offsetX = w + spacing
    const dups: ToolOutline[] = []
    for (let i = 1; i <= count; i++) {
      const newId = `tool_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`
      dups.push({
        ...tool,
        id: newId,
        label: tool.label,
        outer: tool.outer.map((p) => ({ x: p.x + offsetX * i, y: p.y })),
        holes: tool.holes.map((hp) => hp.map((p) => ({ x: p.x + offsetX * i, y: p.y }))),
        finger_holes: (tool.finger_holes ?? []).map((fh) => ({
          ...fh,
          x: fh.x + offsetX * i,
          y: fh.y,
        })),
      })
    }
    set((s) => ({
      design: { ...s.design, outlines: [...s.design.outlines, ...dups] },
    }))
  },

  arrayTool: (id, rows, cols, spacingX, spacingY) => {
    const tool = get().design.outlines.find((o) => o.id === id)
    if (!tool || (rows < 2 && cols < 2)) return
    get().pushHistory()
    // Compute bounding box
    const xs = tool.outer.map((p) => p.x)
    const ys = tool.outer.map((p) => p.y)
    const w = Math.max(...xs) - Math.min(...xs)
    const h = Math.max(...ys) - Math.min(...ys)
    const stepX = w + spacingX
    const stepY = h + spacingY
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length
    const startX = cx - ((cols - 1) * stepX) / 2
    const startY = cy - ((rows - 1) * stepY) / 2
    const dups: ToolOutline[] = []
    let idx = 0
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (row === 0 && col === 0) continue // skip original position
        idx++
        const targetX = startX + col * stepX
        const targetY = startY + row * stepY
        const dx = targetX - cx
        const dy = targetY - cy
        const newId = `tool_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`
        dups.push({
          ...tool,
          id: newId,
          label: tool.label,
          outer: tool.outer.map((p) => ({ x: p.x + dx, y: p.y + dy })),
          holes: tool.holes.map((hp) => hp.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
          finger_holes: (tool.finger_holes ?? []).map((fh) => ({
            ...fh,
            x: fh.x + dx,
            y: fh.y + dy,
          })),
        })
      }
    }
    set((s) => ({
      design: { ...s.design, outlines: [...s.design.outlines, ...dups] },
    }))
  },

  moveTool: (id, dx, dy) => {
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) =>
          o.id === id
            ? {
                ...o,
                outer: o.outer.map((p) => ({ x: p.x + dx, y: p.y + dy })),
                holes: o.holes.map((h) => h.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
                finger_holes: (o.finger_holes ?? []).map((fh) => ({
                  ...fh,
                  x: fh.x + dx,
                  y: fh.y + dy,
                })),
              }
            : o,
        ),
      },
    }))
  },

  moveTools: (ids, dx, dy) => {
    const idSet = new Set(ids)
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) =>
          idSet.has(o.id)
            ? {
                ...o,
                outer: o.outer.map((p) => ({ x: p.x + dx, y: p.y + dy })),
                holes: o.holes.map((h) => h.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
                finger_holes: (o.finger_holes ?? []).map((fh) => ({
                  ...fh,
                  x: fh.x + dx,
                  y: fh.y + dy,
                })),
              }
            : o,
        ),
      },
    }))
  },

  rotateTools: (ids, angleDeg) => {
    if (ids.length === 0 || angleDeg === 0) return
    get().pushHistory()
    const tools = get().design.outlines.filter((o) => ids.includes(o.id))
    if (tools.length === 0) return
    // Compute group center (average of all tool centroids)
    let sumCx = 0, sumCy = 0
    for (const t of tools) {
      const cx = t.outer.reduce((a, p) => a + p.x, 0) / t.outer.length
      const cy = t.outer.reduce((a, p) => a + p.y, 0) / t.outer.length
      sumCx += cx
      sumCy += cy
    }
    const groupCx = sumCx / tools.length
    const groupCy = sumCy / tools.length
    const rad = (angleDeg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const idSet = new Set(ids)
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (!idSet.has(o.id)) return o
          const rotatePt = (p: Point): Point => ({
            x: groupCx + (p.x - groupCx) * cos - (p.y - groupCy) * sin,
            y: groupCy + (p.x - groupCx) * sin + (p.y - groupCy) * cos,
          })
          return {
            ...o,
            outer: o.outer.map(rotatePt),
            holes: o.holes.map((h) => h.map(rotatePt)),
            finger_holes: (o.finger_holes ?? []).map((fh) => ({
              ...fh,
              x: groupCx + (fh.x - groupCx) * cos - (fh.y - groupCy) * sin,
              y: groupCy + (fh.x - groupCx) * sin + (fh.y - groupCy) * cos,
            })),
            rotation_deg: ((o.rotation_deg ?? 0) + angleDeg) % 360,
          }
        }),
      },
    }))
  },

  alignTools: (ids, alignment) => {
    if (ids.length < 2) return
    get().pushHistory()
    const tools = get().design.outlines.filter((o) => ids.includes(o.id))
    if (tools.length < 2) return
    // Compute bounding boxes for each tool
    const bboxes = tools.map((t) => {
      const xs = t.outer.map((p) => p.x)
      const ys = t.outer.map((p) => p.y)
      return { id: t.id, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
    })
    // Compute target alignment line
    let target: number
    let getVal: (bb: typeof bboxes[0]) => number
    let setVal: (bb: typeof bboxes[0]) => number  // current position to offset from
    switch (alignment) {
      case 'left':   target = Math.min(...bboxes.map(b => b.minX)); getVal = b => b.minX; break
      case 'right':  target = Math.max(...bboxes.map(b => b.maxX)); getVal = b => b.maxX; break
      case 'center-h': target = bboxes.reduce((s, b) => s + (b.minX + b.maxX) / 2, 0) / bboxes.length; getVal = b => (b.minX + b.maxX) / 2; break
      case 'top':    target = Math.min(...bboxes.map(b => b.minY)); getVal = b => b.minY; break
      case 'bottom': target = Math.max(...bboxes.map(b => b.maxY)); getVal = b => b.maxY; break
      case 'center-v': target = bboxes.reduce((s, b) => s + (b.minY + b.maxY) / 2, 0) / bboxes.length; getVal = b => (b.minY + b.maxY) / 2; break
      default: return
    }
    // Compute offsets and apply
    const offsets = new Map<string, { dx: number; dy: number }>()
    for (const bb of bboxes) {
      const isHorizontal = alignment === 'left' || alignment === 'right' || alignment === 'center-h'
      const dx = isHorizontal ? target - getVal(bb) : 0
      const dy = isHorizontal ? 0 : target - getVal(bb)
      offsets.set(bb.id, { dx, dy })
    }
    const idSet = new Set(ids)
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (!idSet.has(o.id)) return o
          const off = offsets.get(o.id)!
          if (off.dx === 0 && off.dy === 0) return o
          const movePt = (p: Point): Point => ({ x: p.x + off.dx, y: p.y + off.dy })
          return {
            ...o,
            outer: o.outer.map(movePt),
            holes: o.holes.map((h) => h.map(movePt)),
            finger_holes: (o.finger_holes ?? []).map((fh) => ({ ...fh, x: fh.x + off.dx, y: fh.y + off.dy })),
          }
        }),
      },
    }))
  },

  distributeTools: (ids, axis) => {
    if (ids.length < 3) return  // need at least 3 to distribute
    get().pushHistory()
    const tools = get().design.outlines.filter((o) => ids.includes(o.id))
    if (tools.length < 3) return
    // Compute centroids
    const centroids = tools.map((t) => {
      const cx = t.outer.reduce((a, p) => a + p.x, 0) / t.outer.length
      const cy = t.outer.reduce((a, p) => a + p.y, 0) / t.outer.length
      return { id: t.id, cx, cy }
    })
    // Sort by position along axis
    if (axis === 'h') {
      centroids.sort((a, b) => a.cx - b.cx)
    } else {
      centroids.sort((a, b) => a.cy - b.cy)
    }
    // Compute total span and even spacing
    const first = axis === 'h' ? centroids[0].cx : centroids[0].cy
    const last = axis === 'h' ? centroids[centroids.length - 1].cx : centroids[centroids.length - 1].cy
    const step = (last - first) / (centroids.length - 1)
    // Compute offsets
    const offsets = new Map<string, { dx: number; dy: number }>()
    for (let i = 0; i < centroids.length; i++) {
      const target = first + step * i
      const c = centroids[i]
      if (axis === 'h') {
        offsets.set(c.id, { dx: target - c.cx, dy: 0 })
      } else {
        offsets.set(c.id, { dx: 0, dy: target - c.cy })
      }
    }
    const idSet = new Set(ids)
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (!idSet.has(o.id)) return o
          const off = offsets.get(o.id)!
          if (off.dx === 0 && off.dy === 0) return o
          const movePt = (p: Point): Point => ({ x: p.x + off.dx, y: p.y + off.dy })
          return {
            ...o,
            outer: o.outer.map(movePt),
            holes: o.holes.map((h) => h.map(movePt)),
            finger_holes: (o.finger_holes ?? []).map((fh) => ({ ...fh, x: fh.x + off.dx, y: fh.y + off.dy })),
          }
        }),
      },
    }))
  },

  updateVertex: (toolId, vertexIdx, pos) => {
    set((s) => {
      const axis = s.symmetryAxis
      const mode = s.symmetryMode
      // If live symmetry is on, find and update the mirrored vertex too
      let mirroredIdx: number | null = null
      let mirroredPos: Point | null = null
      if (axis && mode === 'live') {
        const tool = s.design.outlines.find((o) => o.id === toolId)
        if (tool) {
          const cx = tool.outer.reduce((a, p) => a + p.x, 0) / tool.outer.length
          const cy = tool.outer.reduce((a, p) => a + p.y, 0) / tool.outer.length
          // Find the vertex closest to the mirrored position of the dragged vertex
          const mirrorX = axis === 'x' ? 2 * cx - pos.x : pos.x
          const mirrorY = axis === 'y' ? 2 * cy - pos.y : pos.y
          let bestDist = Infinity
          let bestIdx = -1
          for (let i = 0; i < tool.outer.length; i++) {
            if (i === vertexIdx) continue
            const d = Math.hypot(tool.outer[i].x - mirrorX, tool.outer[i].y - mirrorY)
            if (d < bestDist) {
              bestDist = d
              bestIdx = i
            }
          }
          // Only mirror if the closest vertex is within a reasonable distance
          // (the mirrored vertex should be close to the mirrored position)
          if (bestIdx >= 0 && bestDist < 15) {
            mirroredIdx = bestIdx
            mirroredPos = { x: mirrorX, y: mirrorY }
          }
        }
      }
      return {
        design: {
          ...s.design,
          outlines: s.design.outlines.map((o) =>
            o.id === toolId
              ? {
                  ...o,
                  outer: o.outer.map((p, i) => {
                    if (i === vertexIdx) return pos
                    if (i === mirroredIdx && mirroredPos) return mirroredPos
                    return p
                  }),
                }
              : o,
          ),
        },
      }
    })
  },

  addVertex: (toolId, afterIdx, pos) => {
    get().pushHistory()
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) =>
          o.id === toolId
            ? { ...o, outer: [...o.outer.slice(0, afterIdx + 1), pos, ...o.outer.slice(afterIdx + 1)] }
            : o,
        ),
      },
    }))
  },

  deleteVertex: (toolId, vertexIdx) => {
    const tool = get().design.outlines.find((o) => o.id === toolId)
    if (!tool || tool.outer.length <= 3) return // keep at least 3 vertices
    get().pushHistory()
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) =>
          o.id === toolId ? { ...o, outer: o.outer.filter((_, i) => i !== vertexIdx) } : o,
        ),
      },
    }))
  },

  toggleToolVisible: (id) => {
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => (o.id === id ? { ...o, visible: !o.visible } : o)),
      },
    }))
  },

  scaleTool: (id, scaleFactor) => {
    get().pushHistory()
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== id) return o
          // Scale around centroid
          const cx = o.outer.reduce((a, p) => a + p.x, 0) / o.outer.length
          const cy = o.outer.reduce((a, p) => a + p.y, 0) / o.outer.length
          return {
            ...o,
            outer: o.outer.map((p) => ({
              x: cx + (p.x - cx) * scaleFactor,
              y: cy + (p.y - cy) * scaleFactor,
            })),
            holes: o.holes.map((h) =>
              h.map((p) => ({
                x: cx + (p.x - cx) * scaleFactor,
                y: cy + (p.y - cy) * scaleFactor,
              })),
            ),
            finger_holes: (o.finger_holes ?? []).map((fh) => ({
              ...fh,
              x: cx + (fh.x - cx) * scaleFactor,
              y: cy + (fh.y - cy) * scaleFactor,
              radius_mm: fh.radius_mm * scaleFactor,
            })),
          }
        }),
      },
    }))
  },

  mirrorTool: (id, axis) => {
    const tool = get().design.outlines.find((o) => o.id === id)
    if (!tool) return
    get().pushHistory()
    const cx = tool.outer.reduce((a, p) => a + p.x, 0) / tool.outer.length
    const cy = tool.outer.reduce((a, p) => a + p.y, 0) / tool.outer.length
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== id) return o
          const mirror = (p: Point): Point =>
            axis === 'x' ? { x: 2 * cx - p.x, y: p.y } : { x: p.x, y: 2 * cy - p.y }
          // Reverse winding for mirrored polygon to maintain CCW
          const mirroredOuter = o.outer.map(mirror).reverse()
          return {
            ...o,
            outer: mirroredOuter,
            holes: o.holes.map((h) => h.map(mirror).reverse()),
            finger_holes: (o.finger_holes ?? []).map((fh) => ({
              ...fh,
              x: axis === 'x' ? 2 * cx - fh.x : fh.x,
              y: axis === 'y' ? 2 * cy - fh.y : fh.y,
            })),
          }
        }),
      },
    }))
  },

  setSymmetryAxis: (axis) => set({ symmetryAxis: axis }),
  setSymmetryMode: (mode) => set({ symmetryMode: mode }),

  mirrorHalf: (id, axis, source) => {
    // Copy geometry from one side of the symmetry axis to the other.
    // source: 'left'/'right' for X axis, 'top'/'bottom' for Y axis.
    // The "source" side is kept; the other side is replaced with mirrored copies.
    const tool = get().design.outlines.find((o) => o.id === id)
    if (!tool) return
    get().pushHistory()
    const cx = tool.outer.reduce((a, p) => a + p.x, 0) / tool.outer.length
    const cy = tool.outer.reduce((a, p) => a + p.y, 0) / tool.outer.length
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== id) return o
          // Split vertices into source side and target side
          const sourcePts: Point[] = []
          const targetPts: Point[] = []
          for (const p of o.outer) {
            if (axis === 'x') {
              if (source === 'left' ? p.x <= cx : p.x >= cx) sourcePts.push(p)
              else targetPts.push(p)
            } else {
              if (source === 'top' ? p.y <= cy : p.y >= cy) sourcePts.push(p)
              else targetPts.push(p)
            }
          }
          // Mirror the source points to create the new target side
          const mirroredSource = sourcePts.map((p) =>
            axis === 'x' ? { x: 2 * cx - p.x, y: p.y } : { x: p.x, y: 2 * cy - p.y },
          )
          // Combine: source points + mirrored source points
          // Sort by angle around centroid to maintain polygon order
          const allPts = [...sourcePts, ...mirroredSource]
          const finalCx = allPts.reduce((a, p) => a + p.x, 0) / allPts.length
          const finalCy = allPts.reduce((a, p) => a + p.y, 0) / allPts.length
          allPts.sort((a, b) => {
            const angleA = Math.atan2(a.y - finalCy, a.x - finalCx)
            const angleB = Math.atan2(b.y - finalCy, b.x - finalCx)
            return angleA - angleB
          })
          return { ...o, outer: allPts.length >= 3 ? allPts : o.outer }
        }),
      },
    }))
  },

  symmetrize: (id, axis) => {
    // Average both sides for perfect symmetry.
    // For each vertex, find its mirror partner and average both positions.
    const tool = get().design.outlines.find((o) => o.id === id)
    if (!tool) return
    get().pushHistory()
    const cx = tool.outer.reduce((a, p) => a + p.x, 0) / tool.outer.length
    const cy = tool.outer.reduce((a, p) => a + p.y, 0) / tool.outer.length
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== id) return o
          // For each vertex, find the closest vertex to its mirrored position
          // and average the two positions
          const newOuter = o.outer.map((p, i) => {
            const mirrorX = axis === 'x' ? 2 * cx - p.x : p.x
            const mirrorY = axis === 'y' ? 2 * cy - p.y : p.y
            let bestDist = Infinity
            let bestIdx = -1
            for (let j = 0; j < o.outer.length; j++) {
              if (j === i) continue
              const d = Math.hypot(o.outer[j].x - mirrorX, o.outer[j].y - mirrorY)
              if (d < bestDist) {
                bestDist = d
                bestIdx = j
              }
            }
            if (bestIdx >= 0 && bestDist < 15) {
              // Average: move this vertex and its mirror partner toward the midpoint
              const partner = o.outer[bestIdx]
              const avgX = axis === 'x' ? (p.x + (2 * cx - partner.x)) / 2 : p.x
              const avgY = axis === 'y' ? (p.y + (2 * cy - partner.y)) / 2 : p.y
              return { x: avgX, y: avgY }
            }
            return p
          })
          return { ...o, outer: newOuter }
        }),
      },
    }))
  },

  // --- Labels ---
  addLabel: (label) => {
    get().pushHistory()
    set((s) => ({ design: { ...s.design, labels: [...s.design.labels, label] } }))
  },

  updateLabel: (id, updates) => {
    get().pushHistory()
    set((s) => ({
      design: {
        ...s.design,
        labels: s.design.labels.map((l) => (l.id === id ? { ...l, ...updates } : l)),
      },
    }))
  },

  deleteLabel: (id) => {
    get().pushHistory()
    set((s) => ({
      design: { ...s.design, labels: s.design.labels.filter((l) => l.id !== id) },
    }))
  },

  moveLabel: (id, dx, dy) => {
    set((s) => ({
      design: {
        ...s.design,
        labels: s.design.labels.map((l) =>
          l.id === id ? { ...l, x: l.x + dx, y: l.y + dy } : l,
        ),
      },
    }))
  },

  setPaperSize: (size) => set((s) => ({ design: { ...s.design, paper_size: size } })),
  setName: (name) => set((s) => ({ design: { ...s.design, name } })),

  pushHistory: () => {
    const { design, history, historyIndex } = get()
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(design)
    set({ history: newHistory, historyIndex: newHistory.length - 1 })
  },

  undo: () => {
    const { history, historyIndex } = get()
    if (historyIndex > 0) {
      set({ design: history[historyIndex - 1], historyIndex: historyIndex - 1 })
    }
  },

  redo: () => {
    const { history, historyIndex } = get()
    if (historyIndex < history.length - 1) {
      set({ design: history[historyIndex + 1], historyIndex: historyIndex + 1 })
    }
  },

  reset: () => set({ design: { ...emptyDesign }, view: 'upload', selectedToolId: null, selectedToolIds: [], history: [], historyIndex: -1 }),
}))
