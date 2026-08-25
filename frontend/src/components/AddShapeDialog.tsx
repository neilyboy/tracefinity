import { useState } from 'react'
import type { Point, ToolOutline } from '../types'

export type ShapeType = 'rect' | 'rounded_rect' | 'circle' | 'hex' | 'slot' | 'triangle'

interface ShapePreset {
  type: ShapeType
  label: string
  icon: string
  defaults: { w: number; h: number; r?: number; segments?: number }
}

const PRESETS: ShapePreset[] = [
  { type: 'rect', label: 'Rectangle', icon: '▭', defaults: { w: 40, h: 80 } },
  { type: 'rounded_rect', label: 'Rounded Rect', icon: '▢', defaults: { w: 40, h: 80, r: 5 } },
  { type: 'circle', label: 'Circle', icon: '◯', defaults: { w: 20, h: 20 } },
  { type: 'hex', label: 'Hexagon', icon: '⬡', defaults: { w: 25, h: 25 } },
  { type: 'slot', label: 'Slot / Oval', icon: '⬭', defaults: { w: 50, h: 15 } },
  { type: 'triangle', label: 'Triangle', icon: '△', defaults: { w: 30, h: 30 } },
]

function makeShape(type: ShapeType, w: number, h: number, r: number, cx: number, cy: number): Point[] {
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
      // Build a rounded rectangle with corner arcs
      const radius = Math.min(r, w/2, h/2)
      const segsPerCorner = 6
      const pts: Point[] = []
      const corners = [
        { x: cx + w/2 - radius, y: cy - h/2 + radius, start: -Math.PI/2 }, // top-right
        { x: cx + w/2 - radius, y: cy + h/2 - radius, start: 0 },          // bottom-right
        { x: cx - w/2 + radius, y: cy + h/2 - radius, start: Math.PI/2 },  // bottom-left
        { x: cx - w/2 + radius, y: cy - h/2 + radius, start: Math.PI },    // top-left
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
    case 'hex': {
      const radius = w / 2
      const pts: Point[] = []
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2
        pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) })
      }
      return pts
    }
    case 'slot': {
      // Oval / capsule shape (rounded ends)
      const rEnd = Math.min(h / 2, w / 2)
      const straight = w - 2 * rEnd
      const segsPerArc = 12
      const pts: Point[] = []
      // Right arc (bottom to top)
      for (let i = 0; i <= segsPerArc; i++) {
        const a = Math.PI/2 + (i / segsPerArc) * Math.PI
        pts.push({ x: cx + straight/2 + rEnd * Math.cos(a), y: cy + rEnd * Math.sin(a) })
      }
      // Left arc (top to bottom)
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
  }
}

export function createTool(
  type: ShapeType,
  w: number,
  h: number,
  r: number,
  cx: number,
  cy: number,
): ToolOutline {
  const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  // Sharp shapes (rect, triangle) default to low smoothing so corners stay crisp.
  // Curved shapes (circle, hex, slot, rounded_rect) default to 0 since they
  // already have the right geometry — smoothing would distort them.
  const smoothing = 0.0
  return {
    id,
    label: '',
    visible: true,
    rotation_deg: 0,
    outer: makeShape(type, w, h, r, cx, cy),
    holes: [],
    finger_holes: [],
    margin_mm: null,
    pocket_depth_mm: null,
    smoothing,
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
  const [count, setCount] = useState(1)

  if (!open) return null

  const preset = PRESETS.find((p) => p.type === selected)!
  const isCircle = selected === 'circle'
  const isHex = selected === 'hex'
  const showR = selected === 'rounded_rect'
  const showH = !(isCircle || isHex) // circle and hex use w as diameter
  const showW = true

  const handleCreate = () => {
    const cx = binW / 2
    const cy = binL / 2
    if (count === 1) {
      const tool = createTool(selected, w, h, r, cx, cy)
      onCreate(tool)
    } else {
      // Create multiple tools in a grid layout
      const cols = Math.ceil(Math.sqrt(count))
      const rows = Math.ceil(count / cols)
      const spacingX = w + 5
      const spacingY = h + 5
      const startX = cx - ((cols - 1) * spacingX) / 2
      const startY = cy - ((rows - 1) * spacingY) / 2
      let created = 0
      for (let row = 0; row < rows && created < count; row++) {
        for (let col = 0; col < cols && created < count; col++) {
          const tool = createTool(selected, w, h, r, startX + col * spacingX, startY + row * spacingY)
          // Slight delay to ensure unique IDs
          tool.id = `tool_${Date.now()}_${created}_${Math.random().toString(36).slice(2, 6)}`
          onCreate(tool)
          created++
        }
      }
    }
    onClose()
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8,
        padding: 20, zIndex: 1001, minWidth: 360, maxWidth: 400,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 14, color: '#e4e4e7', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Add Tool Shape
          </h3>
          <button onClick={onClose} style={{ ...smallBtn, color: '#71717a' }}>✕</button>
        </div>

        {/* Shape selection grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 16 }}>
          {PRESETS.map((p) => (
            <button
              key={p.type}
              onClick={() => {
                setSelected(p.type)
                setW(p.defaults.w)
                setH(p.defaults.h)
                if (p.defaults.r) setR(p.defaults.r)
              }}
              style={{
                padding: '10px 6px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${selected === p.type ? '#7c3aed' : '#3f3f46'}`,
                background: selected === p.type ? '#3b0764' : '#27272a',
                color: selected === p.type ? '#a78bfa' : '#a1a1aa',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                fontSize: 11,
              }}
            >
              <span style={{ fontSize: 20 }}>{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>

        {/* Dimension inputs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {showW && (
            <label style={{ flex: 1 }}>
              <span style={labelStyle}>{isCircle || isHex ? 'Diameter (mm)' : 'Width (mm)'}</span>
              <input
                type="number" value={w} min={1} max={200} step={0.5}
                onChange={(e) => setW(parseFloat(e.target.value) || 1)}
                style={inputStyle}
              />
            </label>
          )}
          {showH && (
            <label style={{ flex: 1 }}>
              <span style={labelStyle}>Height (mm)</span>
              <input
                type="number" value={h} min={1} max={200} step={0.5}
                onChange={(e) => setH(parseFloat(e.target.value) || 1)}
                style={inputStyle}
              />
            </label>
          )}
          {showR && (
            <label style={{ flex: 1 }}>
              <span style={labelStyle}>Corner R (mm)</span>
              <input
                type="number" value={r} min={0} max={50} step={0.5}
                onChange={(e) => setR(parseFloat(e.target.value) || 0)}
                style={inputStyle}
              />
            </label>
          )}
        </div>

        {/* Count / array */}
        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={labelStyle}>
            Count (1 = single, 2+ = auto-arranged grid)
          </span>
          <input
            type="number" value={count} min={1} max={100} step={1}
            onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
            style={inputStyle}
          />
          {count > 1 && (
            <div style={{ fontSize: 10, color: '#71717a', marginTop: 4 }}>
              Will create {count} tools in a {Math.ceil(Math.sqrt(count))}×{Math.ceil(count / Math.ceil(Math.sqrt(count)))} grid with 5mm spacing.
            </div>
          )}
        </label>

        {/* Preview info */}
        <div style={{
          padding: '8px 10px', background: '#0f1115', borderRadius: 4,
          border: '1px solid #27272a', fontSize: 11, color: '#71717a', marginBottom: 16,
        }}>
          <strong style={{ color: '#a1a1aa' }}>{preset.label}</strong>
          {isCircle ? ` Ø${w}mm` : isHex ? ` Ø${w}mm` : ` ${w}×${h}mm`}
          {showR && r > 0 ? ` R${r}` : ''}
          {count > 1 ? ` × ${count} copies` : ''}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ ...btnStyle, flex: 1 }}>Cancel</button>
          <button
            onClick={handleCreate}
            style={{ ...btnStyle, flex: 1, borderColor: '#7c3aed', background: '#3b0764', color: '#a78bfa' }}
          >
            ＋ Add {count > 1 ? `${count} Tools` : 'Tool'}
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
  display: 'block', fontSize: 11, color: '#71717a', marginBottom: 4,
}

const btnStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 4, border: '1px solid #3f3f46',
  background: '#27272a', color: '#a1a1aa', cursor: 'pointer', fontSize: 13,
}

const smallBtn: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 4, border: '1px solid #3f3f46',
  background: '#27272a', color: '#a1a1aa', cursor: 'pointer', fontSize: 12,
}
