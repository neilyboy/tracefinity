import { useState } from 'react'
import { useBaseplate } from '../editor/useBaseplateState'
import { useEditor } from '../editor/useEditorState'
import BaseplateEditor from './BaseplateEditor'
import BaseplateParamsPanel from './BaseplateParamsPanel'
import BaseplateExportBar from './BaseplateExportBar'
import { Home, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

export default function BaseplateView() {
  const { reset } = useBaseplate()
  const [leftOpen, setLeftOpen] = useState(true)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Top toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
        borderBottom: '1px solid #27272a', background: '#18181b', flexShrink: 0,
      }}>
        <button onClick={() => {
          reset()
          useEditor.getState().setView('upload')
        }} style={iconBtn} title="Home">
          <Home size={16} />
        </button>
        <span style={{ fontSize: 13, color: '#71717a', marginLeft: 4 }}>Baseplate Designer</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => setLeftOpen(!leftOpen)} style={iconBtn} title="Toggle parameters panel">
          {leftOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </div>

      {/* Main area: left panel | SVG canvas */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {leftOpen && (
          <div style={{
            width: 260, borderRight: '1px solid #27272a', background: '#18181b',
            overflow: 'auto', flexShrink: 0,
          }}>
            <BaseplateParamsPanel />
          </div>
        )}

        {/* Center: SVG editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <BaseplateEditor />
        </div>
      </div>

      {/* Bottom: Export bar */}
      <BaseplateExportBar />
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 32, borderRadius: 4, border: '1px solid #3f3f46',
  background: '#27272a', color: '#a1a1aa', cursor: 'pointer',
}
