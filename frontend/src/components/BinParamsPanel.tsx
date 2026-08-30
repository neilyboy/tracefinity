import { useState } from 'react'
import { useEditor } from '../editor/useEditorState'

export default function BinParamsPanel() {
  const { design, setParams } = useEditor()
  const p = design.params

  return (
    <div style={{ padding: 12, overflow: 'auto' }}>
      <h3 style={{ fontSize: 13, color: '#a1a1aa', marginTop: 0, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Bin Parameters</h3>

      <Section title="Grid Size (42mm units)">
        <NumInput label="Width" value={p.grid_w} min={1} max={20} onChange={(v) => setParams({ grid_w: v })} />
        <NumInput label="Length" value={p.grid_l} min={1} max={20} onChange={(v) => setParams({ grid_l: v })} />
        <div style={hintStyle}>
          Footprint: <strong style={{ color: '#a1a1aa' }}>{(p.grid_w * 42).toFixed(0)}×{(p.grid_l * 42).toFixed(0)}mm</strong>
          {' '}({(p.grid_w * 42 / 25.4).toFixed(1)}×{(p.grid_l * 42 / 25.4).toFixed(1)}in)
        </div>
      </Section>

      <Section title="Height">
        <NumInput label="Height (7mm units)" value={p.height_units} min={1} max={20} onChange={(v) => setParams({ height_units: v })} />
        <div style={hintStyle}>
          Total: <strong style={{ color: '#a1a1aa' }}>{(p.height_units * 7).toFixed(0)}mm</strong>
          {' '}({(p.height_units * 7 / 25.4).toFixed(2)}in)
          {p.lip && <span> + lip 4.4mm = <strong style={{ color: '#a1a1aa' }}>{(p.height_units * 7 + 4.4).toFixed(1)}mm</strong></span>}
        </div>
        <div style={{ ...hintStyle, color: '#52525b' }}>
          Pocket depth: {p.pocket_depth_mm.toFixed(1)}mm · Floor: {Math.max(2.25, 4).toFixed(1)}mm
        </div>
      </Section>

      <Section title="Walls & Base" defaultOpen={false}>
        <NumInput label="Wall (mm)" value={p.wall_thickness_mm} step={0.1} min={0.4} max={5} onChange={(v) => setParams({ wall_thickness_mm: v })} />
        <NumInput label="Base (mm)" value={p.base_thickness_mm} step={0.1} min={0.4} max={5} onChange={(v) => setParams({ base_thickness_mm: v })} />
      </Section>

      <Section title="Tool Pockets — Defaults" defaultOpen={false}>
        <NumInput label="Depth (mm)" value={p.pocket_depth_mm} step={0.5} min={1} max={100} onChange={(v) => setParams({ pocket_depth_mm: v })} />
        <NumInput label="Margin (mm)" value={p.tool_margin_mm} step={0.1} min={0} max={10} onChange={(v) => setParams({ tool_margin_mm: v })} />
        <div style={hintStyle}>
          Per-tool overrides available in Tool Properties →
        </div>
        <details style={{ marginTop: 6 }}>
          <summary style={summaryStyle}>Advanced pocket geometry</summary>
          <NumInput label="Corner radius (mm)" value={p.pocket_corner_radius_mm} step={0.5} min={0} max={20} onChange={(v) => setParams({ pocket_corner_radius_mm: v })} />
          <NumInput label="Cutout chamfer (mm)" value={p.cutout_chamfer_mm} step={0.1} min={0} max={3} onChange={(v) => setParams({ cutout_chamfer_mm: v })} />
          <NumInput label="Bottom radius (mm)" value={p.pocket_bottom_radius_mm} step={0.5} min={0} max={10} onChange={(v) => setParams({ pocket_bottom_radius_mm: v })} />
        </details>
      </Section>

      <Section title="Bottom Holes" defaultOpen={false}>
        <Toggle label="Magnet holes (6×2mm)" checked={p.magnet_holes} onChange={(v) => setParams({ magnet_holes: v })} />
        <Toggle label="Screw holes (M3)" checked={p.screw_holes} onChange={(v) => setParams({ screw_holes: v })} />
        {p.screw_holes && (
          <div style={hintStyle}>
            M3 through-holes inside magnet pockets. Invisible when magnets are on — look up into the magnet cavity to see them.
          </div>
        )}
      </Section>

      <Section title="Finger Access" defaultOpen={false}>
        <Toggle label="Front edge scoop" checked={p.scoop} onChange={(v) => setParams({ scoop: v })} />
        {p.scoop && <NumInput label="Scoop depth (mm)" value={p.scoop_depth_mm} step={0.5} min={2} max={20} onChange={(v) => setParams({ scoop_depth_mm: v })} />}
        {p.scoop && (
          <div style={hintStyle}>
            Semi-cylindrical scoop on the front wall so fingers can slide under items.
          </div>
        )}
        <div style={{ borderTop: '1px solid #27272a', margin: '6px 0' }} />
        <div style={hintStyle}>
          <span style={{ color: '#fca5a5' }}>●</span> <strong style={{ color: '#a1a1aa' }}>Finger holes</strong> — placed per-tool in the editor (red dashed circles). Use the <em>◯ Finger Hole</em> button in the toolbar or <em>+ Add Finger Hole</em> in Tool Properties. Multiple holes per tool.
        </div>
      </Section>

      <Section title="Lip & Print Tabs" defaultOpen={false}>
        <Toggle label="Stacking lip" checked={p.lip} onChange={(v) => setParams({ lip: v })} />
        {p.lip && (
          <>
            <div style={{ ...hintStyle, marginBottom: 6 }}>
              The stacking lip allows bins to stack on top of each other.
              Print support tabs help the lip overhang print cleanly without sagging.
            </div>
            <RadioGroup
              value={p.tabs}
              options={[{ v: 'none', l: 'No tabs' }, { v: 'split', l: 'Split' }, { v: 'aligned', l: 'Aligned' }]}
              onChange={(v) => setParams({ tabs: v as any })}
            />
            <div style={hintStyle}>
              <strong style={{ color: '#a1a1aa' }}>No tabs:</strong> clean look, lip may sag on printers without cooling.<br/>
              <strong style={{ color: '#a1a1aa' }}>Split:</strong> small tabs on all 4 sides with gaps.<br/>
              <strong style={{ color: '#a1a1aa' }}>Aligned:</strong> continuous tabs on front and back only.
            </div>
          </>
        )}

        <div style={{ borderTop: '1px solid #27272a', margin: '8px 0', paddingTop: 8 }}>
          <Toggle label="Label tab (front wall)" checked={p.label_tab} onChange={(v) => setParams({ label_tab: v })} />
          {p.label_tab && (
            <>
              <div style={hintStyle}>
                Adds a flat tab on the front wall for labeling. Optional embossed text.
              </div>
              <input
                type="text"
                placeholder="Label text (optional)"
                value={p.label_text}
                onChange={(e) => setParams({ label_text: e.target.value })}
                style={{ width: '100%', padding: '6px 8px', background: '#27272a', border: '1px solid #3f3f46', borderRadius: 4, color: '#e4e4e7', fontSize: 13, boxSizing: 'border-box', marginBottom: 6 }}
              />
              <NumInput label="Font size (mm)" value={p.label_font_size_mm} step={0.5} min={2} max={20} onChange={(v) => setParams({ label_font_size_mm: v })} />
              <Toggle label="Inset tapered pocket (no supports needed)" checked={p.label_tab_inset} onChange={(v) => setParams({ label_tab_inset: v })} />
              {p.label_tab_inset ? (
                <>
                  <div style={hintStyle}>
                    Cuts a 40° tapered pocket into the front wall — prints clean without supports. Text is engraved at the bottom.
                  </div>
                  <NumInput label="Engrave depth (mm)" value={p.label_depth_mm} step={0.1} min={0.2} max={1.5} onChange={(v) => setParams({ label_depth_mm: v })} />
                  <div style={hintStyle}>
                    How deep the text is cut into the pocket floor. 0.4-0.8mm recommended.
                  </div>
                </>
              ) : (
                <>
                  <Toggle label="Engrave (cut in) instead of emboss (raised)" checked={p.label_engrave} onChange={(v) => setParams({ label_engrave: v })} />
                  <NumInput label={p.label_engrave ? 'Engrave depth (mm)' : 'Emboss depth (mm)'} value={p.label_depth_mm} step={0.1} min={0} max={2} onChange={(v) => setParams({ label_depth_mm: v })} />
                  <div style={hintStyle}>
                    {p.label_engrave
                      ? 'Text is cut into the tab surface. 0.6+ mm recommended for readability.'
                      : '0 = flat tab (write on it), 0.6+ = raised text embossed on the tab.'}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </Section>

      <Section title="Compartments (Dividers)" defaultOpen={false}>
        <div style={hintStyle}>
          Adds internal divider walls to create separate compartments. Note: dividers may interfere with tool pockets — best for simple storage bins without tool cutouts.
        </div>
        <NumInput label="Along X" value={p.compartments_x} min={1} max={10} onChange={(v) => setParams({ compartments_x: v })} />
        <NumInput label="Along Y" value={p.compartments_y} min={1} max={10} onChange={(v) => setParams({ compartments_y: v })} />
        {(p.compartments_x > 1 || p.compartments_y > 1) && (
          <>
            <div style={{ borderTop: '1px solid #27272a', margin: '8px 0', paddingTop: 8 }}>
              <div style={{ fontSize: 10, color: '#71717a', marginBottom: 6 }}>Divider options:</div>
              <NumInput label="Wall thickness (mm)" value={p.divider_thickness_mm} step={0.2} min={0.4} max={5} onChange={(v) => setParams({ divider_thickness_mm: v })} />
              <NumInput label="Wall taper (deg)" value={p.divider_taper_deg} step={1} min={0} max={30} onChange={(v) => setParams({ divider_taper_deg: v })} />
              <div style={hintStyle}>
                Tapers walls outward at the top — wider opening makes it easier to grab small parts. 15-20° recommended.
              </div>
              <NumInput label="Top chamfer (mm)" value={p.divider_chamfer_mm} step={0.1} min={0} max={2} onChange={(v) => setParams({ divider_chamfer_mm: v })} />
              <div style={hintStyle}>
                Chamfers the top edges of dividers for a cleaner look and easier printing.
              </div>
              <NumInput label="Bottom corner radius (mm)" value={p.divider_corner_radius_mm} step={0.5} min={0} max={3} onChange={(v) => setParams({ divider_corner_radius_mm: v })} />
              <div style={hintStyle}>
                Rounds the bottom corners of compartments — no sharp corners for small screws and parts to get stuck in.
              </div>
            </div>
          </>
        )}
      </Section>

      <Section title="Flat Insert (Two-Tone)" defaultOpen={false}>
        <Toggle label="Enable flat insert layer" checked={p.use_flat_insert} onChange={(v) => setParams({ use_flat_insert: v })} />
        {p.use_flat_insert && (
          <>
            <NumInput label="Plate thickness (mm)" value={p.flat_thickness_mm} step={0.5} min={0.4} max={20} onChange={(v) => setParams({ flat_thickness_mm: v })} />
            <div style={hintStyle}>
              Print the tray in one color and the flat STL in another. The flat piece sits inside the lip, showing the tray color through tool and text cutouts.
              <br /><br />
              <strong style={{ color: '#a78bfa' }}>Tray:</strong> Top surface recessed by {p.flat_thickness_mm.toFixed(1)}mm inside the lip to accept the insert.
              <br />
              <strong style={{ color: '#a78bfa' }}>Flat STL:</strong> Sized to fit inside the lip walls ({((p.grid_w * 42 - 1 - 2 * p.wall_thickness_mm)).toFixed(1)}×{(p.grid_l * 42 - 1 - 2 * p.wall_thickness_mm).toFixed(1)}mm).
            </div>
          </>
        )}
      </Section>

      <Section title="Segmentation (Large Trays)" defaultOpen={false}>
        {(() => {
          const trayW = p.grid_w * 42
          const trayL = p.grid_l * 42
          const tooBig = trayW > p.print_bed_w_mm || trayL > p.print_bed_l_mm
          return (
            <>
              <div style={hintStyle}>
                Tray footprint: <strong style={{ color: tooBig ? '#f59e0b' : '#22c55e' }}>{trayW}×{trayL}mm</strong>
                {' '}vs print bed: <strong>{p.print_bed_w_mm}×{p.print_bed_l_mm}mm</strong>
                {tooBig && <span style={{ color: '#f59e0b' }}> — too large, will be split into segments</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <NumInput label="Bed W (mm)" value={p.print_bed_w_mm} step={5} min={100} max={500} onChange={(v) => setParams({ print_bed_w_mm: v })} />
                <NumInput label="Bed L (mm)" value={p.print_bed_l_mm} step={5} min={100} max={500} onChange={(v) => setParams({ print_bed_l_mm: v })} />
              </div>
              <Toggle label="Force segmentation" checked={p.force_segment} onChange={(v) => setParams({ force_segment: v })} />
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: '#a1a1aa', marginBottom: 2 }}>Connector type</div>
                <select value={p.tray_connector_type} onChange={(e) => setParams({ tray_connector_type: e.target.value as any })}
                  style={{ width: '100%', background: '#27272a', border: '1px solid #3f3f46', borderRadius: 4, padding: '4px 8px', color: '#e4e4e7', fontSize: 12 }}>
                  <option value="edge_clips">Edge clips (dovetail tabs)</option>
                  <option value="none">None (flat edges)</option>
                </select>
              </div>
              {tooBig && (
                <div style={hintStyle}>
                  Export as STL to get a ZIP with all segments. Each segment fits on your print bed and clips together with dovetail tabs at the base.
                </div>
              )}
            </>
          )
        })()}
      </Section>
    </div>
  )
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginBottom: 8, borderBottom: '1px solid #27272a' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          fontSize: 11, color: '#71717a', fontWeight: 600, cursor: 'pointer',
          userSelect: 'none', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        <span style={{ fontSize: 9, color: '#52525b', width: 10 }}>{open ? '▼' : '▶'}</span>
        {title}
      </div>
      {open && <div style={{ paddingBottom: 8, paddingTop: 2 }}>{children}</div>}
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

const hintStyle: React.CSSProperties = {
  fontSize: 10, color: '#71717a', marginTop: 4, lineHeight: 1.4,
}

const summaryStyle: React.CSSProperties = {
  fontSize: 10, color: '#52525b', cursor: 'pointer', userSelect: 'none',
  marginBottom: 4,
}
