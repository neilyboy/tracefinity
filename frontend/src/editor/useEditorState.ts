// Central editor state via zustand.
import { create } from 'zustand'
import type { BinParams, Design, PaperSize, Point, ToolOutline, TextLabel, VertexHandle, VertexHandleType } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { computeAutoHandles, mirrorHandle } from '../utils/smoothPath'

/** Helper: update a single handle in a handles array immutably */
function updateHandleInArray(handles: VertexHandle[], idx: number, updates: Partial<VertexHandle>): VertexHandle[] {
  return handles.map((h, i) => i === idx ? { ...h, ...updates } : h)
}

interface EditorState {
  // The current design being edited
  design: Design
  selectedToolId: string | null
  selectedToolIds: string[]  // multi-select (includes selectedToolId)
  // Which hole/island is selected for vertex editing (null = outer path)
  selectedHoleIdx: number | null
  // UI state
  view: 'upload' | 'calibrate' | 'trace' | 'editor'
  loading: boolean
  error: string | null
  // History for undo/redo
  history: Design[]
  historyIndex: number
  redoStack: Design[]
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
  selectHole: (holeIdx: number | null) => void
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
  // Hole/island vertex editing
  updateHoleVertex: (toolId: string, holeIdx: number, vertexIdx: number, pos: Point) => void
  addHoleVertex: (toolId: string, holeIdx: number, afterIdx: number, pos: Point) => void
  deleteHoleVertex: (toolId: string, holeIdx: number, vertexIdx: number) => void
  addHole: (toolId: string, hole?: Point[]) => void
  removeHole: (toolId: string, holeIdx: number) => void
  // Bezier handle editing
  updateVertexHandle: (toolId: string, vertexIdx: number, handle: Partial<VertexHandle>) => void
  updateHoleVertexHandle: (toolId: string, holeIdx: number, vertexIdx: number, handle: Partial<VertexHandle>) => void
  setVertexHandleType: (toolId: string, vertexIdx: number, type: VertexHandleType) => void
  setHoleVertexHandleType: (toolId: string, holeIdx: number, vertexIdx: number, type: VertexHandleType) => void
  toggleToolVisible: (id: string) => void
  scaleTool: (id: string, scaleFactor: number) => void
  mirrorTool: (id: string, axis: 'x' | 'y') => void
  // Symmetry actions
  setSymmetryAxis: (axis: 'x' | 'y' | null) => void
  setSymmetryMode: (mode: 'live' | 'manual') => void
  mirrorHalf: (toolId: string, axis: 'x' | 'y', source: 'left' | 'right' | 'top' | 'bottom', angle?: number) => void
  symmetrize: (toolId: string, axis: 'x' | 'y', angle?: number) => void
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
  trace_engine: 'auto',
}

export const useEditor = create<EditorState>((set, get) => ({
  design: { ...emptyDesign },
  selectedToolId: null,
  selectedToolIds: [],
  selectedHoleIdx: null,
  view: 'upload',
  loading: false,
  error: null,
  history: [],
  historyIndex: -1,
  redoStack: [],
  symmetryAxis: null,
  symmetryMode: 'live',

  setView: (view) => set({ view }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  setDesign: (design) => set({ design, view: 'editor', selectedToolId: null, selectedToolIds: [], selectedHoleIdx: null, history: [design], historyIndex: 0 }),

  setParams: (params) => {
    get().pushHistory()
    set((s) => ({ design: { ...s.design, params: { ...s.design.params, ...params } } }))
  },

  selectTool: (id) => set({ selectedToolId: id, selectedToolIds: id ? [id] : [], selectedHoleIdx: null }),

  selectHole: (holeIdx) => set({ selectedHoleIdx: holeIdx }),

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
    const offsetHandle = (h: VertexHandle): VertexHandle => ({
      ...h,
      cp_in: h.cp_in ? { x: h.cp_in.x + offset, y: h.cp_in.y + offset } : null,
      cp_out: h.cp_out ? { x: h.cp_out.x + offset, y: h.cp_out.y + offset } : null,
    })
    const dup: ToolOutline = {
      ...tool,
      id: newId,
      outer: tool.outer.map((p) => ({ x: p.x + offset, y: p.y + offset })),
      holes: tool.holes.map((h) => h.map((p) => ({ x: p.x + offset, y: p.y + offset }))),
      hole_candidates: (tool.hole_candidates ?? []).map((h) => h.map((p) => ({ x: p.x + offset, y: p.y + offset }))),
      outer_handles: (tool.outer_handles ?? []).map(offsetHandle),
      holes_handles: (tool.holes_handles ?? []).map((hh) => hh.map(offsetHandle)),
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
        hole_candidates: (tool.hole_candidates ?? []).map((hp) => hp.map((p) => ({ x: p.x + offsetX * i, y: p.y }))),
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
          hole_candidates: (tool.hole_candidates ?? []).map((hp) => hp.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
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
                hole_candidates: (o.hole_candidates ?? []).map((h) => h.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
                outer_handles: (o.outer_handles ?? []).map((h) => ({
                  ...h,
                  cp_in: h.cp_in ? { x: h.cp_in.x + dx, y: h.cp_in.y + dy } : null,
                  cp_out: h.cp_out ? { x: h.cp_out.x + dx, y: h.cp_out.y + dy } : null,
                })),
                holes_handles: (o.holes_handles ?? []).map((hh) => hh.map((h) => ({
                  ...h,
                  cp_in: h.cp_in ? { x: h.cp_in.x + dx, y: h.cp_in.y + dy } : null,
                  cp_out: h.cp_out ? { x: h.cp_out.x + dx, y: h.cp_out.y + dy } : null,
                }))),
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
                hole_candidates: (o.hole_candidates ?? []).map((h) => h.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
                outer_handles: (o.outer_handles ?? []).map((h) => ({
                  ...h,
                  cp_in: h.cp_in ? { x: h.cp_in.x + dx, y: h.cp_in.y + dy } : null,
                  cp_out: h.cp_out ? { x: h.cp_out.x + dx, y: h.cp_out.y + dy } : null,
                })),
                holes_handles: (o.holes_handles ?? []).map((hh) => hh.map((h) => ({
                  ...h,
                  cp_in: h.cp_in ? { x: h.cp_in.x + dx, y: h.cp_in.y + dy } : null,
                  cp_out: h.cp_out ? { x: h.cp_out.x + dx, y: h.cp_out.y + dy } : null,
                }))),
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
          const rotateHandle = (h: VertexHandle): VertexHandle => ({
            ...h,
            cp_in: h.cp_in ? rotatePt(h.cp_in) : null,
            cp_out: h.cp_out ? rotatePt(h.cp_out) : null,
          })
          return {
            ...o,
            outer: o.outer.map(rotatePt),
            holes: o.holes.map((h) => h.map(rotatePt)),
            hole_candidates: (o.hole_candidates ?? []).map((h) => h.map(rotatePt)),
            outer_handles: (o.outer_handles ?? []).map(rotateHandle),
            holes_handles: (o.holes_handles ?? []).map((hh) => hh.map(rotateHandle)),
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
            hole_candidates: (o.hole_candidates ?? []).map((h) => h.map(movePt)),
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
            hole_candidates: (o.hole_candidates ?? []).map((h) => h.map(movePt)),
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
          outlines: s.design.outlines.map((o) => {
            if (o.id !== toolId) return o
            const oldPos = o.outer[vertexIdx]
            const dx = pos.x - oldPos.x
            const dy = pos.y - oldPos.y
            // Move bezier handles along with the vertex
            const handles = o.outer_handles ?? []
            let newHandles = handles
            if (handles.length === o.outer.length && handles[vertexIdx]) {
              const h = handles[vertexIdx]
              if (h.cp_in) {
                const movedCpIn = { x: h.cp_in.x + dx, y: h.cp_in.y + dy }
                newHandles = updateHandleInArray(newHandles, vertexIdx, { cp_in: movedCpIn })
              }
              if (h.cp_out) {
                const movedCpOut = { x: h.cp_out.x + dx, y: h.cp_out.y + dy }
                newHandles = updateHandleInArray(newHandles, vertexIdx, { cp_out: movedCpOut })
              }
            }
            return {
              ...o,
              outer: o.outer.map((p, i) => {
                if (i === vertexIdx) return pos
                if (i === mirroredIdx && mirroredPos) return mirroredPos
                return p
              }),
              outer_handles: newHandles,
            }
          }),
        },
      }
    })
  },

  addVertex: (toolId, afterIdx, pos) => {
    get().pushHistory()
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== toolId) return o
          const handles = o.outer_handles ?? []
          // Insert a new "auto" handle for the new vertex
          let newHandles = handles
          if (handles.length === o.outer.length) {
            newHandles = [...handles.slice(0, afterIdx + 1), { cp_in: null, cp_out: null, type: 'auto' as VertexHandleType }, ...handles.slice(afterIdx + 1)]
          }
          return {
            ...o,
            outer: [...o.outer.slice(0, afterIdx + 1), pos, ...o.outer.slice(afterIdx + 1)],
            outer_handles: newHandles,
          }
        }),
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
        outlines: s.design.outlines.map((o) => {
          if (o.id !== toolId) return o
          const handles = o.outer_handles ?? []
          let newHandles = handles
          if (handles.length === o.outer.length) {
            newHandles = handles.filter((_, i) => i !== vertexIdx)
          }
          return {
            ...o,
            outer: o.outer.filter((_, i) => i !== vertexIdx),
            outer_handles: newHandles,
          }
        }),
      },
    }))
  },

  // --- Hole/island vertex editing ---
  updateHoleVertex: (toolId, holeIdx, vertexIdx, pos) => {
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== toolId) return o
          const hole = o.holes[holeIdx]
          if (!hole) return o
          const oldPos = hole[vertexIdx]
          const dx = pos.x - oldPos.x
          const dy = pos.y - oldPos.y
          // Move handles along with the vertex
          const holesHandles = o.holes_handles ?? []
          let newHolesHandles = holesHandles
          if (holesHandles.length === o.holes.length && holesHandles[holeIdx]) {
            const holeHandles = holesHandles[holeIdx]
            if (holeHandles.length === hole.length && holeHandles[vertexIdx]) {
              const h = holeHandles[vertexIdx]
              const updatedH = { ...h }
              if (h.cp_in) updatedH.cp_in = { x: h.cp_in.x + dx, y: h.cp_in.y + dy }
              if (h.cp_out) updatedH.cp_out = { x: h.cp_out.x + dx, y: h.cp_out.y + dy }
              newHolesHandles = holesHandles.map((hh, hi) => hi === holeIdx
                ? hh.map((vh, vi) => vi === vertexIdx ? updatedH : vh)
                : hh)
            }
          }
          return {
            ...o,
            holes: o.holes.map((h, hi) => hi === holeIdx
              ? h.map((p, pi) => pi === vertexIdx ? pos : p)
              : h),
            holes_handles: newHolesHandles,
          }
        }),
      },
    }))
  },

  addHoleVertex: (toolId, holeIdx, afterIdx, pos) => {
    get().pushHistory()
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== toolId) return o
          const hole = o.holes[holeIdx]
          if (!hole) return o
          const holesHandles = o.holes_handles ?? []
          let newHolesHandles = holesHandles
          if (holesHandles.length === o.holes.length && holesHandles[holeIdx] && holesHandles[holeIdx].length === hole.length) {
            newHolesHandles = holesHandles.map((hh, hi) => hi === holeIdx
              ? [...hh.slice(0, afterIdx + 1), { cp_in: null, cp_out: null, type: 'auto' as VertexHandleType }, ...hh.slice(afterIdx + 1)]
              : hh)
          }
          return {
            ...o,
            holes: o.holes.map((h, hi) => hi === holeIdx
              ? [...h.slice(0, afterIdx + 1), pos, ...h.slice(afterIdx + 1)]
              : h),
            holes_handles: newHolesHandles,
          }
        }),
      },
    }))
  },

  deleteHoleVertex: (toolId, holeIdx, vertexIdx) => {
    const tool = get().design.outlines.find((o) => o.id === toolId)
    if (!tool) return
    const hole = tool.holes[holeIdx]
    if (!hole || hole.length <= 3) return
    get().pushHistory()
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== toolId) return o
          const holesHandles = o.holes_handles ?? []
          let newHolesHandles = holesHandles
          if (holesHandles.length === o.holes.length && holesHandles[holeIdx] && holesHandles[holeIdx].length === hole.length) {
            newHolesHandles = holesHandles.map((hh, hi) => hi === holeIdx
              ? hh.filter((_, vi) => vi !== vertexIdx)
              : hh)
          }
          return {
            ...o,
            holes: o.holes.map((h, hi) => hi === holeIdx
              ? h.filter((_, vi) => vi !== vertexIdx)
              : h),
            holes_handles: newHolesHandles,
          }
        }),
      },
    }))
  },

  addHole: (toolId, hole) => {
    const tool = get().design.outlines.find((o) => o.id === toolId)
    if (!tool) return
    // Default: a small circle in the center of the tool
    const newHole = hole ?? (() => {
      const xs = tool.outer.map((p) => p.x)
      const ys = tool.outer.map((p) => p.y)
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2
      const rx = Math.max(2, (Math.max(...xs) - Math.min(...xs)) * 0.12)
      const ry = Math.max(2, (Math.max(...ys) - Math.min(...ys)) * 0.12)
      return Array.from({ length: 20 }, (_, i) => {
        const a = i / 20 * Math.PI * 2
        return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry }
      })
    })()
    get().pushHistory()
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== toolId) return o
          const newHoleHandles = newHole.map(() => ({ cp_in: null, cp_out: null, type: 'auto' as VertexHandleType }))
          const holesHandles = o.holes_handles ?? []
          return {
            ...o,
            holes: [...o.holes, newHole],
            holes_handles: holesHandles.length === o.holes.length
              ? [...holesHandles, newHoleHandles]
              : holesHandles,
          }
        }),
      },
    }))
  },

  removeHole: (toolId, holeIdx) => {
    get().pushHistory()
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== toolId) return o
          const holesHandles = o.holes_handles ?? []
          return {
            ...o,
            holes: o.holes.filter((_, hi) => hi !== holeIdx),
            holes_handles: holesHandles.length === o.holes.length
              ? holesHandles.filter((_, hi) => hi !== holeIdx)
              : holesHandles,
          }
        }),
      },
    }))
    // Clear hole selection if we removed the selected hole
    if (get().selectedHoleIdx === holeIdx) {
      set({ selectedHoleIdx: null })
    }
  },

  // --- Bezier handle editing ---
  updateVertexHandle: (toolId, vertexIdx, handle) => {
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== toolId) return o
          const handles = o.outer_handles ?? []
          // Ensure handles array is initialized
          let newHandles: VertexHandle[]
          if (handles.length !== o.outer.length) {
            newHandles = o.outer.map(() => ({ cp_in: null, cp_out: null, type: 'auto' as VertexHandleType }))
          } else {
            newHandles = [...handles]
          }
          const existing = newHandles[vertexIdx]
          const updated = { ...existing, ...handle }
          // If type is "smooth" and we updated one handle, mirror the other
          if (updated.type === 'smooth' && updated.cp_out && handle.cp_out) {
            updated.cp_in = mirrorHandle(o.outer[vertexIdx], updated.cp_out)
          } else if (updated.type === 'smooth' && updated.cp_in && handle.cp_in) {
            updated.cp_out = mirrorHandle(o.outer[vertexIdx], updated.cp_in)
          }
          newHandles[vertexIdx] = updated
          return { ...o, outer_handles: newHandles }
        }),
      },
    }))
  },

  updateHoleVertexHandle: (toolId, holeIdx, vertexIdx, handle) => {
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== toolId) return o
          const hole = o.holes[holeIdx]
          if (!hole) return o
          let holesHandles = o.holes_handles ?? []
          // Ensure holes_handles is properly initialized
          if (holesHandles.length !== o.holes.length) {
            holesHandles = o.holes.map((h) => h.map(() => ({ cp_in: null, cp_out: null, type: 'auto' as VertexHandleType })))
          }
          let holeHandles = holesHandles[holeIdx]
          if (!holeHandles || holeHandles.length !== hole.length) {
            holeHandles = hole.map(() => ({ cp_in: null, cp_out: null, type: 'auto' as VertexHandleType }))
          } else {
            holeHandles = [...holeHandles]
          }
          const existing = holeHandles[vertexIdx]
          const updated = { ...existing, ...handle }
          // If type is "smooth" and we updated one handle, mirror the other
          if (updated.type === 'smooth' && updated.cp_out && handle.cp_out) {
            updated.cp_in = mirrorHandle(hole[vertexIdx], updated.cp_out)
          } else if (updated.type === 'smooth' && updated.cp_in && handle.cp_in) {
            updated.cp_out = mirrorHandle(hole[vertexIdx], updated.cp_in)
          }
          holeHandles[vertexIdx] = updated
          return {
            ...o,
            holes_handles: holesHandles.map((hh, hi) => hi === holeIdx ? holeHandles : hh),
          }
        }),
      },
    }))
  },

  setVertexHandleType: (toolId, vertexIdx, type) => {
    get().pushHistory()
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== toolId) return o
          const handles = o.outer_handles ?? []
          let newHandles: VertexHandle[]
          if (handles.length !== o.outer.length) {
            newHandles = o.outer.map(() => ({ cp_in: null, cp_out: null, type: 'auto' as VertexHandleType }))
          } else {
            newHandles = [...handles]
          }
          if (type === 'auto' || type === 'straight') {
            // Clear explicit handles
            newHandles[vertexIdx] = { cp_in: null, cp_out: null, type }
          } else if (type === 'smooth' || type === 'sharp') {
            // Compute auto handles from Catmull-Rom as starting point
            const n = o.outer.length
            const prev = o.outer[(vertexIdx - 1 + n) % n]
            const curr = o.outer[vertexIdx]
            const next = o.outer[(vertexIdx + 1) % n]
            const auto = computeAutoHandles(prev, curr, next, o.smoothing)
            newHandles[vertexIdx] = { cp_in: auto.cp_in, cp_out: auto.cp_out, type }
          }
          return { ...o, outer_handles: newHandles }
        }),
      },
    }))
  },

  setHoleVertexHandleType: (toolId, holeIdx, vertexIdx, type) => {
    get().pushHistory()
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== toolId) return o
          const hole = o.holes[holeIdx]
          if (!hole) return o
          let holesHandles = o.holes_handles ?? []
          if (holesHandles.length !== o.holes.length) {
            holesHandles = o.holes.map((h) => h.map(() => ({ cp_in: null, cp_out: null, type: 'auto' as VertexHandleType })))
          }
          let holeHandles = [...holesHandles[holeIdx]]
          if (!holeHandles || holeHandles.length !== hole.length) {
            holeHandles = hole.map(() => ({ cp_in: null, cp_out: null, type: 'auto' as VertexHandleType }))
          }
          if (type === 'auto' || type === 'straight') {
            holeHandles[vertexIdx] = { cp_in: null, cp_out: null, type }
          } else if (type === 'smooth' || type === 'sharp') {
            const n = hole.length
            const prev = hole[(vertexIdx - 1 + n) % n]
            const curr = hole[vertexIdx]
            const next = hole[(vertexIdx + 1) % n]
            const auto = computeAutoHandles(prev, curr, next, o.smoothing)
            holeHandles[vertexIdx] = { cp_in: auto.cp_in, cp_out: auto.cp_out, type }
          }
          return {
            ...o,
            holes_handles: holesHandles.map((hh, hi) => hi === holeIdx ? holeHandles : hh),
          }
        }),
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
          const scalePt = (p: Point): Point => ({
            x: cx + (p.x - cx) * scaleFactor,
            y: cy + (p.y - cy) * scaleFactor,
          })
          const scaleHandle = (h: VertexHandle): VertexHandle => ({
            ...h,
            cp_in: h.cp_in ? scalePt(h.cp_in) : null,
            cp_out: h.cp_out ? scalePt(h.cp_out) : null,
          })
          return {
            ...o,
            outer: o.outer.map(scalePt),
            holes: o.holes.map((h) => h.map(scalePt)),
            hole_candidates: (o.hole_candidates ?? []).map((h) => h.map(scalePt)),
            outer_handles: (o.outer_handles ?? []).map(scaleHandle),
            holes_handles: (o.holes_handles ?? []).map((hh) => hh.map(scaleHandle)),
            finger_holes: (o.finger_holes ?? []).map((fh) => ({
              ...fh,
              x: scalePt(fh).x,
              y: scalePt(fh).y,
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
          const mirrorHandle = (h: VertexHandle): VertexHandle => ({
            ...h,
            // Swap cp_in and cp_out because mirroring reverses winding
            cp_in: h.cp_out ? mirror(h.cp_out) : null,
            cp_out: h.cp_in ? mirror(h.cp_in) : null,
          })
          // Reverse winding for mirrored polygon to maintain CCW
          const mirroredOuter = o.outer.map(mirror).reverse()
          return {
            ...o,
            outer: mirroredOuter,
            holes: o.holes.map((h) => h.map(mirror).reverse()),
            hole_candidates: (o.hole_candidates ?? []).map((h) => h.map(mirror).reverse()),
            outer_handles: (o.outer_handles ?? []).map(mirrorHandle).reverse(),
            holes_handles: (o.holes_handles ?? []).map((hh) => hh.map(mirrorHandle).reverse()),
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

  mirrorHalf: (id, axis, source, angle = 0) => {
    // Copy geometry from one side of the symmetry axis to the other.
    // source: 'left'/'right' for X axis, 'top'/'bottom' for Y axis.
    // angle: rotation of the symmetry axis in degrees (0 = straight, auto-detected from tool shape).
    // The "source" side is kept; the other side is replaced with mirrored copies.
    const tool = get().design.outlines.find((o) => o.id === id)
    if (!tool) return
    get().pushHistory()
    const cx = tool.outer.reduce((a, p) => a + p.x, 0) / tool.outer.length
    const cy = tool.outer.reduce((a, p) => a + p.y, 0) / tool.outer.length
    // For X axis: the mirror line is vertical (at angle). For Y axis: horizontal (at angle).
    // The base mirror direction: X axis mirrors across a vertical line, Y axis across horizontal.
    // With angle rotation: rotate points by -angle, mirror across the base axis, rotate back.
    const rad = (angle * Math.PI) / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)
    // Rotate a point into the axis-aligned frame
    const toLocal = (p: Point): Point => ({
      x: (p.x - cx) * cos + (p.y - cy) * sin,
      y: -(p.x - cx) * sin + (p.y - cy) * cos,
    })
    // Rotate a point back from the axis-aligned frame
    const toWorld = (p: Point): Point => ({
      x: cx + p.x * cos - p.y * sin,
      y: cy + p.x * sin + p.y * cos,
    })
    // Mirror a local point across the base axis
    const mirrorLocal = (p: Point): Point =>
      axis === 'x' ? { x: -p.x, y: p.y } : { x: p.x, y: -p.y }

    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== id) return o
          // Split vertices into source side and target side (in local frame)
          const sourcePts: Point[] = []
          for (const p of o.outer) {
            const lp = toLocal(p)
            if (axis === 'x') {
              if (source === 'left' ? lp.x <= 0 : lp.x >= 0) sourcePts.push(p)
            } else {
              if (source === 'top' ? lp.y <= 0 : lp.y >= 0) sourcePts.push(p)
            }
          }
          // Mirror the source points to create the new target side
          const mirroredSource = sourcePts.map((p) => toWorld(mirrorLocal(toLocal(p))))
          // Combine: source points + mirrored source points
          const allPts = [...sourcePts, ...mirroredSource]
          // Sort by angle around centroid to maintain polygon order
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

  symmetrize: (id, axis, angle = 0) => {
    // Average both sides for perfect symmetry.
    // For each vertex, find its mirror partner (across the angled axis) and average both positions.
    const tool = get().design.outlines.find((o) => o.id === id)
    if (!tool) return
    get().pushHistory()
    const cx = tool.outer.reduce((a, p) => a + p.x, 0) / tool.outer.length
    const cy = tool.outer.reduce((a, p) => a + p.y, 0) / tool.outer.length
    const rad = (angle * Math.PI) / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)
    const toLocal = (p: Point): Point => ({
      x: (p.x - cx) * cos + (p.y - cy) * sin,
      y: -(p.x - cx) * sin + (p.y - cy) * cos,
    })
    const toWorld = (p: Point): Point => ({
      x: cx + p.x * cos - p.y * sin,
      y: cy + p.x * sin + p.y * cos,
    })
    const mirrorLocal = (p: Point): Point =>
      axis === 'x' ? { x: -p.x, y: p.y } : { x: p.x, y: -p.y }

    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) => {
          if (o.id !== id) return o
          // For each vertex, find the closest vertex to its mirrored position
          // and average the two positions
          const newOuter = o.outer.map((p, i) => {
            const mirroredWorld = toWorld(mirrorLocal(toLocal(p)))
            let bestDist = Infinity
            let bestIdx = -1
            for (let j = 0; j < o.outer.length; j++) {
              if (j === i) continue
              const d = Math.hypot(o.outer[j].x - mirroredWorld.x, o.outer[j].y - mirroredWorld.y)
              if (d < bestDist) {
                bestDist = d
                bestIdx = j
              }
            }
            if (bestIdx >= 0 && bestDist < 15) {
              // Average: move this vertex and its mirror partner toward the midpoint
              const partner = o.outer[bestIdx]
              return { x: (p.x + mirroredWorld.x) / 2, y: (p.y + mirroredWorld.y) / 2 }
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
    if (historyIndex >= 0 && JSON.stringify(history[historyIndex]) === JSON.stringify(design)) return
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(design)
    set({ history: newHistory, historyIndex: newHistory.length - 1, redoStack: [] })
  },

  undo: () => {
    const { history, historyIndex, design, redoStack } = get()
    if (historyIndex >= 0) {
      // Save current (post-mutation) design to redo stack
      set({
        design: history[historyIndex],
        historyIndex: historyIndex - 1,
        redoStack: [...redoStack, design],
      })
    }
  },

  redo: () => {
    const { redoStack, history, historyIndex } = get()
    if (redoStack.length > 0) {
      const redoState = redoStack[redoStack.length - 1]
      // Push current design to history for undo
      const newHistory = history.slice(0, historyIndex + 1)
      newHistory.push(get().design)
      set({
        design: redoState,
        history: newHistory,
        historyIndex: newHistory.length - 1,
        redoStack: redoStack.slice(0, -1),
      })
    }
  },

  reset: () => set({ design: { ...emptyDesign }, view: 'upload', selectedToolId: null, selectedToolIds: [], selectedHoleIdx: null, history: [], historyIndex: -1, redoStack: [] }),
}))
