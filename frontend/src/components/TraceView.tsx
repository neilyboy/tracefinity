import { useState, useRef, useEffect } from 'react'
import { useEditor } from '../editor/useEditorState'
import { suggestGridSize } from '../editor/gridSnap'
import { smoothClosedPath } from '../utils/smoothPath'
import { detectToolAtPoint, listTraceEngines, mergeOutlines, retraceImage, splitOutline } from '../api/client'
import type { Point, TraceEngine, TraceEngineInfo } from '../types'

export default function TraceView() {
  const { design, setView, toggleToolVisible, setParams, addTool, deleteTool, updateTool, pushHistory, selectTools: selectEditorTools } = useEditor()
  const [addingTool, setAddingTool] = useState(false)
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([])
  const [selectedHole, setSelectedHole] = useState<number | null>(null)
  const [traceEngine, setTraceEngine] = useState<TraceEngine>(design.trace_engine ?? 'hybrid')
  const [traceEngines, setTraceEngines] = useState<TraceEngineInfo[]>([])
  const [smoothing, setSmoothing] = useState(0.3)
  const [dragVertex, setDragVertex] = useState<{ toolId: string; hole: number | null; vertex: number } | null>(null)
  const [splitting, setSplitting] = useState(false)
  const [splitStart, setSplitStart] = useState<Point | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const handleContinue = () => {
    // Auto-suggest bin grid size from detected tools.
    const { grid_w, grid_l } = suggestGridSize(design.outlines)
    setParams({ grid_w, grid_l })
    selectEditorTools(selectedToolIds)
    setView('editor')
  }

  const handleAddToolClick = () => {
    if (!design.image_filename) {
      setError('No rectified image is available for point detection.')
      return
    }
    setAddingTool(true)
    setSplitting(false)
    setSplitStart(null)
    setError(null)
  }

  useEffect(() => {
    listTraceEngines().then(setTraceEngines).catch(() => {})
  }, [])

  const imagePoint = (clientX: number, clientY: number): Point | null => {
    if (!imgRef.current) return null
    const rect = imgRef.current.getBoundingClientRect()
    return {
      x: (clientX - rect.left) * design.rectified_w_px / rect.width,
      y: (clientY - rect.top) * design.rectified_h_px / rect.height,
    }
  }

  const replacePath = (toolId: string, hole: number | null, points: Point[]) => {
    useEditor.setState((state) => ({
      design: {
        ...state.design,
        outlines: state.design.outlines.map((tool) => {
          if (tool.id !== toolId) return tool
          if (hole === null) return { ...tool, outer: points }
          return { ...tool, holes: tool.holes.map((path, index) => index === hole ? points : path) }
        }),
      },
    }))
  }

  const handleVertexMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragVertex) return
    const point = imagePoint(e.clientX, e.clientY)
    if (!point) return
    const tool = useEditor.getState().design.outlines.find((item) => item.id === dragVertex.toolId)
    if (!tool) return
    const path = dragVertex.hole === null ? tool.outer : tool.holes[dragVertex.hole]
    if (!path) return
    replacePath(dragVertex.toolId, dragVertex.hole, path.map((item, index) => (
      index === dragVertex.vertex
        ? { x: point.x * design.scale_mm_per_px, y: point.y * design.scale_mm_per_px }
        : item
    )))
  }

  const handleRetrace = async () => {
    if (!design.image_filename) return
    setDetecting(true)
    setError(null)
    try {
      const result = await retraceImage(
        `/data/images/${design.image_filename}`,
        design.scale_mm_per_px,
        traceEngine,
        smoothing,
      )
      pushHistory()
      useEditor.setState((state) => ({
        design: { ...state.design, outlines: result.outlines, trace_engine: result.trace_engine },
      }))
      setSelectedToolId(null)
      setSelectedToolIds([])
      setSelectedHole(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-trace failed')
    } finally {
      setDetecting(false)
    }
  }

  const selectTool = (toolId: string, additive = false) => {
    const next = additive
      ? selectedToolIds.includes(toolId)
        ? selectedToolIds.filter((id) => id !== toolId)
        : [...selectedToolIds, toolId]
      : [toolId]
    setSelectedToolIds(next)
    setSelectedToolId(next.includes(toolId) ? toolId : next[0] ?? null)
    setSelectedHole(null)
  }

  const handleMerge = async () => {
    const selected = design.outlines.filter((tool) => selectedToolIds.includes(tool.id))
    if (selected.length < 2) return
    setDetecting(true)
    setError(null)
    try {
      const merged = await mergeOutlines(selected)
      pushHistory()
      useEditor.setState((state) => ({
        design: {
          ...state.design,
          outlines: [...state.design.outlines.filter((tool) => !selectedToolIds.includes(tool.id)), merged],
        },
      }))
      setSelectedToolId(merged.id)
      setSelectedToolIds([merged.id])
      setSelectedHole(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed')
    } finally {
      setDetecting(false)
    }
  }

  const handleAddHole = () => {
    if (!selectedToolId) return
    const tool = design.outlines.find((item) => item.id === selectedToolId)
    if (!tool) return
    const xs = tool.outer.map((point) => point.x)
    const ys = tool.outer.map((point) => point.y)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const rx = Math.max(2, (Math.max(...xs) - Math.min(...xs)) * 0.12)
    const ry = Math.max(2, (Math.max(...ys) - Math.min(...ys)) * 0.12)
    const hole = Array.from({ length: 20 }, (_, index) => {
      const angle = index / 20 * Math.PI * 2
      return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry }
    })
    updateTool(tool.id, { holes: [...tool.holes, hole] })
    setSelectedHole(tool.holes.length)
  }

  // Escape key cancels tool-adding mode
  useEffect(() => {
    if (!addingTool && !splitting) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAddingTool(false)
        setSplitting(false)
        setSplitStart(null)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [addingTool, splitting])

  const handleImageClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if ((!addingTool && !splitting) || !imgRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    const scaleX = design.rectified_w_px / rect.width
    const scaleY = design.rectified_h_px / rect.height
    const clickX = Math.round((e.clientX - rect.left) * scaleX)
    const clickY = Math.round((e.clientY - rect.top) * scaleY)

    if (splitting) {
      const point = { x: clickX * design.scale_mm_per_px, y: clickY * design.scale_mm_per_px }
      if (!splitStart) {
        setSplitStart(point)
        return
      }
      const tool = design.outlines.find((item) => item.id === selectedToolId)
      if (!tool) return
      setDetecting(true)
      setError(null)
      try {
        const pieces = await splitOutline(tool, splitStart, point)
        pushHistory()
        useEditor.setState((state) => ({
          design: {
            ...state.design,
            outlines: [...state.design.outlines.filter((item) => item.id !== tool.id), ...pieces],
          },
        }))
        setSelectedToolId(pieces[0]?.id ?? null)
        setSelectedToolIds(pieces.map((piece) => piece.id))
        setSelectedHole(null)
        setSplitting(false)
        setSplitStart(null)
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Split failed')
      } finally {
        setDetecting(false)
      }
      return
    }

    setAddingTool(false)
    setDetecting(true)
    setError(null)
    try {
      const imageUrl = design.image_filename ? `/data/images/${design.image_filename}` : ''
      const outline = await detectToolAtPoint(imageUrl, design.scale_mm_per_px, clickX, clickY, traceEngine)
      addTool(outline)
      setSelectedToolId(outline.id)
      setSelectedToolIds([outline.id])
      setSelectedHole(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Detection failed')
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <select
            value={traceEngine}
            onChange={(e) => setTraceEngine(e.target.value as TraceEngine)}
            style={selectStyle}
          >
            {(traceEngines.length ? traceEngines : [{ id: 'hybrid' as TraceEngine, name: 'Hybrid OpenCV', available: true, ready: true, description: '' }]).map((engine) => (
              <option key={engine.id} value={engine.id} disabled={!engine.available}>
                {engine.name}{engine.id === 'fastsam' && !engine.ready ? ' (first use downloads weights)' : ''}
              </option>
            ))}
          </select>
          <label style={{ color: '#a1a1aa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            Smooth
            <input type="range" min={0} max={1} step={0.05} value={smoothing} onChange={(e) => setSmoothing(Number(e.target.value))} />
            {smoothing.toFixed(2)}
          </label>
          <button onClick={handleRetrace} disabled={detecting} style={btnStyle}>Re-trace</button>
          <button onClick={() => setView('calibrate')} style={btnStyle}>← Back</button>
          <button
            onClick={handleAddToolClick}
            disabled={detecting || !design.image_filename}
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

      {(addingTool || splitting) && (
        <div style={{
          background: '#1e1b4b', border: '1px solid #7c3aed', borderRadius: 8,
          padding: '8px 16px', color: '#c4b5fd', fontSize: 13,
        }}>
          {addingTool
            ? 'Click a tool in the image to trace it. Press Escape to cancel.'
            : splitStart
              ? 'Click the opposite side of the selected path to finish the cut line.'
              : 'Click just outside one side of the selected path, then click outside the opposite side.'}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flex: 1, overflow: 'hidden' }}>
        {/* Rectified image with outline overlays */}
        <div style={{ flex: 1, background: '#18181b', borderRadius: 8, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: 12 }}>
          <div
            style={{ position: 'relative' }}
            onPointerMove={handleVertexMove}
            onPointerUp={() => {
              if (dragVertex) pushHistory()
              setDragVertex(null)
            }}
          >
            <img
              ref={imgRef}
              src={design.image_filename ? `/data/images/${design.image_filename}` : ''}
              alt="rectified"
              onClick={handleImageClick}
              style={{
                display: 'block', maxWidth: '100%',
                cursor: addingTool || splitting ? 'crosshair' : 'default',
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
              {splitStart && (
                <circle
                  cx={splitStart.x / design.scale_mm_per_px}
                  cy={splitStart.y / design.scale_mm_per_px}
                  r={7}
                  fill="#f97316"
                  stroke="#ffffff"
                  strokeWidth={2}
                />
              )}
              {design.outlines.map((tool) => {
                const scale = design.scale_mm_per_px
                const selected = selectedToolIds.includes(tool.id)
                const outerPx = tool.outer.map((point) => ({ x: point.x / scale, y: point.y / scale }))
                const paths = [tool.outer, ...tool.holes]
                return (
                  <g key={tool.id}>
                    <path
                      d={smoothClosedPath(outerPx, tool.smoothing)}
                      fill={tool.visible ? (selected ? 'rgba(34,197,94,0.18)' : 'rgba(124,58,237,0.2)') : 'none'}
                      stroke={tool.visible ? (selected ? '#22c55e' : '#a78bfa') : '#52525b'}
                      strokeWidth={selected ? 4 : 3}
                      style={{ pointerEvents: addingTool || splitting ? 'none' : 'all', cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); selectTool(tool.id, e.ctrlKey || e.metaKey) }}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        const point = imagePoint(e.clientX, e.clientY)
                        if (!point) return
                        let best = 0
                        let distance = Infinity
                        outerPx.forEach((item, index) => {
                          const next = outerPx[(index + 1) % outerPx.length]
                          const d = Math.hypot(point.x - (item.x + next.x) / 2, point.y - (item.y + next.y) / 2)
                          if (d < distance) { distance = d; best = index }
                        })
                        const added = { x: point.x * scale, y: point.y * scale }
                        updateTool(tool.id, { outer: [...tool.outer.slice(0, best + 1), added, ...tool.outer.slice(best + 1)] })
                      }}
                    />
                    {tool.holes.map((hole, holeIndex) => (
                      <path
                        key={`hole-${holeIndex}`}
                        d={smoothClosedPath(hole.map((point) => ({ x: point.x / scale, y: point.y / scale })), tool.smoothing)}
                        fill="rgba(15,17,21,0.72)"
                        stroke={selected && selectedHole === holeIndex ? '#f97316' : '#ef4444'}
                        strokeWidth={selected && selectedHole === holeIndex ? 4 : 3}
                        style={{ pointerEvents: addingTool || splitting ? 'none' : 'all', cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); selectTool(tool.id); setSelectedHole(holeIndex) }}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          const point = imagePoint(e.clientX, e.clientY)
                          if (!point) return
                          const holePx = hole.map((item) => ({ x: item.x / scale, y: item.y / scale }))
                          let best = 0
                          let distance = Infinity
                          holePx.forEach((item, index) => {
                            const next = holePx[(index + 1) % holePx.length]
                            const d = Math.hypot(point.x - (item.x + next.x) / 2, point.y - (item.y + next.y) / 2)
                            if (d < distance) { distance = d; best = index }
                          })
                          const added = { x: point.x * scale, y: point.y * scale }
                          const holes = tool.holes.map((path, index) => index === holeIndex
                            ? [...path.slice(0, best + 1), added, ...path.slice(best + 1)]
                            : path)
                          updateTool(tool.id, { holes })
                        }}
                      />
                    ))}
                    {selectedToolId === tool.id && paths[selectedHole === null ? 0 : selectedHole + 1]?.map((point, vertex) => (
                      <circle
                        key={`vertex-${selectedHole ?? 'outer'}-${vertex}`}
                        cx={point.x / scale}
                        cy={point.y / scale}
                        r={5}
                        fill={selectedHole === null ? '#22c55e' : '#f97316'}
                        stroke="#ffffff"
                        strokeWidth={1.5}
                        style={{ pointerEvents: addingTool || splitting ? 'none' : 'all', cursor: 'grab' }}
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          pushHistory()
                          setDragVertex({ toolId: tool.id, hole: selectedHole, vertex })
                          ;(e.target as Element).setPointerCapture(e.pointerId)
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          const path = selectedHole === null ? tool.outer : tool.holes[selectedHole]
                          if (path.length <= 3) return
                          pushHistory()
                          replacePath(tool.id, selectedHole, path.filter((_, index) => index !== vertex))
                          pushHistory()
                        }}
                      />
                    ))}
                  </g>
                )
              })}
            </svg>
          </div>
        </div>

        {/* Tool list */}
        <div style={{ width: 280, background: '#18181b', borderRadius: 8, padding: 12, overflow: 'auto' }}>
          <h3 style={{ fontSize: 14, color: '#a1a1aa', marginTop: 0, marginBottom: 4 }}>Tools</h3>
          <div style={{ color: '#71717a', fontSize: 11, marginBottom: 10 }}>Ctrl/Cmd-click multiple paths to merge split detections.</div>
          {design.outlines.length === 0 && (
            <p style={{ color: '#71717a', fontSize: 13 }}>
              No tools detected automatically. Click <strong>+ Add Tool</strong> then click on a tool in the image to trace it.
            </p>
          )}
          {design.outlines.map((tool, i) => (
            <div
              key={tool.id}
              onClick={(e) => selectTool(tool.id, e.ctrlKey || e.metaKey)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', marginBottom: 6, borderRadius: 6, cursor: 'pointer',
                background: tool.visible ? '#27272a' : '#18181b',
                border: `1px solid ${selectedToolIds.includes(tool.id) ? '#22c55e' : tool.visible ? '#3f3f46' : '#27272a'}`,
              }}
            >
              <span style={{ fontSize: 13 }}>Tool {i + 1}</span>
              <button
                onClick={(e) => { e.stopPropagation(); toggleToolVisible(tool.id) }}
                style={{ background: 'none', border: 'none', color: tool.visible ? '#a78bfa' : '#52525b', cursor: 'pointer', fontSize: 16 }}
                title={tool.visible ? 'Hide' : 'Show'}
              >
                {tool.visible ? '👁' : '🚫'}
              </button>
            </div>
          ))}
          {selectedToolIds.length > 1 && (
            <button onClick={handleMerge} disabled={detecting} style={{ ...btnStyle, width: '100%', marginTop: 8 }}>
              Merge {selectedToolIds.length} selected paths
            </button>
          )}
          {selectedToolId && (() => {
            const tool = design.outlines.find((item) => item.id === selectedToolId)
            if (!tool) return null
            return (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #3f3f46', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <strong style={{ fontSize: 13 }}>Path editing</strong>
                <div style={{ color: '#a1a1aa', fontSize: 12 }}>
                  Drag points to adjust the path. Double-click a point to remove it or double-click the selected outer or hole edge to add one.
                </div>
                <select
                  value={selectedHole === null ? 'outer' : String(selectedHole)}
                  onChange={(e) => setSelectedHole(e.target.value === 'outer' ? null : Number(e.target.value))}
                  style={selectStyle}
                >
                  <option value="outer">Outer boundary</option>
                  {tool.holes.map((_, index) => <option key={index} value={index}>Hole {index + 1}</option>)}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#a1a1aa', fontSize: 12 }}>
                  Curve
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={tool.smoothing}
                    onPointerDown={pushHistory}
                    onChange={(e) => {
                      const value = Number(e.target.value)
                      useEditor.setState((state) => ({
                        design: {
                          ...state.design,
                          outlines: state.design.outlines.map((item) => item.id === tool.id ? { ...item, smoothing: value } : item),
                        },
                      }))
                    }}
                    onPointerUp={pushHistory}
                  />
                  {tool.smoothing.toFixed(2)}
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <button onClick={handleAddHole} style={btnStyle}>Add hole</button>
                  <button
                    onClick={() => {
                      if (selectedHole === null) return
                      updateTool(tool.id, { holes: tool.holes.filter((_, index) => index !== selectedHole) })
                      setSelectedHole(null)
                    }}
                    disabled={selectedHole === null}
                    style={{ ...btnStyle, opacity: selectedHole === null ? 0.45 : 1 }}
                  >
                    Remove hole
                  </button>
                </div>
                <button
                  disabled={detecting}
                  onClick={() => {
                    setSplitting(!splitting)
                    setSplitStart(null)
                    setAddingTool(false)
                  }}
                  style={{ ...btnStyle, borderColor: splitting ? '#f97316' : '#3f3f46', color: splitting ? '#fdba74' : '#e4e4e7' }}
                >
                  {splitting ? (splitStart ? 'Click the other side of the cut' : 'Click one side of the cut') : 'Split with a cut line'}
                </button>
                <button
                  onClick={() => { deleteTool(tool.id); setSelectedToolId(null); setSelectedToolIds([]); setSelectedHole(null) }}
                  style={{ ...btnStyle, borderColor: '#7f1d1d', color: '#fca5a5' }}
                >
                  Delete tool
                </button>
              </div>
            )
          })()}
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
const selectStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 6, border: '1px solid #3f3f46',
  background: '#27272a', color: '#e4e4e7', fontSize: 13,
}
const primaryBtn: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 6, border: 'none',
  background: '#7c3aed', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 600,
}
