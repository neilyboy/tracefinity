import { useRef, useState, useCallback } from 'react'
import { useEditor } from '../editor/useEditorState'
import { clientToSvgMm, snapToGrid, snapFine } from '../editor/vertexDrag'
import { GRID_UNIT_MM } from '../editor/constants'
import { smoothClosedPath } from '../utils/smoothPath'
import type { Point, FingerHole } from '../types'

export default function SvgEditor() {
  const svgRef = useRef<SVGSVGElement>(null)
  const {
    design, selectedToolId, selectTool, updateVertex, moveTool,
    addVertex, deleteVertex, deleteTool, pushHistory, updateTool,
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

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, padding: '6px 12px', borderBottom: '1px solid #27272a', alignItems: 'center' }}>
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
        <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))} style={toolBtn(false)}>−</button>
        <span style={{ fontSize: 12, color: '#71717a', minWidth: 40 }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(4, z + 0.2))} style={toolBtn(false)}>+</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#52525b' }}>
          {placingFingerHole
            ? 'Click anywhere on the selected tool to place a finger hole'
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
            const outerD = smoothClosedPath(tool.outer.map(pt => ({ x: pt.x + pad, y: pt.y + pad })))
            // Offset (margin) outline - simplified visual
            const offsetD = smoothClosedPath(tool.outer.map(pt => ({ x: pt.x + pad + margin * Math.sign(pt.x - tool.outer[0].x || 1), y: pt.y + pad + margin * Math.sign(pt.y - tool.outer[0].y || 1) })))

            return (
              <g key={tool.id}>
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
                    x={pad + tool.outer.reduce((a, b) => a + b.x, 0) / tool.outer.length}
                    y={pad + tool.outer.reduce((a, b) => a + b.y, 0) / tool.outer.length}
                    fontSize={3} fill={isSelected ? '#a78bfa' : '#52525b'} textAnchor="middle"
                  >
                    {tool.label}
                  </text>
                )}

                {/* Vertices (only for selected tool) */}
                {isSelected && tool.outer.map((pt, vi) => (
                  <circle
                    key={vi}
                    cx={pad + pt.x} cy={pad + pt.y} r={1.5}
                    fill="#a78bfa" stroke="#0f1115" strokeWidth={0.5}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => handleVertexPointerDown(e, tool.id, vi)}
                    onDoubleClick={(e) => { e.stopPropagation(); deleteVertex(tool.id, vi) }}
                  />
                ))}

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
