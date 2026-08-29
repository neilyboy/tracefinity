// TypeScript types mirroring the backend Pydantic schemas.

export type PaperSize = 'letter' | 'a4'
export type ExportFormat = 'svg' | 'dxf' | 'stl' | '3mf' | 'step' | 'stl_flat' | 'stl_lid'
export type OutputMode = 'foam' | 'gridfinity'

export interface Point {
  x: number
  y: number
}

export interface FingerHole {
  x: number
  y: number
  radius_mm: number
  depth_mm: number | null
}

export interface TextLabel {
  id: string
  text: string
  x: number
  y: number
  font_size_mm: number
  rotation_deg: number
  depth_mm: number
  cutout: boolean  // True = engraved into surface, False = raised above
  target: 'tray' | 'flat'  // which export the label appears on
  font: string  // font family key (e.g. "Lato-Stenciled") or system font name
}

export interface FontInfo {
  key: string
  name: string
  category: string  // "Stencil" or "Standard"
  is_stencil: boolean
  available: boolean
  css_family: string  // CSS font-family name for @font-face
  url: string  // URL to the TTF file
}

export interface ToolOutline {
  id: string
  outer: Point[]
  holes: Point[][]
  label: string
  margin_mm: number | null
  pocket_depth_mm: number | null
  visible: boolean
  rotation_deg: number
  finger_holes: FingerHole[]
  smoothing: number  // 0.0 = sharp polygon, 0.3 = balanced, 1.0 = max curves
  pocket_shape: 'flat' | 'spherical' | 'cylindrical'
  pocket_bottom_radius_mm: number | null
}

export interface BinParams {
  output_mode: OutputMode
  grid_w: number
  grid_l: number
  height_units: number
  wall_thickness_mm: number
  base_thickness_mm: number
  pocket_depth_mm: number
  tool_margin_mm: number
  magnet_holes: boolean
  screw_holes: boolean
  scoop: boolean
  scoop_depth_mm: number
  finger_scoop: boolean
  finger_scoop_diameter_mm: number
  tabs: 'none' | 'split' | 'aligned'
  lip: boolean
  label_tab: boolean
  label_text: string
  label_font_size_mm: number
  label_depth_mm: number
  label_engrave: boolean
  label_tab_inset: boolean
  compartments_x: number
  compartments_y: number
  divider_thickness_mm: number
  divider_taper_deg: number
  divider_chamfer_mm: number
  divider_corner_radius_mm: number
  foam_thickness_mm: number
  pocket_corner_radius_mm: number
  cutout_chamfer_mm: number
  pocket_bottom_radius_mm: number
  flat_thickness_mm: number
  use_flat_insert: boolean
}

export interface Design {
  id: string | null
  name: string
  paper_size: PaperSize
  scale_mm_per_px: number
  rectified_w_px: number
  rectified_h_px: number
  paper_corners_px: Point[]
  outlines: ToolOutline[]
  labels: TextLabel[]
  params: BinParams
  image_filename: string | null
}

export interface TraceResult {
  paper_size: PaperSize
  scale_mm_per_px: number
  rectified_w_px: number
  rectified_h_px: number
  paper_corners_px: Point[]
  rectified_image_url: string
  original_image_url: string
  outlines: ToolOutline[]
  paper_detected: boolean
}

export interface DesignSummary {
  id: string
  name: string
  created_at: string
  updated_at: string
  thumbnail_url: string | null
}

export const DEFAULT_PARAMS: BinParams = {
  output_mode: 'gridfinity',
  grid_w: 2,
  grid_l: 2,
  height_units: 3,
  wall_thickness_mm: 1.2,
  base_thickness_mm: 0.8,
  pocket_depth_mm: 15.0,
  tool_margin_mm: 2.0,
  magnet_holes: true,
  screw_holes: false,
  scoop: false,
  scoop_depth_mm: 8.0,
  finger_scoop: false,
  finger_scoop_diameter_mm: 20.0,
  tabs: 'none',
  lip: false,
  label_tab: false,
  label_text: '',
  label_font_size_mm: 6.0,
  label_depth_mm: 0.6,
  label_engrave: false,
  label_tab_inset: false,
  compartments_x: 1,
  compartments_y: 1,
  divider_thickness_mm: 1.2,
  divider_taper_deg: 0,
  divider_chamfer_mm: 0,
  divider_corner_radius_mm: 0,
  foam_thickness_mm: 10.0,
  pocket_corner_radius_mm: 2.0,
  cutout_chamfer_mm: 0.0,
  pocket_bottom_radius_mm: 0.0,
  flat_thickness_mm: 2.0,
  use_flat_insert: false,
}

// ---------------------------------------------------------------------------
// Baseplate Designer types
// ---------------------------------------------------------------------------

export interface DrawerCutout {
  id: string
  shape: string  // shape type from AddShapeDialog
  outer: Point[]  // polygon points in mm, relative to drawer top-left (SVG Y-down)
  x: number  // center X
  y: number  // center Y
  w: number  // bounding box width
  h: number  // bounding box height
  rotation_deg: number
  cutout_type: 'through' | 'partial'  // through-cut or partial-depth from bottom
  depth_mm: number  // depth of partial cutout from the bottom
}

export interface BaseplateParams {
  drawer_w_mm: number
  drawer_l_mm: number
  padding_top_mm: number
  padding_bottom_mm: number
  padding_left_mm: number
  padding_right_mm: number
  drawer_clearance_mm: number
  base_thickness_mm: number
  magnet_holes: boolean
  screw_holes: boolean
  print_bed_w_mm: number
  print_bed_l_mm: number
  connector_type: 'edge_clips' | 'sockets_only' | 'magnets' | 'none'
  cut_lines_x: number[]
  cut_lines_y: number[]
  clip_width_mm: number
  clip_depth_mm: number
  clip_tolerance_mm: number
}

export interface BaseplateDesign {
  id: string | null
  name: string
  params: BaseplateParams
  cutouts: DrawerCutout[]
}

export interface SegmentInfo {
  grid_w: number
  grid_l: number
  plate_w: number
  plate_l: number
  segment_count: number
  segments: { index: number; x: number; y: number; w: number; h: number; cells_w: number; cells_h: number }[]
  cuts_x: number[]
  cuts_y: number[]
}

export interface BaseplateDesignSummary {
  id: string
  name: string
  created_at: string
  updated_at: string
}

export const DEFAULT_BASEPLATE_PARAMS: BaseplateParams = {
  drawer_w_mm: 400,
  drawer_l_mm: 300,
  padding_top_mm: 2.0,
  padding_bottom_mm: 2.0,
  padding_left_mm: 2.0,
  padding_right_mm: 2.0,
  drawer_clearance_mm: 0.5,
  base_thickness_mm: 2.4,
  magnet_holes: true,
  screw_holes: false,
  print_bed_w_mm: 220,
  print_bed_l_mm: 220,
  connector_type: 'edge_clips',
  cut_lines_x: [],
  cut_lines_y: [],
  clip_width_mm: 8.0,
  clip_depth_mm: 4.0,
  clip_tolerance_mm: 0.2,
}

export interface PrintBedPreset {
  key: string
  label: string
  w: number
  l: number
  custom?: boolean  // true for user-saved presets
}

export const PRINT_BED_PRESETS: PrintBedPreset[] = [
  { key: 'ender_3', label: 'Ender 3 (220×220)', w: 220, l: 220 },
  { key: 'ender_3_v2', label: 'Ender 3 V2 (235×235)', w: 235, l: 235 },
  { key: 'prusa_mk3', label: 'Prusa MK3 (250×210)', w: 250, l: 210 },
  { key: 'bambu_x1', label: 'Bambu X1/P1S (256×256)', w: 256, l: 256 },
  { key: 'voron_2_4', label: 'Voron 2.4 (350×350)', w: 350, l: 350 },
  { key: 'elegoo_neptune_3', label: 'Elegoo Neptune 3 (225×225)', w: 225, l: 225 },
  { key: 'creality_cr10', label: 'Creality CR-10 (300×300)', w: 300, l: 300 },
  { key: 'custom', label: 'Custom', w: 220, l: 220 },
]

// --- Custom printer preset storage (localStorage) ---

const CUSTOM_PRESETS_KEY = 'tracefinity_custom_print_beds'

export function loadCustomPresets(): PrintBedPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p: any) => p && p.key && p.label && typeof p.w === 'number' && typeof p.l === 'number')
  } catch {
    return []
  }
}

export function saveCustomPreset(name: string, w: number, l: number): PrintBedPreset[] {
  const existing = loadCustomPresets()
  const preset: PrintBedPreset = {
    key: `custom_${Date.now()}`,
    label: `${name} (${w}×${l})`,
    w,
    l,
    custom: true,
  }
  const updated = [...existing, preset]
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated))
  return updated
}

export function deleteCustomPreset(key: string): PrintBedPreset[] {
  const existing = loadCustomPresets()
  const updated = existing.filter((p) => p.key !== key)
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated))
  return updated
}
