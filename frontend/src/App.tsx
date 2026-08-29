import { useState } from 'react'
import { useEditor } from './editor/useEditorState'
import UploadPanel from './components/UploadPanel'
import CalibrateView from './components/CalibrateView'
import TraceView from './components/TraceView'
import EditorView from './components/EditorView'
import BaseplateView from './components/BaseplateView'

export default function App() {
  const view = useEditor((s) => s.view)
  const error = useEditor((s) => s.error)
  const setError = useEditor((s) => s.setError)
  const [appMode, setAppMode] = useState<'tray' | 'baseplate'>('tray')

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px',
        borderBottom: '1px solid #27272a', background: '#18181b',
      }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: '#a78bfa' }}>Tracefinity</span>
        <span style={{ fontSize: 12, color: '#71717a' }}>photo → gridfinity</span>
        <span style={{ flex: 1 }} />
        {/* Top-level mode tabs */}
        <div style={{ display: 'flex', gap: 2, background: '#27272a', borderRadius: 6, padding: 2 }}>
          <button
            onClick={() => setAppMode('tray')}
            style={tabBtn(appMode === 'tray')}
          >
            📐 Tray Designer
          </button>
          <button
            onClick={() => setAppMode('baseplate')}
            style={tabBtn(appMode === 'baseplate')}
          >
            🔳 Baseplate Designer
          </button>
        </div>
      </header>

      {error && (
        <div style={{
          margin: 8, padding: '8px 12px', background: '#450a0a', color: '#fca5a5',
          borderRadius: 6, fontSize: 14, display: 'flex', justifyContent: 'space-between',
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      <main style={{ flex: 1, overflow: 'hidden' }}>
        {appMode === 'baseplate' ? (
          <BaseplateView />
        ) : (
          <>
            {view === 'upload' && <UploadPanel onSwitchToBaseplate={() => setAppMode('baseplate')} />}
            {view === 'calibrate' && <CalibrateView />}
            {view === 'trace' && <TraceView />}
            {view === 'editor' && <EditorView />}
          </>
        )}
      </main>
    </div>
  )
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: '5px 14px', borderRadius: 4, border: 'none', fontSize: 13, cursor: 'pointer',
    background: active ? '#7c3aed' : 'transparent',
    color: active ? 'white' : '#a1a1aa', fontWeight: active ? 600 : 400,
    transition: 'all 0.15s',
  }
}
