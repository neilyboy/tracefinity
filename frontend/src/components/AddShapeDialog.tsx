import { useState } from 'react'
import type { Point, ToolOutline } from '../types'

export type ShapeType =
  | 'rect' | 'rounded_rect' | 'circle' | 'ellipse' | 'hex' | 'pentagon' | 'octagon'
  | 'slot' | 'triangle' | 'trapezoid' | 'star' | 'ring' | 'l_shape' | 't_shape' | 'cross'

export type ArrayPattern = 'grid' | 'circular' | 'hex_grid' | 'linear_x' | 'linear_y'

interface ShapePreset {
  type: ShapeType
  label: string
  icon: string
  defaults: { w: number; h: number; r?: number; r2?: number; points?: number; innerR?: number; thickness?: number }
}

const PRESETS: ShapePreset[] = [
  // Basic shapes
  { type: 'rect', label: 'Rectangle', icon: '▭', defaults: { w: 40, h: 80 } },
  { type: 'rounded_rect', label: 'Rounded Rect', icon: '▢', defaults: { w: 40, h: 80, r: 5 } },
  { type: 'circle', label: 'Circle', icon: '◯', defaults: { w: 20, h: 20 } },
  { type: 'ellipse', label: 'Ellipse', icon: '⬭', defaults: { w: 40, h: 20 } },
  { type: 'slot', label: 'Slot', icon: '⬭', defaults: { w: 50, h: 15 } },
  // Polygons
  { type: 'hex', label: 'Hexagon', icon: '⬡', defaults: { w: 25, h: 25 } },
  { type: 'pentagon', label: 'Pentagon', icon: '⬠', defaults: { w: 25, h: 25 } },
  { type: 'octagon', label: 'Octagon', icon: '⯁', defaults: { w: 25, h: 25 } },
  { type: 'triangle', label: 'Triangle', icon: '△', defaults: { w: 30, h: 30 } },
  { type: 'trapezoid', label: 'Trapezoid', icon: '⏢', defaults: { w: 40, h: 25, r2: 25 } },
  // Special shapes
  { type: 'star', label: 'Star', icon: '★', defaults: { w: 30, h: 30, points: 5, innerR: 12 } },
  { type: 'ring', label: 'Ring', icon: '◎', defaults: { w: 30, h: 30, thickness: 5 } },
  { type: 'l_shape', label: 'L-Shape', icon: '⌐', defaults: { w: 40, h: 40, thickness: 15 } },
  { type: 't_shape', label: 'T-Shape', icon: '⊥', defaults: { w: 40, h: 40, thickness: 15 } },
  { type: 'cross', label: 'Cross', icon: '✚', defaults: { w: 40, h: 40, thickness: 15 } },
]

function makeShape(
  type: ShapeType, w: number, h: number, r: number, cx: number, cy: number,
  extra?: { r2?: number; points?: number; innerR?: number; thickness?: number },
): Point[] {
  const r2 = extra?.r2 ?? 0
  const points = extra?.points ?? 5
  const innerR = extra?.innerR ?? 0
  const thickness = extra?.thickness ?? 15

  switch (type) {
    case 'rect': {
      return [
        { x: cx - w/2, y: cy - h/2 },
        { x: cx + w/2, y: cy - h/2 },
        { x: cx + w/2, y: cy + h/2 },
        { x: cx - w/2, y: cy + h/2 },
      ]
    }
    case 'rounded_rect': {
      const radius = Math.min(r, w/2, h/2)
      const segsPerCorner = 6
      const pts: Point[] = []
      const corners = [
        { x: cx + w/2 - radius, y: cy - h/2 + radius, start: -Math.PI/2 },
        { x: cx + w/2 - radius, y: cy + h/2 - radius, start: 0 },
        { x: cx - w/2 + radius, y: cy + h/2 - radius, start: Math.PI/2 },
        { x: cx - w/2 + radius, y: cy - h/2 + radius, start: Math.PI },
      ]
      for (const c of corners) {
        for (let i = 0; i <= segsPerCorner; i++) {
          const a = c.start + (i / segsPerCorner) * (Math.PI / 2)
          pts.push({ x: c.x + radius * Math.cos(a), y: c.y + radius * Math.sin(a) })
        }
      }
      return pts
    }
    case 'circle': {
      const radius = w / 2
      const segs = 48
      const pts: Point[] = []
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2
        pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) })
      }
      return pts
    }
    case 'ellipse': {
      const rx = w / 2, ry = h / 2
      const segs = 48
      const pts: Point[] = []
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2
        pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) })
      }
      return pts
    }
    case 'hex': {
      const radius = w / 2
      const pts: Point[] = []
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2
        pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) })
      }
      return pts
    }
    case 'pentagon': {
      const radius = w / 2
      const pts: Point[] = []
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2
        pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) })
      }
      return pts
    }
    case 'octagon': {
      const radius = w / 2
      const pts: Point[] = []
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 8
        pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) })
      }
      return pts
    }
    case 'slot': {
      const rEnd = Math.min(h / 2, w / 2)
      const straight = w - 2 * rEnd
      const segsPerArc = 12
      const pts: Point[] = []
      for (let i = 0; i <= segsPerArc; i++) {
        const a = Math.PI/2 + (i / segsPerArc) * Math.PI
        pts.push({ x: cx + straight/2 + rEnd * Math.cos(a), y: cy + rEnd * Math.sin(a) })
      }
      for (let i = 0; i <= segsPerArc; i++) {
        const a = -Math.PI/2 + (i / segsPerArc) * Math.PI
        pts.push({ x: cx - straight/2 + rEnd * Math.cos(a), y: cy + rEnd * Math.sin(a) })
      }
      return pts
    }
    case 'triangle': {
      return [
        { x: cx, y: cy - h/2 },
        { x: cx + w/2, y: cy + h/2 },
        { x: cx - w/2, y: cy + h/2 },
      ]
    }
    case 'trapezoid': {
      // w = bottom width, r2 = top width, h = height
      const topW = r2
      return [
        { x: cx - topW/2, y: cy - h/2 },
        { x: cx + topW/2, y: cy - h/2 },
        { x: cx + w/2, y: cy + h/2 },
        { x: cx - w/2, y: cy + h/2 },
      ]
    }
    case 'star': {
      const outerR = w / 2
      const innerRadius = innerR > 0 ? innerR : outerR * 0.4
      const pts: Point[] = []
      const totalPoints = points * 2
      for (let i = 0; i < totalPoints; i++) {
        const a = (i / totalPoints) * Math.PI * 2 - Math.PI / 2
        const radius = i % 2 === 0 ? outerR : innerRadius
        pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) })
      }
      return pts
    }
    case 'ring': {
      // Ring = outer circle, with a hole (returned as outer + we set holes separately)
      // But ToolOutline has holes field. We'll return outer and set hole in createTool.
      const outerR = w / 2
      const innerR = outerR - thickness
      const segs = 48
      const outer: Point[] = []
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2
        outer.push({ x: cx + outerR * Math.cos(a), y: cy + outerR * Math.sin(a) })
      }
      return outer
    }
    case 'l_shape': {
      const t = thickness
      return [
        { x: cx - w/2, y: cy - h/2 },
        { x: cx - w/2 + t, y: cy - h/2 },
        { x: cx - w/2 + t, y: cy + h/2 - t },
        { x: cx + w/2, y: cy + h/2 - t },
        { x: cx + w/2, y: cy + h/2 },
        { x: cx - w/2, y: cy + h/2 },
      ]
    }
    case 't_shape': {
      const t = thickness
      return [
        { x: cx - w/2, y: cy - h/2 },
        { x: cx + w/2, y: cy - h/2 },
        { x: cx + w/2, y: cy - h/2 + t },
        { x: cx + t/2, y: cy - h/2 + t },
        { x: cx + t/2, y: cy + h/2 },
        { x: cx - t/2, y: cy + h/2 },
        { x: cx - t/2, y: cy - h/2 + t },
        { x: cx - w/2, y: cy - h/2 + t },
      ]
    }
    case 'cross': {
      const t = thickness
      return [
        { x: cx - t/2, y: cy - h/2 },
        { x: cx + t/2, y: cy - h/2 },
        { x: cx + t/2, y: cy - t/2 },
        { x: cx + w/2, y: cy - t/2 },
        { x: cx + w/2, y: cy + t/2 },
        { x: cx + t/2, y: cy + t/2 },
        { x: cx + t/2, y: cy + h/2 },
        { x: cx - t/2, y: cy + h/2 },
        { x: cx - t/2, y: cy + t/2 },
        { x: cx - w/2, y: cy + t/2 },
        { x: cx - w/2, y: cy - t/2 },
        { x: cx - t/2, y: cy - t/2 },
      ]
    }
  }
}

// Get the hole for shapes that have holes (ring)
function makeHole(type: ShapeType, w: number, h: number, cx: number, cy: number, thickness?: number): Point[] | null {
  if (type === 'ring' && thickness) {
    const outerR = w / 2
    const innerR = outerR - thickness
    if (innerR <= 0) return null
    const segs = 48
    const pts: Point[] = []
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2
      pts.push({ x: cx + innerR * Math.cos(a), y: cy + innerR * Math.sin(a) })
    }
    return pts
  }
  return null
}

export function createTool(
  type: ShapeType,
  w: number, h: number, r: number,
  cx: number, cy: number,
  extra?: { r2?: number; points?: number; innerR?: number; thickness?: number },
): ToolOutline {
  const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const outer = makeShape(type, w, h, r, cx, cy, extra)
  const hole = makeHole(type, w, h, cx, cy, extra?.thickness)
  return {
    id,
    label: '',
    visible: true,
    rotation_deg: 0,
    outer,
    holes: hole ? [hole] : [],
    finger_holes: [],
    margin_mm: null,
    pocket_depth_mm: null,
    smoothing: 0.0,
    pocket_shape: 'flat',
    pocket_bottom_radius_mm: null,
  }
}

interface Props {
  open: boolean
  onClose: () => void
  onCreate: (tool: ToolOutline) => void
  binW: number
  binL: number
}

export default function AddShapeDialog({ open, onClose, onCreate, binW, binL }: Props) {
  const [selected, setSelected] = useState<ShapeType>('circle')
  const [w, setW] = useState(20)
  const [h, setH] = useState(20)
  const [r, setR] = useState(5)
  const [r2, setR2] = useState(25)       // trapezoid top width
  const [points, setPoints] = useState(5) // star points
  const [innerR, setInnerR] = useState(12) // star inner radius
  const [thickness, setThickness] = useState(15) // ring/L/T/cross thickness
  const [count, setCount] = useState(1)
  const [pattern, setPattern] = useState<ArrayPattern>('grid')
  const [spacing, setSpacing] = useState(5)
  const [circleRadius, setCircleRadius] = useState(40) // circular pattern radius

  if (!open) return null

  const preset = PRESETS.find((p) => p.type === selected)!

  // Determine which fields to show
  const isRound = selected === 'circle' || selected === 'hex' || selected === 'pentagon' || selected === 'octagon'
  const isCircle = selected === 'circle'
  const isEllipse = selected === 'ellipse'
  const isSlot = selected === 'slot'
  const isRoundedRect = selected === 'rounded_rect'
  const isTrapezoid = selected === 'trapezoid'
  const isStar = selected === 'star'
  const isRing = selected === 'ring'
  const isStructural = selected === 'l_shape' || selected === 't_shape' || selected === 'cross'

  // All shapes show Width (or Diameter for round shapes).
  // Round shapes (circle, hex, pentagon, octagon) only use one dimension.
  // Star and Ring use Diameter + their special params.
  const showW = true
  const showH = !isRound && !isStar && !isRing  // round/star/ring shapes don't need height
  const showR = isRoundedRect
  const showR2 = isTrapezoid
  const showPoints = isStar
  const showInnerR = isStar
  const showThickness = isRing || isStructural

  const labelW = isRound || isStar || isRing ? 'Diameter (mm)' : 'Width (mm)'
  const labelH = 'Height (mm)'

  const extra = { r2, points, innerR, thickness }

  const handleCreate = () => {
    const cx = binW / 2
    const cy = binL / 2
    if (count === 1) {
      const tool = createTool(selected, w, h, r, cx, cy, extra)
      onCreate(tool)
    } else {
      // Create multiple tools based on pattern
      if (pattern === 'circular') {
        const r = circleRadius
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 - Math.PI / 2
          const tx = cx + r * Math.cos(a)
          const ty = cy + r * Math.sin(a)
          const tool = createTool(selected, w, h, r, tx, ty, extra)
          tool.id = `tool_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`
          onCreate(tool)
        }
      } else if (pattern === 'linear_x') {
        const stepX = w + spacing
        const startX = cx - ((count - 1) * stepX) / 2
        for (let i = 0; i < count; i++) {
          const tool = createTool(selected, w, h, r, startX + i * stepX, cy, extra)
          tool.id = `tool_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`
          onCreate(tool)
        }
      } else if (pattern === 'linear_y') {
        const stepY = h + spacing
        const startY = cy - ((count - 1) * stepY) / 2
        for (let i = 0; i < count; i++) {
          const tool = createTool(selected, w, h, r, cx, startY + i * stepY, extra)
          tool.id = `tool_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`
          onCreate(tool)
        }
      } else if (pattern === 'hex_grid') {
        // Hexagonal close-packed arrangement
        const cols = Math.ceil(Math.sqrt(count))
        const rows = Math.ceil(count / cols)
        const stepX = w + spacing
        const stepY = (h + spacing) * 0.866 // hex vertical spacing
        const startX = cx - ((cols - 1) * stepX) / 2
        const startY = cy - ((rows - 1) * stepY) / 2
        let created = 0
        for (let row = 0; row < rows && created < count; row++) {
          const offsetX = row % 2 === 0 ? 0 : stepX / 2
          for (let col = 0; col < cols && created < count; col++) {
            const tool = createTool(selected, w, h, r, startX + col * stepX + offsetX, startY + row * stepY, extra)
            tool.id = `tool_${Date.now()}_${created}_${Math.random().toString(36).slice(2, 6)}`
            onCreate(tool)
            created++
          }
        }
      } else {
        // Default: grid
        const cols = Math.ceil(Math.sqrt(count))
        const rows = Math.ceil(count / cols)
        const stepX = w + spacing
        const stepY = h + spacing
        const startX = cx - ((cols - 1) * stepX) / 2
        const startY = cy - ((rows - 1) * stepY) / 2
        let created = 0
        for (let row = 0; row < rows && created < count; row++) {
          for (let col = 0; col < cols && created < count; col++) {
            const tool = createTool(selected, w, h, r, startX + col * stepX, startY + row * stepY, extra)
            tool.id = `tool_${Date.now()}_${created}_${Math.random().toString(36).slice(2, 6)}`
            onCreate(tool)
            created++
          }
        }
      }
    }
    onClose()
  }

  // Group shapes for display
  const basicShapes = PRESETS.filter((p) => ['rect', 'rounded_rect', 'circle', 'ellipse', 'slot'].includes(p.type))
  const polygonShapes = PRESETS.filter((p) => ['hex', 'pentagon', 'octagon', 'triangle', 'trapezoid'].includes(p.type))
  const specialShapes = PRESETS.filter((p) => ['star', 'ring', 'l_shape', 't_shape', 'cross'].includes(p.type))

  const renderShapeButton = (p: ShapePreset) => (
    <button
      key={p.type}
      onClick={() => {
        setSelected(p.type)
        setW(p.defaults.w)
        setH(p.defaults.h)
        if (p.defaults.r) setR(p.defaults.r)
        if (p.defaults.r2) setR2(p.defaults.r2)
        if (p.defaults.points) setPoints(p.defaults.points)
        if (p.defaults.innerR) setInnerR(p.defaults.innerR)
        if (p.defaults.thickness) setThickness(p.defaults.thickness)
      }}
      style={{
        padding: '8px 4px', borderRadius: 6, cursor: 'pointer',
        border: `1px solid ${selected === p.type ? '#7c3aed' : '#3f3f46'}`,
        background: selected === p.type ? '#3b0764' : '#27272a',
        color: selected === p.type ? '#a78bfa' : '#a1a1aa',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        fontSize: 10,
      }}
    >
      <span style={{ fontSize: 18 }}>{p.icon}</span>
      {p.label}
    </button>
  )

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8,
        padding: 20, zIndex: 1001, minWidth: 400, maxWidth: 460, maxHeight: '90vh', overflow: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, color: '#e4e4e7', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Add Shape
          </h3>
          <button onClick={onClose} style={{ ...smallBtn, color: '#71717a' }}>✕</button>
        </div>

        {/* Shape selection — grouped */}
        <div style={{ fontSize: 9, color: '#52525b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Basic</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 8 }}>
          {basicShapes.map(renderShapeButton)}
        </div>

        <div style={{ fontSize: 9, color: '#52525b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Polygons</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 8 }}>
          {polygonShapes.map(renderShapeButton)}
        </div>

        <div style={{ fontSize: 9, color: '#52525b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Special</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 12 }}>
          {specialShapes.map(renderShapeButton)}
        </div>

        {/* Dimension inputs — show relevant fields per shape */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          {showW && (
            <label style={{ flex: '1 1 80px' }}>
              <span style={labelStyle}>{labelW}</span>
              <input type="number" value={w} min={0.5} max={200} step={0.5}
                onChange={(e) => setW(parseFloat(e.target.value) || 1)} style={inputStyle} />
            </label>
          )}
          {showH && (
            <label style={{ flex: '1 1 80px' }}>
              <span style={labelStyle}>{labelH}</span>
              <input type="number" value={h} min={0.5} max={200} step={0.5}
                onChange={(e) => setH(parseFloat(e.target.value) || 1)} style={inputStyle} />
            </label>
          )}
          {showR && (
            <label style={{ flex: '1 1 80px' }}>
              <span style={labelStyle}>Corner R (mm)</span>
              <input type="number" value={r} min={0} max={50} step={0.5}
                onChange={(e) => setR(parseFloat(e.target.value) || 0)} style={inputStyle} />
            </label>
          )}
          {showR2 && (
            <label style={{ flex: '1 1 80px' }}>
              <span style={labelStyle}>Top Width (mm)</span>
              <input type="number" value={r2} min={1} max={200} step={0.5}
                onChange={(e) => setR2(parseFloat(e.target.value) || 1)} style={inputStyle} />
            </label>
          )}
          {showPoints && (
            <label style={{ flex: '1 1 80px' }}>
              <span style={labelStyle}>Star Points</span>
              <input type="number" value={points} min={3} max={20} step={1}
                onChange={(e) => setPoints(Math.max(3, parseInt(e.target.value) || 5))} style={inputStyle} />
            </label>
          )}
          {showInnerR && (
            <label style={{ flex: '1 1 80px' }}>
              <span style={labelStyle}>Inner R (mm)</span>
              <input type="number" value={innerR} min={1} max={100} step={0.5}
                onChange={(e) => setInnerR(parseFloat(e.target.value) || 1)} style={inputStyle} />
            </label>
          )}
          {showThickness && (
            <label style={{ flex: '1 1 80px' }}>
              <span style={labelStyle}>Thickness (mm)</span>
              <input type="number" value={thickness} min={1} max={100} step={0.5}
                onChange={(e) => setThickness(parseFloat(e.target.value) || 1)} style={inputStyle} />
            </label>
          )}
        </div>

        {/* Array / pattern section */}
        <div style={{ borderTop: '1px solid #27272a', paddingTop: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'flex-end' }}>
            <label style={{ flex: '1 1 60px' }}>
              <span style={labelStyle}>Count</span>
              <input type="number" value={count} min={1} max={200} step={1}
                onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))} style={inputStyle} />
            </label>
            {count > 1 && (
              <>
                <label style={{ flex: '1 1 80px' }}>
                  <span style={labelStyle}>Pattern</span>
                  <select value={pattern} onChange={(e) => setPattern(e.target.value as ArrayPattern)} style={inputStyle}>
                    <option value="grid">Grid (rows×cols)</option>
                    <option value="hex_grid">Hex Grid</option>
                    <option value="linear_x">Linear (→)</option>
                    <option value="linear_y">Linear (↓)</option>
                    <option value="circular">Circular</option>
                  </select>
                </label>
                {pattern !== 'circular' && (
                  <label style={{ flex: '1 1 60px' }}>
                    <span style={labelStyle}>Gap (mm)</span>
                    <input type="number" value={spacing} min={0} max={50} step={0.5}
                      onChange={(e) => setSpacing(parseFloat(e.target.value) || 0)} style={inputStyle} />
                  </label>
                )}
                {pattern === 'circular' && (
                  <label style={{ flex: '1 1 80px' }}>
                    <span style={labelStyle}>Radius (mm)</span>
                    <input type="number" value={circleRadius} min={5} max={200} step={1}
                      onChange={(e) => setCircleRadius(parseFloat(e.target.value) || 5)} style={inputStyle} />
                  </label>
                )}
              </>
            )}
          </div>
          {count > 1 && (
            <div style={{ fontSize: 10, color: '#71717a' }}>
              {pattern === 'grid' && `Grid: ${Math.ceil(Math.sqrt(count))}×${Math.ceil(count / Math.ceil(Math.sqrt(count)))} with ${spacing}mm gaps`}
              {pattern === 'hex_grid' && `Hex-packed grid with ${spacing}mm gaps (offset rows)`}
              {pattern === 'linear_x' && `${count} shapes in a horizontal line, ${spacing}mm apart`}
              {pattern === 'linear_y' && `${count} shapes in a vertical line, ${spacing}mm apart`}
              {pattern === 'circular' && `${count} shapes evenly spaced on a ${circleRadius}mm radius circle`}
            </div>
          )}
        </div>

        {/* Preview info */}
        <div style={{
          padding: '8px 10px', background: '#0f1115', borderRadius: 4,
          border: '1px solid #27272a', fontSize: 11, color: '#71717a', marginBottom: 12,
        }}>
          <strong style={{ color: '#a1a1aa' }}>{preset.label}</strong>
          {isCircle ? ` Ø${w}mm` : isRound ? ` Ø${w}mm` : ` ${w}×${h}mm`}
          {showR && r > 0 ? ` R${r}` : ''}
          {showR2 ? ` top:${r2}mm` : ''}
          {showPoints ? ` ${points}pt` : ''}
          {showInnerR ? ` inner:${innerR}mm` : ''}
          {showThickness ? ` t:${thickness}mm` : ''}
          {count > 1 ? ` × ${count} (${pattern})` : ''}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ ...btnStyle, flex: 1 }}>Cancel</button>
          <button
            onClick={handleCreate}
            style={{ ...btnStyle, flex: 1, borderColor: '#7c3aed', background: '#3b0764', color: '#a78bfa' }}
          >
            ＋ Add {count > 1 ? `${count} Shapes` : 'Shape'}
          </button>
        </div>
      </div>
    </>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', background: '#27272a', border: '1px solid #3f3f46',
  borderRadius: 4, color: '#e4e4e7', fontSize: 13, boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, color: '#71717a', marginBottom: 3,
}

const btnStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 4, border: '1px solid #3f3f46',
  background: '#27272a', color: '#a1a1aa', cursor: 'pointer', fontSize: 13,
}

const smallBtn: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 4, border: '1px solid #3f3f46',
  background: '#27272a', color: '#a1a1aa', cursor: 'pointer', fontSize: 12,
}
