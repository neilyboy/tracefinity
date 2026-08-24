import { useRef, useState, useCallback } from 'react'
import { useEditor } from '../editor/useEditorState'
import { clientToSvgMm, snapToGrid, snapFine } from '../editor/vertexDrag'
import { GRID_UNIT_MM } from '../editor/constants'
import { smoothClosedPath } from '../utils/smoothPath'
import { fontKeyToCssFamily } from '../editor/fontLoader'
import type { Point, FingerHole, TextLabel } from '../types'

export default function SvgEditor() {
  const svgRef = useRef<SVGSVGElement>(null)
  const {
    design, selectedToolId, selectTool, updateVertex, moveTool,
    addVertex, deleteVertex, deleteTool, pushHistory, updateTool,
    undo, redo, history, historyIndex,
    addLabel, updateLabel, deleteLabel, moveLabel,
    symmetryAxis, symmetryMode, setSymmetryAxis, setSymmetryMode,
    mirrorHalf, symmetrize,
  } = useEditor()

  const [drag, setDrag] = useState<{
    type: 'vertex' | 'tool' | 'fingerHole'
    toolId: string
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
  const [zoom, setZoom] = useState(1)
  const [placingFingerHole, setPlacingFingerHole] = useState(false)
  const [draggingLabel, setDraggingLabel] = useState<string | null>(null)

  const p = design.params
  const binW = p.grid_w * GRID_UNIT_MM
  const binL = p.grid_l * GRID_UNIT_MM
  const pad = 10
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
    setDrag({ type: 'tool', toolId, startMm: mm, startVertices: tool.outer.map((v) => ({ ...v })) })
    lastMoveRef.current = { dx: 0, dy: 0 }
    selectTool(toolId)
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
    } else if (drag.type === 'fingerHole' && drag.fingerHoleIdx !== undefined && drag.startHole) {
      const newPos = {
        x: snapFine(drag.startHole.x + dx, snapEnabled ? 0.5 : 0.01),
        y: snapFine(drag.startHole.y + dy, snapEnabled ? 0.5 : 0.01),
      }
      const tool = design.outlines.find((o) => o.id === drag.toolId)
      if (tool) {
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
    const newHole: FingerHole = {
      x: snapFine(mm.x, 0.5),
      y: snapFine(mm.y, 0.5),
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
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!selectedToolId) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteTool(selectedToolId)
    }
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
      <div style={{ display: 'flex', gap: 8, padding: '6px 12px', borderBottom: '1px solid #27272a', alignItems: 'center' }}>
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
          onClick={handleAddLabel}
          style={toolBtn(false)}
          title="Add a text label to the bin surface"
        >
          🏷 Add Label
        </button>
        <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))} style={toolBtn(false)}>−</button>
        <span style={{ fontSize: 12, color: '#71717a', minWidth: 40 }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(4, z + 0.2))} style={toolBtn(false)}>+</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#52525b' }}>
          {placingFingerHole
            ? 'Click anywhere on the selected tool to place a finger hole'
            : symmetryAxis
              ? `Symmetry ${symmetryAxis.toUpperCase()} ${symmetryMode === 'live' ? '(live mirror)' : '(manual)'} · Drag vertices to edit · Use Copy buttons to mirror halves`
              : 'Drag vertices to edit · Double-click edge to add vertex · Del to remove tool'}
        </span>
      </div>

      {/* SVG Canvas */}
      <div style={{ flex: 1, overflow: 'auto', background: '#0f1115', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 12 }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${viewW} ${viewH}`}
          style={{
            width: viewW * zoom * 3, height: viewH * zoom * 3, maxWidth: '100%',
            cursor: placingFingerHole ? 'crosshair' : 'default',
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onClick={(e) => {
            if (placingFingerHole) {
              handlePlaceFingerHole(e)
              return
            }
            if (suppressClickRef.current) {
              suppressClickRef.current = false
              return
            }
            selectTool(null)
          }}
        >
          {/* Bin outline */}
          <rect
            x={pad} y={pad} width={binW} height={binL}
            fill="#18181b" stroke="#3f3f46" strokeWidth={0.5} rx={3.75} ry={3.75}
          />

          {/* Grid overlay */}
          <g stroke="#27272a" strokeWidth={0.2} strokeDasharray="2,2">
            {Array.from({ length: p.grid_w - 1 }, (_, i) => (
              <line key={`vx${i}`} x1={pad + (i + 1) * GRID_UNIT_MM} y1={pad} x2={pad + (i + 1) * GRID_UNIT_MM} y2={pad + binL} />
            ))}
            {Array.from({ length: p.grid_l - 1 }, (_, i) => (
              <line key={`hy${i}`} x1={pad} y1={pad + (i + 1) * GRID_UNIT_MM} x2={pad + binW} y2={pad + (i + 1) * GRID_UNIT_MM} />
            ))}
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
            const isSelected = tool.id === selectedToolId
            const margin = tool.margin_mm ?? p.tool_margin_mm
            // Compute centroid for rotation
            const cx = tool.outer.reduce((a, b) => a + b.x, 0) / tool.outer.length
            const cy = tool.outer.reduce((a, b) => a + b.y, 0) / tool.outer.length
            const rot = tool.rotation_deg ?? 0
            // SVG transform: rotate around centroid (in SVG coords, y is down)
            const transform = rot !== 0
              ? `rotate(${rot} ${cx + pad} ${cy + pad})`
              : undefined

            const outerD = smoothClosedPath(tool.outer.map(pt => ({ x: pt.x + pad, y: pt.y + pad })))

            return (
              <g key={tool.id} transform={transform}>
                {/* Margin preview (dashed) */}
                <path d={outerD} fill={isSelected ? 'rgba(124,58,237,0.15)' : 'rgba(63,63,70,0.1)'} stroke="none" />
                <path d={outerD} fill="none" stroke={isSelected ? '#a78bfa' : '#71717a'} strokeWidth={0.4} />

                {/* Holes */}
                {tool.holes.map((hole, hi) => {
                  const hd = smoothClosedPath(hole.map(pt => ({ x: pt.x + pad, y: pt.y + pad })))
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
                  const isMirrored = symmetryAxis && symmetryMode === 'live' && drag?.type === 'vertex' &&
                    drag.toolId === tool.id &&
                    (vi === drag.vertexIdx || (
                      symmetryAxis === 'x'
                        ? Math.abs(pt.x - (2 * cx - design.outlines.find(o => o.id === drag.toolId)!.outer[drag.vertexIdx!].x)) < 0.5
                        : Math.abs(pt.y - (2 * cy - design.outlines.find(o => o.id === drag.toolId)!.outer[drag.vertexIdx!].y)) < 0.5
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

                {/* Auto finger scoop preview (at tool tip, when enabled) */}
                {p.finger_scoop && (() => {
                  // Find farthest point from centroid (rotation preserves distances,
                  // so we can compute in unrotated coords and render inside the rotated <g>)
                  let farPt = tool.outer[0]
                  let maxDist = 0
                  for (const pt of tool.outer) {
                    const d = Math.sqrt((pt.x - cx) ** 2 + (pt.y - cy) ** 2)
                    if (d > maxDist) { maxDist = d; farPt = pt }
                  }
                  const dx = farPt.x - cx, dy = farPt.y - cy
                  const dist = Math.sqrt(dx * dx + dy * dy)
                  if (dist < 1e-6) return null
                  const ux = dx / dist, uy = dy / dist
                  const scoopR = p.finger_scoop_diameter_mm / 2
                  const sx = farPt.x + ux * (margin + scoopR * 0.3)
                  const sy = farPt.y + uy * (margin + scoopR * 0.3)
                  return (
                    <g style={{ pointerEvents: 'none' }}>
                      <circle
                        cx={pad + sx} cy={pad + sy} r={scoopR}
                        fill="rgba(251,191,36,0.08)" stroke="#fbbf24"
                        strokeWidth={0.3} strokeDasharray="2,1.5"
                      />
                      <text
                        x={pad + sx} y={pad + sy + 1}
                        fontSize={2} fill="#fbbf24" textAnchor="middle"
                        style={{ pointerEvents: 'none' }}
                      >
                        scoop
                      </text>
                    </g>
                  )
                })()}

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
        </svg>
      </div>
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
