import { useEditor } from '../editor/useEditorState'
import { suggestGridSize } from '../editor/gridSnap'
import { smoothClosedPath } from '../utils/smoothPath'

export default function TraceView() {
  const { design, setView, toggleToolVisible, setParams } = useEditor()

  const handleContinue = () => {
    // Auto-suggest bin grid size from detected tools.
    const { grid_w, grid_l } = suggestGridSize(design.outlines)
    setParams({ grid_w, grid_l })
    setView('editor')
  }

  const paperWmm = design.paper_size === 'letter' ? 215.9 : 210
  const paperHmm = design.paper_size === 'letter' ? 279.4 : 297

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16, gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 22, margin: 0 }}>Detected Tools ({design.outlines.length})</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => setView('calibrate')} style={btnStyle}>← Back</button>
          <button onClick={handleContinue} style={primaryBtn}>Open Editor →</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flex: 1, overflow: 'hidden' }}>
        {/* Rectified image with outline overlays */}
        <div style={{ flex: 1, background: '#18181b', borderRadius: 8, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: 12 }}>
          <div style={{ position: 'relative' }}>
            <img
              src={design.image_filename ? `/data/images/${design.image_filename}` : ''}
              alt="rectified"
              style={{ display: 'block', maxWidth: '100%' }}
            />
            <svg
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
              viewBox={`0 0 ${design.rectified_w_px} ${design.rectified_h_px}`}
            >
              {design.outlines.map((tool) => {
                const scale = design.scale_mm_per_px
                const d = smoothClosedPath(tool.outer.map(p => ({ x: p.x / scale, y: p.y / scale })))
                return (
                  <path
                    key={tool.id}
                    d={d}
                    fill={tool.visible ? 'rgba(124,58,237,0.2)' : 'none'}
                    stroke={tool.visible ? '#a78bfa' : '#52525b'}
                    strokeWidth={3}
                  />
                )
              })}
            </svg>
          </div>
        </div>

        {/* Tool list */}
        <div style={{ width: 280, background: '#18181b', borderRadius: 8, padding: 12, overflow: 'auto' }}>
          <h3 style={{ fontSize: 14, color: '#a1a1aa', marginTop: 0 }}>Tools</h3>
          {design.outlines.length === 0 && (
            <p style={{ color: '#71717a', fontSize: 13 }}>No tools detected. You can add shapes manually in the editor.</p>
          )}
          {design.outlines.map((tool, i) => (
            <div
              key={tool.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', marginBottom: 6, borderRadius: 6,
                background: tool.visible ? '#27272a' : '#18181b',
                border: `1px solid ${tool.visible ? '#3f3f46' : '#27272a'}`,
              }}
            >
              <span style={{ fontSize: 13 }}>Tool {i + 1}</span>
              <button
                onClick={() => toggleToolVisible(tool.id)}
                style={{ background: 'none', border: 'none', color: tool.visible ? '#a78bfa' : '#52525b', cursor: 'pointer', fontSize: 16 }}
                title={tool.visible ? 'Hide' : 'Show'}
              >
                {tool.visible ? '👁' : '🚫'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#52525b' }}>
        Paper: {paperWmm}×{paperHmm}mm · Image: {design.rectified_w_px}×{design.rectified_h_px}px
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 6, border: '1px solid #3f3f46',
  background: '#27272a', color: '#e4e4e7', cursor: 'pointer', fontSize: 14,
}
const primaryBtn: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 6, border: 'none',
  background: '#7c3aed', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 600,
}
