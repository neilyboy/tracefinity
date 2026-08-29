import { useRef, useState, useCallback, useEffect } from 'react'
import { useEditor } from '../editor/useEditorState'
import { clientToSvgMm, snapToGrid, snapFine } from '../editor/vertexDrag'
import { GRID_UNIT_MM } from '../editor/constants'
import { smoothClosedPath } from '../utils/smoothPath'
import { fontKeyToCssFamily } from '../editor/fontLoader'
import type { Point, FingerHole, TextLabel, ToolOutline } from '../types'
import AddShapeDialog from './AddShapeDialog'

export default function SvgEditor() {
  const svgRef = useRef<SVGSVGElement>(null)
  const {
    design, selectedToolId, selectedToolIds, selectTool, toggleToolSelection, selectTools,
    updateVertex, moveTool, moveTools,
    addVertex, deleteVertex, deleteTool, pushHistory, updateTool,
    undo, redo, history, historyIndex,
    addLabel, updateLabel, deleteLabel, moveLabel,
    addTool, addTools,
    symmetryAxis, symmetryMode, setSymmetryAxis, setSymmetryMode,
    mirrorHalf, symmetrize,
  } = useEditor()

  const [drag, setDrag] = useState<{
    type: 'vertex' | 'tool' | 'fingerHole' | 'multi'
    toolId: string
    toolIds?: string[]  // for multi-select drag
    vertexIdx?: number
    fingerHoleIdx?: number
    startMm: Point
    startVertices: Point[]
    startHole?: FingerHole
  } | null>(null)

  const lastMoveRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 })
  // Track whether a tool interaction just happened so we can suppress the
  // SVG background click that would otherwise deselect it.
  const suppressClickRef = useRef(false)

  const [snapEnabled, setSnapEnabled] = useState(true)
  const [zoom, setZoom] = useState(0.5)
  const [placingFingerHole, setPlacingFingerHole] = useState(false)
  const [draggingLabel, setDraggingLabel] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; x: number; y: number } | null>(null)
  const marqueeJustFinishedRef = useRef(false)
  const [nudgeStep, setNudgeStep] = useState(1.0)

  const p = design.params
  const binW = p.grid_w * GRID_UNIT_MM
  const binL = p.grid_l * GRID_UNIT_MM
  const pad = 80  // workspace margin around the tray (mm)
  const viewW = binW + 2 * pad
  const viewH = binL + 2 * pad

  const toMm = useCallback((clientX: number, clientY: number): Point => {
    if (!svgRef.current) return { x: 0, y: 0 }
    const pt = clientToSvgMm(svgRef.current, clientX, clientY)
    return { x: pt.x - pad, y: pt.y - pad }
  }, [])

  const handleVertexPointerDown = (e: React.PointerEvent, toolId: string, vertexIdx: number) => {
    e.stopPropagation()
    suppressClickRef.current = true
    const tool = design.outlines.find((o) => o.id === toolId)
    if (!tool) return
    const mm = toMm(e.clientX, e.clientY)
    setDrag({ type: 'vertex', toolId, vertexIdx, startMm: mm, startVertices: tool.outer.map((v) => ({ ...v })) })
    lastMoveRef.current = { dx: 0, dy: 0 }
    selectTool(toolId)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const handleToolPointerDown = (e: React.PointerEvent, toolId: string) => {
    e.stopPropagation()
    suppressClickRef.current = true
    const tool = design.outlines.find((o) => o.id === toolId)
    if (!tool) return
    const mm = toMm(e.clientX, e.clientY)

    // Ctrl+click (or Cmd+click) toggles multi-select
    if (e.ctrlKey || e.metaKey) {
      toggleToolSelection(toolId)
      // If now selected, start a multi-drag of all selected tools
      const currentSelected = useEditor.getState().selectedToolIds
      if (currentSelected.includes(toolId) && currentSelected.length > 1) {
        setDrag({ type: 'multi', toolId, toolIds: currentSelected, startMm: mm, startVertices: tool.outer.map((v) => ({ ...v })) })
        lastMoveRef.current = { dx: 0, dy: 0 }
      }
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      return
    }

    // Regular click: if clicking an already-selected tool in a multi-select group,
    // drag all of them. Otherwise, select just this one.
    if (selectedToolIds.includes(toolId) && selectedToolIds.length > 1) {
      // Drag all selected tools together
      setDrag({ type: 'multi', toolId, toolIds: [...selectedToolIds], startMm: mm, startVertices: tool.outer.map((v) => ({ ...v })) })
      lastMoveRef.current = { dx: 0, dy: 0 }
    } else {
      setDrag({ type: 'tool', toolId, startMm: mm, startVertices: tool.outer.map((v) => ({ ...v })) })
      lastMoveRef.current = { dx: 0, dy: 0 }
      selectTool(toolId)
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const mm = toMm(e.clientX, e.clientY)
    const dx = mm.x - drag.startMm.x
    const dy = mm.y - drag.startMm.y

    if (drag.type === 'vertex' && drag.vertexIdx !== undefined) {
      const newPos = {
        x: snapFine(drag.startVertices[drag.vertexIdx].x + dx, snapEnabled ? 0.5 : 0.01),
        y: snapFine(drag.startVertices[drag.vertexIdx].y + dy, snapEnabled ? 0.5 : 0.01),
      }
      updateVertex(drag.toolId, drag.vertexIdx, newPos)
    } else if (drag.type === 'tool') {
      const sdx = snapEnabled ? snapToGrid(dx, GRID_UNIT_MM / 4, true) : dx
      const sdy = snapEnabled ? snapToGrid(dy, GRID_UNIT_MM / 4, true) : dy
      const incDx = sdx - lastMoveRef.current.dx
      const incDy = sdy - lastMoveRef.current.dy
      if (incDx !== 0 || incDy !== 0) {
        moveTool(drag.toolId, incDx, incDy)
        lastMoveRef.current = { dx: sdx, dy: sdy }
      }
    } else if (drag.type === 'multi' && drag.toolIds) {
      const sdx = snapEnabled ? snapToGrid(dx, GRID_UNIT_MM / 4, true) : dx
      const sdy = snapEnabled ? snapToGrid(dy, GRID_UNIT_MM / 4, true) : dy
      const incDx = sdx - lastMoveRef.current.dx
      const incDy = sdy - lastMoveRef.current.dy
      if (incDx !== 0 || incDy !== 0) {
        moveTools(drag.toolIds, incDx, incDy)
        lastMoveRef.current = { dx: sdx, dy: sdy }
      }
    } else if (drag.type === 'fingerHole' && drag.fingerHoleIdx !== undefined && drag.startHole) {
      const tool = design.outlines.find((o) => o.id === drag.toolId)
      if (tool) {
        // The tool's <g> is rendered with a CSS rotate transform around its
        // centroid when rotation_deg != 0. Finger hole (x, y) is stored in the
        // tool's LOCAL (unrotated) coordinate system, but (dx, dy) came from
        // screen space. Inverse-rotate the delta to map back to local coords.
        const rot = tool.rotation_deg ?? 0
        let ldx = dx
        let ldy = dy
        if (rot !== 0) {
          const r = -rot * Math.PI / 180  // negative = inverse rotation
          const c = Math.cos(r)
          const s = Math.sin(r)
          ldx = dx * c - dy * s
          ldy = dx * s + dy * c
        }
        const newPos = {
          x: snapFine(drag.startHole.x + ldx, snapEnabled ? 0.5 : 0.01),
          y: snapFine(drag.startHole.y + ldy, snapEnabled ? 0.5 : 0.01),
        }
        const holes = [...(tool.finger_holes ?? [])]
        holes[drag.fingerHoleIdx] = { ...holes[drag.fingerHoleIdx], x: newPos.x, y: newPos.y }
        updateTool(drag.toolId, { finger_holes: holes })
      }
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (drag) {
      pushHistory()
      ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    }
    setDrag(null)
  }

  // --- Marquee (rubber-band) selection ---
  const handleSvgPointerDown = (e: React.PointerEvent) => {
    if (placingFingerHole) return
    // Start marquee on click on the SVG background or any background element.
    // Tool paths have their own pointer handlers with stopPropagation, so they
    // won't reach here. Vertex circles also stopPropagation.
    const target = e.target as Element
    const tag = target.tagName
    // Allow starting on SVG element itself, rect (workspace/tray bg), line (grid/ruler), text (ruler labels)
    if (tag !== 'svg' && tag !== 'rect' && tag !== 'line' && tag !== 'text') return
    const mm = toMm(e.clientX, e.clientY)
    setMarquee({ startX: mm.x, startY: mm.y, x: mm.x, y: mm.y })
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }

  const handleSvgPointerMove = (e: React.PointerEvent) => {
    if (!marquee) return
    const mm = toMm(e.clientX, e.clientY)
    setMarquee({ ...marquee, x: mm.x, y: mm.y })
  }

  const handleSvgPointerUp = (e: React.PointerEvent) => {
    if (!marquee) return
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
    // Find all tools whose bounding box intersects the marquee rect
    const mx1 = Math.min(marquee.startX, marquee.x)
    const my1 = Math.min(marquee.startY, marquee.y)
    const mx2 = Math.max(marquee.startX, marquee.x)
    const my2 = Math.max(marquee.startY, marquee.y)
    // Only select if the marquee is at least 2mm in size (avoid accidental clicks)
    if (Math.abs(mx2 - mx1) < 2 && Math.abs(my2 - my1) < 2) {
      setMarquee(null)
      return
    }
    const hitIds: string[] = []
    for (const tool of design.outlines) {
      if (!tool.visible) continue
      const xs = tool.outer.map((p) => p.x)
      const ys = tool.outer.map((p) => p.y)
      const tx1 = Math.min(...xs), ty1 = Math.min(...ys)
      const tx2 = Math.max(...xs), ty2 = Math.max(...ys)
      // Rectangle intersection test
      if (tx1 < mx2 && tx2 > mx1 && ty1 < my2 && ty2 > my1) {
        hitIds.push(tool.id)
      }
    }
    if (hitIds.length > 0) {
      selectTools(hitIds)
    } else {
      selectTool(null)
    }
    setMarquee(null)
    marqueeJustFinishedRef.current = true
  }

  const handleEdgeClick = (e: React.MouseEvent, toolId: string, afterIdx: number) => {
    // Double-click on an edge to add a vertex
    if (e.detail !== 2) return
    e.stopPropagation()
    const mm = toMm(e.clientX, e.clientY)
    addVertex(toolId, afterIdx, { x: snapFine(mm.x, 0.5), y: snapFine(mm.y, 0.5) })
  }

  const handlePlaceFingerHole = (e: React.MouseEvent) => {
    if (!placingFingerHole || !selectedToolId) return
    e.stopPropagation()
    suppressClickRef.current = true
    const mm = toMm(e.clientX, e.clientY)
    const tool = design.outlines.find((o) => o.id === selectedToolId)
    if (!tool) return
    // Finger hole coords are stored in the tool's LOCAL (unrotated) frame.
    // The click came in screen space, so inverse-rotate around the tool's
    // centroid to get the local coordinates.
    const rot = tool.rotation_deg ?? 0
    let lx = mm.x
    let ly = mm.y
    if (rot !== 0) {
      const cx = tool.outer.reduce((a, b) => a + b.x, 0) / tool.outer.length
      const cy = tool.outer.reduce((a, b) => a + b.y, 0) / tool.outer.length
      const r = -rot * Math.PI / 180
      const c = Math.cos(r)
      const s = Math.sin(r)
      const dx = mm.x - cx
      const dy = mm.y - cy
      lx = cx + dx * c - dy * s
      ly = cy + dx * s + dy * c
    }
    const newHole: FingerHole = {
      x: snapFine(lx, 0.5),
      y: snapFine(ly, 0.5),
      radius_mm: 15.0,
      depth_mm: null,
    }
    updateTool(tool.id, { finger_holes: [...(tool.finger_holes ?? []), newHole] })
    setPlacingFingerHole(false)
    pushHistory()
  }

  const handleFingerHolePointerDown = (e: React.PointerEvent, toolId: string, holeIdx: number) => {
    e.stopPropagation()
    suppressClickRef.current = true
    const tool = design.outlines.find((o) => o.id === toolId)
    if (!tool) return
    const hole = tool.finger_holes?.[holeIdx]
    if (!hole) return
    const mm = toMm(e.clientX, e.clientY)
    setDrag({ type: 'fingerHole', toolId, fingerHoleIdx: holeIdx, startMm: mm, startVertices: [], startHole: { ...hole } })
    selectTool(toolId)
    // Don't set pointer capture here; let the SVG-level onPointerMove handle it.
    // This avoids captured events being routed to the circle instead of the SVG.
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedToolIds.length > 1) {
        selectedToolIds.forEach((id) => deleteTool(id))
      } else if (selectedToolId) {
        deleteTool(selectedToolId)
      }
    }
    // Note: arrow key nudging is handled by the global keydown listener below
    // to avoid double-firing (React onKeyDown + window listener both fire).
  }

  // Global keydown listener for arrow key nudging (works without focus)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
      const state = useEditor.getState()
      const ids = state.selectedToolIds.length > 0 ? state.selectedToolIds : (state.selectedToolId ? [state.selectedToolId] : [])
      if (ids.length === 0) return
      e.preventDefault()
      let dx = 0, dy = 0
      if (e.key === 'ArrowLeft') dx = -nudgeStep
      if (e.key === 'ArrowRight') dx = nudgeStep
      if (e.key === 'ArrowUp') dy = -nudgeStep
      if (e.key === 'ArrowDown') dy = nudgeStep
      if (e.shiftKey) { dx *= 10; dy *= 10 }
      state.moveTools(ids, dx, dy)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [nudgeStep])

  // Add a new tool with a basic shape
  const [showAddTool, setShowAddTool] = useState(false)

  const handleAddShape = (tool: ToolOutline) => {
    addTool(tool)
    selectTool(tool.id)
    pushHistory()
  }

  // Add a new text label at the center of the bin
  const handleAddLabel = () => {
    const newLabel: TextLabel = {
      id: `label_${Date.now()}`,
      text: 'Label',
      x: binW / 2,
      y: binL / 2,
      font_size_mm: 6.0,
      rotation_deg: 0,
      depth_mm: 0.6,
      cutout: true,
      target: 'tray',
      font: 'Lato-Stenciled',
    }
    addLabel(newLabel)
  }

  // Label drag handler
  const handleLabelPointerDown = (e: React.PointerEvent, labelId: string) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    setDraggingLabel(labelId)
  }

  const handleLabelPointerMove = (e: React.PointerEvent) => {
    if (!draggingLabel || !svgRef.current) return
    const pt = clientToSvgMm(svgRef.current, e.clientX, e.clientY)
    // Convert from SVG coords to mm (subtract pad)
    const mx = pt.x - pad
    const my = pt.y - pad
    const label = design.labels.find(l => l.id === draggingLabel)
    if (!label) return
    moveLabel(draggingLabel, mx - label.x, my - label.y)
  }

  const handleLabelPointerUp = (e: React.PointerEvent) => {
    if (draggingLabel) {
      ;(e.target as Element).releasePointerCapture?.(e.pointerId)
      pushHistory()
    }
    setDraggingLabel(null)
  }

  // Remove vertices that are too close together (within threshold mm)
  const handleSimplifyVertices = () => {
    if (!selectedToolId) return
    const tool = design.outlines.find((o) => o.id === selectedToolId)
    if (!tool || tool.outer.length <= 3) return
    const threshold = 1.5 // mm — remove vertices closer than this to the previous one
    const simplified: Point[] = [tool.outer[0]]
    for (let i = 1; i < tool.outer.length; i++) {
      const prev = simplified[simplified.length - 1]
      const curr = tool.outer[i]
      const dist = Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2)
      if (dist >= threshold) {
        simplified.push(curr)
      }
    }
    // Check last vs first
    const last = simplified[simplified.length - 1]
    const first = simplified[0]
    const distLF = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2)
    if (distLF < threshold && simplified.length > 3) {
      simplified.pop()
    }
    if (simplified.length >= 3 && simplified.length < tool.outer.length) {
      pushHistory()
      updateTool(selectedToolId, { outer: simplified })
    }
  }

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, padding: '6px 12px', borderBottom: '1px solid #27272a', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        <button
          onClick={undo}
          disabled={historyIndex <= 0}
          style={{ ...toolBtn(false), opacity: historyIndex <= 0 ? 0.3 : 1 }}
          title="Undo"
        >
          ↩ Undo
        </button>
        <button
          onClick={redo}
          disabled={historyIndex >= history.length - 1}
          style={{ ...toolBtn(false), opacity: historyIndex >= history.length - 1 ? 0.3 : 1 }}
          title="Redo"
        >
          ↪ Redo
        </button>
        <span style={{ width: 1, height: 20, background: '#3f3f46' }} />
        <button onClick={() => setSnapEnabled(!snapEnabled)} style={toolBtn(snapEnabled)}>
          {snapEnabled ? '🧲 Snap ON' : '🧲 Snap OFF'}
        </button>
        <button
          onClick={() => setPlacingFingerHole(!placingFingerHole)}
          disabled={!selectedToolId}
          style={toolBtn(placingFingerHole)}
          title="Click to place a finger hole on the selected tool"
        >
          {placingFingerHole ? '👆 Click on tool...' : '◯ Finger Hole'}
        </button>
        <button
          onClick={handleSimplifyVertices}
          disabled={!selectedToolId}
          style={toolBtn(false)}
          title="Remove vertices that are closer than 1.5mm together"
        >
          ✂ Simplify
        </button>
        <span style={{ width: 1, height: 20, background: '#3f3f46' }} />
        {/* Symmetry controls */}
        <button
          onClick={() => setSymmetryAxis(symmetryAxis === 'x' ? null : 'x')}
          disabled={!selectedToolId}
          style={toolBtn(symmetryAxis === 'x')}
          title="Toggle X-axis symmetry (vertical line through tool center)"
        >
          ⇅ Sym X
        </button>
        <button
          onClick={() => setSymmetryAxis(symmetryAxis === 'y' ? null : 'y')}
          disabled={!selectedToolId}
          style={toolBtn(symmetryAxis === 'y')}
          title="Toggle Y-axis symmetry (horizontal line through tool center)"
        >
          ⇄ Sym Y
        </button>
        {symmetryAxis && (
          <>
            <button
              onClick={() => setSymmetryMode(symmetryMode === 'live' ? 'manual' : 'live')}
              style={toolBtn(symmetryMode === 'live')}
              title={symmetryMode === 'live' ? 'Live mirror: dragging a vertex mirrors its partner' : 'Manual mode: use buttons below'}
            >
              {symmetryMode === 'live' ? '🔗 Live' : '✋ Manual'}
            </button>
            <button
              onClick={() => selectedToolId && mirrorHalf(selectedToolId, symmetryAxis, symmetryAxis === 'x' ? 'left' : 'top')}
              style={toolBtn(false)}
              title={`Copy left/top half to right/bottom (mirror across ${symmetryAxis.toUpperCase()} axis)`}
            >
              ⬅ Copy→
            </button>
            <button
              onClick={() => selectedToolId && mirrorHalf(selectedToolId, symmetryAxis, symmetryAxis === 'x' ? 'right' : 'bottom')}
              style={toolBtn(false)}
              title={`Copy right/bottom half to left/top (mirror across ${symmetryAxis.toUpperCase()} axis)`}
            >
              ←Copy ➡
            </button>
            <button
              onClick={() => selectedToolId && symmetrize(selectedToolId, symmetryAxis)}
              style={toolBtn(false)}
              title="Average both sides for perfect symmetry"
            >
              ⚖ Symmetrize
            </button>
          </>
        )}
        <span style={{ width: 1, height: 20, background: '#3f3f46' }} />
        <button
          onClick={() => setShowAddTool(true)}
          style={toolBtn(false)}
          title="Add a new shape with custom dimensions"
        >
          ＋ Add Shape
        </button>
        <button
          onClick={handleAddLabel}
          style={toolBtn(false)}
          title="Add a text label to the bin surface"
        >
          🏷 Add Label
        </button>
        <span style={{ width: 1, height: 20, background: '#3f3f46' }} />
        <span style={{ fontSize: 11, color: '#71717a' }}>Nudge:</span>
        <select
          value={nudgeStep}
          onChange={(e) => setNudgeStep(parseFloat(e.target.value))}
          style={{ ...toolBtn(false), padding: '3px 6px', cursor: 'pointer' }}
          title="Arrow key movement step size"
        >
          <option value={0.1}>0.1mm</option>
          <option value={1}>1mm</option>
          <option value={5}>5mm</option>
          <option value={10}>10mm</option>
        </select>
        <span style={{ fontSize: 10, color: '#52525b' }}>Shift+Arrow = 10×</span>
        <button onClick={() => setZoom((z) => Math.max(0.15, z - 0.2))} style={toolBtn(false)}>−</button>
        <button onClick={() => setZoom(0.5)} style={toolBtn(false)} title="Fit workspace to screen">Fit</button>
        <button onClick={() => setZoom(1)} style={toolBtn(false)} title="Zoom to tray (100%)">Tray</button>
        <span style={{ fontSize: 12, color: '#71717a', minWidth: 40 }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(8, z + 0.2))} style={toolBtn(false)}>+</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#52525b' }}>
          {placingFingerHole
            ? 'Click anywhere on the selected tool to place a finger hole'
            : selectedToolIds.length > 1
              ? `${selectedToolIds.length} tools selected · Ctrl+click to add/remove · Drag to move all`
              : symmetryAxis
                ? `Symmetry ${symmetryAxis.toUpperCase()} ${symmetryMode === 'live' ? '(live mirror)' : '(manual)'} · Drag vertices to edit · Use Copy buttons to mirror halves`
                : selectedToolId
                  ? 'Drag to move · Arrow keys to nudge · Drag vertices to edit · Double-click edge to add vertex'
                  : 'Drag vertices to edit · Double-click edge to add vertex · Ctrl+click or drag-box to multi-select'}
        </span>
      </div>

      {/* SVG Canvas */}
      <div style={{ flex: 1, overflow: 'auto', background: '#0f1115', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 12 }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${viewW} ${viewH}`}
          preserveAspectRatio="xMidYMin meet"
          style={{
            width: '100%', height: '100%', maxWidth: viewW * zoom * 8, maxHeight: viewH * zoom * 8,
            cursor: placingFingerHole ? 'crosshair' : (marquee ? 'crosshair' : 'default'),
          }}
          onPointerDown={(e) => {
            if (placingFingerHole) return
            handleSvgPointerDown(e)
          }}
          onPointerMove={(e) => {
            handlePointerMove(e)
            handleSvgPointerMove(e)
          }}
          onPointerUp={(e) => {
            handlePointerUp(e)
            handleSvgPointerUp(e)
          }}
          onClick={(e) => {
            if (placingFingerHole) {
              handlePlaceFingerHole(e)
              return
            }
            if (suppressClickRef.current) {
              suppressClickRef.current = false
              return
            }
            // Don't deselect on click if we just finished a marquee selection
            if (marqueeJustFinishedRef.current) {
              marqueeJustFinishedRef.current = false
              return
            }
            selectTool(null)  // clears both selectedToolId and selectedToolIds
          }}
        >
          {/* Workspace background (entire SVG area) */}
          <rect x={0} y={0} width={viewW} height={viewH} fill="#0a0b0e" />

          {/* Workspace grid (10mm fine grid, very subtle) */}
          <g stroke="#151618" strokeWidth={0.15}>
            {Array.from({ length: Math.ceil(viewW / 10) + 1 }, (_, i) => (
              <line key={`wsx${i}`} x1={i * 10} y1={0} x2={i * 10} y2={viewH} />
            ))}
            {Array.from({ length: Math.ceil(viewH / 10) + 1 }, (_, i) => (
              <line key={`wsy${i}`} x1={0} y1={i * 10} x2={viewW} y2={i * 10} />
            ))}
          </g>

          {/* Workspace grid (50mm major grid, slightly more visible) */}
          <g stroke="#1c1e22" strokeWidth={0.25}>
            {Array.from({ length: Math.ceil(viewW / 50) + 1 }, (_, i) => (
              <line key={`wsX${i}`} x1={i * 50} y1={0} x2={i * 50} y2={viewH} />
            ))}
            {Array.from({ length: Math.ceil(viewH / 50) + 1 }, (_, i) => (
              <line key={`wsY${i}`} x1={0} y1={i * 50} x2={viewW} y2={i * 50} />
            ))}
          </g>

          {/* Tray shadow (subtle drop shadow effect) */}
          <rect
            x={pad + 1} y={pad + 1.5} width={binW} height={binL}
            fill="#000000" opacity={0.4} rx={3.75} ry={3.75}
          />

          {/* Tray area (the actual Gridfinity bin) */}
          <rect
            x={pad} y={pad} width={binW} height={binL}
            fill="#18181b" stroke="#52525b" strokeWidth={0.6} rx={3.75} ry={3.75}
          />

          {/* Tray label (top-left corner) */}
          <text x={pad + 3} y={pad - 3} fontSize={4} fill="#52525b" fontWeight="bold">
            {p.grid_w}×{p.grid_l} Gridfinity
          </text>

          {/* Grid overlay (Gridfinity unit grid lines inside tray) */}
          <g stroke="#27272a" strokeWidth={0.2} strokeDasharray="2,2">
            {Array.from({ length: p.grid_w - 1 }, (_, i) => (
              <line key={`vx${i}`} x1={pad + (i + 1) * GRID_UNIT_MM} y1={pad} x2={pad + (i + 1) * GRID_UNIT_MM} y2={pad + binL} />
            ))}
            {Array.from({ length: p.grid_l - 1 }, (_, i) => (
              <line key={`hy${i}`} x1={pad} y1={pad + (i + 1) * GRID_UNIT_MM} x2={pad + binW} y2={pad + (i + 1) * GRID_UNIT_MM} />
            ))}
          </g>

          {/* Ruler marks — top edge (mm scale) */}
          <g stroke="#3f3f46" strokeWidth={0.2}>
            {Array.from({ length: Math.ceil(binW / 10) + 1 }, (_, i) => {
              const x = pad + i * 10
              const isMajor = i % 5 === 0
              return (
                <g key={`rT${i}`}>
                  <line x1={x} y1={pad - (isMajor ? 4 : 2)} x2={x} y2={pad} />
                  {isMajor && (
                    <text x={x} y={pad - 5} fontSize={2.5} fill="#52525b" textAnchor="middle">
                      {i * 10}
                    </text>
                  )}
                </g>
              )
            })}
          </g>

          {/* Ruler marks — left edge (mm scale) */}
          <g stroke="#3f3f46" strokeWidth={0.2}>
            {Array.from({ length: Math.ceil(binL / 10) + 1 }, (_, i) => {
              const y = pad + i * 10
              const isMajor = i % 5 === 0
              return (
                <g key={`rL${i}`}>
                  <line x1={pad - (isMajor ? 4 : 2)} y1={y} x2={pad} y2={y} />
                  {isMajor && (
                    <text x={pad - 5} y={y + 1} fontSize={2.5} fill="#52525b" textAnchor="end">
                      {i * 10}
                    </text>
                  )}
                </g>
              )
            })}
          </g>

          {/* Magnet holes */}
          {p.magnet_holes && (
            <g fill="none" stroke="#3f3f46" strokeWidth={0.3}>
              {[[pad + 8, pad + 8], [pad + binW - 8, pad + 8], [pad + 8, pad + binL - 8], [pad + binW - 8, pad + binL - 8]].map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r={3} />
              ))}
            </g>
          )}

          {/* Tool outlines */}
          {design.outlines.map((tool) => {
            if (!tool.visible) return null
            const isSelected = selectedToolIds.includes(tool.id)
            const margin = tool.margin_mm ?? p.tool_margin_mm
            // Compute centroid for rotation
            const cx = tool.outer.reduce((a, b) => a + b.x, 0) / tool.outer.length
            const cy = tool.outer.reduce((a, b) => a + b.y, 0) / tool.outer.length
            const rot = tool.rotation_deg ?? 0
            // SVG transform: rotate around centroid (in SVG coords, y is down)
            const transform = rot !== 0
              ? `rotate(${rot} ${cx + pad} ${cy + pad})`
              : undefined

            const outerD = smoothClosedPath(tool.outer.map(pt => ({ x: pt.x + pad, y: pt.y + pad })), tool.smoothing ?? 0.3)

            return (
              <g key={tool.id} transform={transform}>
                {/* Margin preview (dashed) */}
                <path d={outerD} fill={isSelected ? 'rgba(124,58,237,0.15)' : 'rgba(63,63,70,0.1)'} stroke="none" />
                <path d={outerD} fill="none" stroke={isSelected ? '#a78bfa' : '#71717a'} strokeWidth={0.4} />

                {/* Holes */}
                {tool.holes.map((hole, hi) => {
                  const hd = smoothClosedPath(hole.map(pt => ({ x: pt.x + pad, y: pt.y + pad })), tool.smoothing ?? 0.3)
                  return <path key={hi} d={hd} fill="#0f1115" stroke={isSelected ? '#a78bfa' : '#71717a'} strokeWidth={0.3} />
                })}

                {/* Label */}
                {tool.label && (
                  <text
                    x={pad + cx}
                    y={pad + cy}
                    fontSize={3} fill={isSelected ? '#a78bfa' : '#52525b'} textAnchor="middle"
                  >
                    {tool.label}
                  </text>
                )}

                {/* Vertices (only for selected tool) — larger when zoomed in */}
                {isSelected && tool.outer.map((pt, vi) => {
                  // Compute distance to next vertex to detect clusters
                  const next = tool.outer[(vi + 1) % tool.outer.length]
                  const dist = Math.sqrt((pt.x - next.x) ** 2 + (pt.y - next.y) ** 2)
                  const isClustered = dist < 2 // less than 2mm apart
                  // Highlight mirrored vertex pair when symmetry is live
                  const draggedTool = drag?.type === 'vertex' ? design.outlines.find(o => o.id === drag.toolId) : null
                  const draggedVertex = draggedTool && drag?.vertexIdx !== undefined ? draggedTool.outer[drag.vertexIdx] : null
                  const isMirrored = symmetryAxis && symmetryMode === 'live' && draggedVertex && drag &&
                    drag.toolId === tool.id &&
                    (vi === drag.vertexIdx || (
                      symmetryAxis === 'x'
                        ? Math.abs(pt.x - (2 * cx - draggedVertex.x)) < 0.5
                        : Math.abs(pt.y - (2 * cy - draggedVertex.y)) < 0.5
                    ))
                  return (
                    <circle
                      key={vi}
                      cx={pad + pt.x} cy={pad + pt.y} r={isClustered ? 2 : 1.5}
                      fill={isMirrored ? '#34d399' : (isClustered ? '#fca5a5' : '#a78bfa')}
                      stroke="#0f1115" strokeWidth={0.5}
                      style={{ cursor: 'grab' }}
                      onPointerDown={(e) => handleVertexPointerDown(e, tool.id, vi)}
                      onDoubleClick={(e) => { e.stopPropagation(); deleteVertex(tool.id, vi) }}
                    >
                      <title>
                        Vertex {vi}: ({pt.x.toFixed(1)}, {pt.y.toFixed(1)})mm
                        {isClustered ? ' — CLUSTERED (double-click to delete)' : ''}
                        {isMirrored ? ' — MIRRORED PAIR' : ''}
                      </title>
                    </circle>
                  )
                })}

                {/* Symmetry axis line (only for selected tool when symmetry is on) */}
                {isSelected && symmetryAxis && (() => {
                  // Compute bounding box of the tool to draw the axis line
                  const xs = tool.outer.map(p => p.x)
                  const ys = tool.outer.map(p => p.y)
                  const minX = Math.min(...xs), maxX = Math.max(...xs)
                  const minY = Math.min(...ys), maxY = Math.max(...ys)
                  const lineLen = Math.max(maxX - minX, maxY - minY) + 10
                  if (symmetryAxis === 'x') {
                    // Vertical line through centroid (X axis = mirror left/right)
                    return (
                      <line
                        x1={pad + cx} y1={pad + cy - lineLen / 2}
                        x2={pad + cx} y2={pad + cy + lineLen / 2}
                        stroke="#34d399" strokeWidth={0.4} strokeDasharray="3,2"
                        style={{ pointerEvents: 'none' }}
                      >
                        <title>Symmetry axis (X) — left/right mirror</title>
                      </line>
                    )
                  } else {
                    // Horizontal line through centroid (Y axis = mirror top/bottom)
                    return (
                      <line
                        x1={pad + cx - lineLen / 2} y1={pad + cy}
                        x2={pad + cx + lineLen / 2} y2={pad + cy}
                        stroke="#34d399" strokeWidth={0.4} strokeDasharray="3,2"
                        style={{ pointerEvents: 'none' }}
                      >
                        <title>Symmetry axis (Y) — top/bottom mirror</title>
                      </line>
                    )
                  }
                })()}

                {/* Dimension labels — distance from tool bbox to bin edges (single select only) */}
                {isSelected && selectedToolIds.length === 1 && (() => {
                  const xs = tool.outer.map(p => p.x)
                  const ys = tool.outer.map(p => p.y)
                  const minX = Math.min(...xs)
                  const maxX = Math.max(...xs)
                  const minY = Math.min(...ys)
                  const maxY = Math.max(...ys)
                  const midX = (minX + maxX) / 2
                  const midY = (minY + maxY) / 2
                  const distLeft = minX
                  const distRight = binW - maxX
                  const distTop = minY
                  const distBottom = binL - maxY
                  return (
                    <g style={{ pointerEvents: 'none' }}>
                      {/* Left distance */}
                      <line x1={pad} y1={pad + midY} x2={pad + minX} y2={pad + midY}
                        stroke="#22d3ee" strokeWidth={0.3} strokeDasharray="2,1" opacity={0.7} />
                      <text x={pad + distLeft / 2} y={pad + midY - 1}
                        fill="#22d3ee" fontSize={3} textAnchor="middle" opacity={0.8}>
                        {distLeft.toFixed(1)}
                      </text>
                      {/* Right distance */}
                      <line x1={pad + maxX} y1={pad + midY} x2={pad + binW} y2={pad + midY}
                        stroke="#22d3ee" strokeWidth={0.3} strokeDasharray="2,1" opacity={0.7} />
                      <text x={pad + maxX + distRight / 2} y={pad + midY - 1}
                        fill="#22d3ee" fontSize={3} textAnchor="middle" opacity={0.8}>
                        {distRight.toFixed(1)}
                      </text>
                      {/* Top distance */}
                      <line x1={pad + midX} y1={pad} x2={pad + midX} y2={pad + minY}
                        stroke="#22d3ee" strokeWidth={0.3} strokeDasharray="2,1" opacity={0.7} />
                      <text x={pad + midX} y={pad + distTop / 2}
                        fill="#22d3ee" fontSize={3} textAnchor="middle" opacity={0.8}>
                        {distTop.toFixed(1)}
                      </text>
                      {/* Bottom distance */}
                      <line x1={pad + midX} y1={pad + maxY} x2={pad + midX} y2={pad + binL}
                        stroke="#22d3ee" strokeWidth={0.3} strokeDasharray="2,1" opacity={0.7} />
                      <text x={pad + midX} y={pad + maxY + distBottom / 2}
                        fill="#22d3ee" fontSize={3} textAnchor="middle" opacity={0.8}>
                        {distBottom.toFixed(1)}
                      </text>
                    </g>
                  )
                })()}

                {/* Finger holes (draggable circles) */}
                {(tool.finger_holes ?? []).map((hole, hi) => (
                  <g key={`fh${hi}`}>
                    <circle
                      cx={pad + hole.x} cy={pad + hole.y} r={hole.radius_mm}
                      fill="rgba(252,165,165,0.15)" stroke={isSelected ? '#fca5a5' : '#71717a'}
                      strokeWidth={0.3} strokeDasharray="1,1"
                      style={{ cursor: isSelected ? 'grab' : 'default', pointerEvents: isSelected ? 'all' : 'none' }}
                      onPointerDown={isSelected ? (e) => handleFingerHolePointerDown(e, tool.id, hi) : undefined}
                    />
                    <circle
                      cx={pad + hole.x} cy={pad + hole.y} r={1}
                      fill="#fca5a5" stroke="#0f1115" strokeWidth={0.3}
                      style={{ pointerEvents: 'none' }}
                    />
                  </g>
                ))}

                {/* Invisible thick path for easy tool selection/dragging */}
                <path
                  d={outerD}
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth={5}
                  style={{ cursor: 'move', pointerEvents: 'all' }}
                  onPointerDown={(e) => handleToolPointerDown(e, tool.id)}
                />
              </g>
            )
          })}

          {/* Text labels — draggable, on the bin surface or flat */}
          {design.labels.map((label) => {
            const color = label.target === 'flat' ? '#60a5fa' : (label.cutout ? '#fbbf24' : '#34d399')
            return (
            <g
              key={label.id}
              transform={label.rotation_deg !== 0 ? `rotate(${label.rotation_deg} ${pad + label.x} ${pad + label.y})` : undefined}
            >
              {/* Bounding rect for drag target (invisible) */}
              <rect
                x={pad + label.x - label.text.length * label.font_size_mm * 0.3}
                y={pad + label.y - label.font_size_mm}
                width={label.text.length * label.font_size_mm * 0.6}
                height={label.font_size_mm * 1.4}
                fill="transparent"
                stroke={color}
                strokeWidth={0.3}
                strokeDasharray="2,1"
                style={{ cursor: 'move', pointerEvents: 'all' }}
                onPointerDown={(e) => handleLabelPointerDown(e, label.id)}
                onPointerMove={handleLabelPointerMove}
                onPointerUp={handleLabelPointerUp}
                onDoubleClick={() => deleteLabel(label.id)}
              >
                <title>
                  {label.text} — {label.target === 'flat' ? 'Flat' : 'Tray'} · {label.cutout ? 'Cutout' : 'Raised'} · Double-click to delete
                </title>
              </rect>
              <text
                x={pad + label.x}
                y={pad + label.y}
                fontSize={label.font_size_mm}
                fill={color}
                textAnchor="middle"
                fontFamily={fontKeyToCssFamily(label.font)}
                fontWeight={label.font?.includes('Bold') ? 'bold' : 'normal'}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {label.text}
              </text>
            </g>
            )
          })}

          {/* Marquee selection rectangle */}
          {marquee && (
            <rect
              x={pad + Math.min(marquee.startX, marquee.x)}
              y={pad + Math.min(marquee.startY, marquee.y)}
              width={Math.abs(marquee.x - marquee.startX)}
              height={Math.abs(marquee.y - marquee.startY)}
              fill="rgba(124, 58, 237, 0.1)"
              stroke="#a78bfa"
              strokeWidth={0.3}
              strokeDasharray="2,1"
              pointerEvents="none"
            />
          )}
        </svg>
      </div>

      <AddShapeDialog
        open={showAddTool}
        onClose={() => setShowAddTool(false)}
        onCreate={handleAddShape}
        binW={binW}
        binL={binL}
      />
    </div>
  )
}

function toolBtn(active: boolean): React.CSSProperties {
  return {
    padding: '4px 10px', borderRadius: 4, border: `1px solid ${active ? '#7c3aed' : '#3f3f46'}`,
    background: active ? '#3b0764' : '#27272a', color: active ? '#a78bfa' : '#a1a1aa',
    cursor: 'pointer', fontSize: 12,
  }
}
