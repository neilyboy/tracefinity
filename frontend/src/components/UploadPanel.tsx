import { useState, useRef, useEffect } from 'react'
import { useEditor } from '../editor/useEditorState'
import { traceImage, listDesigns, loadDesign, listToolLibrary } from '../api/client'
import type { PaperSize, DesignSummary } from '../types'
import type { ToolLibrarySummary } from '../api/client'

export default function UploadPanel() {
  const { setLoading, setError, setDesign, setView, setPaperSize, reset } = useEditor()
  const [paperSize, setPaper] = useState<PaperSize>('letter')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [savedDesigns, setSavedDesigns] = useState<DesignSummary[]>([])
  const [libraryCount, setLibraryCount] = useState(0)
  const [showSaved, setShowSaved] = useState(false)

  const loading = useEditor((s) => s.loading)

  useEffect(() => {
    // Load saved designs and library count on mount
    listDesigns().then(setSavedDesigns).catch(() => {})
    listToolLibrary().then((tools) => setLibraryCount(tools.length)).catch(() => {})
  }, [])

  const handleFile = async (file: File) => {
    setLoading(true)
    setError(null)
    setPaperSize(paperSize)
    try {
      const result = await traceImage(file, paperSize)
      useEditor.setState((s) => ({
        design: {
          ...s.design,
          paper_size: result.paper_size,
          scale_mm_per_px: result.scale_mm_per_px,
          rectified_w_px: result.rectified_w_px,
          rectified_h_px: result.rectified_h_px,
          paper_corners_px: result.paper_corners_px,
          outlines: result.outlines,
          image_filename: result.rectified_image_url.split('/').pop() || null,
        },
        _originalImageUrl: result.original_image_url,
        _paperDetected: result.paper_detected,
      } as any))
      setView('calibrate')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  const handleDesignFromScratch = () => {
    reset()
    setPaperSize(paperSize)
    setView('editor')
  }

  const handleLoadDesign = async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const design = await loadDesign(id)
      setDesign(design)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 40, gap: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 600 }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Tracefinity</h1>
        <p style={{ color: '#a1a1aa', fontSize: 15 }}>
          Place your tools on a sheet of <strong>US Letter (8.5×11")</strong> or <strong>A4</strong> paper.
          Take a photo from directly above with even lighting. We'll detect the paper for scale and trace each tool.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label style={{ color: '#a1a1aa', fontSize: 14 }}>Paper size:</label>
        <select
          value={paperSize}
          onChange={(e) => setPaper(e.target.value as PaperSize)}
          style={{ background: '#27272a', color: '#e4e4e7', border: '1px solid #3f3f46', borderRadius: 6, padding: '6px 12px' }}
        >
          <option value="letter">US Letter (8.5×11")</option>
          <option value="a4">A4 (210×297mm)</option>
        </select>
      </div>

      {/* Three options: Upload, Design from scratch, Load saved */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* Upload option */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false)
            const file = e.dataTransfer.files[0]
            if (file) handleFile(file)
          }}
          onClick={() => fileRef.current?.click()}
          style={{
            width: 320, height: 220, border: `2px dashed ${dragOver ? '#a78bfa' : '#3f3f46'}`,
            borderRadius: 12, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            background: dragOver ? '#1e1b2e' : '#18181b', transition: 'all 0.2s',
          }}
        >
          {loading ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, marginBottom: 8 }}>Tracing your tools...</div>
              <div style={{ width: 200, height: 4, background: '#27272a', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: '50%', height: '100%', background: '#a78bfa', animation: 'pulse 1s infinite' }} />
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📷</div>
              <div style={{ fontSize: 15, color: '#a1a1aa' }}>Upload Photo</div>
              <div style={{ fontSize: 12, color: '#52525b', marginTop: 4 }}>Drag & drop or click</div>
            </>
          )}
        </div>

        {/* Design from scratch */}
        <div
          onClick={handleDesignFromScratch}
          style={{
            width: 320, height: 220, border: '2px solid #3f3f46',
            borderRadius: 12, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            background: '#18181b', transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.background = '#1e1b2e' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#3f3f46'; e.currentTarget.style.background = '#18181b' }}
        >
          <div style={{ fontSize: 40, marginBottom: 8 }}>📐</div>
          <div style={{ fontSize: 15, color: '#a1a1aa' }}>Design from Scratch</div>
          <div style={{ fontSize: 12, color: '#52525b', marginTop: 4 }}>
            {libraryCount > 0
              ? `Build from your library (${libraryCount} tools)`
              : 'Start with an empty tray'}
          </div>
        </div>

        {/* Load saved tray */}
        <div
          onClick={() => setShowSaved(!showSaved)}
          style={{
            width: 320, height: 220, border: '2px solid #3f3f46',
            borderRadius: 12, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            background: '#18181b', transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.background = '#1e1b2e' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#3f3f46'; e.currentTarget.style.background = '#18181b' }}
        >
          <div style={{ fontSize: 40, marginBottom: 8 }}>📂</div>
          <div style={{ fontSize: 15, color: '#a1a1aa' }}>Load Saved Tray</div>
          <div style={{ fontSize: 12, color: '#52525b', marginTop: 4 }}>
            {savedDesigns.length > 0
              ? `${savedDesigns.length} saved tray${savedDesigns.length !== 1 ? 's' : ''}`
              : 'No saved trays yet'}
          </div>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
      />

      {/* Saved designs list */}
      {showSaved && (
        <div style={{ width: 600, background: '#18181b', borderRadius: 12, padding: 16, border: '1px solid #3f3f46' }}>
          <h3 style={{ fontSize: 14, color: '#a1a1aa', marginTop: 0, marginBottom: 12 }}>Saved Trays</h3>
          {savedDesigns.length === 0 ? (
            <p style={{ color: '#52525b', fontSize: 13, textAlign: 'center', padding: 20 }}>
              No saved trays yet. Create a tray and click Save in the editor to save it.
            </p>
          ) : (
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              {savedDesigns.map((d) => (
                <div
                  key={d.id}
                  onClick={() => handleLoadDesign(d.id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', marginBottom: 6, borderRadius: 6, cursor: 'pointer',
                    background: '#27272a', border: '1px solid #3f3f46',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#7c3aed' }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#3f3f46' }}
                >
                  <div>
                    <div style={{ fontSize: 14, color: '#e4e4e7' }}>{d.name}</div>
                    <div style={{ fontSize: 11, color: '#71717a' }}>
                      {new Date(d.updated_at).toLocaleDateString()} {new Date(d.updated_at).toLocaleTimeString()}
                    </div>
                  </div>
                  <span style={{ fontSize: 18, color: '#71717a' }}>→</span>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowSaved(false)}
            style={{ marginTop: 8, padding: '6px 16px', borderRadius: 6, border: '1px solid #3f3f46', background: '#27272a', color: '#a1a1aa', cursor: 'pointer', fontSize: 12 }}
          >
            Close
          </button>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:0.5} 50%{opacity:1} }`}</style>
    </div>
  )
}
