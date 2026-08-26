// API client for the Tracefinity backend.
import type { Design, DesignSummary, FontInfo, PaperSize, Point, ToolOutline, TraceResult, ExportFormat } from '../types'

const API = '/api'

export async function traceImage(file: File, paperSize: PaperSize): Promise<TraceResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('paper_size', paperSize)
  const res = await fetch(`${API}/trace`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Trace failed')
  }
  return res.json()
}

export async function rectifyWithCorners(
  originalImageUrl: string,
  corners: Point[],
  paperSize: PaperSize,
): Promise<TraceResult> {
  const res = await fetch(`${API}/rectify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      original_image_url: originalImageUrl,
      corners,
      paper_size: paperSize,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Rectify failed')
  }
  return res.json()
}

export async function detectToolAtPoint(
  rectifiedImageUrl: string,
  scaleMmPerPx: number,
  clickX: number,
  clickY: number,
): Promise<ToolOutline> {
  const res = await fetch(`${API}/detect-at-point`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rectified_image_url: rectifiedImageUrl,
      scale_mm_per_px: scaleMmPerPx,
      click_x: clickX,
      click_y: clickY,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Detection failed')
  }
  return res.json()
}

export async function autoRotateTool(outer: Point[]): Promise<number> {
  const res = await fetch(`${API}/auto-rotate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outer }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Auto-rotate failed')
  }
  const data = await res.json()
  return data.rotation_deg
}

export async function saveDesign(design: Design): Promise<Design> {
  const res = await fetch(`${API}/designs`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(design),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Save failed')
  }
  return res.json()
}

export async function loadDesign(id: string): Promise<Design> {
  const res = await fetch(`${API}/designs/${id}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Load failed')
  }
  return res.json()
}

export async function listDesigns(): Promise<DesignSummary[]> {
  const res = await fetch(`${API}/designs`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'List failed')
  }
  return res.json()
}

export async function deleteDesign(id: string): Promise<void> {
  const res = await fetch(`${API}/designs/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Delete failed')
  }
}

export async function exportDesign(design: Design, fmt: ExportFormat): Promise<Blob> {
  const res = await fetch(`${API}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ design, fmt }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Export failed')
  }
  return res.blob()
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// --- Tool Library ---

export interface ToolLibrarySummary {
  id: string
  name: string
  category: string
  bbox_w_mm: number
  bbox_h_mm: number
  created_at: string
}

export async function listToolLibrary(): Promise<ToolLibrarySummary[]> {
  const res = await fetch(`${API}/tools`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'List tools failed')
  }
  return res.json()
}

export async function loadToolFromLibrary(id: string): Promise<ToolOutline> {
  const res = await fetch(`${API}/tools/${id}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Load tool failed')
  }
  return res.json()
}

export async function saveToolToLibrary(
  tool: ToolOutline,
  name: string,
  category: string = 'General',
): Promise<{ id: string }> {
  const res = await fetch(`${API}/tools`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, name, category }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Save tool failed')
  }
  return res.json()
}

export async function deleteToolFromLibrary(id: string): Promise<void> {
  const res = await fetch(`${API}/tools/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Delete tool failed')
  }
}

export async function listFonts(): Promise<FontInfo[]> {
  const res = await fetch(`${API}/designs/fonts/list`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'List fonts failed')
  }
  return res.json()
}
