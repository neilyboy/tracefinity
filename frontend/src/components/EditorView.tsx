import { useEffect, useState } from 'react'
import { useEditor } from '../editor/useEditorState'
import SvgEditor from './SvgEditor'
import BinParamsPanel from './BinParamsPanel'
import ToolPropsPanel from './ToolPropsPanel'
import ExportBar from './ExportBar'
import { Undo2, Redo2, Home, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { loadAllFonts } from '../editor/fontLoader'

export default function EditorView() {
  const { undo, redo, reset, history, historyIndex } = useEditor()
  const canUndo = historyIndex > 0
  const canRedo = historyIndex < history.length - 1
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)

  // Load all bundled fonts on mount — injects @font-face CSS so SVG text
  // elements can use the actual font files for accurate preview rendering.
  useEffect(() => {
    loadAllFonts()
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Editor toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
        borderBottom: '1px solid #27272a', background: '#18181b', flexShrink: 0,
      }}>
        <button onClick={() => reset()} style={iconBtn} title="New / Upload">
          <Home size={16} />
        </button>
        <button onClick={undo} disabled={!canUndo} style={{ ...iconBtn, opacity: canUndo ? 1 : 0.3 }} title="Undo">
          <Undo2 size={16} />
        </button>
        <button onClick={redo} disabled={!canRedo} style={{ ...iconBtn, opacity: canRedo ? 1 : 0.3 }} title="Redo">
          <Redo2 size={16} />
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={() => setLeftOpen(!leftOpen)} style={iconBtn} title="Toggle bin parameters panel">
          {leftOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <button onClick={() => setRightOpen(!rightOpen)} style={iconBtn} title="Toggle tool properties panel">
          {rightOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>

      {/* Main editor area: left panel | SVG canvas | right panel */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Left: Bin params */}
        {leftOpen && (
          <div style={{
            width: 260, borderRight: '1px solid #27272a', background: '#18181b',
            overflow: 'auto', flexShrink: 0,
          }}>
            <BinParamsPanel />
          </div>
        )}

        {/* Center: SVG editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <SvgEditor />
        </div>

        {/* Right: Tool props */}
        {rightOpen && (
          <div style={{
            width: 240, borderLeft: '1px solid #27272a', background: '#18181b',
            overflow: 'auto', flexShrink: 0,
          }}>
            <ToolPropsPanel />
          </div>
        )}
      </div>

      {/* Bottom: Export bar — always visible, pinned */}
      <ExportBar />
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 32, borderRadius: 4, border: '1px solid #3f3f46',
  background: '#27272a', color: '#a1a1aa', cursor: 'pointer',
}
