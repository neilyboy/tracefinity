// TypeScript types mirroring the backend Pydantic schemas.

export type PaperSize = 'letter' | 'a4'
export type ExportFormat = 'svg' | 'dxf' | 'stl' | '3mf' | 'step'
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
  compartments_x: number
  compartments_y: number
  foam_thickness_mm: number
  pocket_corner_radius_mm: number
  cutout_chamfer_mm: number
  pocket_bottom_radius_mm: number
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
  tool_margin_mm: 1.0,
  magnet_holes: true,
  screw_holes: false,
  scoop: true,
  scoop_depth_mm: 8.0,
  finger_scoop: true,
  finger_scoop_diameter_mm: 20.0,
  tabs: 'none',
  lip: true,
  label_tab: false,
  label_text: '',
  label_font_size_mm: 6.0,
  label_depth_mm: 0.6,
  compartments_x: 1,
  compartments_y: 1,
  foam_thickness_mm: 10.0,
  pocket_corner_radius_mm: 2.0,
  cutout_chamfer_mm: 0.0,
  pocket_bottom_radius_mm: 0.0,
}
