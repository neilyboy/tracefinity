import { useBaseplate } from '../editor/useBaseplateState'
import type { DrawerCutout } from '../types'

export default function CutoutPropsPanel() {
  const { design, selectedCutoutId, updateCutout, deleteCutout } = useBaseplate()
  const cutout = design.cutouts.find((c) => c.id === selectedCutoutId)

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
  const maxX = Math.max(...cutout.outer.map(p => p.x))
  const minY = Math.min(...cutout.outer.map(p => p.y))
  const maxY = Math.max(...cutout.outer.map(p => p.y))

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
            <input type="number" value={minX.toFixed(1)} step={0.5} onChange={(e) => {
              const newMinX = parseFloat(e.target.value) || 0
              const dx = newMinX - minX
              updateCutout(cutout.id, {
                outer: cutout.outer.map(p => ({ x: p.x + dx, y: p.y })),
                x: cutout.x + dx,
              })
            }} style={inputStyle} />
          </label>
          <label style={{ flex: 1 }}>
            <span style={labelStyle}>Top (mm)</span>
            <input type="number" value={minY.toFixed(1)} step={0.5} onChange={(e) => {
              const newMinY = parseFloat(e.target.value) || 0
              const dy = newMinY - minY
              updateCutout(cutout.id, {
                outer: cutout.outer.map(p => ({ x: p.x, y: p.y + dy })),
                y: cutout.y + dy,
              })
            }} style={inputStyle} />
          </label>
        </div>
      </div>

      {/* Size */}
      <div>
        <div style={{ fontSize: 10, color: '#52525b', marginBottom: 4 }}>Size</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <label style={{ flex: 1 }}>
            <span style={labelStyle}>Width (mm)</span>
            <input type="number" value={cutout.w.toFixed(1)} step={0.5} onChange={(e) => {
              const newW = parseFloat(e.target.value) || 1
              const scale = newW / cutout.w
              updateCutout(cutout.id, {
                outer: cutout.outer.map(p => ({ x: cutout.x + (p.x - cutout.x) * scale, y: p.y })),
                w: newW,
              })
            }} style={inputStyle} />
          </label>
          <label style={{ flex: 1 }}>
            <span style={labelStyle}>Height (mm)</span>
            <input type="number" value={cutout.h.toFixed(1)} step={0.5} onChange={(e) => {
              const newH = parseFloat(e.target.value) || 1
              const scale = newH / cutout.h
              updateCutout(cutout.id, {
                outer: cutout.outer.map(p => ({ x: p.x, y: cutout.y + (p.y - cutout.y) * scale })),
                h: newH,
              })
            }} style={inputStyle} />
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
            <input type="number" value={cutout.depth_mm} step={0.5} min={0.5} max={20}
              onChange={(e) => update({ depth_mm: parseFloat(e.target.value) || 1 })}
              style={inputStyle} />
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
