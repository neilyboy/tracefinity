// Central baseplate editor state via zustand.
import { create } from 'zustand'
import type { BaseplateDesign, BaseplateParams, DrawerCutout, Point, SegmentInfo } from '../types'
import { DEFAULT_BASEPLATE_PARAMS } from '../types'

interface BaseplateState {
  design: BaseplateDesign
  selectedCutoutId: string | null
  segmentInfo: SegmentInfo | null
  loading: boolean
  error: string | null
  // History
  history: BaseplateDesign[]
  historyIndex: number

  // Actions
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setDesign: (design: BaseplateDesign) => void
  setParams: (params: Partial<BaseplateParams>) => void
  setName: (name: string) => void
  selectCutout: (id: string | null) => void
  addCutout: (cutout: DrawerCutout) => void
  updateCutout: (id: string, updates: Partial<DrawerCutout>) => void
  deleteCutout: (id: string) => void
  moveCutout: (id: string, dx: number, dy: number) => void
  setSegmentInfo: (info: SegmentInfo | null) => void
  undo: () => void
  redo: () => void
  pushHistory: () => void
  reset: () => void
}

const emptyDesign: BaseplateDesign = {
  id: null,
  name: 'Untitled Baseplate',
  params: { ...DEFAULT_BASEPLATE_PARAMS },
  cutouts: [],
}

export const useBaseplate = create<BaseplateState>((set, get) => ({
  design: { ...emptyDesign },
  selectedCutoutId: null,
  segmentInfo: null,
  loading: false,
  error: null,
  history: [{ ...emptyDesign, params: { ...DEFAULT_BASEPLATE_PARAMS }, cutouts: [] }],
  historyIndex: 0,

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setDesign: (design) => set({ design, history: [design], historyIndex: 0 }),

  setParams: (params) => {
    get().pushHistory()
    set((s) => ({
      design: { ...s.design, params: { ...s.design.params, ...params } },
    }))
  },

  setName: (name) => set((s) => ({ design: { ...s.design, name } })),

  selectCutout: (id) => set({ selectedCutoutId: id }),

  addCutout: (cutout) => {
    get().pushHistory()
    set((s) => ({
      design: { ...s.design, cutouts: [...s.design.cutouts, cutout] },
      selectedCutoutId: cutout.id,
    }))
  },

  updateCutout: (id, updates) => {
    set((s) => ({
      design: {
        ...s.design,
        cutouts: s.design.cutouts.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      },
    }))
  },

  deleteCutout: (id) => {
    get().pushHistory()
    set((s) => ({
      design: { ...s.design, cutouts: s.design.cutouts.filter((c) => c.id !== id) },
      selectedCutoutId: s.selectedCutoutId === id ? null : s.selectedCutoutId,
    }))
  },

  moveCutout: (id, dx, dy) => {
    set((s) => ({
      design: {
        ...s.design,
        cutouts: s.design.cutouts.map((c) =>
          c.id === id
            ? {
                ...c,
                x: c.x + dx,
                y: c.y + dy,
                outer: c.outer.map((p) => ({ x: p.x + dx, y: p.y + dy })),
              }
            : c
        ),
      },
    }))
  },

  setSegmentInfo: (info) => set({ segmentInfo: info }),

  pushHistory: () => {
    set((s) => {
      const newHistory = s.history.slice(0, s.historyIndex + 1)
      newHistory.push(JSON.parse(JSON.stringify(s.design)))
      if (newHistory.length > 50) newHistory.shift()
      return { history: newHistory, historyIndex: newHistory.length - 1 }
    })
  },

  undo: () => {
    set((s) => {
      if (s.historyIndex <= 0) return s
      const idx = s.historyIndex - 1
      return { design: JSON.parse(JSON.stringify(s.history[idx])), historyIndex: idx }
    })
  },

  redo: () => {
    set((s) => {
      if (s.historyIndex >= s.history.length - 1) return s
      const idx = s.historyIndex + 1
      return { design: JSON.parse(JSON.stringify(s.history[idx])), historyIndex: idx }
    })
  },

  reset: () => {
    set({
      design: { ...emptyDesign, params: { ...DEFAULT_BASEPLATE_PARAMS }, cutouts: [] },
      selectedCutoutId: null,
      segmentInfo: null,
      history: [{ ...emptyDesign, params: { ...DEFAULT_BASEPLATE_PARAMS }, cutouts: [] }],
      historyIndex: 0,
    })
  },
}))
