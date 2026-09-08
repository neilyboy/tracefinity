import { useState, useRef, useEffect, useCallback } from 'react'
import { useEditor } from '../editor/useEditorState'
import { suggestGridSize } from '../editor/gridSnap'
import { smoothClosedPath, computeAutoHandles, mirrorHandle } from '../utils/smoothPath'
import { detectToolAtPoint, listTraceEngines, mergeOutlines, retraceImage, splitOutline } from '../api/client'
import type { Point, TraceEngine, TraceEngineInfo, ToolOutline, VertexHandle, VertexHandleType } from '../types'

export default function TraceView() {
  const {
    design, setView, toggleToolVisible, setParams, addTool, deleteTool, updateTool, pushHistory,
    selectTools: selectEditorTools,
    updateVertexHandle, updateHoleVertexHandle, setVertexHandleType, setHoleVertexHandleType,
    addHole, removeHole,
    undo, redo, history, historyIndex,
    symmetryAxis, symmetryMode, setSymmetryAxis, setSymmetryMode,
    mirrorHalf, symmetrize,
  } = useEditor()

  // --- Selection state (local to TraceView) ---
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([])
  const [selectedHole, setSelectedHole] = useState<number | null>(null)

  // --- Tool modes ---
  const [addingTool, setAddingTool] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [splitStart, setSplitStart] = useState<Point | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // --- Trace engine ---
  const [traceEngine, setTraceEngine] = useState<TraceEngine>(design.trace_engine ?? 'hybrid')
  const [traceEngines, setTraceEngines] = useState<TraceEngineInfo[]>([])
  const [smoothing, setSmoothing] = useState(0.3)

  // --- Drag state ---
  const [dragVertex, setDragVertex] = useState<{ toolId: string; hole: number | null; vertex: number; startMm: Point; startPoints: Point[]; startHandles: VertexHandle[] } | null>(null)
  const [dragHandle, setDragHandle] = useState<{ toolId: string; hole: number | null; vertex: number; end: 'cp_in' | 'cp_out'; startMm: Point; startHandle: VertexHandle } | null>(null)

  // --- Pen tool ---
  const [penMode, setPenMode] = useState<'none' | 'tool' | 'hole'>('none')
  const [penPoints, setPenPoints] = useState<Point[]>([])  // in mm

  // --- UI toggles ---
  const [showLoupe, setShowLoupe] = useState(true)
  const [showHandles, setShowHandles] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const [loupePos, setLoupePos] = useState<{ px: number; py: number } | null>(null)
  const [imageZoom, setImageZoom] = useState(1)  // zoom level for the image (1 = fit to width)
  const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const magnifierRef = useRef<HTMLCanvasElement>(null)
  const LOUPE_ZOOM = 4
  const LOUPE_SIZE = 200

  // --- Load trace engines ---
  useEffect(() => {
    listTraceEngines().then(setTraceEngines).catch(() => {})
  }, [])

  // --- Coordinate conversion ---
  const imagePoint = useCallback((clientX: number, clientY: number): Point | null => {
    if (!imgRef.current) return null
    const rect = imgRef.current.getBoundingClientRect()
    return {
      x: (clientX - rect.left) * design.rectified_w_px / rect.width,
      y: (clientY - rect.top) * design.rectified_h_px / rect.height,
    }
  }, [design.rectified_w_px, design.rectified_h_px])

  const imagePointMm = useCallback((clientX: number, clientY: number): Point | null => {
    const pt = imagePoint(clientX, clientY)
    if (!pt) return null
    return { x: pt.x * design.scale_mm_per_px, y: pt.y * design.scale_mm_per_px }
  }, [imagePoint, design.scale_mm_per_px])

  // --- Magnifier loupe ---
  useEffect(() => {
    if (!showLoupe || !loupePos || !imgRef.current || !magnifierRef.current) return
    const canvas = magnifierRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = imgRef.current
    const srcSize = LOUPE_SIZE / LOUPE_ZOOM
    const sx = loupePos.px - srcSize / 2
    const sy = loupePos.py - srcSize / 2
    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE)
    ctx.imageSmoothingEnabled = false
    try {
      ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, LOUPE_SIZE, LOUPE_SIZE)
    } catch {
      return
    }

    // Helper: convert image px to loupe canvas px
    const toLoupeX = (px: number) => (px - sx) * LOUPE_ZOOM
    const toLoupeY = (py: number) => (py - sy) * LOUPE_ZOOM

    // Draw tool paths on top of the image
    const scale = design.scale_mm_per_px
    for (const tool of design.outlines) {
      if (!tool.visible) continue
      const isSelected = selectedToolIds.includes(tool.id)
      const outerPx = tool.outer.map((p) => ({ x: p.x / scale, y: p.y / scale }))

      // Outer path
      ctx.strokeStyle = isSelected ? '#a78bfa' : '#71717a'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let i = 0; i < outerPx.length; i++) {
        const lx = toLoupeX(outerPx[i].x)
        const ly = toLoupeY(outerPx[i].y)
        if (i === 0) ctx.moveTo(lx, ly)
        else ctx.lineTo(lx, ly)
      }
      ctx.closePath()
      ctx.stroke()

      // Holes
      for (const hole of tool.holes) {
        const hPx = hole.map((p) => ({ x: p.x / scale, y: p.y / scale }))
        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let i = 0; i < hPx.length; i++) {
          const lx = toLoupeX(hPx[i].x)
          const ly = toLoupeY(hPx[i].y)
          if (i === 0) ctx.moveTo(lx, ly)
          else ctx.lineTo(lx, ly)
        }
        ctx.closePath()
        ctx.stroke()
      }

      // Vertices for selected tool
      if (isSelected && showHandles) {
        const handles = tool.outer_handles ?? []
        for (let vi = 0; vi < outerPx.length; vi++) {
          const lx = toLoupeX(outerPx[vi].x)
          const ly = toLoupeY(outerPx[vi].y)
          const h = handles[vi]
          const handleType = h?.type ?? 'auto'

          // Bezier handle lines and circles
          if (h && h.type !== 'auto' && h.type !== 'straight') {
            if (h.cp_in) {
              const cpPx = { x: h.cp_in.x / scale, y: h.cp_in.y / scale }
              const cpx = toLoupeX(cpPx.x)
              const cpy = toLoupeY(cpPx.y)
              ctx.strokeStyle = '#3b82f6'
              ctx.lineWidth = 1
              ctx.setLineDash([3, 2])
              ctx.beginPath()
              ctx.moveTo(lx, ly)
              ctx.lineTo(cpx, cpy)
              ctx.stroke()
              ctx.setLineDash([])
              ctx.fillStyle = '#3b82f6'
              ctx.beginPath()
              ctx.arc(cpx, cpy, 4, 0, Math.PI * 2)
              ctx.fill()
            }
            if (h.cp_out) {
              const cpPx = { x: h.cp_out.x / scale, y: h.cp_out.y / scale }
              const cpx = toLoupeX(cpPx.x)
              const cpy = toLoupeY(cpPx.y)
              ctx.strokeStyle = '#3b82f6'
              ctx.lineWidth = 1
              ctx.setLineDash([3, 2])
              ctx.beginPath()
              ctx.moveTo(lx, ly)
              ctx.lineTo(cpx, cpy)
              ctx.stroke()
              ctx.setLineDash([])
              ctx.fillStyle = '#3b82f6'
              ctx.beginPath()
              ctx.arc(cpx, cpy, 4, 0, Math.PI * 2)
              ctx.fill()
            }
          }

          // Vertex dot
          ctx.fillStyle = handleType === 'smooth' ? '#22d3ee' : handleType === 'sharp' ? '#fbbf24' : handleType === 'straight' ? '#71717a' : '#22c55e'
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(lx, ly, 3.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        }
      }
    }

    // Crosshair
    ctx.strokeStyle = '#a78bfa'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(LOUPE_SIZE / 2 - 12, LOUPE_SIZE / 2)
    ctx.lineTo(LOUPE_SIZE / 2 + 12, LOUPE_SIZE / 2)
    ctx.moveTo(LOUPE_SIZE / 2, LOUPE_SIZE / 2 - 12)
    ctx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE / 2 + 12)
    ctx.stroke()
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(LOUPE_SIZE / 2, LOUPE_SIZE / 2, 8, 0, Math.PI * 2)
    ctx.stroke()
  }, [showLoupe, loupePos, design.rectified_w_px, design.rectified_h_px, design.outlines, design.scale_mm_per_px, selectedToolIds, showHandles])

  // --- Path update helpers ---
  const replacePath = (toolId: string, hole: number | null, points: Point[]) => {
    useEditor.setState((state) => ({
      design: {
        ...state.design,
        outlines: state.design.outlines.map((tool) => {
          if (tool.id !== toolId) return tool
          if (hole === null) return { ...tool, outer: points }
          return { ...tool, holes: tool.holes.map((p, i) => i === hole ? points : p) }
        }),
      },
    }))
  }

  const replaceHandles = (toolId: string, hole: number | null, handles: VertexHandle[]) => {
    useEditor.setState((state) => ({
      design: {
        ...state.design,
        outlines: state.design.outlines.map((tool) => {
          if (tool.id !== toolId) return tool
          if (hole === null) return { ...tool, outer_handles: handles }
          return { ...tool, holes_handles: tool.holes_handles?.map((h, i) => i === hole ? handles : h) ?? [] }
        }),
      },
    }))
  }

  // --- Vertex dragging ---
  const handleVertexPointerDown = (e: React.PointerEvent, toolId: string, hole: number | null, vertex: number) => {
    e.stopPropagation()
    e.preventDefault()
    const pt = imagePointMm(e.clientX, e.clientY)
    if (!pt) return
    const tool = design.outlines.find((t) => t.id === toolId)
    if (!tool) return
    const path = hole === null ? tool.outer : tool.holes[hole]
    if (!path) return
    pushHistory()
    const startHandles = (hole === null ? (tool.outer_handles ?? []) : ((tool.holes_handles ?? [])[hole] ?? [])).map((h) => ({ ...h, cp_in: h.cp_in ? { ...h.cp_in } : null, cp_out: h.cp_out ? { ...h.cp_out } : null }))
    setDragVertex({ toolId, hole, vertex, startMm: pt, startPoints: path.map((p) => ({ ...p })), startHandles })
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const handleHandlePointerDown = (e: React.PointerEvent, toolId: string, hole: number | null, vertex: number, end: 'cp_in' | 'cp_out') => {
    e.stopPropagation()
    e.preventDefault()
    const pt = imagePointMm(e.clientX, e.clientY)
    if (!pt) return
    const tool = design.outlines.find((t) => t.id === toolId)
    if (!tool) return
    const handles = hole === null ? (tool.outer_handles ?? []) : ((tool.holes_handles ?? [])[hole] ?? [])
    const h = handles[vertex]
    if (!h) return
    pushHistory()
    setDragHandle({ toolId, hole, vertex, end, startMm: pt, startHandle: { ...h } })
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    const pt = imagePointMm(e.clientX, e.clientY)
    if (!pt) return

    if (dragVertex || dragHandle) {
      e.preventDefault()
    }

    if (dragVertex) {
      const dx = pt.x - dragVertex.startMm.x
      const dy = pt.y - dragVertex.startMm.y
      const newPoints = dragVertex.startPoints.map((p, i) =>
        i === dragVertex.vertex ? { x: p.x + dx, y: p.y + dy } : p
      )
      replacePath(dragVertex.toolId, dragVertex.hole, newPoints)
      // Move handles with the vertex — use startHandles (captured at drag start)
      // to avoid compounding the delta on already-moved handles
      if (dragVertex.startHandles.length === newPoints.length) {
        const newHandles = dragVertex.startHandles.map((h, i) => {
          if (i !== dragVertex.vertex) return h
          return {
            ...h,
            cp_in: h.cp_in ? { x: h.cp_in.x + dx, y: h.cp_in.y + dy } : null,
            cp_out: h.cp_out ? { x: h.cp_out.x + dx, y: h.cp_out.y + dy } : null,
          }
        })
        replaceHandles(dragVertex.toolId, dragVertex.hole, newHandles)
      }
    } else if (dragHandle) {
      const newPos = { x: pt.x, y: pt.y }
      const tool = useEditor.getState().design.outlines.find((t) => t.id === dragHandle.toolId)
      if (!tool) return
      const path = dragHandle.hole === null ? tool.outer : tool.holes[dragHandle.hole]
      if (!path) return
      const vertex = path[dragHandle.vertex]
      const handles = dragHandle.hole === null ? (tool.outer_handles ?? []) : ((tool.holes_handles ?? [])[dragHandle.hole] ?? [])
      const h = handles[dragHandle.vertex]
      if (!h) return

      let newHandle: VertexHandle = { ...h }
      if (dragHandle.end === 'cp_out') {
        newHandle.cp_out = newPos
        // If smooth, mirror cp_in
        if (h.type === 'smooth' && h.cp_in) {
          newHandle.cp_in = mirrorHandle(vertex, newPos)
        }
      } else {
        newHandle.cp_in = newPos
        if (h.type === 'smooth' && h.cp_out) {
          newHandle.cp_out = mirrorHandle(vertex, newPos)
        }
      }

      if (dragHandle.hole === null) {
        updateVertexHandle(dragHandle.toolId, dragHandle.vertex, newHandle)
      } else {
        updateHoleVertexHandle(dragHandle.toolId, dragHandle.hole, dragHandle.vertex, newHandle)
      }
    }
  }

  const handlePointerUp = () => {
    if (dragVertex || dragHandle) pushHistory()
    setDragVertex(null)
    setDragHandle(null)
  }

  // --- Pen tool ---
  const handlePenClick = (e: React.MouseEvent) => {
    if (penMode === 'none') return
    e.stopPropagation()
    const pt = imagePointMm(e.clientX, e.clientY)
    if (!pt) return
    // Close path if clicking near first point
    if (penPoints.length >= 3) {
      const first = penPoints[0]
      const distPx = Math.hypot(pt.x - first.x, pt.y - first.y) / design.scale_mm_per_px
      if (distPx < 15) {
        finishPenPath()
        return
      }
    }
    setPenPoints([...penPoints, pt])
  }

  const handlePenDoubleClick = (e: React.MouseEvent) => {
    if (penMode === 'none') return
    e.stopPropagation()
    if (penPoints.length >= 3) finishPenPath()
  }

  const finishPenPath = () => {
    if (penPoints.length < 3) { cancelPen(); return }
    pushHistory()
    const handles: VertexHandle[] = penPoints.map(() => ({ cp_in: null, cp_out: null, type: 'auto' as VertexHandleType }))
    if (penMode === 'tool') {
      const newTool: ToolOutline = {
        id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        outer: penPoints,
        holes: [],
        hole_candidates: [],
        outer_handles: handles,
        holes_handles: [],
        label: '',
        visible: true,
        rotation_deg: 0,
        finger_holes: [],
        margin_mm: null,
        pocket_depth_mm: null,
        smoothing: smoothing,
        pocket_shape: 'flat',
        pocket_bottom_radius_mm: null,
      }
      addTool(newTool)
      setSelectedToolId(newTool.id)
      setSelectedToolIds([newTool.id])
      setSelectedHole(null)
    } else if (penMode === 'hole' && selectedToolId) {
      addHole(selectedToolId, penPoints)
      const tool = useEditor.getState().design.outlines.find((t) => t.id === selectedToolId)
      setSelectedHole(tool ? tool.holes.length - 1 : null)
    }
    cancelPen()
  }

  const cancelPen = () => { setPenMode('none'); setPenPoints([]) }

  // --- Escape key ---
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'Escape') {
        setAddingTool(false); setSplitting(false); setSplitStart(null); cancelPen()
      }
      if (e.key === 'Enter' && penMode !== 'none') finishPenPath()
      if (e.key === 'h' || e.key === 'H') setShowHandles((s) => !s)
      if (e.key === 'l' || e.key === 'L') setShowLoupe((s) => !s)
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) setShowHelp((h) => !h)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [penMode, penPoints])

  // --- Tool actions ---
  const selectTool = (toolId: string, additive = false) => {
    const next = additive
      ? selectedToolIds.includes(toolId)
        ? selectedToolIds.filter((id) => id !== toolId)
        : [...selectedToolIds, toolId]
      : [toolId]
    setSelectedToolIds(next)
    setSelectedToolId(next.includes(toolId) ? toolId : next[0] ?? null)
    setSelectedHole(null)
  }

  const handleContinue = () => {
    const { grid_w, grid_l } = suggestGridSize(design.outlines)
    setParams({ grid_w, grid_l })
    selectEditorTools(selectedToolIds)
    setView('editor')
  }

  const handleRetrace = async () => {
    if (!design.image_filename) return
    setDetecting(true); setError(null)
    try {
      const result = await retraceImage(`/data/images/${design.image_filename}`, design.scale_mm_per_px, traceEngine, smoothing)
      pushHistory()
      useEditor.setState((state) => ({ design: { ...state.design, outlines: result.outlines, trace_engine: result.trace_engine } }))
      setSelectedToolId(null); setSelectedToolIds([]); setSelectedHole(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-trace failed')
    } finally { setDetecting(false) }
  }

  const handleMerge = async () => {
    const selected = design.outlines.filter((t) => selectedToolIds.includes(t.id))
    if (selected.length < 2) return
    setDetecting(true); setError(null)
    try {
      const merged = await mergeOutlines(selected)
      pushHistory()
      useEditor.setState((state) => ({
        design: { ...state.design, outlines: [...state.design.outlines.filter((t) => !selectedToolIds.includes(t.id)), merged] },
      }))
      setSelectedToolId(merged.id); setSelectedToolIds([merged.id]); setSelectedHole(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed')
    } finally { setDetecting(false) }
  }

  const handleImageClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (penMode !== 'none') { handlePenClick(e); return }
    if ((!addingTool && !splitting) || !imgRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    const scaleX = design.rectified_w_px / rect.width
    const scaleY = design.rectified_h_px / rect.height
    const clickX = Math.round((e.clientX - rect.left) * scaleX)
    const clickY = Math.round((e.clientY - rect.top) * scaleY)

    if (splitting) {
      const point = { x: clickX * design.scale_mm_per_px, y: clickY * design.scale_mm_per_px }
      if (!splitStart) { setSplitStart(point); return }
      const tool = design.outlines.find((t) => t.id === selectedToolId)
      if (!tool) return
      setDetecting(true); setError(null)
      try {
        const pieces = await splitOutline(tool, splitStart, point)
        pushHistory()
        useEditor.setState((state) => ({
          design: { ...state.design, outlines: [...state.design.outlines.filter((t) => t.id !== tool.id), ...pieces] },
        }))
        setSelectedToolId(pieces[0]?.id ?? null)
        setSelectedToolIds(pieces.map((p) => p.id))
        setSelectedHole(null); setSplitting(false); setSplitStart(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Split failed')
      } finally { setDetecting(false) }
      return
    }

    setAddingTool(false); setDetecting(true); setError(null)
    try {
      const imageUrl = design.image_filename ? `/data/images/${design.image_filename}` : ''
      const outline = await detectToolAtPoint(imageUrl, design.scale_mm_per_px, clickX, clickY, traceEngine)
      addTool(outline)
      setSelectedToolId(outline.id); setSelectedToolIds([outline.id]); setSelectedHole(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection failed')
    } finally { setDetecting(false) }
  }

  // --- Cycle handle type ---
  const cycleHandleType = (toolId: string, hole: number | null, vertex: number) => {
    const tool = design.outlines.find((t) => t.id === toolId)
    if (!tool) return
    const handles = hole === null ? (tool.outer_handles ?? []) : ((tool.holes_handles ?? [])[hole] ?? [])
    const h = handles[vertex]
    const currentType = h?.type ?? 'auto'
    const nextType: VertexHandleType =
      currentType === 'auto' ? 'smooth' :
      currentType === 'smooth' ? 'sharp' :
      currentType === 'sharp' ? 'straight' : 'auto'

    // When switching to smooth/sharp, initialize handles from Catmull-Rom if not present
    // Use 3x the auto handle length so they're long enough to grab easily
    if (nextType === 'smooth' || nextType === 'sharp') {
      const path = hole === null ? tool.outer : tool.holes[hole]
      if (!path) return
      const n = path.length
      const prev = path[(vertex - 1 + n) % n]
      const curr = path[vertex]
      const next = path[(vertex + 1) % n]
      const { cp_in, cp_out } = computeAutoHandles(prev, curr, next, tool.smoothing ?? 0.3)
      // Scale handles 3x away from vertex for easier grabbing
      const scaledCpIn = { x: curr.x + (cp_in.x - curr.x) * 3, y: curr.y + (cp_in.y - curr.y) * 3 }
      const scaledCpOut = { x: curr.x + (cp_out.x - curr.x) * 3, y: curr.y + (cp_out.y - curr.y) * 3 }
      const newHandle: VertexHandle = {
        cp_in: nextType === 'smooth' ? scaledCpIn : (h?.cp_in ?? scaledCpIn),
        cp_out: nextType === 'smooth' ? scaledCpOut : (h?.cp_out ?? scaledCpOut),
        type: nextType,
      }
      if (hole === null) {
        updateVertexHandle(toolId, vertex, newHandle)
      } else {
        updateHoleVertexHandle(toolId, hole, vertex, newHandle)
      }
    } else {
      if (hole === null) {
        setVertexHandleType(toolId, vertex, nextType)
      } else {
        setHoleVertexHandleType(toolId, hole, vertex, nextType)
      }
    }
  }

  // --- Delete vertex ---
  const deleteVertex = (toolId: string, hole: number | null, vertex: number) => {
    const tool = design.outlines.find((t) => t.id === toolId)
    if (!tool) return
    const path = hole === null ? tool.outer : tool.holes[hole]
    if (!path || path.length <= 3) return
    pushHistory()
    replacePath(toolId, hole, path.filter((_, i) => i !== vertex))
    // Also remove the corresponding handle
    const handles = hole === null ? (tool.outer_handles ?? []) : ((tool.holes_handles ?? [])[hole] ?? [])
    if (handles.length > vertex) {
      replaceHandles(toolId, hole, handles.filter((_, i) => i !== vertex))
    }
  }

  // --- Add vertex on edge double-click ---
  const addVertexOnEdge = (toolId: string, hole: number | null, e: React.MouseEvent) => {
    const pt = imagePointMm(e.clientX, e.clientY)
    if (!pt) return
    const tool = design.outlines.find((t) => t.id === toolId)
    if (!tool) return
    const path = hole === null ? tool.outer : tool.holes[hole]
    if (!path) return
    // Find closest edge segment
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < path.length; i++) {
      const a = path[i]
      const b = path[(i + 1) % path.length]
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const d = Math.hypot(pt.x - mx, pt.y - my)
      if (d < bestDist) { bestDist = d; best = i }
    }
    pushHistory()
    const newPoint = { x: pt.x, y: pt.y }
    replacePath(toolId, hole, [...path.slice(0, best + 1), newPoint, ...path.slice(best + 1)])
    // Also add a default handle for the new vertex
    const handles = hole === null ? (tool.outer_handles ?? []) : ((tool.holes_handles ?? [])[hole] ?? [])
    const newHandle: VertexHandle = { cp_in: null, cp_out: null, type: 'auto' }
    replaceHandles(toolId, hole, [...handles.slice(0, best + 1), newHandle, ...handles.slice(best + 1)])
  }

  const paperWmm = design.paper_size === 'letter' ? 215.9 : 210
  const paperHmm = design.paper_size === 'letter' ? 279.4 : 297
  const scale = design.scale_mm_per_px

  // Helper to convert mm to px for rendering
  const mmToPx = (pt: Point) => ({ x: pt.x / scale, y: pt.y / scale })

  // Get the currently selected path and handles
  const selectedTool = selectedToolId ? design.outlines.find((t) => t.id === selectedToolId) : null
  const activePath = selectedTool ? (selectedHole === null ? selectedTool.outer : selectedTool.holes[selectedHole]) : null
  const activeHandles = selectedTool ? (selectedHole === null ? (selectedTool.outer_handles ?? []) : ((selectedTool.holes_handles ?? [])[selectedHole] ?? [])) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16, gap: 12 }}>
      {/* Top bar: title + trace controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 22, margin: 0 }}>Detected Tools ({design.outlines.length})</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={traceEngine} onChange={(e) => setTraceEngine(e.target.value as TraceEngine)} style={selectStyle}>
            {(traceEngines.length ? traceEngines : [{ id: 'hybrid' as TraceEngine, name: 'Hybrid OpenCV', available: true, ready: true, description: '' }]).map((engine) => (
              <option key={engine.id} value={engine.id} disabled={!engine.available}>
                {engine.name}{engine.id === 'fastsam' && !engine.ready ? ' (downloads on first use)' : ''}
              </option>
            ))}
          </select>
          <label style={{ color: '#a1a1aa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            Smooth
            <input type="range" min={0} max={1} step={0.05} value={smoothing} onChange={(e) => setSmoothing(Number(e.target.value))} />
            {smoothing.toFixed(2)}
          </label>
          <button onClick={handleRetrace} disabled={detecting} style={btnStyle}>Re-trace</button>
          <button onClick={() => setView('calibrate')} style={btnStyle}>← Back</button>
          <button onClick={handleContinue} style={primaryBtn}>Open Editor →</button>
        </div>
      </div>

      {/* Vector editing toolbar */}
      <div style={{
        display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap',
        background: '#18181b', borderRadius: 8, padding: '6px 10px', border: '1px solid #3f3f46',
      }}>
        {/* Undo / Redo */}
        <ToolButton active={false} onClick={undo} icon="↩" label="Undo" title="Undo last action" disabled={historyIndex <= 0} />
        <ToolButton active={false} onClick={redo} icon="↪" label="Redo" title="Redo last undone action" disabled={historyIndex >= history.length - 1} />
        <Divider />

        {/* Selection tool */}
        <ToolButton active={penMode === 'none' && !addingTool && !splitting} onClick={() => { cancelPen(); setAddingTool(false); setSplitting(false) }} icon="🖱" label="Select" title="Select and edit existing paths (default)" />
        <Divider />

        {/* Pen tools */}
        <ToolButton active={penMode === 'tool'} onClick={() => { setPenMode('tool'); setPenPoints([]); setAddingTool(false); setSplitting(false) }} icon="✏" label="Draw Tool" title="Click to place points, close to create a new tool outline" />
        <ToolButton active={penMode === 'hole'} onClick={() => { if (!selectedToolId) return; setPenMode('hole'); setPenPoints([]); setAddingTool(false); setSplitting(false) }} icon="✏" label="Draw Island" title="Draw a custom solid island inside the selected tool" disabled={!selectedToolId} />
        <Divider />

        {/* Auto-detect tool */}
        <ToolButton active={addingTool} onClick={() => { setAddingTool(!addingTool); cancelPen(); setSplitting(false); setSplitStart(null) }} icon="🔍" label="Auto-Detect" title="Click on a tool in the image to auto-trace it" />
        <Divider />

        {/* Handle visibility */}
        <ToolButton active={showHandles} onClick={() => setShowHandles(!showHandles)} icon="◐" label="Handles" title="Show/hide bezier control handles (H)" />
        <ToolButton active={showLoupe} onClick={() => setShowLoupe(!showLoupe)} icon="🔍" label="Loupe" title="Toggle magnifier loupe (L)" />
        <ToolButton active={false} onClick={() => setShowHelp(true)} icon="?" label="Help" title="Show help and keyboard shortcuts (?)" />
        <Divider />

        {/* Path editing actions (only when a path is selected) */}
        {selectedTool && activePath && (
          <>
            <span style={{ fontSize: 11, color: '#71717a', margin: '0 4px' }}>
              {selectedHole === null ? 'Outer boundary' : `Island ${selectedHole + 1}`} · {activePath.length} pts
            </span>
            <Divider />
            {/* Path selector */}
            <select
              value={selectedHole === null ? 'outer' : String(selectedHole)}
              onChange={(e) => setSelectedHole(e.target.value === 'outer' ? null : Number(e.target.value))}
              style={{ ...selectStyle, padding: '4px 8px', fontSize: 11, width: 'auto' }}
            >
              <option value="outer">Outer boundary</option>
              {selectedTool.holes.map((_, i) => <option key={i} value={i}>Island {i + 1}</option>)}
            </select>
            {/* Smoothing slider */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#a1a1aa', fontSize: 11 }}>
              Curve
              <input
                type="range" min={0} max={1} step={0.05} value={selectedTool.smoothing}
                onPointerDown={pushHistory}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  useEditor.setState((state) => ({
                    design: { ...state.design, outlines: state.design.outlines.map((t) => t.id === selectedTool.id ? { ...t, smoothing: v } : t) },
                  }))
                }}
                onPointerUp={pushHistory}
              />
              {selectedTool.smoothing.toFixed(2)}
            </label>
            <Divider />
            {/* Add solid island */}
            <ToolButton active={false} onClick={() => { addHole(selectedTool.id); setSelectedHole(selectedTool.holes.length) }} icon="＋" label="Add Island" title="Add a solid island (preserves tray material)" />
            {selectedHole !== null && (
              <ToolButton active={false} onClick={() => { removeHole(selectedTool.id, selectedHole); setSelectedHole(null) }} icon="✕" label="Remove Island" title="Remove the selected island" />
            )}
            <Divider />
            {/* Split */}
            <ToolButton active={splitting} onClick={() => { setSplitting(!splitting); setSplitStart(null); cancelPen(); setAddingTool(false) }} icon="✂" label="Split" title="Split the selected path with a cut line" />
            {/* Delete tool */}
            <ToolButton active={false} onClick={() => { deleteTool(selectedTool.id); setSelectedToolId(null); setSelectedToolIds([]); setSelectedHole(null) }} icon="🗑" label="Delete" title="Delete the entire tool" />
            <Divider />
            {/* Symmetry controls — grouped in a compact bordered section */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '2px 6px', borderRadius: 6, border: `1px solid ${symmetryAxis ? '#34d399' : '#3f3f46'}`, background: symmetryAxis ? 'rgba(52,211,153,0.08)' : 'transparent' }}>
              <span style={{ fontSize: 10, color: symmetryAxis ? '#34d399' : '#71717a', marginRight: 4, fontWeight: 600 }}>SYM</span>
              <ToolButton active={symmetryAxis === 'x'} onClick={() => setSymmetryAxis(symmetryAxis === 'x' ? null : 'x')} icon="⇅" label="X" title="Toggle X-axis symmetry (vertical line through tool center)" disabled={!selectedToolId} />
              <ToolButton active={symmetryAxis === 'y'} onClick={() => setSymmetryAxis(symmetryAxis === 'y' ? null : 'y')} icon="⇄" label="Y" title="Toggle Y-axis symmetry (horizontal line through tool center)" disabled={!selectedToolId} />
              {symmetryAxis && (
                <>
                  <span style={{ width: 1, height: 16, background: '#3f3f46', margin: '0 2px' }} />
                  <ToolButton active={symmetryMode === 'live'} onClick={() => setSymmetryMode(symmetryMode === 'live' ? 'manual' : 'live')} icon={symmetryMode === 'live' ? '🔗' : '✋'} label={symmetryMode === 'live' ? 'Live' : 'Man'} title={symmetryMode === 'live' ? 'Live mirror: dragging a vertex mirrors its partner' : 'Manual mode: use copy buttons'} />
                  <ToolButton active={false} onClick={() => selectedToolId && mirrorHalf(selectedToolId, symmetryAxis, symmetryAxis === 'x' ? 'left' : 'top')} icon="⬅" label="Copy→" title={`Copy left/top half to right/bottom (mirror across ${symmetryAxis.toUpperCase()} axis)`} />
                  <ToolButton active={false} onClick={() => selectedToolId && mirrorHalf(selectedToolId, symmetryAxis, symmetryAxis === 'x' ? 'right' : 'bottom')} icon="➡" label="←Copy" title={`Copy right/bottom half to left/top (mirror across ${symmetryAxis.toUpperCase()} axis)`} />
                  <ToolButton active={false} onClick={() => selectedToolId && symmetrize(selectedToolId, symmetryAxis)} icon="⚖" label="Avg" title="Average both sides for perfect symmetry" />
                </>
              )}
            </div>
          </>
        )}
        <Divider />
        {/* Zoom controls */}
        <ToolButton active={false} onClick={() => setImageZoom((z) => Math.max(0.25, z - 0.25))} icon="−" label="" title="Zoom out" />
        <span style={{ fontSize: 11, color: '#71717a', minWidth: 36, textAlign: 'center' }}>{Math.round(imageZoom * 100)}%</span>
        <ToolButton active={false} onClick={() => setImageZoom(1)} icon="⊡" label="Fit" title="Reset zoom to 100% (fit to width)" />
        <ToolButton active={false} onClick={() => setImageZoom((z) => Math.min(8, z + 0.25))} icon="+" label="" title="Zoom in" />
        <span style={{ fontSize: 10, color: '#52525b' }}>Ctrl+Wheel</span>
        <span style={{ flex: 1 }} />
        {/* Status text */}
        <span style={{ fontSize: 11, color: '#52525b' }}>
          {penMode !== 'none'
            ? `✏ Drawing ${penMode === 'tool' ? 'tool' : 'island'} — ${penPoints.length} pts placed. Click first point or double-click to close. Esc to cancel.`
            : addingTool
              ? '👆 Click on a tool in the image to auto-trace it. Esc to cancel.'
              : splitting
                ? (splitStart ? 'Click the other side of the cut' : 'Click just outside one side of the path')
                : selectedTool
                  ? 'Drag vertices · Double-click vertex to cycle handle type · Right-click vertex to delete · Double-click edge to add vertex'
                  : 'Click a tool to select it · Ctrl+click to multi-select · Use Draw Tool to create from scratch'}
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: '#422006', border: '1px solid #a16207', borderRadius: 8, padding: '8px 16px', color: '#fde047', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Main area: image + side panel */}
      <div style={{ display: 'flex', gap: 12, flex: 1, overflow: 'hidden' }}>
        {/* Image with SVG overlays */}
        <div
          style={{ flex: 1, background: '#18181b', borderRadius: 8, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 12 }}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault()
              const delta = -e.deltaY * 0.002
              setImageZoom((z) => Math.max(0.25, Math.min(8, z + delta * z)))
            }
          }}
        >
          <div
            style={{ position: 'relative', display: 'inline-block', touchAction: 'none' }}
            onPointerMove={(e) => { handlePointerMove(e); /* update loupe */ if (!imgRef.current) return; const rect = imgRef.current.getBoundingClientRect(); setLoupePos({ px: (e.clientX - rect.left) * design.rectified_w_px / rect.width, py: (e.clientY - rect.top) * design.rectified_h_px / rect.height }) }}
            onMouseLeave={() => setLoupePos(null)}
            onPointerUp={handlePointerUp}
          >
            <img
              ref={imgRef}
              src={design.image_filename ? `/data/images/${design.image_filename}` : ''}
              alt="rectified"
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              onLoad={(e) => setImgNaturalSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onClick={handleImageClick}
              onDoubleClick={penMode !== 'none' ? handlePenDoubleClick : undefined}
              style={{
                display: 'block',
                width: imgNaturalSize ? `${imgNaturalSize.w * imageZoom}px` : `${imageZoom * 100}%`,
                height: imgNaturalSize ? `${imgNaturalSize.h * imageZoom}px` : 'auto',
                maxWidth: 'none',
                cursor: penMode !== 'none' ? 'crosshair' : (addingTool || splitting ? 'crosshair' : 'default'),
                opacity: detecting ? 0.5 : 1,
                userSelect: 'none',
              }}
            />
            {detecting && (
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#a78bfa', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="spinner" style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid #3f3f46', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                Detecting tool...
              </div>
            )}
            <svg
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', touchAction: 'none' }}
              viewBox={`0 0 ${design.rectified_w_px} ${design.rectified_h_px}`}
              preserveAspectRatio="none"
            >
              {splitStart && (
                <circle cx={splitStart.x / scale} cy={splitStart.y / scale} r={7} fill="#f97316" stroke="#fff" strokeWidth={2} />
              )}

              {/* Tool outlines */}
              {design.outlines.map((tool) => {
                const isSelected = selectedToolIds.includes(tool.id)
                const outerPx = tool.outer.map(mmToPx)
                const outerHandles = (tool.outer_handles ?? []).map(h => ({ ...h, cp_in: h.cp_in ? mmToPx(h.cp_in) : null, cp_out: h.cp_out ? mmToPx(h.cp_out) : null }))
                return (
                  <g key={tool.id}>
                    {/* Hole candidates (rendered first, under the outer path) */}
                    {(tool.hole_candidates ?? []).map((candidate, ci) => (
                      <path
                        key={`cand-${ci}`}
                        d={smoothClosedPath(candidate.map(mmToPx), tool.smoothing)}
                        fill="rgba(249,115,22,0.10)"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        style={{ pointerEvents: 'none' }}
                      />
                    ))}
                    {/* Outer path */}
                    <path
                      d={smoothClosedPath(outerPx, tool.smoothing, outerHandles)}
                      fill={tool.visible ? (isSelected ? 'rgba(34,197,94,0.18)' : 'rgba(124,58,237,0.2)') : 'none'}
                      stroke={tool.visible ? (isSelected ? '#22c55e' : '#a78bfa') : '#52525b'}
                      strokeWidth={isSelected ? 4 : 3}
                      style={{ pointerEvents: penMode !== 'none' || addingTool || splitting ? 'none' : 'all', cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); selectTool(tool.id, e.ctrlKey || e.metaKey) }}
                      onDoubleClick={(e) => { if (penMode !== 'none') return; e.stopPropagation(); addVertexOnEdge(tool.id, null, e) }}
                    />
                    {/* Confirmed holes */}
                    {tool.holes.map((hole, hi) => {
                      const holeHandles = (tool.holes_handles ?? [])[hi]
                      const hh = holeHandles ? holeHandles.map(h => ({ ...h, cp_in: h.cp_in ? mmToPx(h.cp_in) : null, cp_out: h.cp_out ? mmToPx(h.cp_out) : null })) : undefined
                      return (
                        <path
                          key={`hole-${hi}`}
                          d={smoothClosedPath(hole.map(mmToPx), tool.smoothing, hh)}
                          fill="rgba(15,17,21,0.72)"
                          stroke={isSelected && selectedHole === hi ? '#f97316' : '#ef4444'}
                          strokeWidth={isSelected && selectedHole === hi ? 4 : 3}
                          style={{ pointerEvents: penMode !== 'none' || addingTool || splitting ? 'none' : 'all', cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); selectTool(tool.id); setSelectedHole(hi) }}
                          onDoubleClick={(e) => { if (penMode !== 'none') return; e.stopPropagation(); addVertexOnEdge(tool.id, hi, e) }}
                        />
                      )
                    })}
                    {/* Vertices and handles for selected tool */}
                    {isSelected && (() => {
                      const path = selectedHole === null ? tool.outer : tool.holes[selectedHole]
                      if (!path) return null
                      const handles = selectedHole === null ? (tool.outer_handles ?? []) : ((tool.holes_handles ?? [])[selectedHole] ?? [])
                      return path.map((pt, vi) => {
                        const h = handles[vi]
                        const handleType = h?.type ?? 'auto'
                        const ptPx = mmToPx(pt)
                        const cpInPx = h?.cp_in ? mmToPx(h.cp_in) : null
                        const cpOutPx = h?.cp_out ? mmToPx(h.cp_out) : null
                        return (
                          <g key={`v-${vi}`}>
                            {/* Bezier handle lines and circles */}
                            {showHandles && h && h.type !== 'auto' && h.type !== 'straight' && cpInPx && (
                              <>
                                <line x1={ptPx.x} y1={ptPx.y} x2={cpInPx.x} y2={cpInPx.y} stroke="#3b82f6" strokeWidth={2} strokeDasharray="4,3" style={{ pointerEvents: 'none' }} />
                                <circle cx={cpInPx.x} cy={cpInPx.y} r={8} fill="#3b82f6" stroke="#0f1115" strokeWidth={2}
                                  style={{ pointerEvents: penMode !== 'none' || addingTool || splitting ? 'none' : 'all', cursor: 'grab', touchAction: 'none' }}
                                  onPointerDown={(e) => handleHandlePointerDown(e, tool.id, selectedHole, vi, 'cp_in')}
                                />
                              </>
                            )}
                            {showHandles && h && h.type !== 'auto' && h.type !== 'straight' && cpOutPx && (
                              <>
                                <line x1={ptPx.x} y1={ptPx.y} x2={cpOutPx.x} y2={cpOutPx.y} stroke="#3b82f6" strokeWidth={2} strokeDasharray="4,3" style={{ pointerEvents: 'none' }} />
                                <circle cx={cpOutPx.x} cy={cpOutPx.y} r={8} fill="#3b82f6" stroke="#0f1115" strokeWidth={2}
                                  style={{ pointerEvents: penMode !== 'none' || addingTool || splitting ? 'none' : 'all', cursor: 'grab', touchAction: 'none' }}
                                  onPointerDown={(e) => handleHandlePointerDown(e, tool.id, selectedHole, vi, 'cp_out')}
                                />
                              </>
                            )}
                            {/* Vertex circle */}
                            <circle
                              cx={ptPx.x} cy={ptPx.y} r={7}
                              fill={handleType === 'smooth' ? '#22d3ee' : handleType === 'sharp' ? '#fbbf24' : handleType === 'straight' ? '#71717a' : (selectedHole === null ? '#22c55e' : '#f97316')}
                              stroke="#ffffff" strokeWidth={2.5}
                              style={{ pointerEvents: penMode !== 'none' || addingTool || splitting ? 'none' : 'all', cursor: 'grab', touchAction: 'none' }}
                              onPointerDown={(e) => handleVertexPointerDown(e, tool.id, selectedHole, vi)}
                              onDoubleClick={(e) => { e.stopPropagation(); cycleHandleType(tool.id, selectedHole, vi) }}
                              onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); deleteVertex(tool.id, selectedHole, vi) }}
                            >
                              <title>
                                Vertex {vi} · {handleType}
                                {' — Double-click to cycle: auto→smooth→sharp→straight'}
                                {' — Right-click to delete'}
                              </title>
                            </circle>
                          </g>
                        )
                      })
                    })()}
                  </g>
                )
              })}

              {/* Symmetry axis line for selected tool */}
              {selectedTool && symmetryAxis && (() => {
                const tool = selectedTool
                const cx = tool.outer.reduce((a, p) => a + p.x, 0) / tool.outer.length
                const cy = tool.outer.reduce((a, p) => a + p.y, 0) / tool.outer.length
                const xs = tool.outer.map(p => p.x)
                const ys = tool.outer.map(p => p.y)
                const minX = Math.min(...xs), maxX = Math.max(...xs)
                const minY = Math.min(...ys), maxY = Math.max(...ys)
                const lineLen = Math.max(maxX - minX, maxY - minY) + 20
                if (symmetryAxis === 'x') {
                  return <line x1={cx / scale} y1={(cy - lineLen / 2) / scale} x2={cx / scale} y2={(cy + lineLen / 2) / scale} stroke="#34d399" strokeWidth={2} strokeDasharray="6,4" style={{ pointerEvents: 'none' }} />
                } else {
                  return <line x1={(cx - lineLen / 2) / scale} y1={cy / scale} x2={(cx + lineLen / 2) / scale} y2={cy / scale} stroke="#34d399" strokeWidth={2} strokeDasharray="6,4" style={{ pointerEvents: 'none' }} />
                }
              })()}

              {/* Pen tool preview */}
              {penMode !== 'none' && penPoints.length > 0 && (
                <g pointerEvents="none">
                  {penPoints.length >= 2 && penPoints.map((pt, i) => {
                    if (i === 0) return null
                    const prev = penPoints[i - 1]
                    return <line key={`pen-${i}`} x1={prev.x / scale} y1={prev.y / scale} x2={pt.x / scale} y2={pt.y / scale} stroke={penMode === 'tool' ? '#22c55e' : '#f97316'} strokeWidth={3} strokeDasharray="6,3" />
                  })}
                  {penPoints.length >= 3 && (
                    <line x1={penPoints[penPoints.length - 1].x / scale} y1={penPoints[penPoints.length - 1].y / scale} x2={penPoints[0].x / scale} y2={penPoints[0].y / scale} stroke={penMode === 'tool' ? '#22c55e' : '#f97316'} strokeWidth={2} strokeDasharray="3,3" opacity={0.4} />
                  )}
                  {penPoints.map((pt, i) => (
                    <g key={`pp-${i}`}>
                      <circle cx={pt.x / scale} cy={pt.y / scale} r={i === 0 ? 8 : 6} fill={i === 0 ? '#22d3ee' : (penMode === 'tool' ? '#22c55e' : '#f97316')} stroke="#0f1115" strokeWidth={2} />
                      {i === 0 && penPoints.length >= 3 && (
                        <circle cx={pt.x / scale} cy={pt.y / scale} r={14} fill="none" stroke="#22d3ee" strokeWidth={1.5} strokeDasharray="3,2" />
                      )}
                    </g>
                  ))}
                </g>
              )}
            </svg>
          </div>
        </div>

        {/* Side panel: tool list + interior regions + docked loupe */}
        <div style={{ width: 280, background: '#18181b', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '100%' }}>
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          <h3 style={{ fontSize: 14, color: '#a1a1aa', margin: 0 }}>Tools</h3>
          <div style={{ color: '#71717a', fontSize: 11 }}>Ctrl/Cmd-click to multi-select for merge.</div>

          {design.outlines.length === 0 && (
            <p style={{ color: '#71717a', fontSize: 13 }}>
              No tools detected. Click <strong>🔍 Auto-Detect</strong> then click on a tool in the image, or use <strong>✏ Draw Tool</strong> to draw one from scratch.
            </p>
          )}

          {design.outlines.map((tool, i) => (
            <div
              key={tool.id}
              onClick={(e) => selectTool(tool.id, e.ctrlKey || e.metaKey)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                background: tool.visible ? '#27272a' : '#18181b',
                border: `1px solid ${selectedToolIds.includes(tool.id) ? '#22c55e' : tool.visible ? '#3f3f46' : '#27272a'}`,
              }}
            >
              <span style={{ fontSize: 13 }}>
                Tool {i + 1}{(tool.hole_candidates ?? []).length > 0 ? ` · ${(tool.hole_candidates ?? []).length} interior` : ''}
              </span>
              <button onClick={(e) => { e.stopPropagation(); toggleToolVisible(tool.id) }} style={{ background: 'none', border: 'none', color: tool.visible ? '#a78bfa' : '#52525b', cursor: 'pointer', fontSize: 16 }} title={tool.visible ? 'Hide' : 'Show'}>
                {tool.visible ? '👁' : '🚫'}
              </button>
            </div>
          ))}

          {selectedToolIds.length > 1 && (
            <button onClick={handleMerge} disabled={detecting} style={{ ...btnStyle, width: '100%' }}>
              Merge {selectedToolIds.length} selected paths
            </button>
          )}

          {/* Interior regions for selected tool */}
          {selectedTool && (selectedTool.hole_candidates ?? []).length > 0 && (() => {
            const tool = selectedTool
            return (
              <div style={{ padding: 10, border: '1px solid #92400e', borderRadius: 6, background: '#2b1706', display: 'flex', flexDirection: 'column', gap: 7 }}>
                <strong style={{ color: '#fbbf24', fontSize: 12 }}>Review interior regions</strong>
                <div style={{ color: '#d6d3d1', fontSize: 11, lineHeight: 1.4 }}>
                  Dashed amber regions are included in the pocket by default. <strong>Preserve island</strong> only for real openings (e.g. scissors finger hole). <strong>Include in pocket</strong> for reflections, labels, or transparent regions.
                </div>
                {(tool.hole_candidates ?? []).map((candidate, index) => (
                  <div key={index} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ flex: 1, color: '#fcd34d', fontSize: 11 }}>Region {index + 1}</span>
                    <button onClick={() => updateTool(tool.id, { holes: [...tool.holes, candidate], hole_candidates: (tool.hole_candidates ?? []).filter((_, ci) => ci !== index) })} style={smallBtnStyle}>Preserve</button>
                    <button onClick={() => updateTool(tool.id, { hole_candidates: (tool.hole_candidates ?? []).filter((_, ci) => ci !== index) })} style={smallBtnStyle}>Include</button>
                  </div>
                ))}
              </div>
            )
          })()}

          {/* Quick help for selected tool */}
          {selectedTool && (
            <div style={{ padding: 10, border: '1px solid #3f3f46', borderRadius: 6, background: '#1e1b2e', fontSize: 11, color: '#a1a1aa', lineHeight: 1.6 }}>
              <strong style={{ color: '#a78bfa' }}>Editing tips:</strong><br/>
              • <strong>Drag</strong> green/orange dots to move points<br/>
              • <strong>Double-click</strong> a dot to cycle: auto → smooth → sharp → straight<br/>
              • <strong>Right-click</strong> a dot to delete it<br/>
              • <strong>Double-click</strong> an edge to add a point<br/>
              • Drag <strong>blue circles</strong> to shape curves (when handle type is smooth/sharp)<br/>
              • Use <strong>✏ Draw Tool</strong> to create from scratch<br/>
              • Use <strong>✏ Draw Island</strong> to add a custom solid island
            </div>
          )}

          </div>{/* end scrollable content */}

          {/* Docked magnifier loupe — pinned at the bottom of the side panel */}
          {showLoupe && (
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 600 }}>🔍 Magnifier ({LOUPE_ZOOM}×)</span>
                <span style={{ fontSize: 10, color: '#52525b' }}>
                  {loupePos ? `${loupePos.px.toFixed(0)}, ${loupePos.py.toFixed(0)}px` : 'hover image'}
                </span>
              </div>
              <div style={{
                width: '100%', aspectRatio: '1 / 1',
                border: '2px solid #a78bfa', borderRadius: 8, overflow: 'hidden',
                background: '#0a0b0e', position: 'relative',
              }}>
                <canvas ref={magnifierRef} width={LOUPE_SIZE} height={LOUPE_SIZE} style={{ width: '100%', height: '100%', display: 'block' }} />
                {!loupePos && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#52525b', fontSize: 12 }}>
                    Move cursor over image
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom info bar */}
      <div style={{ fontSize: 12, color: '#52525b' }}>
        Paper: {paperWmm}×{paperHmm}mm · Image: {design.rectified_w_px}×{design.rectified_h_px}px · Scale: {scale.toFixed(3)} mm/px
      </div>

      {/* Help panel */}
      {showHelp && (
        <div onClick={() => setShowHelp(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, padding: 24, maxWidth: 580, maxHeight: '80vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: '#e4e4e7' }}>Vector Editing Help</h2>
              <button onClick={() => setShowHelp(false)} style={btnStyle}>✕</button>
            </div>

            <HelpSection title="Toolbar Tools">
              <HelpItem icon="🖱" name="Select" desc="Click tools, drag vertices, edit handles (default)" />
              <HelpItem icon="✏" name="Draw Tool" desc="Click to place points, close to create a new tool outline" />
              <HelpItem icon="✏" name="Draw Island" desc="Draw a custom solid island inside the selected tool" />
              <HelpItem icon="🔍" name="Auto-Detect" desc="Click on a tool in the image to auto-trace it" />
              <HelpItem icon="◐" name="Handles" desc="Show/hide bezier control handle circles" />
              <HelpItem icon="🔍" name="Loupe" desc="Toggle the 4× magnifier docked in the side panel" />
              <HelpItem icon="✂" name="Split" desc="Split a path with a cut line (click both sides)" />
              <HelpItem icon="🗑" name="Delete" desc="Delete the entire tool" />
            </HelpSection>

            <HelpSection title="Symmetry">
              <HelpItem icon="⇅" name="Sym X" desc="Toggle X-axis symmetry (vertical line through tool center)" />
              <HelpItem icon="⇄" name="Sym Y" desc="Toggle Y-axis symmetry (horizontal line through tool center)" />
              <HelpItem icon="🔗" name="Live" desc="Live mirror: dragging a vertex mirrors its partner in real-time" />
              <HelpItem icon="✋" name="Manual" desc="Manual mode: use copy buttons to mirror one half to the other" />
              <HelpItem icon="⬅" name="Copy→" desc="Copy left/top half to right/bottom (mirror across active axis)" />
              <HelpItem icon="➡" name="←Copy" desc="Copy right/bottom half to left/top (mirror across active axis)" />
              <HelpItem icon="⚖" name="Symmetrize" desc="Average both sides for perfect symmetry" />
            </HelpSection>

            <HelpSection title="Vertex Editing">
              <HelpItem icon="●" name="Drag vertex" desc="Move a point on the path" />
              <HelpItem icon="●" name="Double-click vertex" desc="Cycle handle type: auto → smooth → sharp → straight" />
              <HelpItem icon="●" name="Right-click vertex" desc="Delete the vertex (minimum 3 per path)" />
              <HelpItem icon="—" name="Double-click edge" desc="Insert a new vertex on that edge" />
            </HelpSection>

            <HelpSection title="Handle Types (vertex colors)">
              <HelpItem icon="🟣" name="Auto (purple/green)" desc="Catmull-Rom smoothing — no explicit handles needed" />
              <HelpItem icon="🔵" name="Smooth (cyan)" desc="Mirrored handles — smooth curve through the vertex. Drag one side and the other mirrors automatically." />
              <HelpItem icon="🟡" name="Sharp (amber)" desc="Independent handles — corner with curved approaches on each side" />
              <HelpItem icon="⚫" name="Straight (gray)" desc="No curve — straight line segments to and from this vertex" />
            </HelpSection>

            <HelpSection title="Bezier Handles (Inkscape-style)">
              <HelpItem icon="🔵" name="Blue circles" desc="Drag to shape the curve on that side of the vertex" />
              <HelpItem icon="—" name="Dashed blue lines" desc="Connect the handle to its vertex (visual guide)" />
              <HelpItem icon="◐" name="Handles toggle" desc="Show or hide all handle circles (H key)" />
            </HelpSection>

            <HelpSection title="Interior Regions (Islands)">
              <HelpItem icon="🟠" name="Dashed amber" desc="Unconfirmed candidate — included in pocket by default" />
              <HelpItem icon="🟢" name="Preserve island" desc="Confirm a real opening (e.g. scissors finger hole) — leaves tray material" />
              <HelpItem icon="🔴" name="Include in pocket" desc="Dismiss a false candidate (reflection, label) — cuts that area" />
              <HelpItem icon="＋" name="Add Island" desc="Create a new solid island to shape manually" />
              <HelpItem icon="✏" name="Draw Island" desc="Draw a custom island with the pen tool" />
            </HelpSection>

            <HelpSection title="Keyboard Shortcuts">
              <HelpItem icon="⌨" name="Escape" desc="Cancel pen tool / auto-detect / split" />
              <HelpItem icon="⌨" name="Enter" desc="Close pen tool path" />
              <HelpItem icon="⌨" name="H" desc="Toggle handle visibility" />
              <HelpItem icon="⌨" name="L" desc="Toggle magnifier loupe" />
              <HelpItem icon="⌨" name="?" desc="Toggle this help panel" />
              <HelpItem icon="⌨" name="Ctrl+Click" desc="Multi-select tools for merge" />
            </HelpSection>
          </div>
        </div>
      )}
    </div>
  )
}

// --- Helper components ---

function ToolButton({ active, onClick, icon, label, title, disabled }: {
  active: boolean; onClick: () => void; icon: string; label: string; title: string; disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '5px 10px', borderRadius: 5,
        border: `1px solid ${active ? '#7c3aed' : '#3f3f46'}`,
        background: active ? '#3b0764' : '#27272a',
        color: active ? '#a78bfa' : disabled ? '#52525b' : '#a1a1aa',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 12, whiteSpace: 'nowrap', opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function Divider() {
  return <span style={{ width: 1, height: 22, background: '#3f3f46', margin: '0 2px' }} />
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 13, color: '#a78bfa', margin: '0 0 6px 0', textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </div>
  )
}

function HelpItem({ icon, name, desc }: { icon: string; name: string; desc: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 12, lineHeight: 1.5 }}>
      <span style={{ minWidth: 24, textAlign: 'center', fontSize: 14 }}>{icon}</span>
      <span style={{ minWidth: 140, color: '#e4e4e7', fontWeight: 600 }}>{name}</span>
      <span style={{ color: '#a1a1aa', flex: 1 }}>{desc}</span>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 6, border: '1px solid #3f3f46',
  background: '#27272a', color: '#e4e4e7', cursor: 'pointer', fontSize: 14,
}
const smallBtnStyle: React.CSSProperties = {
  padding: '4px 7px', borderRadius: 4, border: '1px solid #92400e',
  background: '#422006', color: '#fde68a', cursor: 'pointer', fontSize: 10,
}
const selectStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 6, border: '1px solid #3f3f46',
  background: '#27272a', color: '#e4e4e7', fontSize: 13,
}
const primaryBtn: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 6, border: 'none',
  background: '#7c3aed', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 600,
}
