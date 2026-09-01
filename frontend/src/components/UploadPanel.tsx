import { useState, useRef, useEffect } from 'react'
import { useEditor } from '../editor/useEditorState'
import { useBaseplate } from '../editor/useBaseplateState'
import { traceImage, listDesigns, loadDesign, deleteDesign, listBaseplateDesigns, loadBaseplateDesign, deleteBaseplateDesign, listToolLibrary } from '../api/client'
import { downloadBlob } from '../api/client'
import type { PaperSize, ProjectSummary, Design, BaseplateDesign } from '../types'
import type { ToolLibrarySummary } from '../api/client'

export default function UploadPanel({ onSwitchToBaseplate }: { onSwitchToBaseplate?: () => void }) {
  const { setLoading, setError, setDesign, setView, setPaperSize, reset } = useEditor()
  const [paperSize, setPaper] = useState<PaperSize>('letter')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [savedProjects, setSavedProjects] = useState<ProjectSummary[]>([])
  const [projectFilter, setProjectFilter] = useState<'all' | 'tray' | 'baseplate'>('all')
  const [showSaved, setShowSaved] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showBlankBin, setShowBlankBin] = useState(false)
  const [blankW, setBlankW] = useState(3)
  const [blankL, setBlankL] = useState(2)
  const [blankH, setBlankH] = useState(4)
  const [libraryCount, setLibraryCount] = useState(0)
  const importRef = useRef<HTMLInputElement>(null)

  const loading = useEditor((s) => s.loading)

  useEffect(() => {
    refreshProjects()
    listToolLibrary().then((tools) => setLibraryCount(tools.length)).catch(() => {})
  }, [])

  const refreshProjects = async () => {
    try {
      const [trays, baseplates] = await Promise.all([listDesigns(), listBaseplateDesigns()])
      const merged: ProjectSummary[] = [
        ...trays.map((d) => ({ ...d, type: 'tray' as const })),
        ...baseplates.map((d) => ({ ...d, type: 'baseplate' as const, thumbnail_url: null })),
      ]
      merged.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      setSavedProjects(merged)
    } catch {
      // ignore — list will just be empty
    }
  }

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
    setShowBlankBin(true)
  }

  const handleCreateBlankBin = () => {
    reset()
    setPaperSize(paperSize)
    useEditor.setState((s) => ({
      design: {
        ...s.design,
        params: {
          ...s.design.params,
          grid_w: blankW,
          grid_l: blankL,
          height_units: blankH,
        },
      },
    }))
    setView('editor')
    setShowBlankBin(false)
  }

  const handleLoadProject = async (project: ProjectSummary) => {
    setLoading(true)
    setError(null)
    try {
      if (project.type === 'tray') {
        const design = await loadDesign(project.id)
        setDesign(design)
        setView('editor')
      } else {
        const design = await loadBaseplateDesign(project.id)
        useBaseplate.setState({
          design,
          history: [JSON.parse(JSON.stringify(design))],
          historyIndex: 0,
          selectedCutoutId: null,
        })
        onSwitchToBaseplate?.()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteProject = async (project: ProjectSummary) => {
    try {
      if (project.type === 'tray') {
        await deleteDesign(project.id)
      } else {
        await deleteBaseplateDesign(project.id)
      }
      setSavedProjects((prev) => prev.filter((p) => p.id !== project.id))
      setDeletingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
      setDeletingId(null)
    }
  }

  const handleExportProject = async (project: ProjectSummary) => {
    setLoading(true)
    setError(null)
    try {
      let design: Design | BaseplateDesign
      if (project.type === 'tray') {
        design = await loadDesign(project.id)
      } else {
        design = await loadBaseplateDesign(project.id)
      }
      // Wrap in a portable format with type info and version
      const exportData = {
        type: project.type,
        version: 1,
        exported_at: new Date().toISOString(),
        design,
      }
      const json = JSON.stringify(exportData, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const safeName = (project.name || 'untitled').replace(/[^a-zA-Z0-9_-]/g, '_')
      downloadBlob(blob, `${safeName}.tracefinity.json`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setLoading(false)
    }
  }

  const handleImportProject = async (file: File) => {
    setLoading(true)
    setError(null)
    try {
      const text = await file.text()
      const data = JSON.parse(text)

      // Validate format
      if (!data.type || !data.design) {
        throw new Error('Invalid project file: missing type or design data')
      }

      // Strip the ID so it creates a fresh record when saved
      const design = data.design
      design.id = null

      if (data.type === 'tray') {
        // Mark as imported copy in the name
        if (!design.name.endsWith(' (imported)')) {
          design.name = `${design.name || 'Imported'} (imported)`
        }
        setDesign(design)
        setView('editor')
      } else if (data.type === 'baseplate') {
        if (!design.name.endsWith(' (imported)')) {
          design.name = `${design.name || 'Imported'} (imported)`
        }
        useBaseplate.setState({
          design,
          history: [JSON.parse(JSON.stringify(design))],
          historyIndex: 0,
          selectedCutoutId: null,
        })
        onSwitchToBaseplate?.()
      } else {
        throw new Error(`Unknown project type: ${data.type}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  const filteredProjects = savedProjects.filter(
    (p) => projectFilter === 'all' || p.type === projectFilter
  )

  const trayCount = savedProjects.filter((p) => p.type === 'tray').length
  const baseplateCount = savedProjects.filter((p) => p.type === 'baseplate').length

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

      {/* Four options: Upload, Design from scratch, Baseplate Designer, Load Saved Project */}
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

        {/* Baseplate Designer */}
        <div
          onClick={() => onSwitchToBaseplate?.()}
          style={{
            width: 320, height: 220, border: '2px solid #3f3f46',
            borderRadius: 12, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            background: '#18181b', transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.background = '#1e1b2e' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#3f3f46'; e.currentTarget.style.background = '#18181b' }}
        >
          <div style={{ fontSize: 40, marginBottom: 8 }}>🔳</div>
          <div style={{ fontSize: 15, color: '#a1a1aa' }}>Baseplate Designer</div>
          <div style={{ fontSize: 12, color: '#52525b', marginTop: 4 }}>
            Custom gridfinity baseplates for your drawers
          </div>
        </div>

        {/* Load saved project */}
        <div
          onClick={() => { setShowSaved(!showSaved); if (!showSaved) refreshProjects() }}
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
          <div style={{ fontSize: 15, color: '#a1a1aa' }}>Load Saved Project</div>
          <div style={{ fontSize: 12, color: '#52525b', marginTop: 4 }}>
            {savedProjects.length > 0
              ? `${savedProjects.length} saved project${savedProjects.length !== 1 ? 's' : ''}`
              : 'No saved projects yet'}
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

      {/* Hidden import file input */}
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportProject(f); e.target.value = '' }}
      />

      {/* Saved projects list */}
      {showSaved && (
        <div style={{ width: 620, background: '#18181b', borderRadius: 12, padding: 16, border: '1px solid #3f3f46' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, color: '#a1a1aa', margin: 0 }}>Saved Projects</h3>
            <button
              onClick={() => importRef.current?.click()}
              title="Import a .tracefinity.json file shared by someone else"
              style={{
                padding: '4px 12px', borderRadius: 6, border: '1px solid #3f3f46',
                background: '#27272a', color: '#a1a1aa', cursor: 'pointer', fontSize: 12,
                display: 'flex', alignItems: 'center', gap: 4,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.color = '#a78bfa' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#3f3f46'; e.currentTarget.style.color = '#a1a1aa' }}
            >
              📥 Import
            </button>
          </div>

          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {([
              { key: 'all', label: `All (${savedProjects.length})` },
              { key: 'tray', label: `Trays (${trayCount})` },
              { key: 'baseplate', label: `Baseplates (${baseplateCount})` },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setProjectFilter(tab.key)}
                style={{
                  padding: '4px 12px', borderRadius: 12, border: '1px solid #3f3f46',
                  background: projectFilter === tab.key ? '#7c3aed' : '#27272a',
                  color: projectFilter === tab.key ? 'white' : '#a1a1aa',
                  cursor: 'pointer', fontSize: 12, fontWeight: projectFilter === tab.key ? 600 : 400,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filteredProjects.length === 0 ? (
            <p style={{ color: '#52525b', fontSize: 13, textAlign: 'center', padding: 20 }}>
              No saved projects yet. Create a tray or baseplate and click Save in the editor to save it.
            </p>
          ) : (
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              {filteredProjects.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', marginBottom: 6, borderRadius: 6,
                    background: '#27272a', border: '1px solid #3f3f46',
                  }}
                  onMouseEnter={(e) => { if (deletingId !== p.id) e.currentTarget.style.borderColor = '#7c3aed' }}
                  onMouseLeave={(e) => { if (deletingId !== p.id) e.currentTarget.style.borderColor = '#3f3f46' }}
                >
                  {deletingId === p.id ? (
                    /* Inline delete confirmation */
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                      <span style={{ fontSize: 13, color: '#fca5a5' }}>Delete "{p.name}"?</span>
                      <span style={{ flex: 1 }} />
                      <button
                        onClick={() => handleDeleteProject(p)}
                        style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid #dc2626', background: '#dc2626', color: 'white', cursor: 'pointer', fontSize: 12 }}
                      >
                        Yes, delete
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid #3f3f46', background: '#27272a', color: '#a1a1aa', cursor: 'pointer', fontSize: 12 }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <div
                        onClick={() => handleLoadProject(p)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1 }}
                      >
                        {/* Type badge */}
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                          background: p.type === 'tray' ? 'rgba(124,58,237,0.2)' : 'rgba(245,158,11,0.2)',
                          color: p.type === 'tray' ? '#a78bfa' : '#f59e0b',
                          border: `1px solid ${p.type === 'tray' ? 'rgba(124,58,237,0.3)' : 'rgba(245,158,11,0.3)'}`,
                          whiteSpace: 'nowrap',
                        }}>
                          {p.type === 'tray' ? '📐 Tray' : '🔳 Base'}
                        </span>
                        <div>
                          <div style={{ fontSize: 14, color: '#e4e4e7' }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: '#71717a' }}>
                            {new Date(p.updated_at).toLocaleDateString()} {new Date(p.updated_at).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                      {/* Export button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleExportProject(p) }}
                        title="Export as shareable .json file"
                        style={{
                          padding: '4px 8px', borderRadius: 4, border: '1px solid #3f3f46',
                          background: '#27272a', color: '#71717a', cursor: 'pointer', fontSize: 14,
                          marginRight: 4,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.borderColor = '#7c3aed' }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.borderColor = '#3f3f46' }}
                      >
                        📤
                      </button>
                      {/* Delete button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeletingId(p.id) }}
                        title="Delete project"
                        style={{
                          padding: '4px 8px', borderRadius: 4, border: '1px solid #3f3f46',
                          background: '#27272a', color: '#71717a', cursor: 'pointer', fontSize: 14,
                          marginRight: 8,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#fca5a5'; e.currentTarget.style.borderColor = '#dc2626' }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.borderColor = '#3f3f46' }}
                      >
                        🗑
                      </button>
                      <span
                        onClick={() => handleLoadProject(p)}
                        style={{ fontSize: 18, color: '#71717a', cursor: 'pointer' }}
                      >
                        →
                      </span>
                    </>
                  )}
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

      {/* Blank bin dialog */}
      {showBlankBin && (
        <div
          onClick={() => setShowBlankBin(false)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.7)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#18181b', borderRadius: 12, padding: 24,
              border: '1px solid #3f3f46', width: 360,
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: 16, color: '#e4e4e7' }}>
              New Blank Bin
            </h3>
            <p style={{ color: '#a1a1aa', fontSize: 13, marginBottom: 16 }}>
              Set the initial dimensions. You can adjust everything later in the editor.
            </p>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <label style={{ flex: 1 }}>
                <span style={{ color: '#a1a1aa', fontSize: 12, display: 'block', marginBottom: 4 }}>Width (cells)</span>
                <input type="number" min={1} max={10} value={blankW}
                  onChange={(e) => setBlankW(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{ width: '100%', padding: '8px', background: '#27272a', border: '1px solid #3f3f46', borderRadius: 4, color: '#e4e4e7', fontSize: 14, boxSizing: 'border-box' }} />
              </label>
              <label style={{ flex: 1 }}>
                <span style={{ color: '#a1a1aa', fontSize: 12, display: 'block', marginBottom: 4 }}>Length (cells)</span>
                <input type="number" min={1} max={10} value={blankL}
                  onChange={(e) => setBlankL(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{ width: '100%', padding: '8px', background: '#27272a', border: '1px solid #3f3f46', borderRadius: 4, color: '#e4e4e7', fontSize: 14, boxSizing: 'border-box' }} />
              </label>
              <label style={{ flex: 1 }}>
                <span style={{ color: '#a1a1aa', fontSize: 12, display: 'block', marginBottom: 4 }}>Height (7mm)</span>
                <input type="number" min={1} max={20} value={blankH}
                  onChange={(e) => setBlankH(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{ width: '100%', padding: '8px', background: '#27272a', border: '1px solid #3f3f46', borderRadius: 4, color: '#e4e4e7', fontSize: 14, boxSizing: 'border-box' }} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowBlankBin(false)}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #3f3f46', background: '#27272a', color: '#a1a1aa', cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
              <button onClick={handleCreateBlankBin}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #7c3aed', background: '#7c3aed', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Create Bin
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:0.5} 50%{opacity:1} }`}</style>
    </div>
  )
}
