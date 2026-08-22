import { useEditor } from './editor/useEditorState'
import UploadPanel from './components/UploadPanel'
import CalibrateView from './components/CalibrateView'
import TraceView from './components/TraceView'
import EditorView from './components/EditorView'

export default function App() {
  const view = useEditor((s) => s.view)
  const error = useEditor((s) => s.error)
  const setError = useEditor((s) => s.setError)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px',
        borderBottom: '1px solid #27272a', background: '#18181b',
      }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: '#a78bfa' }}>Tracefinity</span>
        <span style={{ fontSize: 12, color: '#71717a' }}>photo → gridfinity</span>
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
        {view === 'upload' && <UploadPanel />}
        {view === 'calibrate' && <CalibrateView />}
        {view === 'trace' && <TraceView />}
        {view === 'editor' && <EditorView />}
      </main>
    </div>
  )
}
