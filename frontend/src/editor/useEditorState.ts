// Central editor state via zustand.
import { create } from 'zustand'
import type { BinParams, Design, PaperSize, Point, ToolOutline } from '../types'
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
              }
            : o,
        ),
      },
    }))
  },

  updateVertex: (toolId, vertexIdx, pos) => {
    set((s) => ({
      design: {
        ...s.design,
        outlines: s.design.outlines.map((o) =>
          o.id === toolId
            ? { ...o, outer: o.outer.map((p, i) => (i === vertexIdx ? pos : p)) }
            : o,
        ),
      },
    }))
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
