import { useState, useRef } from 'react'
import { useEditor } from '../editor/useEditorState'
import { traceImage } from '../api/client'
import type { PaperSize } from '../types'

export default function UploadPanel() {
  const { setLoading, setError, setDesign, setView, setPaperSize } = useEditor()
  const [paperSize, setPaper] = useState<PaperSize>('letter')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setLoading(true)
    setError(null)
    setPaperSize(paperSize)
    try {
      const result = await traceImage(file, paperSize)
      // Store trace result in the design and move to calibrate view
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
        // Store original image URL and detection status for the calibrate view.
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

  const loading = useEditor((s) => s.loading)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 40, gap: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 600 }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Snap a Photo of Your Tools</h1>
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
          width: 500, height: 250, border: `2px dashed ${dragOver ? '#a78bfa' : '#3f3f46'}`,
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
            <div style={{ fontSize: 48, marginBottom: 8 }}>📷</div>
            <div style={{ fontSize: 16, color: '#a1a1aa' }}>Drag & drop or click to upload</div>
            <div style={{ fontSize: 12, color: '#52525b', marginTop: 4 }}>JPG, PNG, WEBP — max 25MB</div>
          </>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
      />
      <style>{`@keyframes pulse { 0%,100%{opacity:0.5} 50%{opacity:1} }`}</style>
    </div>
  )
}
