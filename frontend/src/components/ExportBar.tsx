import { useState } from 'react'
import { useEditor } from '../editor/useEditorState'
import { exportDesign, downloadBlob, saveDesign } from '../api/client'
import type { ExportFormat } from '../types'

const FORMATS: { fmt: ExportFormat; label: string; icon: string; desc: string }[] = [
  { fmt: 'svg', label: 'SVG', icon: '📐', desc: '2D vector (laser/foam)' },
  { fmt: 'dxf', label: 'DXF', icon: '📐', desc: '2D CAD (laser/CNC)' },
  { fmt: 'stl', label: 'STL', icon: '🧊', desc: '3D mesh (3D print). Large trays auto-split into a ZIP of segments.' },
  { fmt: 'stl_flat', label: 'Flat STL', icon: '📋', desc: 'Flat insert layer (two-tone: sits inside tray lip, shows tray color through cutouts)' },
  { fmt: 'stl_lid', label: 'Lid STL', icon: '📦', desc: 'Bin lid (snaps onto bin, optional text label)' },
  { fmt: '3mf', label: '3MF', icon: '🧊', desc: '3D mesh (advanced)' },
  { fmt: 'step', label: 'STEP', icon: '🔧', desc: '3D CAD (Fusion/FreeCAD)' },
]

export default function ExportBar() {
  const { design, setName, pushHistory } = useEditor()
  const [exporting, setExporting] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(design.id)

  // Check if tray will be segmented (client-side prediction for UI display)
  const p = design.params
  const trayW = p.grid_w * 42
  const trayL = p.grid_l * 42
  const willSegment = p.force_segment || trayW > (p.print_bed_w_mm || 220) || trayL > (p.print_bed_l_mm || 220)

  const handleExport = async (fmt: ExportFormat) => {
    setExporting(fmt)
    const is3D = fmt === 'stl' || fmt === '3mf' || fmt === 'step' || fmt === 'stl_flat' || fmt === 'stl_lid'
    setExportStatus(is3D ? 'Generating 3D model...' : 'Exporting...')
    try {
      const blob = await exportDesign(design, fmt)
      // Determine filename based on format and actual content type
      // (segmented trays return a ZIP even when fmt is 'stl')
      const isZip = blob.type === 'application/zip' || blob.type === 'application/x-zip-compressed'
      let ext: string
      let suffix: string
      if (isZip) {
        ext = 'zip'
        suffix = '-segments'
      } else if (fmt === 'stl_flat') {
        ext = 'stl'
        suffix = '-flat'
      } else if (fmt === 'stl_lid') {
        ext = 'stl'
        suffix = '-lid'
      } else {
        ext = fmt
        suffix = ''
      }
      const filename = `${design.name || 'tracefinity'}${suffix}.${ext}`
      setExportStatus('Downloading...')
      downloadBlob(blob, filename)
    } catch (e) {
      useEditor.getState().setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(null)
      setExportStatus('')
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
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0,
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
          {f.fmt === 'stl' && willSegment && <span style={{ color: '#f59e0b', fontSize: 10, marginLeft: 2 }}>(ZIP)</span>}
          {exporting === f.fmt && ' ...'}
        </button>
      ))}
      {willSegment && (
        <span style={{ fontSize: 11, color: '#f59e0b' }}>
          Tray {trayW}×{trayL}mm exceeds bed → will split into segments
        </span>
      )}
      {exporting && (
        <span style={{ fontSize: 12, color: '#a78bfa', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="spinner" style={{
            display: 'inline-block', width: 12, height: 12,
            border: '2px solid #3f3f46', borderTopColor: '#a78bfa',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }} />
          {exportStatus}
        </span>
      )}
    </div>
  )
}
