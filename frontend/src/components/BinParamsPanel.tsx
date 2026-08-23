import { useEditor } from '../editor/useEditorState'

export default function BinParamsPanel() {
  const { design, setParams } = useEditor()
  const p = design.params

  return (
    <div style={{ padding: 12, overflow: 'auto' }}>
      <h3 style={{ fontSize: 13, color: '#a1a1aa', marginTop: 0, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Bin Parameters</h3>

      <Section title="Output Mode">
        <RadioGroup
          value={p.output_mode}
          options={[{ v: 'gridfinity', l: 'Gridfinity (3D)' }, { v: 'foam', l: 'Foam (2D)' }]}
          onChange={(v) => setParams({ output_mode: v as any })}
        />
      </Section>

      <Section title="Grid Size (42mm units)">
        <NumInput label="Width" value={p.grid_w} min={1} max={20} onChange={(v) => setParams({ grid_w: v })} />
        <NumInput label="Length" value={p.grid_l} min={1} max={20} onChange={(v) => setParams({ grid_l: v })} />
        <div style={{ fontSize: 11, color: '#71717a', marginTop: 4 }}>
          Footprint: <strong style={{ color: '#a1a1aa' }}>{(p.grid_w * 42).toFixed(0)}×{(p.grid_l * 42).toFixed(0)}mm</strong>
          {' '}({(p.grid_w * 42 / 25.4).toFixed(1)}×{(p.grid_l * 42 / 25.4).toFixed(1)}in)
        </div>
      </Section>

      <Section title="Height">
        <NumInput label="Height (7mm units)" value={p.height_units} min={1} max={20} onChange={(v) => setParams({ height_units: v })} />
        <div style={{ fontSize: 11, color: '#71717a', marginTop: 4 }}>
          Total: <strong style={{ color: '#a1a1aa' }}>{(p.height_units * 7).toFixed(0)}mm</strong>
          {' '}({(p.height_units * 7 / 25.4).toFixed(2)}in)
          {p.lip && <span> + lip 4.4mm = <strong style={{ color: '#a1a1aa' }}>{(p.height_units * 7 + 4.4).toFixed(1)}mm</strong></span>}
        </div>
        <div style={{ fontSize: 10, color: '#52525b', marginTop: 2 }}>
          Pocket depth: {p.pocket_depth_mm.toFixed(1)}mm · Floor: {Math.max(2.25, 4).toFixed(1)}mm
        </div>
      </Section>

      <Section title="Walls & Base">
        <NumInput label="Wall (mm)" value={p.wall_thickness_mm} step={0.1} min={0.4} max={5} onChange={(v) => setParams({ wall_thickness_mm: v })} />
        <NumInput label="Base (mm)" value={p.base_thickness_mm} step={0.1} min={0.4} max={5} onChange={(v) => setParams({ base_thickness_mm: v })} />
      </Section>

      <Section title="Pockets">
        <NumInput label="Default depth (mm)" value={p.pocket_depth_mm} step={0.5} min={1} max={100} onChange={(v) => setParams({ pocket_depth_mm: v })} />
        <NumInput label="Default margin (mm)" value={p.tool_margin_mm} step={0.1} min={0} max={10} onChange={(v) => setParams({ tool_margin_mm: v })} />
        <NumInput label="Corner radius (mm)" value={p.pocket_corner_radius_mm} step={0.5} min={0} max={20} onChange={(v) => setParams({ pocket_corner_radius_mm: v })} />
        <NumInput label="Cutout chamfer (mm)" value={p.cutout_chamfer_mm} step={0.1} min={0} max={3} onChange={(v) => setParams({ cutout_chamfer_mm: v })} />
        <NumInput label="Bottom radius (mm)" value={p.pocket_bottom_radius_mm} step={0.5} min={0} max={10} onChange={(v) => setParams({ pocket_bottom_radius_mm: v })} />
      </Section>

      <Section title="Features">
        <Toggle label="Magnet holes (6×2mm)" checked={p.magnet_holes} onChange={(v) => setParams({ magnet_holes: v })} />
        <Toggle label="Screw holes (M3)" checked={p.screw_holes} onChange={(v) => setParams({ screw_holes: v })} />
        <Toggle label="Scoop (finger cutout)" checked={p.scoop} onChange={(v) => setParams({ scoop: v })} />
        {p.scoop && <NumInput label="Scoop depth (mm)" value={p.scoop_depth_mm} step={0.5} min={2} max={20} onChange={(v) => setParams({ scoop_depth_mm: v })} />}
        <Toggle label="Finger scoop (auto tool edge)" checked={p.finger_scoop} onChange={(v) => setParams({ finger_scoop: v })} />
        {p.finger_scoop && <NumInput label="Finger scoop Ø (mm)" value={p.finger_scoop_diameter_mm} step={1} min={5} max={40} onChange={(v) => setParams({ finger_scoop_diameter_mm: v })} />}
        <Toggle label="Stacking lip" checked={p.lip} onChange={(v) => setParams({ lip: v })} />
        <Toggle label="Label tab" checked={p.label_tab} onChange={(v) => setParams({ label_tab: v })} />
        {p.label_tab && (
          <>
            <input
              type="text"
              placeholder="Label text..."
              value={p.label_text}
              onChange={(e) => setParams({ label_text: e.target.value })}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, border: '1px solid #3f3f46', background: '#18181b', color: '#e4e4e7', fontSize: 13, marginTop: 4 }}
            />
            <NumInput label="Font size (mm)" value={p.label_font_size_mm} step={0.5} min={3} max={20} onChange={(v) => setParams({ label_font_size_mm: v })} />
            <NumInput label="Label depth (mm)" value={p.label_depth_mm} step={0.1} min={0.2} max={3} onChange={(v) => setParams({ label_depth_mm: v })} />
          </>
        )}
      </Section>

      <Section title="Tabs">
        <RadioGroup
          value={p.tabs}
          options={[{ v: 'none', l: 'None' }, { v: 'split', l: 'Split' }, { v: 'aligned', l: 'Aligned' }]}
          onChange={(v) => setParams({ tabs: v as any })}
        />
      </Section>

      <Section title="Compartments">
        <NumInput label="Along X" value={p.compartments_x} min={1} max={10} onChange={(v) => setParams({ compartments_x: v })} />
        <NumInput label="Along Y" value={p.compartments_y} min={1} max={10} onChange={(v) => setParams({ compartments_y: v })} />
      </Section>

      {p.output_mode === 'foam' && (
        <Section title="Foam">
          <NumInput label="Sheet thickness (mm)" value={p.foam_thickness_mm} step={1} min={1} max={50} onChange={(v) => setParams({ foam_thickness_mm: v })} />
        </Section>
      )}

      <Section title="Flat STL Layer">
        <NumInput label="Plate thickness (mm)" value={p.flat_thickness_mm} step={0.5} min={0.4} max={20} onChange={(v) => setParams({ flat_thickness_mm: v })} />
        <div style={{ fontSize: 11, color: '#52525b', marginTop: 4 }}>
          Used for test-fit and two-tone insert exports
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: '#71717a', marginBottom: 6, fontWeight: 600 }}>{title}</div>
      {children}
    </div>
  )
}

function NumInput({ label, value, onChange, min, max, step = 1 }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
      <label style={{ fontSize: 12, color: '#a1a1aa' }}>{label}</label>
      <input
        type="number" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={inputStyle}
      />
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, cursor: 'pointer' }}
      onClick={() => onChange(!checked)}>
      <label style={{ fontSize: 12, color: '#a1a1aa', cursor: 'pointer' }}>{label}</label>
      <div style={{
        width: 32, height: 18, borderRadius: 9, background: checked ? '#7c3aed' : '#3f3f46',
        position: 'relative', transition: 'background 0.2s',
      }}>
        <div style={{
          position: 'absolute', top: 2, left: checked ? 16 : 2, width: 14, height: 14,
          borderRadius: 7, background: 'white', transition: 'left 0.2s',
        }} />
      </div>
    </div>
  )
}

function RadioGroup({ value, options, onChange }: {
  value: string; options: { v: string; l: string }[]; onChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          style={{
            padding: '4px 10px', borderRadius: 4, fontSize: 12, cursor: 'pointer',
            border: `1px solid ${value === o.v ? '#7c3aed' : '#3f3f46'}`,
            background: value === o.v ? '#3b0764' : '#27272a',
            color: value === o.v ? '#a78bfa' : '#a1a1aa',
          }}
        >
          {o.l}
        </button>
      ))}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: 70, padding: '4px 6px', background: '#27272a', border: '1px solid #3f3f46',
  borderRadius: 4, color: '#e4e4e7', fontSize: 12,
}
