import { useState } from 'react'
import { useBaseplate } from '../editor/useBaseplateState'
import { exportBaseplate, downloadBlob, saveBaseplateDesign } from '../api/client'

export default function BaseplateExportBar() {
  const { design, setName, pushHistory, segmentInfo } = useBaseplate()
  const [exporting, setExporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(design.id)

  const handleExport = async () => {
    setExporting(true)
    try {
      const blob = await exportBaseplate(design)
      const isZip = blob.type === 'application/zip' || segmentInfo?.segment_count! > 1
      const ext = isZip ? 'zip' : 'stl'
      const filename = `${design.name || 'baseplate'}.${ext}`
      downloadBlob(blob, filename)
    } catch (e) {
      useBaseplate.getState().setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const saved = await saveBaseplateDesign(design)
      setSavedId(saved.id)
      useBaseplate.setState({ design: saved })
    } catch (e) {
      useBaseplate.getState().setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const segCount = segmentInfo?.segment_count || 1

  return (
    <div style={{
      borderTop: '1px solid #27272a', padding: '10px 16px', background: '#18181b',
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0,
    }}>
      <input
        type="text" value={design.name}
        onChange={(e) => { setName(e.target.value); pushHistory() }}
        placeholder="Baseplate name"
        style={{
          background: '#27272a', border: '1px solid #3f3f46', borderRadius: 4,
          padding: '6px 10px', color: '#e4e4e7', fontSize: 13, width: 180,
        }}
      />

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: '6px 14px', borderRadius: 4, border: '1px solid #3f3f46',
          background: '#27272a', color: '#a1a1aa',
          cursor: saving ? 'wait' : 'pointer', fontSize: 13,
        }}
      >
        {saving ? 'Saving...' : savedId ? '✓ Saved' : '💾 Save'}
      </button>

      <div style={{ flex: 1 }} />

      {segCount > 1 && (
        <span style={{ fontSize: 12, color: '#f59e0b' }}>
          {segCount} segments → ZIP
        </span>
      )}

      <button
        onClick={handleExport}
        disabled={exporting}
        style={{
          padding: '6px 14px', borderRadius: 4, border: '1px solid #7c3aed',
          background: exporting ? '#27272a' : '#7c3aed', color: 'white',
          cursor: exporting ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        {exporting ? (
          <>
            <span className="spinner" style={{
              display: 'inline-block', width: 12, height: 12,
              border: '2px solid #3f3f46', borderTopColor: '#a78bfa',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            }} />
            Generating...
          </>
        ) : (
          <>🧊 Export {segCount > 1 ? 'ZIP' : 'STL'}</>
        )}
      </button>
    </div>
  )
}
