import { useState, useEffect } from 'react'
import { useBaseplate } from '../editor/useBaseplateState'
import { GRID_UNIT_MM } from '../editor/constants'
import { PRINT_BED_PRESETS, loadCustomPresets, saveCustomPreset, deleteCustomPreset } from '../types'
import type { BaseplateParams, PrintBedPreset } from '../types'

export default function BaseplateParamsPanel() {
  const { design, setParams, segmentInfo } = useBaseplate()
  const p = design.params
  const [showPerSide, setShowPerSide] = useState(false)
  const [customPresets, setCustomPresets] = useState<PrintBedPreset[]>([])
  const [showSavePreset, setShowSavePreset] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [selectedBed, setSelectedBed] = useState(() => {
    const match = PRINT_BED_PRESETS.find(b => b.w === p.print_bed_w_mm && b.l === p.print_bed_l_mm)
    return match?.key || 'custom'
  })

  // Load custom presets from localStorage on mount
  useEffect(() => {
    setCustomPresets(loadCustomPresets())
  }, [])

  // All presets: built-in + custom (excluding the generic "custom" entry if custom presets exist)
  const allPresets = [...PRINT_BED_PRESETS, ...customPresets]

  // Check if current bed dims match a custom preset
  useEffect(() => {
    const match = allPresets.find(b => b.w === p.print_bed_w_mm && b.l === p.print_bed_l_mm)
    if (match) setSelectedBed(match.key)
  }, [p.print_bed_w_mm, p.print_bed_l_mm, customPresets.length])

  // Compute grid info for display
  const padding = {
    left: p.padding_left_mm + p.drawer_clearance_mm,
    right: p.padding_right_mm + p.drawer_clearance_mm,
    top: p.padding_top_mm + p.drawer_clearance_mm,
    bottom: p.padding_bottom_mm + p.drawer_clearance_mm,
  }
  const availW = p.drawer_w_mm - padding.left - padding.right
  const availL = p.drawer_l_mm - padding.top - padding.bottom
  const gridW = Math.max(1, Math.floor(availW / GRID_UNIT_MM))
  const gridL = Math.max(1, Math.floor(availL / GRID_UNIT_MM))
  const plateW = gridW * GRID_UNIT_MM
  const plateL = gridL * GRID_UNIT_MM

  const update = (updates: Partial<BaseplateParams>) => setParams(updates)

  const handleBedPreset = (key: string) => {
    setSelectedBed(key)
    const preset = allPresets.find(b => b.key === key)
    if (preset && key !== 'custom') {
      update({ print_bed_w_mm: preset.w, print_bed_l_mm: preset.l })
    }
  }

  const handleSavePreset = () => {
    const name = presetName.trim()
    if (!name) return
    const updated = saveCustomPreset(name, p.print_bed_w_mm, p.print_bed_l_mm)
    setCustomPresets(updated)
    // Select the newly saved preset
    const newPreset = updated[updated.length - 1]
    setSelectedBed(newPreset.key)
    setShowSavePreset(false)
    setPresetName('')
  }

  const handleDeletePreset = (key: string) => {
    const updated = deleteCustomPreset(key)
    setCustomPresets(updated)
    setSelectedBed('custom')
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
      {/* Drawer Dimensions */}
      <Section title="Drawer Dimensions">
        <Row>
          <Field label="Width (mm)">
            <NumInput value={p.drawer_w_mm} onChange={(v) => update({ drawer_w_mm: v })} min={50} max={1000} />
          </Field>
          <Field label="Length (mm)">
            <NumInput value={p.drawer_l_mm} onChange={(v) => update({ drawer_l_mm: v })} min={50} max={1000} />
          </Field>
        </Row>
      </Section>

      {/* Padding */}
      <Section title="Edge Padding">
        {!showPerSide ? (
          <Row>
            <Field label="Uniform (mm)">
              <NumInput
                value={p.padding_left_mm}
                onChange={(v) => update({ padding_left_mm: v, padding_right_mm: v, padding_top_mm: v, padding_bottom_mm: v })}
                min={0} max={50} step={0.5}
              />
            </Field>
            <button onClick={() => setShowPerSide(true)} style={linkBtn}>Per side →</button>
          </Row>
        ) : (
          <>
            <Row>
              <Field label="Left (mm)"><NumInput value={p.padding_left_mm} onChange={(v) => update({ padding_left_mm: v })} min={0} max={50} step={0.5} /></Field>
              <Field label="Right (mm)"><NumInput value={p.padding_right_mm} onChange={(v) => update({ padding_right_mm: v })} min={0} max={50} step={0.5} /></Field>
            </Row>
            <Row>
              <Field label="Top (mm)"><NumInput value={p.padding_top_mm} onChange={(v) => update({ padding_top_mm: v })} min={0} max={50} step={0.5} /></Field>
              <Field label="Bottom (mm)"><NumInput value={p.padding_bottom_mm} onChange={(v) => update({ padding_bottom_mm: v })} min={0} max={50} step={0.5} /></Field>
            </Row>
            <button onClick={() => setShowPerSide(false)} style={linkBtn}>← Uniform</button>
          </>
        )}
        <Field label="Drawer clearance / slop (mm)">
          <NumInput value={p.drawer_clearance_mm} onChange={(v) => update({ drawer_clearance_mm: v })} min={0} max={5} step={0.1} />
        </Field>
      </Section>

      {/* Grid Info */}
      <Section title="Grid Info">
        <div style={{ fontSize: 12, color: '#a1a1aa', lineHeight: 1.6 }}>
          <div>Grid: <strong style={{ color: '#a78bfa' }}>{gridW}×{gridL}</strong> cells</div>
          <div>Plate: <strong style={{ color: '#a78bfa' }}>{plateW.toFixed(0)}×{plateL.toFixed(0)}</strong> mm</div>
          <div>Segments: <strong style={{ color: segmentInfo && segmentInfo.segment_count > 1 ? '#f59e0b' : '#22c55e' }}>{segmentInfo?.segment_count || 1}</strong></div>
        </div>
      </Section>

      {/* Baseplate Thickness */}
      <Section title="Baseplate">
        <Field label={`Base thickness: ${p.base_thickness_mm.toFixed(1)}mm`}>
          <input type="range" min={0} max={10} step={0.2} value={p.base_thickness_mm}
            onChange={(e) => update({ base_thickness_mm: parseFloat(e.target.value) })}
            style={{ width: '100%' }} />
          <span style={{ fontSize: 11, color: p.base_thickness_mm === 0 ? '#f59e0b' : '#52525b' }}>
            {p.base_thickness_mm === 0
              ? 'Open bottom (socket grid only, no flat floor)'
              : `Total height: ${(4 + p.base_thickness_mm).toFixed(1)}mm`}
          </span>
        </Field>
        <Toggle
          label="Magnet holes"
          checked={p.magnet_holes}
          onChange={(v) => update({ magnet_holes: v })}
          disabled={p.base_thickness_mm === 0}
        />
        {p.base_thickness_mm === 0 && p.magnet_holes && (
          <span style={{ fontSize: 10, color: '#f59e0b' }}>
            Magnets need a base floor — increase base thickness to enable
          </span>
        )}
        <Toggle
          label="Screw holes"
          checked={p.screw_holes}
          onChange={(v) => update({ screw_holes: v })}
          disabled={p.base_thickness_mm === 0}
        />
      </Section>

      {/* Print Bed */}
      <Section title="Print Bed">
        <Field label="Preset">
          <select value={selectedBed} onChange={(e) => handleBedPreset(e.target.value)} style={selectStyle}>
            <optgroup label="Built-in">
              {PRINT_BED_PRESETS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
            </optgroup>
            {customPresets.length > 0 && (
              <optgroup label="My Printers">
                {customPresets.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
              </optgroup>
            )}
          </select>
        </Field>
        <Row>
          <Field label="Bed W (mm)"><NumInput value={p.print_bed_w_mm} onChange={(v) => { update({ print_bed_w_mm: v }); setSelectedBed('custom') }} min={50} max={600} /></Field>
          <Field label="Bed L (mm)"><NumInput value={p.print_bed_l_mm} onChange={(v) => { update({ print_bed_l_mm: v }); setSelectedBed('custom') }} min={50} max={600} /></Field>
        </Row>
        {/* Save current as preset */}
        {!showSavePreset ? (
          <button onClick={() => setShowSavePreset(true)} style={smallBtn}>
            💾 Save current as preset
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <input
              type="text" value={presetName} placeholder="Printer name (e.g. My Ender 3)"
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); if (e.key === 'Escape') { setShowSavePreset(false); setPresetName('') } }}
              autoFocus
              style={inputStyle}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={handleSavePreset} disabled={!presetName.trim()} style={{ ...smallBtn, flex: 1, borderColor: '#7c3aed', color: '#a78bfa' }}>
                Save
              </button>
              <button onClick={() => { setShowSavePreset(false); setPresetName('') }} style={smallBtn}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {/* Delete custom preset if one is selected */}
        {customPresets.some(b => b.key === selectedBed) && !showSavePreset && (
          <button onClick={() => handleDeletePreset(selectedBed)} style={{ ...smallBtn, color: '#fca5a5', borderColor: '#7f1d1d' }}>
            🗑 Delete "{customPresets.find(b => b.key === selectedBed)?.label}"
          </button>
        )}
      </Section>

      {/* Connectors */}
      <Section title="Segment Connectors">
        <Field label="Type">
          <select value={p.connector_type} onChange={(e) => update({ connector_type: e.target.value as any })} style={selectStyle}>
            <option value="edge_clips">Edge clips / tabs</option>
            <option value="sockets_only">Sockets only (no clips)</option>
            <option value="magnets">Magnet alignment</option>
            <option value="none">None (loose pieces)</option>
          </select>
        </Field>
        {p.connector_type === 'edge_clips' && (
          <>
            <Row>
              <Field label="Clip width (mm)"><NumInput value={p.clip_width_mm} onChange={(v) => update({ clip_width_mm: v })} min={2} max={20} step={0.5} /></Field>
              <Field label="Clip depth (mm)"><NumInput value={p.clip_depth_mm} onChange={(v) => update({ clip_depth_mm: v })} min={1} max={10} step={0.5} /></Field>
            </Row>
            <Field label="Tolerance (mm)"><NumInput value={p.clip_tolerance_mm} onChange={(v) => update({ clip_tolerance_mm: v })} min={0} max={1} step={0.05} /></Field>
          </>
        )}
      </Section>

      {/* Segmentation info */}
      {segmentInfo && segmentInfo.segment_count > 1 && (
        <Section title="Segments">
          <div style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.5 }}>
            {segmentInfo.segments.map(s => (
              <div key={s.index}>
                <span style={{ color: '#a78bfa' }}>S{s.index}</span>: {s.cells_w}×{s.cells_h} cells = {s.w.toFixed(0)}×{s.h.toFixed(0)}mm
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

// --- Reusable components ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#52525b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8 }}>{children}</div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ flex: 1 }}>
      <span style={{ fontSize: 11, color: '#a1a1aa', display: 'block', marginBottom: 2 }}>{label}</span>
      {children}
    </label>
  )
}

function NumInput({ value, onChange, min, max, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input type="number" value={value} min={min} max={max} step={step}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      style={inputStyle} />
  )
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 12, color: disabled ? '#52525b' : '#a1a1aa' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      {label}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '5px 8px', background: '#27272a', border: '1px solid #3f3f46',
  borderRadius: 4, color: '#e4e4e7', fontSize: 13, boxSizing: 'border-box',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: 'pointer',
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer',
  fontSize: 11, padding: 0, textDecoration: 'underline',
}

const smallBtn: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 4, border: '1px solid #3f3f46',
  background: '#27272a', color: '#a1a1aa', cursor: 'pointer', fontSize: 11,
}
