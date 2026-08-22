import { useState } from 'react'
import { useEditor } from '../editor/useEditorState'
import { exportDesign, downloadBlob, saveDesign } from '../api/client'
import type { ExportFormat } from '../types'

const FORMATS: { fmt: ExportFormat; label: string; icon: string; desc: string }[] = [
  { fmt: 'svg', label: 'SVG', icon: '📐', desc: '2D vector (laser/foam)' },
  { fmt: 'dxf', label: 'DXF', icon: '📐', desc: '2D CAD (laser/CNC)' },
  { fmt: 'stl', label: 'STL', icon: '🧊', desc: '3D mesh (3D print)' },
  { fmt: '3mf', label: '3MF', icon: '🧊', desc: '3D mesh (advanced)' },
  { fmt: 'step', label: 'STEP', icon: '🔧', desc: '3D CAD (Fusion/FreeCAD)' },
]

export default function ExportBar() {
  const { design, setName, pushHistory } = useEditor()
  const [exporting, setExporting] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(design.id)

  const handleExport = async (fmt: ExportFormat) => {
    setExporting(fmt)
    try {
      const blob = await exportDesign(design, fmt)
      const filename = `${design.name || 'tracefinity'}.${fmt}`
      downloadBlob(blob, filename)
    } catch (e) {
      useEditor.getState().setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(null)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const saved = await saveDesign(design)
      setSavedId(saved.id)
      useEditor.setState({ design: saved })
    } catch (e) {
      useEditor.getState().setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      borderTop: '1px solid #27272a', padding: '10px 16px', background: '#18181b',
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <input
        type="text" value={design.name}
        onChange={(e) => { setName(e.target.value); pushHistory() }}
        placeholder="Design name"
        style={{
          background: '#27272a', border: '1px solid #3f3f46', borderRadius: 4,
          padding: '6px 10px', color: '#e4e4e7', fontSize: 13, width: 160,
        }}
      />

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: '6px 14px', borderRadius: 4, border: '1px solid #3f3f46',
          background: saving ? '#27272a' : '#27272a', color: '#a1a1aa',
          cursor: saving ? 'wait' : 'pointer', fontSize: 13,
        }}
      >
        {saving ? 'Saving...' : savedId ? '✓ Saved' : '💾 Save'}
      </button>

      <div style={{ flex: 1 }} />

      <span style={{ fontSize: 12, color: '#52525b' }}>Export:</span>
      {FORMATS.map((f) => (
        <button
          key={f.fmt}
          onClick={() => handleExport(f.fmt)}
          disabled={exporting !== null}
          title={f.desc}
          style={{
            padding: '6px 12px', borderRadius: 4, border: '1px solid #3f3f46',
            background: exporting === f.fmt ? '#3b0764' : '#27272a',
            color: exporting === f.fmt ? '#a78bfa' : '#a1a1aa',
            cursor: exporting ? 'wait' : 'pointer', fontSize: 12,
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          {f.icon} {f.label}
          {exporting === f.fmt && ' ...'}
        </button>
      ))}
    </div>
  )
}
