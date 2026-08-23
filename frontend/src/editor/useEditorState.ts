// Central editor state via zustand.
import { create } from 'zustand'
import type { BinParams, Design, PaperSize, Point, ToolOutline, TextLabel } from '../types'
import { DEFAULT_PARAMS } from '../types'

interface EditorState {
  // The current design being edited
  design: Design
  selectedToolId: string | null
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
  updateTool: (id: string, updates: Partial<ToolOutline>) => void
  deleteTool: (id: string) => void
  addTool: (tool: ToolOutline) => void
  duplicateTool: (id: string) => void
  moveTool: (id: string, dx: number, dy: number) => void
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

  setDesign: (design) => set({ design, view: 'editor', selectedToolId: null, history: [design], historyIndex: 0 }),

  setParams: (params) => {
    get().pushHistory()
    set((s) => ({ design: { ...s.design, params: { ...s.design.params, ...params } } }))
  },

  selectTool: (id) => set({ selectedToolId: id }),

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

  reset: () => set({ design: { ...emptyDesign }, view: 'upload', selectedToolId: null, history: [], historyIndex: -1 }),
}))
