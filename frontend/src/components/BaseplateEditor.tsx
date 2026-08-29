import { useRef, useState, useCallback, useEffect } from 'react'
import { useBaseplate } from '../editor/useBaseplateState'
import { clientToSvgMm } from '../editor/vertexDrag'
import { GRID_UNIT_MM } from '../editor/constants'
import { getSegmentInfo } from '../api/client'
import type { Point, DrawerCutout } from '../types'
import AddShapeDialog, { createTool } from './AddShapeDialog'
import type { ShapeType } from './AddShapeDialog'

// Segment colors for visual distinction
const SEGMENT_COLORS = [
  'rgba(167, 139, 250, 0.12)',
  'rgba(34, 197, 94, 0.12)',
  'rgba(59, 130, 246, 0.12)',
  'rgba(251, 146, 60, 0.12)',
  'rgba(236, 72, 153, 0.12)',
  'rgba(234, 179, 8, 0.12)',
  'rgba(20, 184, 166, 0.12)',
  'rgba(168, 85, 247, 0.12)',
  'rgba(99, 102, 241, 0.12)',
  'rgba(244, 63, 94, 0.12)',
]

export default function BaseplateEditor() {
  const svgRef = useRef<SVGSVGElement>(null)
  const {
    design, selectedCutoutId, selectCutout,
    addCutout, updateCutout, deleteCutout, moveCutout,
    segmentInfo, setSegmentInfo,
    pushHistory, undo, redo,
  } = useBaseplate()

  const [drag, setDrag] = useState<{
    type: 'cutout' | 'vertex'
    cutoutId: string
    vertexIdx?: number
    startMm: Point
    startOuter: Point[]
    startCenter: Point
  } | null>(null)

  const [zoom, setZoom] = useState(0.4)
  const [showAddShape, setShowAddShape] = useState(false)
  const suppressClickRef = useRef(false)

  const p = design.params
  const drawerW = p.drawer_w_mm
  const drawerL = p.drawer_l_mm
  const pad = 60
  const viewW = drawerW + 2 * pad
  const viewH = drawerL + 2 * pad

  // Compute plate position within drawer (centered with padding)
  const padding = {
    left: p.padding_left_mm + p.drawer_clearance_mm,
    right: p.padding_right_mm + p.drawer_clearance_mm,
    top: p.padding_top_mm + p.drawer_clearance_mm,
    bottom: p.padding_bottom_mm + p.drawer_clearance_mm,
  }
  const availW = drawerW - padding.left - padding.right
  const availL = drawerL - padding.top - padding.bottom
  const gridW = Math.max(1, Math.floor(availW / GRID_UNIT_MM))
  const gridL = Math.max(1, Math.floor(availL / GRID_UNIT_MM))
  const plateW = gridW * GRID_UNIT_MM
  const plateL = gridL * GRID_UNIT_MM
  // Plate top-left in drawer coords (SVG Y-down)
  const plateX = (drawerW - plateW) / 2
  const plateY = (drawerL - plateL) / 2

  const toMm = useCallback((clientX: number, clientY: number): Point => {
    if (!svgRef.current) return { x: 0, y: 0 }
    const pt = clientToSvgMm(svgRef.current, clientX, clientY)
    return { x: pt.x - pad, y: pt.y - pad }
  }, [])

  // Fetch segment info from backend when params change
  useEffect(() => {
    const timer = setTimeout(() => {
      getSegmentInfo(design).then(setSegmentInfo).catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [design.params, design.cutouts.length])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCutoutId) {
        e.preventDefault()
        deleteCutout(selectedCutoutId)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo, selectedCutoutId, deleteCutout])

  const handleCutoutPointerDown = (e: React.PointerEvent, cutoutId: string) => {
    e.stopPropagation()
    suppressClickRef.current = true
    const cutout = design.cutouts.find((c) => c.id === cutoutId)
    if (!cutout) return
    const mm = toMm(e.clientX, e.clientY)
    setDrag({
      type: 'cutout',
      cutoutId,
      startMm: mm,
      startOuter: cutout.outer.map((v) => ({ ...v })),
      startCenter: { x: cutout.x, y: cutout.y },
    })
    selectCutout(cutoutId)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const handleVertexPointerDown = (e: React.PointerEvent, cutoutId: string, vertexIdx: number) => {
    e.stopPropagation()
    suppressClickRef.current = true
    const cutout = design.cutouts.find((c) => c.id === cutoutId)
    if (!cutout) return
    const mm = toMm(e.clientX, e.clientY)
    setDrag({
      type: 'vertex',
      cutoutId,
      vertexIdx,
      startMm: mm,
      startOuter: cutout.outer.map((v) => ({ ...v })),
      startCenter: { x: cutout.x, y: cutout.y },
    })
    selectCutout(cutoutId)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const mm = toMm(e.clientX, e.clientY)
    const dx = mm.x - drag.startMm.x
    const dy = mm.y - drag.startMm.y

    if (drag.type === 'cutout') {
      // Use absolute positioning from drag start snapshot to avoid compounding
      const newOuter = drag.startOuter.map((v) => ({ x: v.x + dx, y: v.y + dy }))
      const newCenter = { x: drag.startCenter.x + dx, y: drag.startCenter.y + dy }
      updateCutout(drag.cutoutId, { outer: newOuter, x: newCenter.x, y: newCenter.y })
    } else if (drag.type === 'vertex' && drag.vertexIdx !== undefined) {
      const newOuter = drag.startOuter.map((v, i) =>
        i === drag.vertexIdx ? { x: v.x + dx, y: v.y + dy } : v
      )
      updateCutout(drag.cutoutId, { outer: newOuter })
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (drag) {
      pushHistory()
      setDrag(null)
    }
    setTimeout(() => { suppressClickRef.current = false }, 50)
  }

  const handleAddShape = (shapeType: ShapeType, w: number, h: number, _r: number, extra?: any) => {
    // Add cutout at center of drawer
    const cx = drawerW / 2
    const cy = drawerL / 2
    const tool = createTool(shapeType, w, h, _r, cx, cy, extra)
    const cutout: DrawerCutout = {
      id: tool.id,
      shape: shapeType,
      outer: tool.outer,
      x: cx,
      y: cy,
      w,
      h,
      rotation_deg: 0,
      cutout_type: 'through',
      depth_mm: 3.0,
    }
    addCutout(cutout)
  }

  // Render cutout polygon path
  const cutoutPath = (outer: Point[]) => {
    if (outer.length === 0) return ''
    return outer.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
  }

  // Grid lines for the plate area
  const gridLines = []
  for (let i = 0; i <= gridW; i++) {
    const x = plateX + i * GRID_UNIT_MM
    gridLines.push(<line key={`gx${i}`} x1={x} y1={plateY} x2={x} y2={plateY + plateL} stroke="#3f3f46" strokeWidth={0.3} />)
  }
  for (let i = 0; i <= gridL; i++) {
    const y = plateY + i * GRID_UNIT_MM
    gridLines.push(<line key={`gy${i}`} x1={plateX} y1={y} x2={plateX + plateW} y2={y} stroke="#3f3f46" strokeWidth={0.3} />)
  }

  // Cut lines (from segment info)
  const cutLines = []
  if (segmentInfo) {
    for (const cx of segmentInfo.cuts_x) {
      const x = plateX + cx * GRID_UNIT_MM
      cutLines.push(<line key={`cx${cx}`} x1={x} y1={plateY} x2={x} y2={plateY + plateL} stroke="#3b82f6" strokeWidth={0.8} strokeDasharray="4 2" />)
    }
    for (const cy of segmentInfo.cuts_y) {
      const y = plateY + cy * GRID_UNIT_MM
      cutLines.push(<line key={`cy${cy}`} x1={plateX} y1={y} x2={plateX + plateW} y2={y} stroke="#3b82f6" strokeWidth={0.8} strokeDasharray="4 2" />)
    }
  }

  // Segment fills
  const segmentFills = []
  if (segmentInfo && segmentInfo.segment_count > 1) {
    for (const seg of segmentInfo.segments) {
      // seg.x, seg.y are in plate-local coords (centered at plate center, Y-up)
      // Convert to drawer SVG coords (Y-down, origin at drawer top-left)
      const segX = plateX + plateW / 2 + seg.x - seg.w / 2
      const segY = plateY + plateL / 2 - seg.y - seg.h / 2
      const color = SEGMENT_COLORS[(seg.index - 1) % SEGMENT_COLORS.length]
      segmentFills.push(
        <rect key={`seg${seg.index}`} x={segX} y={segY} width={seg.w} height={seg.h}
          fill={color} stroke="#a78bfa" strokeWidth={0.3} strokeDasharray="2 2" />
      )
      // Segment label
      segmentFills.push(
        <text key={`seglabel${seg.index}`} x={segX + seg.w / 2} y={segY + seg.h / 2}
          fill="#a78bfa" fontSize={12} textAnchor="middle" dominantBaseline="middle"
          style={{ pointerEvents: 'none', fontWeight: 700 }}>
          S{seg.index}
        </text>
      )
    }
  }

  // Print bed overlay (positioned at top-left of plate area)
  const bedX = plateX
  const bedY = plateY
  const bedW = p.print_bed_w_mm
  const bedL = p.print_bed_l_mm

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
        borderBottom: '1px solid #27272a', background: '#18181b', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <button onClick={() => setShowAddShape(true)} style={toolBtn}>
          ＋ Add Cutout
        </button>
        {selectedCutoutId && (
          <button onClick={() => deleteCutout(selectedCutoutId)} style={{ ...toolBtn, color: '#fca5a5' }}>
            🗑 Delete
          </button>
        )}
        <span style={{ width: 1, height: 20, background: '#3f3f46' }} />
        <button onClick={() => undo()} style={toolBtn}>↶ Undo</button>
        <button onClick={() => redo()} style={toolBtn}>↷ Redo</button>
        <span style={{ width: 1, height: 20, background: '#3f3f46' }} />
        <button onClick={() => setZoom((z) => Math.max(0.15, z - 0.2))} style={toolBtn}>−</button>
        <button onClick={() => setZoom(0.4)} style={toolBtn} title="Fit">Fit</button>
        <button onClick={() => setZoom((z) => Math.min(8, z + 0.2))} style={toolBtn}>+</button>
        <span style={{ fontSize: 12, color: '#71717a', minWidth: 40 }}>{Math.round(zoom * 100)}%</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#52525b' }}>
          {selectedCutoutId
            ? 'Drag cutout to move · Drag vertices to resize'
            : `Grid: ${gridW}×${gridL} cells = ${plateW.toFixed(0)}×${plateL.toFixed(0)}mm` +
              (segmentInfo && segmentInfo.segment_count > 1 ? ` · ${segmentInfo.segment_count} segments` : '')}
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
            cursor: drag ? 'grabbing' : 'default',
          }}
          onPointerDown={(e) => {
            // Click on empty area → deselect
            if (!suppressClickRef.current) selectCutout(null)
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Drawer outline */}
          <rect
            x={pad} y={pad} width={drawerW} height={drawerL}
            fill="#18181b" stroke="#52525b" strokeWidth={1} rx={2}
          />
          {/* Drawer label */}
          <text x={pad + drawerW / 2} y={pad - 8} fill="#71717a" fontSize={10} textAnchor="middle">
            Drawer: {drawerW}×{drawerL}mm
          </text>

          {/* Plate area (gridfinity grid) */}
          <rect
            x={plateX + pad} y={plateY + pad} width={plateW} height={plateL}
            fill="#1e1b2e" stroke="#7c3aed" strokeWidth={0.8}
          />
          {/* Offset all plate-relative elements by pad */}
          <g transform={`translate(${pad}, ${pad})`}>
            {/* Grid lines */}
            {gridLines}
            {/* Segment fills */}
            {segmentFills}
            {/* Cut lines */}
            {cutLines}
            {/* Print bed overlay (dashed) */}
            <rect
              x={bedX} y={bedY} width={bedW} height={bedL}
              fill="none" stroke="#f59e0b" strokeWidth={0.6} strokeDasharray="6 3" opacity={0.6}
              style={{ pointerEvents: 'none' }}
            />
            <text x={bedX + 4} y={bedY + 10} fill="#f59e0b" fontSize={8} opacity={0.7} style={{ pointerEvents: 'none' }}>
              Print bed: {bedW}×{bedL}mm
            </text>

            {/* Cutout shapes */}
            {design.cutouts.map((cutout) => {
              const isSelected = cutout.id === selectedCutoutId
              const path = cutoutPath(cutout.outer)
              // Bounding box of cutout in drawer coords
              const minX = Math.min(...cutout.outer.map(p => p.x))
              const maxX = Math.max(...cutout.outer.map(p => p.x))
              const minY = Math.min(...cutout.outer.map(p => p.y))
              const maxY = Math.max(...cutout.outer.map(p => p.y))
              // Distances to plate edges (plate is at plateX..plateX+plateW, plateY..plateY+plateL)
              const distLeft = minX - plateX
              const distRight = (plateX + plateW) - maxX
              const distTop = minY - plateY
              const distBottom = (plateY + plateL) - maxY
              return (
                <g key={cutout.id}>
                  <path
                    d={path}
                    fill={isSelected ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.15)'}
                    stroke={isSelected ? '#ef4444' : '#dc2626'}
                    strokeWidth={isSelected ? 1 : 0.6}
                    onPointerDown={(e) => handleCutoutPointerDown(e, cutout.id)}
                    style={{ cursor: 'grab' }}
                  />
                  {/* Cutout type indicator for partial cutouts */}
                  {cutout.cutout_type === 'partial' && (
                    <text
                      x={cutout.x} y={cutout.y}
                      fill="#f59e0b" fontSize={6} textAnchor="middle" dominantBaseline="middle"
                      style={{ pointerEvents: 'none', fontWeight: 600 }}
                    >
                      {cutout.depth_mm.toFixed(1)}mm
                    </text>
                  )}
                  {/* Vertices when selected */}
                  {isSelected && cutout.outer.map((v, i) => (
                    <circle
                      key={i} cx={v.x} cy={v.y} r={2.5}
                      fill="#a78bfa" stroke="#fff" strokeWidth={0.5}
                      onPointerDown={(e) => handleVertexPointerDown(e, cutout.id, i)}
                      style={{ cursor: 'pointer' }}
                    />
                  ))}
                  {/* Dimension labels when selected — distances to plate edges */}
                  {isSelected && (
                    <g style={{ pointerEvents: 'none' }}>
                      {/* Left distance */}
                      <line x1={plateX} y1={minY + (maxY - minY) / 2} x2={minX} y2={minY + (maxY - minY) / 2}
                        stroke="#22d3ee" strokeWidth={0.4} strokeDasharray="2 1" />
                      <text x={plateX + distLeft / 2} y={minY + (maxY - minY) / 2 - 1.5}
                        fill="#22d3ee" fontSize={5} textAnchor="middle">
                        {distLeft.toFixed(1)}
                      </text>
                      {/* Right distance */}
                      <line x1={maxX} y1={minY + (maxY - minY) / 2} x2={plateX + plateW} y2={minY + (maxY - minY) / 2}
                        stroke="#22d3ee" strokeWidth={0.4} strokeDasharray="2 1" />
                      <text x={maxX + distRight / 2} y={minY + (maxY - minY) / 2 - 1.5}
                        fill="#22d3ee" fontSize={5} textAnchor="middle">
                        {distRight.toFixed(1)}
                      </text>
                      {/* Top distance */}
                      <line x1={minX + (maxX - minX) / 2} y1={plateY} x2={minX + (maxX - minX) / 2} y2={minY}
                        stroke="#22d3ee" strokeWidth={0.4} strokeDasharray="2 1" />
                      <text x={minX + (maxX - minX) / 2} y={plateY + distTop / 2}
                        fill="#22d3ee" fontSize={5} textAnchor="middle">
                        {distTop.toFixed(1)}
                      </text>
                      {/* Bottom distance */}
                      <line x1={minX + (maxX - minX) / 2} y1={maxY} x2={minX + (maxX - minX) / 2} y2={plateY + plateL}
                        stroke="#22d3ee" strokeWidth={0.4} strokeDasharray="2 1" />
                      <text x={minX + (maxX - minX) / 2} y={maxY + distBottom / 2}
                        fill="#22d3ee" fontSize={5} textAnchor="middle">
                        {distBottom.toFixed(1)}
                      </text>
                    </g>
                  )}
                </g>
              )
            })}
          </g>

          {/* Ruler markings (top) */}
          {Array.from({ length: Math.floor(drawerW / 50) + 1 }, (_, i) => (
            <g key={`rulerX${i}`}>
              <line x1={pad + i * 50} y1={pad - 4} x2={pad + i * 50} y2={pad} stroke="#52525b" strokeWidth={0.5} />
              <text x={pad + i * 50} y={pad - 6} fill="#52525b" fontSize={7} textAnchor="middle">{i * 50}</text>
            </g>
          ))}
          {/* Ruler markings (left) */}
          {Array.from({ length: Math.floor(drawerL / 50) + 1 }, (_, i) => (
            <g key={`rulerY${i}`}>
              <line x1={pad - 4} y1={pad + i * 50} x2={pad} y2={pad + i * 50} stroke="#52525b" strokeWidth={0.5} />
              <text x={pad - 6} y={pad + i * 50 + 2} fill="#52525b" fontSize={7} textAnchor="end">{i * 50}</text>
            </g>
          ))}
        </svg>
      </div>

      {/* Add Shape Dialog */}
      <AddShapeDialog
        open={showAddShape}
        onClose={() => setShowAddShape(false)}
        onCreate={(tool) => {
          // Convert ToolOutline to DrawerCutout
          const cutout: DrawerCutout = {
            id: tool.id,
            shape: 'rect', // we don't track which shape, just the polygon
            outer: tool.outer,
            x: tool.outer.reduce((s, p) => s + p.x, 0) / tool.outer.length,
            y: tool.outer.reduce((s, p) => s + p.y, 0) / tool.outer.length,
            w: Math.max(...tool.outer.map(p => p.x)) - Math.min(...tool.outer.map(p => p.x)),
            h: Math.max(...tool.outer.map(p => p.y)) - Math.min(...tool.outer.map(p => p.y)),
            rotation_deg: 0,
            cutout_type: 'through',
            depth_mm: 3.0,
          }
          addCutout(cutout)
        }}
        binW={drawerW}
        binL={drawerL}
      />
    </div>
  )
}

const toolBtn: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 4, border: '1px solid #3f3f46',
  background: '#27272a', color: '#a1a1aa', cursor: 'pointer', fontSize: 12,
}
