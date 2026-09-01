import { useState, useRef, useEffect } from 'react'
import { useEditor } from '../editor/useEditorState'
import { useBaseplate } from '../editor/useBaseplateState'
import {
  listDesigns, loadDesign, deleteDesign, listBaseplateDesigns, loadBaseplateDesign, deleteBaseplateDesign,
  listFolders, createFolder, renameFolder, deleteFolder, moveDesignToFolder, moveBaseplateToFolder,
  renameDesign, renameBaseplate, exportFolderTree, importFolderTree,
  downloadBlob,
} from '../api/client'
import type { ProjectSummary, FolderSummary } from '../types'

interface Props {
  onSwitchToBaseplate?: () => void
}

export default function ProjectBrowser({ onSwitchToBaseplate }: Props) {
  const { setLoading, setError, setDesign, setView } = useEditor()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [folders, setFolders] = useState<FolderSummary[]>([])
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameFolderValue, setRenameFolderValue] = useState('')
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null) // project being moved
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    refresh()
  }, [])

  const refresh = async () => {
    try {
      const [trays, baseplates, flds] = await Promise.all([listDesigns(), listBaseplateDesigns(), listFolders()])
      const merged: ProjectSummary[] = [
        ...trays.map((d) => ({ ...d, type: 'tray' as const })),
        ...baseplates.map((d) => ({ ...d, type: 'baseplate' as const, thumbnail_url: null, folder_id: d.folder_id ?? null })),
      ]
      merged.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      setProjects(merged)
      setFolders(flds)
    } catch {
      // ignore
    }
  }

  // --- Folder helpers ---

  const childFolders = (parentId: string | null) =>
    folders.filter((f) => f.parent_id === parentId).sort((a, b) => a.name.localeCompare(b.name))

  const projectsInFolder = (folderId: string | null) =>
    projects.filter((p) => p.folder_id === folderId)

  const toggleExpand = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  // --- Actions ---

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
      if (project.type === 'tray') await deleteDesign(project.id)
      else await deleteBaseplateDesign(project.id)
      setProjects((prev) => prev.filter((p) => p.id !== project.id))
      setDeletingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
      setDeletingId(null)
    }
  }

  const handleDeleteFolder = async (folderId: string) => {
    try {
      await deleteFolder(folderId)
      await refresh()
      setDeletingFolderId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete folder failed')
      setDeletingFolderId(null)
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      await createFolder(newFolderName.trim(), newFolderParent)
      await refresh()
      // Auto-expand parent so the new folder is visible
      if (newFolderParent) {
        setExpandedFolders((prev) => new Set(prev).add(newFolderParent))
      }
      setShowNewFolderDialog(false)
      setNewFolderName('')
      setNewFolderParent(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create folder failed')
    }
  }

  const handleRenameFolder = async (folderId: string) => {
    if (!renameFolderValue.trim()) return
    try {
      await renameFolder(folderId, renameFolderValue.trim())
      await refresh()
      setRenamingFolderId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename folder failed')
    }
  }

  const handleRenameProject = async (project: ProjectSummary) => {
    if (!renameValue.trim()) return
    try {
      if (project.type === 'tray') await renameDesign(project.id, renameValue.trim())
      else await renameBaseplate(project.id, renameValue.trim())
      setProjects((prev) => prev.map((p) => p.id === project.id ? { ...p, name: renameValue.trim() } : p))
      setRenamingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed')
    }
  }

  const handleMoveProject = async (project: ProjectSummary, targetFolderId: string | null) => {
    try {
      if (project.type === 'tray') await moveDesignToFolder(project.id, targetFolderId)
      else await moveBaseplateToFolder(project.id, targetFolderId)
      setProjects((prev) => prev.map((p) => p.id === project.id ? { ...p, folder_id: targetFolderId } : p))
      setMovingId(null)
      // Auto-expand target folder so the moved project is visible
      if (targetFolderId) {
        setExpandedFolders((prev) => new Set(prev).add(targetFolderId))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Move failed')
      setMovingId(null)
    }
  }

  const handleExportProject = async (project: ProjectSummary) => {
    setLoading(true)
    setError(null)
    try {
      let design: any
      if (project.type === 'tray') design = await loadDesign(project.id)
      else design = await loadBaseplateDesign(project.id)
      const exportData = { type: project.type, version: 1, exported_at: new Date().toISOString(), design }
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const safeName = (project.name || 'untitled').replace(/[^a-zA-Z0-9_-]/g, '_')
      downloadBlob(blob, `${safeName}.tracefinity.json`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setLoading(false)
    }
  }

  const handleExportFolder = async (folderId: string) => {
    setLoading(true)
    setError(null)
    try {
      const tree = await exportFolderTree(folderId)
      const blob = new Blob([JSON.stringify(tree, null, 2)], { type: 'application/json' })
      const folder = folders.find((f) => f.id === folderId)
      const safeName = (folder?.name || 'folder').replace(/[^a-zA-Z0-9_-]/g, '_')
      downloadBlob(blob, `${safeName}.tracefinity.json`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export folder failed')
    } finally {
      setLoading(false)
    }
  }

  const handleImportFile = async (file: File) => {
    setLoading(true)
    setError(null)
    try {
      const text = await file.text()
      const data = JSON.parse(text)

      if (data.type === 'folder') {
        // Folder tree import — goes through backend
        await importFolderTree(data, null)
        await refresh()
      } else if (data.type === 'tray' || data.type === 'baseplate') {
        // Single project import — load into editor
        const design = data.design
        design.id = null
        if (!design.name.endsWith(' (imported)')) design.name = `${design.name || 'Imported'} (imported)`
        if (data.type === 'tray') {
          setDesign(design)
          setView('editor')
        } else {
          useBaseplate.setState({
            design,
            history: [JSON.parse(JSON.stringify(design))],
            historyIndex: 0,
            selectedCutoutId: null,
          })
          onSwitchToBaseplate?.()
        }
      } else {
        throw new Error('Invalid file format: unknown type')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  // --- Render helpers ---

  const renderProjectRow = (p: ProjectSummary, indent: number) => {
    if (renamingId === p.id) {
      return (
        <div key={p.id} style={{ ...rowStyle, paddingLeft: 12 + indent * 20 }}>
          <input
            type="text" value={renameValue} autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRenameProject(p); if (e.key === 'Escape') setRenamingId(null) }}
            onBlur={() => handleRenameProject(p)}
            style={{ flex: 1, background: '#18181b', border: '1px solid #7c3aed', borderRadius: 4, color: '#e4e4e7', fontSize: 13, padding: '4px 8px' }}
          />
        </div>
      )
    }

    if (movingId === p.id) {
      // Show move-to-folder dropdown
      const availableFolders = folders.filter((f) => f.id !== p.folder_id)
      return (
        <div key={p.id} style={{ ...rowStyle, paddingLeft: 12 + indent * 20, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <div style={{ fontSize: 12, color: '#a1a1aa' }}>Move "{p.name}" to:</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button onClick={() => handleMoveProject(p, null)} style={moveBtnStyle}>Root</button>
            {availableFolders.map((f) => (
              <button key={f.id} onClick={() => handleMoveProject(p, f.id)} style={moveBtnStyle}>{f.name}</button>
            ))}
          </div>
          <button onClick={() => setMovingId(null)} style={{ ...moveBtnStyle, borderColor: '#3f3f46', color: '#71717a' }}>Cancel</button>
        </div>
      )
    }

    return (
      <div key={p.id} style={{ ...rowStyle, paddingLeft: 12 + indent * 20 }}
        onMouseEnter={(e) => { if (deletingId !== p.id) e.currentTarget.style.borderColor = '#7c3aed' }}
        onMouseLeave={(e) => { if (deletingId !== p.id) e.currentTarget.style.borderColor = '#3f3f46' }}
      >
        {deletingId === p.id ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
            <span style={{ fontSize: 13, color: '#fca5a5' }}>Delete "{p.name}"?</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => handleDeleteProject(p)} style={confirmDeleteBtnStyle}>Yes, delete</button>
            <button onClick={() => setDeletingId(null)} style={cancelBtnStyle}>Cancel</button>
          </div>
        ) : (
          <>
            <div onClick={() => handleLoadProject(p)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1, minWidth: 0 }}>
              <span style={badgeStyle(p.type)}>{p.type === 'tray' ? '📐 Tray' : '🔳 Base'}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                <div style={{ fontSize: 11, color: '#71717a' }}>{new Date(p.updated_at).toLocaleDateString()} {new Date(p.updated_at).toLocaleTimeString()}</div>
              </div>
            </div>
            {/* Action buttons */}
            <button onClick={(e) => { e.stopPropagation(); setMovingId(p.id) }} title="Move to folder" style={iconBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.borderColor = '#7c3aed' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.borderColor = '#3f3f46' }}>📁</button>
            <button onClick={(e) => { e.stopPropagation(); setRenamingId(p.id); setRenameValue(p.name) }} title="Rename" style={iconBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.borderColor = '#7c3aed' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.borderColor = '#3f3f46' }}>✏️</button>
            <button onClick={(e) => { e.stopPropagation(); handleExportProject(p) }} title="Export as .json" style={iconBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.borderColor = '#7c3aed' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.borderColor = '#3f3f46' }}>📤</button>
            <button onClick={(e) => { e.stopPropagation(); setDeletingId(p.id) }} title="Delete" style={{ ...iconBtnStyle, marginRight: 8 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#fca5a5'; e.currentTarget.style.borderColor = '#dc2626' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.borderColor = '#3f3f46' }}>🗑</button>
            <span onClick={() => handleLoadProject(p)} style={{ fontSize: 18, color: '#71717a', cursor: 'pointer' }}>→</span>
          </>
        )}
      </div>
    )
  }

  const renderFolder = (folder: FolderSummary, indent: number) => {
    const isExpanded = expandedFolders.has(folder.id)
    const childFolds = childFolders(folder.id)
    const childProjs = projectsInFolder(folder.id)

    return (
      <div key={folder.id}>
        <div style={{ ...rowStyle, paddingLeft: 8 + indent * 20 }}
          onMouseEnter={(e) => { if (deletingFolderId !== folder.id && renamingFolderId !== folder.id) e.currentTarget.style.borderColor = '#f59e0b' }}
          onMouseLeave={(e) => { if (deletingFolderId !== folder.id && renamingFolderId !== folder.id) e.currentTarget.style.borderColor = '#3f3f46' }}
        >
          {deletingFolderId === folder.id ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
              <span style={{ fontSize: 13, color: '#fca5a5' }}>Delete folder "{folder.name}"? (projects inside move to root)</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => handleDeleteFolder(folder.id)} style={confirmDeleteBtnStyle}>Yes, delete</button>
              <button onClick={() => setDeletingFolderId(null)} style={cancelBtnStyle}>Cancel</button>
            </div>
          ) : renamingFolderId === folder.id ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
              <input type="text" value={renameFolderValue} autoFocus
                onChange={(e) => setRenameFolderValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameFolder(folder.id); if (e.key === 'Escape') setRenamingFolderId(null) }}
                onBlur={() => handleRenameFolder(folder.id)}
                style={{ flex: 1, background: '#18181b', border: '1px solid #f59e0b', borderRadius: 4, color: '#e4e4e7', fontSize: 13, padding: '4px 8px' }}
              />
            </div>
          ) : (
            <>
              <div onClick={() => toggleExpand(folder.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, color: '#71717a', width: 16 }}>{isExpanded ? '▼' : '▶'}</span>
                <span style={{ fontSize: 18 }}>📁</span>
                <span style={{ fontSize: 14, color: '#f59e0b', fontWeight: 600 }}>{folder.name}</span>
                <span style={{ fontSize: 11, color: '#71717a' }}>({childFolds.length + childProjs.length})</span>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setShowNewFolderDialog(true); setNewFolderParent(folder.id); setNewFolderName('') }} title="New subfolder" style={iconBtnStyle}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.borderColor = '#7c3aed' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.borderColor = '#3f3f46' }}>➕</button>
              <button onClick={(e) => { e.stopPropagation(); setRenamingFolderId(folder.id); setRenameFolderValue(folder.name) }} title="Rename folder" style={iconBtnStyle}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.borderColor = '#7c3aed' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.borderColor = '#3f3f46' }}>✏️</button>
              <button onClick={(e) => { e.stopPropagation(); handleExportFolder(folder.id) }} title="Export folder tree" style={iconBtnStyle}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#a78bfa'; e.currentTarget.style.borderColor = '#7c3aed' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.borderColor = '#3f3f46' }}>📤</button>
              <button onClick={(e) => { e.stopPropagation(); setDeletingFolderId(folder.id) }} title="Delete folder" style={{ ...iconBtnStyle, marginRight: 8 }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#fca5a5'; e.currentTarget.style.borderColor = '#dc2626' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.borderColor = '#3f3f46' }}>🗑</button>
            </>
          )}
        </div>
        {isExpanded && (
          <div>
            {childFolds.map((cf) => renderFolder(cf, indent + 1))}
            {childProjs.map((p) => renderProjectRow(p, indent + 1))}
            {childFolds.length === 0 && childProjs.length === 0 && (
              <div style={{ paddingLeft: 20 + indent * 20, paddingBlock: 6, fontSize: 12, color: '#52525b', fontStyle: 'italic' }}>Empty folder</div>
            )}
          </div>
        )}
      </div>
    )
  }

  // --- Main render ---

  const rootFolders = childFolders(null)
  const rootProjects = projectsInFolder(null)
  const totalCount = projects.length

  return (
    <div style={{ width: 680, background: '#18181b', borderRadius: 12, padding: 16, border: '1px solid #3f3f46' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, color: '#a1a1aa', margin: 0 }}>Saved Projects {totalCount > 0 && `(${totalCount})`}</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => { setShowNewFolderDialog(true); setNewFolderParent(null); setNewFolderName('') }}
            style={headerBtnStyle}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.color = '#a78bfa' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#3f3f46'; e.currentTarget.style.color = '#a1a1aa' }}>
            📁 New Folder
          </button>
          <button onClick={() => importRef.current?.click()}
            style={headerBtnStyle}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.color = '#a78bfa' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#3f3f46'; e.currentTarget.style.color = '#a1a1aa' }}>
            📥 Import
          </button>
        </div>
      </div>

      {/* Hidden import file input */}
      <input ref={importRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = '' }} />

      {/* Tree */}
      {totalCount === 0 && rootFolders.length === 0 ? (
        <p style={{ color: '#52525b', fontSize: 13, textAlign: 'center', padding: 20 }}>
          No saved projects yet. Create a tray or baseplate and click Save in the editor to save it.
        </p>
      ) : (
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
          {/* Root-level folders */}
          {rootFolders.map((f) => renderFolder(f, 0))}
          {/* Root-level projects */}
          {rootProjects.map((p) => renderProjectRow(p, 0))}
        </div>
      )}

      {/* New folder dialog */}
      {showNewFolderDialog && (
        <div style={{ marginTop: 8, padding: 12, background: '#27272a', borderRadius: 8, border: '1px solid #3f3f46' }}>
          <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 8 }}>
            New folder{newFolderParent ? ` inside "${folders.find((f) => f.id === newFolderParent)?.name || ''}"` : ' at root'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="text" value={newFolderName} autoFocus placeholder="Folder name"
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') setShowNewFolderDialog(false) }}
              style={{ flex: 1, background: '#18181b', border: '1px solid #3f3f46', borderRadius: 4, color: '#e4e4e7', fontSize: 13, padding: '6px 10px' }}
            />
            <button onClick={handleCreateFolder} style={{ padding: '6px 14px', borderRadius: 4, border: '1px solid #7c3aed', background: '#7c3aed', color: 'white', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Create</button>
            <button onClick={() => setShowNewFolderDialog(false)} style={cancelBtnStyle}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// --- Styles ---

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 12px', marginBottom: 4, borderRadius: 6,
  background: '#27272a', border: '1px solid #3f3f46',
}

const iconBtnStyle: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 4, border: '1px solid #3f3f46',
  background: '#27272a', color: '#71717a', cursor: 'pointer', fontSize: 13,
  marginRight: 4,
}

const headerBtnStyle: React.CSSProperties = {
  padding: '4px 12px', borderRadius: 6, border: '1px solid #3f3f46',
  background: '#27272a', color: '#a1a1aa', cursor: 'pointer', fontSize: 12,
  display: 'flex', alignItems: 'center', gap: 4,
}

const confirmDeleteBtnStyle: React.CSSProperties = {
  padding: '3px 10px', borderRadius: 4, border: '1px solid #dc2626',
  background: '#dc2626', color: 'white', cursor: 'pointer', fontSize: 12,
}

const cancelBtnStyle: React.CSSProperties = {
  padding: '3px 10px', borderRadius: 4, border: '1px solid #3f3f46',
  background: '#27272a', color: '#a1a1aa', cursor: 'pointer', fontSize: 12,
}

const moveBtnStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 4, border: '1px solid #7c3aed',
  background: '#27272a', color: '#a78bfa', cursor: 'pointer', fontSize: 12,
}

function badgeStyle(type: 'tray' | 'baseplate'): React.CSSProperties {
  return {
    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
    background: type === 'tray' ? 'rgba(124,58,237,0.2)' : 'rgba(245,158,11,0.2)',
    color: type === 'tray' ? '#a78bfa' : '#f59e0b',
    border: `1px solid ${type === 'tray' ? 'rgba(124,58,237,0.3)' : 'rgba(245,158,11,0.3)'}`,
    whiteSpace: 'nowrap',
  }
}
