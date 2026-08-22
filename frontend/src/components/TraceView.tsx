import { useState, useRef, useEffect } from 'react'
import { useEditor } from '../editor/useEditorState'
import { suggestGridSize } from '../editor/gridSnap'
import { smoothClosedPath } from '../utils/smoothPath'
import { detectToolAtPoint } from '../api/client'

export default function TraceView() {
  const { design, setView, toggleToolVisible, setParams, addTool } = useEditor()
  const [addingTool, setAddingTool] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const handleContinue = () => {
    // Auto-suggest bin grid size from detected tools.
    const { grid_w, grid_l } = suggestGridSize(design.outlines)
    setParams({ grid_w, grid_l })
    setView('editor')
  }

  const handleAddToolClick = () => {
    setAddingTool(true)
    setError(null)
  }

  // Escape key cancels tool-adding mode
  useEffect(() => {
    if (!addingTool) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAddingTool(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [addingTool])

  const handleImageClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!addingTool || !imgRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    const scaleX = design.rectified_w_px / rect.width
    const scaleY = design.rectified_h_px / rect.height
    const clickX = Math.round((e.clientX - rect.left) * scaleX)
    const clickY = Math.round((e.clientY - rect.top) * scaleY)

    setAddingTool(false)
    setDetecting(true)
    setError(null)
    try {
      const imageUrl = design.image_filename ? `/data/images/${design.image_filename}` : ''
      const outline = await detectToolAtPoint(imageUrl, design.scale_mm_per_px, clickX, clickY)
      addTool(outline)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Detection failed')
    } finally {
      setDetecting(false)
    }
  }

  const paperWmm = design.paper_size === 'letter' ? 215.9 : 210
  const paperHmm = design.paper_size === 'letter' ? 279.4 : 297

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16, gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 22, margin: 0 }}>Detected Tools ({design.outlines.length})</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => setView('calibrate')} style={btnStyle}>← Back</button>
          <button
            onClick={handleAddToolClick}
            disabled={detecting}
            style={{
              ...btnStyle,
              background: addingTool ? '#3b0764' : '#27272a',
              color: addingTool ? '#a78bfa' : '#e4e4e7',
              border: addingTool ? '1px solid #7c3aed' : '1px solid #3f3f46',
            }}
          >
            {addingTool ? '👆 Click on a tool...' : '+ Add Tool'}
          </button>
          <button onClick={handleContinue} style={primaryBtn}>Open Editor →</button>
        </div>
      </div>

      {error && (
        <div style={{
          background: '#422006', border: '1px solid #a16207', borderRadius: 8,
          padding: '8px 16px', color: '#fde047', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {addingTool && (
        <div style={{
          background: '#1e1b4b', border: '1px solid #7c3aed', borderRadius: 8,
          padding: '8px 16px', color: '#c4b5fd', fontSize: 13,
        }}>
          Click on any tool in the image to trace its outline. Click "Cancel" or press Escape to stop.
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flex: 1, overflow: 'hidden' }}>
        {/* Rectified image with outline overlays */}
        <div style={{ flex: 1, background: '#18181b', borderRadius: 8, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: 12 }}>
          <div style={{ position: 'relative' }}>
            <img
              ref={imgRef}
              src={design.image_filename ? `/data/images/${design.image_filename}` : ''}
              alt="rectified"
              onClick={handleImageClick}
              style={{
                display: 'block', maxWidth: '100%',
                cursor: addingTool ? 'crosshair' : 'default',
                opacity: detecting ? 0.5 : 1,
              }}
            />
            {detecting && (
              <div style={{
                position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                color: '#a78bfa', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span className="spinner" style={{
                  display: 'inline-block', width: 16, height: 16,
                  border: '2px solid #3f3f46', borderTopColor: '#a78bfa',
                  borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                }} />
                Detecting tool...
              </div>
            )}
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
            <p style={{ color: '#71717a', fontSize: 13 }}>
              No tools detected automatically. Click <strong>+ Add Tool</strong> then click on a tool in the image to trace it.
            </p>
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
