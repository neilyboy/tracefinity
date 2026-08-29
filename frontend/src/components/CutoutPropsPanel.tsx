import { useState, useEffect } from 'react'
import { useBaseplate } from '../editor/useBaseplateState'
import type { DrawerCutout } from '../types'

export default function CutoutPropsPanel() {
  const { design, selectedCutoutId, updateCutout, deleteCutout } = useBaseplate()
  const cutout = design.cutouts.find((c) => c.id === selectedCutoutId)

  // Local string state for inputs — allows free typing without controlled-value reset
  const [leftStr, setLeftStr] = useState('')
  const [topStr, setTopStr] = useState('')
  const [wStr, setWStr] = useState('')
  const [hStr, setHStr] = useState('')
  const [depthStr, setDepthStr] = useState('')

  // Sync local strings when cutout changes (selection change, external move, etc.)
  useEffect(() => {
    if (!cutout) return
    const minX = Math.min(...cutout.outer.map(p => p.x))
    const minY = Math.min(...cutout.outer.map(p => p.y))
    setLeftStr(minX.toFixed(1))
    setTopStr(minY.toFixed(1))
    setWStr(cutout.w.toFixed(1))
    setHStr(cutout.h.toFixed(1))
    setDepthStr(String(cutout.depth_mm))
  }, [cutout?.id, cutout?.x, cutout?.y, cutout?.w, cutout?.h, cutout?.depth_mm, cutout?.outer])

  if (!cutout) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: '#52525b' }}>
        Select a cutout to edit its properties.
      </div>
    )
  }

  const update = (updates: Partial<DrawerCutout>) => updateCutout(cutout.id, updates)

  // Bounding box for display
  const minX = Math.min(...cutout.outer.map(p => p.x))
  const minY = Math.min(...cutout.outer.map(p => p.y))

  // Apply position change from Left field
  const applyLeft = (raw: string) => {
    setLeftStr(raw)
    const val = parseFloat(raw)
    if (isNaN(val)) return
    const dx = val - minX
    if (dx === 0) return
    updateCutout(cutout.id, {
      outer: cutout.outer.map(p => ({ x: p.x + dx, y: p.y })),
      x: cutout.x + dx,
    })
  }

  const applyTop = (raw: string) => {
    setTopStr(raw)
    const val = parseFloat(raw)
    if (isNaN(val)) return
    const dy = val - minY
    if (dy === 0) return
    updateCutout(cutout.id, {
      outer: cutout.outer.map(p => ({ x: p.x, y: p.y + dy })),
      y: cutout.y + dy,
    })
  }

  const applyWidth = (raw: string) => {
    setWStr(raw)
    const newW = parseFloat(raw)
    if (isNaN(newW) || newW < 0.5 || cutout.w === 0) return
    const scale = newW / cutout.w
    updateCutout(cutout.id, {
      outer: cutout.outer.map(p => ({ x: cutout.x + (p.x - cutout.x) * scale, y: p.y })),
      w: newW,
    })
  }

  const applyHeight = (raw: string) => {
    setHStr(raw)
    const newH = parseFloat(raw)
    if (isNaN(newH) || newH < 0.5 || cutout.h === 0) return
    const scale = newH / cutout.h
    updateCutout(cutout.id, {
      outer: cutout.outer.map(p => ({ x: p.x, y: cutout.y + (p.y - cutout.y) * scale })),
      h: newH,
    })
  }

  const applyDepth = (raw: string) => {
    setDepthStr(raw)
    const val = parseFloat(raw)
    if (isNaN(val)) return
    update({ depth_mm: val })
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
      <div style={{ fontSize: 10, color: '#52525b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Cutout Properties
      </div>

      {/* Position */}
      <div>
        <div style={{ fontSize: 10, color: '#52525b', marginBottom: 4 }}>Position (from drawer top-left)</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <label style={{ flex: 1 }}>
            <span style={labelStyle}>Left (mm)</span>
            <input type="text" value={leftStr} onChange={(e) => applyLeft(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ flex: 1 }}>
            <span style={labelStyle}>Top (mm)</span>
            <input type="text" value={topStr} onChange={(e) => applyTop(e.target.value)} style={inputStyle} />
          </label>
        </div>
      </div>

      {/* Size */}
      <div>
        <div style={{ fontSize: 10, color: '#52525b', marginBottom: 4 }}>Size</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <label style={{ flex: 1 }}>
            <span style={labelStyle}>Width (mm)</span>
            <input type="text" value={wStr} onChange={(e) => applyWidth(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ flex: 1 }}>
            <span style={labelStyle}>Height (mm)</span>
            <input type="text" value={hStr} onChange={(e) => applyHeight(e.target.value)} style={inputStyle} />
          </label>
        </div>
      </div>

      {/* Cutout type */}
      <div>
        <div style={{ fontSize: 10, color: '#52525b', marginBottom: 4 }}>Cutout Type</div>
        <select
          value={cutout.cutout_type}
          onChange={(e) => update({ cutout_type: e.target.value as 'through' | 'partial' })}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          <option value="through">Through cutout (cuts all the way through)</option>
          <option value="partial">Partial cutout (from bottom, for low obstructions)</option>
        </select>
        {cutout.cutout_type === 'partial' && (
          <label style={{ display: 'block', marginTop: 6 }}>
            <span style={labelStyle}>Depth from bottom (mm)</span>
            <input type="text" value={depthStr} onChange={(e) => applyDepth(e.target.value)} style={inputStyle} />
            <span style={{ fontSize: 10, color: '#52525b', display: 'block', marginTop: 2 }}>
              Top surface stays flat so trays sit on top. Only the bottom is recessed.
            </span>
          </label>
        )}
      </div>

      {/* Delete */}
      <button
        onClick={() => deleteCutout(cutout.id)}
        style={{
          padding: '6px 12px', borderRadius: 4, border: '1px solid #7f1d1d',
          background: '#450a0a', color: '#fca5a5', cursor: 'pointer', fontSize: 12,
        }}
      >
        🗑 Delete Cutout
      </button>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 2,
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '5px 8px', background: '#27272a', border: '1px solid #3f3f46',
  borderRadius: 4, color: '#e4e4e7', fontSize: 13, boxSizing: 'border-box',
}
