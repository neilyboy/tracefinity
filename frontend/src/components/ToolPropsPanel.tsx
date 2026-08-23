import { useState, useEffect } from 'react'
import { useEditor } from '../editor/useEditorState'
import { autoRotateTool, saveToolToLibrary, listToolLibrary, loadToolFromLibrary, deleteToolFromLibrary } from '../api/client'
import type { ToolLibrarySummary } from '../api/client'

export default function ToolPropsPanel() {
  const { design, selectedToolId, updateTool, deleteTool, addTool, scaleTool } = useEditor()
  const tool = design.outlines.find((o) => o.id === selectedToolId)
  const [rotating, setRotating] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveCat, setSaveCat] = useState('General')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [libraryTools, setLibraryTools] = useState<ToolLibrarySummary[]>([])
  const [libLoading, setLibLoading] = useState(false)
  const [scalePct, setScalePct] = useState(100)

  if (!tool) {
    return (
      <div style={{ padding: 12, color: '#52525b', fontSize: 12 }}>
        Select a tool to edit its properties.
      </div>
    )
  }

  const idx = design.outlines.findIndex((o) => o.id === tool.id)

  const handleAutoRotate = async () => {
    setRotating(true)
    try {
      const angle = await autoRotateTool(tool.outer)
      updateTool(tool.id, { rotation_deg: angle })
    } catch (e) {
      console.error('Auto-rotate failed:', e)
    } finally {
      setRotating(false)
    }
  }

  const handleRotate90 = (dir: 1 | -1) => {
    const newAngle = (tool.rotation_deg ?? 0) + dir * 90
    updateTool(tool.id, { rotation_deg: newAngle % 360 })
  }

  const handleAddFingerHole = () => {
    // Add a finger hole at the centroid of the tool
    const pts = tool.outer
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    const newHole = { x: cx, y: cy, radius_mm: 15.0, depth_mm: null }
    updateTool(tool.id, { finger_holes: [...(tool.finger_holes ?? []), newHole] })
  }

  const handleRemoveFingerHole = (idx: number) => {
    const holes = [...(tool.finger_holes ?? [])]
    holes.splice(idx, 1)
    updateTool(tool.id, { finger_holes: holes })
  }

  const handleSaveToLibrary = async () => {
    if (!tool || !saveName.trim()) return
    try {
      await saveToolToLibrary(tool, saveName.trim(), saveCat.trim() || 'General')
      setShowSaveDialog(false)
      setSaveName('')
    } catch (e) {
      console.error('Save to library failed:', e)
    }
  }

  const handleShowLibrary = async () => {
    setShowLibrary(!showLibrary)
    if (!showLibrary) {
      setLibLoading(true)
      try {
        const tools = await listToolLibrary()
        setLibraryTools(tools)
      } catch (e) {
        console.error('List tools failed:', e)
      } finally {
        setLibLoading(false)
      }
    }
  }

  const handleLoadFromLibrary = async (id: string) => {
    try {
      const loaded = await loadToolFromLibrary(id)
      // Generate a new ID and position at bin center
      const newId = `tool_${Date.now()}`
      addTool({ ...loaded, id: newId })
    } catch (e) {
      console.error('Load tool failed:', e)
    }
  }

  const handleDeleteFromLibrary = async (id: string) => {
    try {
      await deleteToolFromLibrary(id)
      const tools = await listToolLibrary()
      setLibraryTools(tools)
    } catch (e) {
      console.error('Delete tool failed:', e)
    }
  }

  const handleScale = (pct: number) => {
    if (!tool) return
    const factor = pct / 100
    scaleTool(tool.id, factor)
    setScalePct(100) // reset after applying
  }

  return (
    <div style={{ padding: 12 }}>
      <h3 style={{ fontSize: 13, color: '#a1a1aa', marginTop: 0, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Tool {idx + 1} Properties
      </h3>

      <Field label="Label">
        <input
          type="text" value={tool.label} placeholder="e.g. Pliers"
          onChange={(e) => updateTool(tool.id, { label: e.target.value })}
          style={inputStyle}
        />
      </Field>

      <Field label="Rotation (degrees)">
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="number" value={tool.rotation_deg ?? 0} step={1} min={0} max={359}
            onChange={(e) => updateTool(tool.id, { rotation_deg: parseFloat(e.target.value) || 0 })}
            style={{ ...inputStyle, width: 70 }}
          />
          <button onClick={() => handleRotate90(-1)} style={smallBtn} title="Rotate -90°">↺90</button>
          <button onClick={() => handleRotate90(1)} style={smallBtn} title="Rotate +90°">90↻</button>
          <button onClick={handleAutoRotate} disabled={rotating} style={smallBtn} title="Auto-align to axes">
            {rotating ? '...' : 'Auto'}
          </button>
        </div>
      </Field>

      <Field label="Margin override (mm)">
        <input
          type="number" value={tool.margin_mm ?? ''} step={0.1} min={0} max={10}
          placeholder={`default: ${design.params.tool_margin_mm}`}
          onChange={(e) => updateTool(tool.id, { margin_mm: e.target.value === '' ? null : parseFloat(e.target.value) })}
          style={inputStyle}
        />
      </Field>

      <Field label="Pocket depth override (mm)">
        <input
          type="number" value={tool.pocket_depth_mm ?? ''} step={0.5} min={1} max={100}
          placeholder={`default: ${design.params.pocket_depth_mm}`}
          onChange={(e) => updateTool(tool.id, { pocket_depth_mm: e.target.value === '' ? null : parseFloat(e.target.value) })}
          style={inputStyle}
        />
      </Field>

      <div style={{ marginTop: 12, marginBottom: 8, fontSize: 11, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Finger Holes — click on tool in editor to place
      </div>
      <button onClick={handleAddFingerHole} style={{ ...btnStyle, width: '100%', marginBottom: 8 }}>
        + Add Finger Hole at Center
      </button>
      {(tool.finger_holes ?? []).map((hole, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: '#52525b', minWidth: 60 }}>
            ({hole.x.toFixed(0)}, {hole.y.toFixed(0)})
          </span>
          <input
            type="number" value={hole.radius_mm} step={1} min={3} max={40}
            onChange={(e) => {
              const holes = [...(tool.finger_holes ?? [])]
              holes[i] = { ...hole, radius_mm: parseFloat(e.target.value) || 15 }
              updateTool(tool.id, { finger_holes: holes })
            }}
            style={{ ...inputStyle, width: 50 }}
            title="Radius (mm)"
          />
          <span style={{ fontSize: 11, color: '#52525b' }}>mm Ø</span>
          <button onClick={() => handleRemoveFingerHole(i)} style={{ ...smallBtn, color: '#fca5a5' }}>✕</button>
        </div>
      ))}

      <Field label={`Scale (${scalePct}%)`}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="range" min={50} max={200} value={scalePct} step={5}
            onChange={(e) => setScalePct(parseInt(e.target.value))}
            style={{ flex: 1 }}
          />
          <button
            onClick={() => handleScale(scalePct)}
            disabled={scalePct === 100}
            style={{ ...smallBtn, opacity: scalePct === 100 ? 0.4 : 1 }}
          >
            Apply
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button onClick={() => handleScale(90)} style={smallBtn}>−10%</button>
          <button onClick={() => handleScale(95)} style={smallBtn}>−5%</button>
          <button onClick={() => handleScale(105)} style={smallBtn}>+5%</button>
          <button onClick={() => handleScale(110)} style={smallBtn}>+10%</button>
        </div>
      </Field>

      <div style={{ marginTop: 12, marginBottom: 8, fontSize: 11, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Tool Library
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button onClick={() => setShowSaveDialog(!showSaveDialog)} style={{ ...btnStyle, flex: 1 }}>
          {showSaveDialog ? 'Cancel' : '💾 Save'}
        </button>
        <button onClick={handleShowLibrary} style={{ ...btnStyle, flex: 1 }}>
          {showLibrary ? 'Close' : '📂 Browse'}
        </button>
      </div>

      {showSaveDialog && (
        <div style={{ marginBottom: 8, padding: 8, background: '#18181b', borderRadius: 4, border: '1px solid #3f3f46' }}>
          <input
            type="text" placeholder="Tool name (e.g. Pliers)"
            value={saveName} onChange={(e) => setSaveName(e.target.value)}
            style={{ ...inputStyle, width: '100%', marginBottom: 4 }}
          />
          <input
            type="text" placeholder="Category"
            value={saveCat} onChange={(e) => setSaveCat(e.target.value)}
            style={{ ...inputStyle, width: '100%', marginBottom: 4 }}
          />
          <button
            onClick={handleSaveToLibrary}
            disabled={!saveName.trim()}
            style={{ ...btnStyle, width: '100%', opacity: saveName.trim() ? 1 : 0.4 }}
          >
            Save to Library
          </button>
        </div>
      )}

      {showLibrary && (
        <div style={{ marginBottom: 8, maxHeight: 200, overflow: 'auto' }}>
          {libLoading && <div style={{ fontSize: 12, color: '#71717a', padding: 4 }}>Loading...</div>}
          {!libLoading && libraryTools.length === 0 && (
            <div style={{ fontSize: 12, color: '#52525b', padding: 4 }}>No saved tools yet</div>
          )}
          {libraryTools.map((t) => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '4px 6px', marginBottom: 2, borderRadius: 4,
              background: '#27272a', border: '1px solid #3f3f46', fontSize: 11,
            }}>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ color: '#e4e4e7', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.name}
                </div>
                <div style={{ color: '#71717a', fontSize: 10 }}>
                  {t.category} · {t.bbox_w_mm.toFixed(0)}×{t.bbox_h_mm.toFixed(0)}mm
                </div>
              </div>
              <button
                onClick={() => handleLoadFromLibrary(t.id)}
                style={{ ...smallBtn, fontSize: 10, padding: '2px 6px' }}
                title="Add to workspace"
              >
                + Add
              </button>
              <button
                onClick={() => handleDeleteFromLibrary(t.id)}
                style={{ ...smallBtn, fontSize: 10, padding: '2px 6px', color: '#fca5a5' }}
                title="Delete from library"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={() => updateTool(tool.id, { visible: !tool.visible })}
          style={btnStyle}
        >
          {tool.visible ? '👁 Hide' : '👁 Show'}
        </button>
        <button
          onClick={() => deleteTool(tool.id)}
          style={{ ...btnStyle, color: '#fca5a5', borderColor: '#7f1d1d' }}
        >
          🗑 Delete
        </button>
      </div>

      <div style={{ marginTop: 16, fontSize: 11, color: '#52525b' }}>
        <div>Vertices: {tool.outer.length}</div>
        <div>Finger holes: {(tool.finger_holes ?? []).length}</div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 11, color: '#71717a', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', background: '#27272a', border: '1px solid #3f3f46',
  borderRadius: 4, color: '#e4e4e7', fontSize: 13, boxSizing: 'border-box',
}

const btnStyle: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 4, border: '1px solid #3f3f46',
  background: '#27272a', color: '#a1a1aa', cursor: 'pointer', fontSize: 12,
}

const smallBtn: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 4, border: '1px solid #3f3f46',
  background: '#27272a', color: '#a1a1aa', cursor: 'pointer', fontSize: 11,
  whiteSpace: 'nowrap',
}
