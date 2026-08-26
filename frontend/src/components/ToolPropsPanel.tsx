import { useState, useEffect, useMemo } from 'react'
import { useEditor } from '../editor/useEditorState'
import { autoRotateTool, saveToolToLibrary, listToolLibrary, loadToolFromLibrary, deleteToolFromLibrary } from '../api/client'
import type { ToolLibrarySummary } from '../api/client'
import type { FontInfo, TextLabel } from '../types'
import { loadAllFonts } from '../editor/fontLoader'

export default function ToolPropsPanel() {
  const { design, selectedToolId, selectedToolIds, selectTool, updateTool, deleteTool, addTool, scaleTool, duplicateTool, duplicateToolN, arrayTool, deleteLabel, updateLabel, mirrorTool } = useEditor()
  const tool = design.outlines.find((o) => o.id === selectedToolId)
  const multiSelected = selectedToolIds.length > 1 ? selectedToolIds : []
  const [rotating, setRotating] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveCat, setSaveCat] = useState('General')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [libraryTools, setLibraryTools] = useState<ToolLibrarySummary[]>([])
  const [libLoading, setLibLoading] = useState(false)
  const [scalePct, setScalePct] = useState(100)
  const [dupCount, setDupCount] = useState(4)
  const [dupSpacing, setDupSpacing] = useState(5)
  const [gridRows, setGridRows] = useState(4)
  const [gridCols, setGridCols] = useState(5)
  const [gridSpacingX, setGridSpacingX] = useState(5)
  const [gridSpacingY, setGridSpacingY] = useState(5)

  const refreshLibrary = async () => {
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

  // Auto-load library when no tool is selected
  useEffect(() => {
    if (!tool && !showLibrary) setShowLibrary(true)
    if (tool && showLibrary) setShowLibrary(false)
  }, [tool])

  useEffect(() => {
    if (showLibrary) refreshLibrary()
  }, [showLibrary])

  const handleLoadFromLibrary = async (id: string) => {
    try {
      const loaded = await loadToolFromLibrary(id)
      const newId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      addTool({ ...loaded, id: newId })
    } catch (e) {
      console.error('Load tool failed:', e)
    }
  }

  const handleDeleteFromLibrary = async (id: string) => {
    try {
      await deleteToolFromLibrary(id)
      refreshLibrary()
    } catch (e) {
      console.error('Delete tool failed:', e)
    }
  }

  // Multi-select panel
  if (multiSelected.length > 1) {
    const multiTools = design.outlines.filter((o) => multiSelected.includes(o.id))
    return (
      <div style={{ padding: 12 }}>
        <h3 style={{ fontSize: 13, color: '#a1a1aa', marginTop: 0, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {multiSelected.length} Tools Selected
        </h3>

        {/* Selected tools list */}
        <div style={{ marginBottom: 12 }}>
          {multiTools.map((t, i) => (
            <div
              key={t.id}
              onClick={() => selectTool(t.id)}
              style={{
                padding: '4px 8px', marginBottom: 2, borderRadius: 4, cursor: 'pointer',
                background: '#27272a', border: '1px solid #3f3f46', fontSize: 11,
                color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{ color: '#52525b', fontSize: 10 }}>{i + 1}.</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.label || `Tool ${design.outlines.indexOf(t) + 1}`}
              </span>
            </div>
          ))}
        </div>

        {/* Group actions */}
        <div style={{ fontSize: 11, color: '#71717a', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Group Actions
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => multiSelected.forEach((id) => deleteTool(id))}
            style={{ ...btnStyle, color: '#fca5a5', borderColor: '#7f1d1d' }}
          >
            🗑 Delete All
          </button>
          <button
            onClick={() => selectTool(multiSelected[0])}
            style={btnStyle}
          >
            Select One
          </button>
          <button
            onClick={() => selectTool(null)}
            style={btnStyle}
          >
            Deselect All
          </button>
        </div>

        <div style={{ fontSize: 11, color: '#52525b', lineHeight: 1.5 }}>
          Drag any selected tool in the editor to move all {multiSelected.length} tools together.
          Ctrl+click a tool to add/remove it from the selection.
        </div>

        {/* Labels section */}
        {design.labels.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: '#71717a', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Text Labels
            </div>
            {design.labels.map((label) => (
              <LabelEditor
                key={label.id}
                label={label}
                onUpdate={(updates) => updateLabel(label.id, updates)}
                onDelete={() => deleteLabel(label.id)}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  if (!tool) {
    return (
      <div style={{ padding: 12 }}>
        <h3 style={{ fontSize: 13, color: '#a1a1aa', marginTop: 0, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Tool Library
        </h3>

        {/* Tools in current design */}
        {design.outlines.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#71717a', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Tools in this design ({design.outlines.length})
            </div>
            {design.outlines.map((t, i) => (
              <div
                key={t.id}
                onClick={() => selectTool(t.id)}
                style={{
                  padding: '6px 8px', marginBottom: 2, borderRadius: 4, cursor: 'pointer',
                  background: '#27272a', border: '1px solid #3f3f46', fontSize: 12,
                  color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <span style={{ color: '#52525b', fontSize: 10 }}>{i + 1}.</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.label || `Tool ${i + 1}`}
                </span>
                {!t.visible && <span style={{ fontSize: 10, color: '#52525b' }}>hidden</span>}
              </div>
            ))}
          </div>
        )}

        <p style={{ fontSize: 12, color: '#71717a', marginBottom: 12, lineHeight: 1.5 }}>
          No tool selected. Click a tool above, add one with <strong style={{ color: '#a1a1aa' }}>＋ Add Tool</strong> in the toolbar, or load from your library below.
        </p>
        <LibraryBrowser
          tools={libraryTools}
          loading={libLoading}
          onAdd={handleLoadFromLibrary}
          onDelete={handleDeleteFromLibrary}
          onRefresh={refreshLibrary}
        />

        {/* Labels section */}
        {design.labels.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: '#71717a', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Text Labels
            </div>
            {design.labels.map((label) => (
              <LabelEditor
                key={label.id}
                label={label}
                onUpdate={(updates) => updateLabel(label.id, updates)}
                onDelete={() => deleteLabel(label.id)}
              />
            ))}
          </div>
        )}
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

  const handleScale = (pct: number) => {
    if (!tool) return
    const factor = pct / 100
    scaleTool(tool.id, factor)
    setScalePct(100)
  }

  const handleDuplicate = () => {
    duplicateTool(tool.id)
  }

  return (
    <div style={{ padding: 12 }}>
      <h3 style={{ fontSize: 13, color: '#a1a1aa', marginTop: 0, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Tool {idx + 1} Properties
      </h3>

      {/* Tool selector strip */}
      {design.outlines.length > 1 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
          {design.outlines.map((t, i) => (
            <button
              key={t.id}
              onClick={() => selectTool(t.id)}
              style={{
                padding: '2px 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                border: `1px solid ${t.id === tool.id ? '#7c3aed' : '#3f3f46'}`,
                background: t.id === tool.id ? '#3b0764' : '#27272a',
                color: t.id === tool.id ? '#a78bfa' : '#71717a',
                whiteSpace: 'nowrap',
              }}
              title={t.label || `Tool ${i + 1}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

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
            type="number" value={tool.rotation_deg ?? 0} step={1}
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

      <Field label="Mirror">
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => mirrorTool(tool.id, 'x')} style={smallBtn} title="Mirror left-right (flip X)">
            ↔ Mirror X
          </button>
          <button onClick={() => mirrorTool(tool.id, 'y')} style={smallBtn} title="Mirror top-bottom (flip Y)">
            ↕ Mirror Y
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
        Finger Holes
      </div>
      {(tool.finger_holes ?? []).length === 0 && (
        <div style={{ fontSize: 11, color: '#52525b', marginBottom: 8, lineHeight: 1.4 }}>
          Use the <strong style={{ color: '#a1a1aa' }}>◯ Finger Hole</strong> button in the toolbar above to place finger holes on this tool.
        </div>
      )}
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

      <Field label={`Path smoothing (${((tool.smoothing ?? 0.3) * 100).toFixed(0)}%)`}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="range" min={0} max={100} value={Math.round((tool.smoothing ?? 0.3) * 100)} step={5}
            onChange={(e) => updateTool(tool.id, { smoothing: parseInt(e.target.value) / 100 })}
            style={{ flex: 1 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button onClick={() => updateTool(tool.id, { smoothing: 0.0 })} style={smallBtn}>Sharp</button>
          <button onClick={() => updateTool(tool.id, { smoothing: 0.3 })} style={smallBtn}>Balanced</button>
          <button onClick={() => updateTool(tool.id, { smoothing: 0.6 })} style={smallBtn}>Smooth</button>
          <button onClick={() => updateTool(tool.id, { smoothing: 1.0 })} style={smallBtn}>Max</button>
        </div>
        <div style={{ fontSize: 10, color: '#52525b', marginTop: 4, lineHeight: 1.4 }}>
          0% = sharp corners (polygon), 30% = balanced, 100% = maximum curve smoothing. Affects both preview and exported geometry.
        </div>
      </Field>

      <div style={{ marginTop: 12, marginBottom: 8, fontSize: 11, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Tool Library
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button onClick={() => setShowSaveDialog(!showSaveDialog)} style={{ ...btnStyle, flex: 1 }}>
          {showSaveDialog ? 'Cancel' : '💾 Save'}
        </button>
        <button onClick={() => setShowLibrary(!showLibrary)} style={{ ...btnStyle, flex: 1 }}>
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
        <LibraryBrowser
          tools={libraryTools}
          loading={libLoading}
          onAdd={handleLoadFromLibrary}
          onDelete={handleDeleteFromLibrary}
          onRefresh={refreshLibrary}
        />
      )}

      {/* Array / Duplicate section */}
      <div style={{ marginTop: 12, marginBottom: 8, fontSize: 11, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Duplicate & Array
      </div>

      {/* Quick duplicate */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button onClick={handleDuplicate} style={{ ...btnStyle, flex: 1 }} title="Duplicate this tool (offset 10mm)">
          ⧉ Duplicate
        </button>
      </div>

      {/* Duplicate N times in a row */}
      <div style={{ marginBottom: 8, padding: 8, background: '#18181b', borderRadius: 4, border: '1px solid #3f3f46' }}>
        <div style={{ fontSize: 10, color: '#71717a', marginBottom: 4 }}>Linear repeat (copies to the right):</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="number" value={dupCount} min={1} max={50} step={1}
            onChange={(e) => setDupCount(Math.max(1, parseInt(e.target.value) || 1))}
            style={{ ...inputStyle, width: 50 }}
            title="Number of copies"
          />
          <span style={{ fontSize: 11, color: '#52525b' }}>copies</span>
          <input
            type="number" value={dupSpacing} min={0} max={50} step={0.5}
            onChange={(e) => setDupSpacing(parseFloat(e.target.value) || 0)}
            style={{ ...inputStyle, width: 50 }}
            title="Spacing between copies (mm)"
          />
          <span style={{ fontSize: 11, color: '#52525b' }}>mm gap</span>
          <button
            onClick={() => duplicateToolN(tool.id, dupCount, dupSpacing)}
            style={{ ...smallBtn, borderColor: '#7c3aed', color: '#a78bfa' }}
          >
            Create
          </button>
        </div>
      </div>

      {/* Grid array */}
      <div style={{ marginBottom: 8, padding: 8, background: '#18181b', borderRadius: 4, border: '1px solid #3f3f46' }}>
        <div style={{ fontSize: 10, color: '#71717a', marginBottom: 4 }}>Grid array (rows × columns):</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
          <input
            type="number" value={gridRows} min={1} max={20} step={1}
            onChange={(e) => setGridRows(Math.max(1, parseInt(e.target.value) || 1))}
            style={{ ...inputStyle, width: 40 }}
            title="Rows"
          />
          <span style={{ fontSize: 11, color: '#52525b' }}>×</span>
          <input
            type="number" value={gridCols} min={1} max={20} step={1}
            onChange={(e) => setGridCols(Math.max(1, parseInt(e.target.value) || 1))}
            style={{ ...inputStyle, width: 40 }}
            title="Columns"
          />
          <span style={{ fontSize: 11, color: '#52525b' }}>grid</span>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="number" value={gridSpacingX} min={0} max={50} step={0.5}
            onChange={(e) => setGridSpacingX(parseFloat(e.target.value) || 0)}
            style={{ ...inputStyle, width: 45 }}
            title="X spacing (mm)"
          />
          <span style={{ fontSize: 10, color: '#52525b' }}>X gap</span>
          <input
            type="number" value={gridSpacingY} min={0} max={50} step={0.5}
            onChange={(e) => setGridSpacingY(parseFloat(e.target.value) || 0)}
            style={{ ...inputStyle, width: 45 }}
            title="Y spacing (mm)"
          />
          <span style={{ fontSize: 10, color: '#52525b' }}>Y gap</span>
          <button
            onClick={() => arrayTool(tool.id, gridRows, gridCols, gridSpacingX, gridSpacingY)}
            disabled={gridRows < 2 && gridCols < 2}
            style={{ ...smallBtn, borderColor: '#7c3aed', color: '#a78bfa', opacity: (gridRows < 2 && gridCols < 2) ? 0.4 : 1 }}
          >
            Create
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#52525b', marginTop: 4 }}>
          Creates {(gridRows * gridCols) - 1} copies around this tool in a grid pattern.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginTop: 12, flexWrap: 'wrap' }}>
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

function LibraryBrowser({ tools, loading, onAdd, onDelete, onRefresh }: {
  tools: ToolLibrarySummary[]
  loading: boolean
  onAdd: (id: string) => void
  onDelete: (id: string) => void
  onRefresh: () => void
}) {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set(['General']))

  // Group tools by category
  const categories = useMemo(() => {
    const map = new Map<string, ToolLibrarySummary[]>()
    for (const t of tools) {
      const cat = t.category || 'General'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(t)
    }
    // Sort categories alphabetically, with General first
    const sorted = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === 'General') return -1
      if (b[0] === 'General') return 1
      return a[0].localeCompare(b[0])
    })
    return sorted
  }, [tools])

  const toggleCat = (cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const expandAll = () => setExpandedCats(new Set(categories.map(([c]) => c)))
  const collapseAll = () => setExpandedCats(new Set())

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#71717a' }}>
          {tools.length} tool{tools.length !== 1 ? 's' : ''} · {categories.length} categor{categories.length !== 1 ? 'ies' : 'y'}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={expandAll} style={{ ...smallBtn, fontSize: 9, padding: '2px 5px' }} title="Expand all">⊕</button>
          <button onClick={collapseAll} style={{ ...smallBtn, fontSize: 9, padding: '2px 5px' }} title="Collapse all">⊖</button>
          <button onClick={onRefresh} style={{ ...smallBtn, fontSize: 10, padding: '2px 6px' }} title="Refresh">↻</button>
        </div>
      </div>
      <div style={{ maxHeight: 300, overflow: 'auto' }}>
        {loading && <div style={{ fontSize: 12, color: '#71717a', padding: 4 }}>Loading...</div>}
        {!loading && tools.length === 0 && (
          <div style={{ fontSize: 12, color: '#52525b', padding: 8, textAlign: 'center' }}>
            No saved tools yet. Select a tool and click 💾 Save to add it to your library.
          </div>
        )}
        {categories.map(([cat, catTools]) => {
          const isExpanded = expandedCats.has(cat)
          return (
            <div key={cat} style={{ marginBottom: 2 }}>
              {/* Category header (folder) */}
              <div
                onClick={() => toggleCat(cat)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px',
                  borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: '#1e1b2e', border: '1px solid #3f3f46', color: '#a78bfa',
                  userSelect: 'none',
                }}
              >
                <span style={{ fontSize: 10, width: 12 }}>{isExpanded ? '▼' : '▶'}</span>
                <span>📁 {cat}</span>
                <span style={{ fontSize: 10, color: '#71717a', fontWeight: 400 }}>
                  ({catTools.length})
                </span>
              </div>
              {/* Tools in category */}
              {isExpanded && catTools.map((t) => (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '4px 6px 4px 24px', marginBottom: 1, borderRadius: 4,
                  background: '#27272a', border: '1px solid #3f3f46', fontSize: 11,
                }}>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ color: '#e4e4e7', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      🔧 {t.name}
                    </div>
                    <div style={{ color: '#71717a', fontSize: 10 }}>
                      {t.bbox_w_mm.toFixed(0)}×{t.bbox_h_mm.toFixed(0)}mm
                    </div>
                  </div>
                  <button
                    onClick={() => onAdd(t.id)}
                    style={{ ...smallBtn, fontSize: 10, padding: '2px 6px' }}
                    title="Add to workspace"
                  >
                    + Add
                  </button>
                  <button
                    onClick={() => onDelete(t.id)}
                    style={{ ...smallBtn, fontSize: 10, padding: '2px 6px', color: '#fca5a5' }}
                    title="Delete from library"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )
        })}
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


// ─── Font Selector ──────────────────────────────────────────────────────
// Loads bundled fonts from the backend and lets the user pick one.
// Stencil fonts (with bridges connecting counters) are shown first and
// tagged with a ⚔ icon; standard fonts are tagged with ✎.

function FontSelector({ value, onChange }: { value: string; onChange: (font: string) => void }) {
  const [fonts, setFonts] = useState<FontInfo[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    loadAllFonts().then(setFonts)
  }, [])

  const stencilFonts = fonts.filter((f) => f.is_stencil)
  const standardFonts = fonts.filter((f) => !f.is_stencil)
  const selected = fonts.find((f) => f.key === value)
  const selectedName = selected ? selected.name : value

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          ...inputStyle, cursor: 'pointer', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 11 }}>
          {selected?.is_stencil ? '⚔ ' : (selected ? '✎ ' : '')}
          {selectedName}
        </span>
        <span style={{ fontSize: 9, color: '#71717a' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 998 }}
          />
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999,
            maxHeight: 250, overflow: 'auto', background: '#18181b',
            border: '1px solid #3f3f46', borderRadius: 4, marginTop: 2,
          }}>
            {stencilFonts.length > 0 && (
              <>
                <div style={{ fontSize: 9, color: '#71717a', padding: '4px 8px 2px', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                  ⚔ Stencil (cutout-ready)
                </div>
                {stencilFonts.map((f) => (
                  <div
                    key={f.key}
                    onClick={() => { onChange(f.key); setOpen(false) }}
                    style={{
                      padding: '4px 8px', fontSize: 11, cursor: 'pointer',
                      background: f.key === value ? '#3b0764' : 'transparent',
                      color: f.key === value ? '#a78bfa' : '#e4e4e7',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                    }}
                    onMouseEnter={(e) => { if (f.key !== value) e.currentTarget.style.background = '#27272a' }}
                    onMouseLeave={(e) => { if (f.key !== value) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span>⚔ {f.name}</span>
                    <span style={{ fontFamily: f.css_family, fontSize: 13, color: f.key === value ? '#c4b5fd' : '#a1a1aa' }}>
                      ABC abc 123
                    </span>
                  </div>
                ))}
              </>
            )}
            {standardFonts.length > 0 && (
              <>
                <div style={{ fontSize: 9, color: '#71717a', padding: '6px 8px 2px', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, borderTop: '1px solid #3f3f46' }}>
                  ✎ Standard (raised labels)
                </div>
                {standardFonts.map((f) => (
                  <div
                    key={f.key}
                    onClick={() => { onChange(f.key); setOpen(false) }}
                    style={{
                      padding: '4px 8px', fontSize: 11, cursor: 'pointer',
                      background: f.key === value ? '#3b0764' : 'transparent',
                      color: f.key === value ? '#a78bfa' : '#e4e4e7',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                    }}
                    onMouseEnter={(e) => { if (f.key !== value) e.currentTarget.style.background = '#27272a' }}
                    onMouseLeave={(e) => { if (f.key !== value) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span>✎ {f.name}</span>
                    <span style={{ fontFamily: f.css_family, fontSize: 13, color: f.key === value ? '#c4b5fd' : '#a1a1aa' }}>
                      ABC abc 123
                    </span>
                  </div>
                ))}
              </>
            )}
            {/* System font option */}
            <div style={{ fontSize: 9, color: '#71717a', padding: '6px 8px 2px', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, borderTop: '1px solid #3f3f46' }}>
              System
            </div>
            {['Arial', 'Helvetica', 'Times New Roman', 'Courier New'].map((name) => (
              <div
                key={name}
                onClick={() => { onChange(name); setOpen(false) }}
                style={{
                  padding: '4px 8px', fontSize: 11, cursor: 'pointer',
                  background: name === value ? '#3b0764' : 'transparent',
                  color: name === value ? '#a78bfa' : '#e4e4e7',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                }}
                onMouseEnter={(e) => { if (name !== value) e.currentTarget.style.background = '#27272a' }}
                onMouseLeave={(e) => { if (name !== value) e.currentTarget.style.background = 'transparent' }}
              >
                <span>✎ {name}</span>
                <span style={{ fontFamily: name, fontSize: 13, color: name === value ? '#c4b5fd' : '#a1a1aa' }}>
                  ABC abc 123
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}


// ─── Label Editor ───────────────────────────────────────────────────────
function LabelEditor({ label, onUpdate, onDelete }: {
  label: TextLabel
  onUpdate: (updates: Partial<TextLabel>) => void
  onDelete: () => void
}) {
  return (
    <div style={{
      padding: '6px 8px', marginBottom: 4, borderRadius: 4,
      background: '#27272a', border: '1px solid #3f3f46', fontSize: 11,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ color: label.target === 'flat' ? '#60a5fa' : (label.cutout ? '#fbbf24' : '#34d399') }}>
          {label.target === 'flat' ? '📋' : (label.cutout ? '⬇' : '⬆')} {label.text || '(empty)'}
        </span>
        <button
          onClick={onDelete}
          style={{ ...smallBtn, fontSize: 10, padding: '2px 6px', color: '#fca5a5' }}
        >
          ✕
        </button>
      </div>
      <input
        type="text" value={label.text}
        placeholder="Label text"
        onChange={(e) => onUpdate({ text: e.target.value })}
        style={{ ...inputStyle, width: '100%', marginBottom: 4, fontSize: 12 }}
      />
      <div style={{ fontSize: 10, color: '#71717a', marginBottom: 2, marginTop: 4 }}>Font</div>
      <FontSelector
        value={label.font}
        onChange={(font) => onUpdate({ font })}
      />
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, marginTop: 4 }}>
        <label style={{ fontSize: 10, color: '#71717a', minWidth: 40 }}>Size:</label>
        <input
          type="number" value={label.font_size_mm} step={0.5} min={2} max={30}
          onChange={(e) => onUpdate({ font_size_mm: parseFloat(e.target.value) || 6 })}
          style={{ ...inputStyle, width: 50, fontSize: 11 }}
        />
        <label style={{ fontSize: 10, color: '#71717a', minWidth: 40 }}>Rot:</label>
        <input
          type="number" value={label.rotation_deg} step={5}
          onChange={(e) => onUpdate({ rotation_deg: parseFloat(e.target.value) || 0 })}
          style={{ ...inputStyle, width: 50, fontSize: 11 }}
        />
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <label style={{ fontSize: 10, color: '#71717a', minWidth: 40 }}>Depth:</label>
        <input
          type="number" value={label.depth_mm} step={0.1} min={0.2} max={3}
          onChange={(e) => onUpdate({ depth_mm: parseFloat(e.target.value) || 0.6 })}
          style={{ ...inputStyle, width: 50, fontSize: 11 }}
        />
        <button
          onClick={() => onUpdate({ cutout: !label.cutout })}
          style={{ ...smallBtn, fontSize: 10, padding: '2px 8px', flex: 1 }}
        >
          {label.cutout ? '⬇ Cutout' : '⬆ Raised'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 }}>
        <label style={{ fontSize: 10, color: '#71717a', minWidth: 40 }}>Target:</label>
        <button
          onClick={() => onUpdate({ target: 'tray' })}
          style={{ ...smallBtn, fontSize: 10, padding: '2px 8px', flex: 1,
            borderColor: label.target === 'tray' ? '#7c3aed' : '#3f3f46',
            background: label.target === 'tray' ? '#3b0764' : '#27272a',
            color: label.target === 'tray' ? '#a78bfa' : '#a1a1aa',
          }}
        >
          Tray
        </button>
        <button
          onClick={() => onUpdate({ target: 'flat' })}
          style={{ ...smallBtn, fontSize: 10, padding: '2px 8px', flex: 1,
            borderColor: label.target === 'flat' ? '#2563eb' : '#3f3f46',
            background: label.target === 'flat' ? '#1e3a5f' : '#27272a',
            color: label.target === 'flat' ? '#60a5fa' : '#a1a1aa',
          }}
        >
          Flat
        </button>
      </div>
    </div>
  )
}
