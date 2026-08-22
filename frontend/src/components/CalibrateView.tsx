import { useState, useRef, useCallback } from 'react'
import { useEditor } from '../editor/useEditorState'
import { rectifyWithCorners } from '../api/client'
import type { Point } from '../types'

export default function CalibrateView() {
  const { design, setView, setError, setLoading, loading } = useEditor()

  // Get the extra state stored by UploadPanel.
  const originalImageUrl = (useEditor.getState() as any)._originalImageUrl || ''
  const paperDetected = (useEditor.getState() as any)._paperDetected ?? true

  const [corners, setCorners] = useState<Point[]>(
    design.paper_corners_px.length === 4
      ? design.paper_corners_px
      : [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.9, y: 0.9 },
          { x: 0.1, y: 0.9 },
        ],
  )
  const [imgSize, setImgSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [cornersMoved, setCornersMoved] = useState(false)  // tracks if user dragged any corner
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Convert client coordinates to image pixel coordinates.
  const clientToImagePx = useCallback((clientX: number, clientY: number): Point => {
    if (!imgRef.current) return { x: 0, y: 0 }
    const rect = imgRef.current.getBoundingClientRect()
    const scaleX = imgSize.w / rect.width
    const scaleY = imgSize.h / rect.height
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    }
  }, [imgSize])

  const handleImgLoad = () => {
    if (imgRef.current) {
      setImgSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight })
      // If no corners detected, initialize to image corners with margin.
      if (corners.length === 4 && design.paper_corners_px.length === 0) {
        const w = imgRef.current.naturalWidth
        const h = imgRef.current.naturalHeight
        setCorners([
          { x: w * 0.05, y: h * 0.05 },
          { x: w * 0.95, y: h * 0.05 },
          { x: w * 0.95, y: h * 0.95 },
          { x: w * 0.05, y: h * 0.95 },
        ])
      }
    }
  }

  const handleCornerPointerDown = (e: React.PointerEvent, idx: number) => {
    e.stopPropagation()
    setDragIdx(idx)
    setCornersMoved(true)  // user is adjusting corners
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragIdx === null) return
    const pt = clientToImagePx(e.clientX, e.clientY)
    setCorners((prev) => prev.map((c, i) => (i === dragIdx ? pt : c)))
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragIdx !== null) {
      ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    }
    setDragIdx(null)
  }

  const handleConfirm = async () => {
    // If paper was auto-detected and user didn't change corners, go straight to trace.
    if (paperDetected && design.paper_corners_px.length === 4 && !cornersMoved) {
      setView('trace')
      return
    }

    // User adjusted corners (or auto-detection failed): re-rectify with user's corners.
    setLoading(true)
    setError(null)
    try {
      const result = await rectifyWithCorners(originalImageUrl, corners, design.paper_size)
      useEditor.setState((s) => ({
        design: {
          ...s.design,
          scale_mm_per_px: result.scale_mm_per_px,
          rectified_w_px: result.rectified_w_px,
          rectified_h_px: result.rectified_h_px,
          paper_corners_px: result.paper_corners_px,
          outlines: result.outlines,
          image_filename: result.rectified_image_url.split('/').pop() || null,
        },
        _paperDetected: true,
      } as any))
      setView('trace')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rectify failed')
    } finally {
      setLoading(false)
    }
  }

  // Display the original image (for manual adjustment) or the rectified one.
  const imageUrl = originalImageUrl || (design.image_filename ? `/data/images/${design.image_filename}` : '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 24, gap: 20 }}>
      <h2 style={{ fontSize: 22 }}>Paper Calibration</h2>

      {!paperDetected && (
        <div style={{
          background: '#422006', border: '1px solid #a16207', borderRadius: 8,
          padding: '10px 16px', color: '#fde047', fontSize: 14, maxWidth: 600, textAlign: 'center',
        }}>
          Auto-detection couldn't find the paper. <strong>Drag the 4 corner dots</strong> to outline
          the paper sheet in your photo, then click Confirm.
        </div>
      )}

      {paperDetected && (
        <p style={{ color: '#a1a1aa', maxWidth: 500, textAlign: 'center' }}>
          Paper detected automatically. Scale: <strong>{design.scale_mm_per_px.toFixed(3)} mm/px</strong>
          {' '}({design.paper_size === 'letter' ? '8.5×11"' : 'A4'})
          <br />You can adjust the corners if needed, or click Confirm to continue.
        </p>
      )}

      {/* Image with draggable corner overlays */}
      <div
        ref={containerRef}
        style={{ position: 'relative', maxWidth: 700, maxHeight: 500, cursor: dragIdx !== null ? 'grabbing' : 'default' }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <img
          ref={imgRef}
          src={imageUrl}
          alt="original"
          onLoad={handleImgLoad}
          style={{ display: 'block', maxWidth: 700, maxHeight: 500, objectFit: 'contain' }}
        />
        {imgSize.w > 0 && (
          <svg
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Lines connecting corners */}
            <polygon
              points={corners.map((c) => `${c.x},${c.y}`).join(' ')}
              fill="rgba(124,58,237,0.15)"
              stroke="#a78bfa"
              strokeWidth={Math.max(2, imgSize.w / 300)}
            />
            {/* Corner labels */}
            {['TL', 'TR', 'BR', 'BL'].map((label, i) => (
              <text
                key={label}
                x={corners[i].x + 15}
                y={corners[i].y + 25}
                fill="#a78bfa"
                fontSize={Math.max(16, imgSize.w / 50)}
                style={{ pointerEvents: 'none' }}
              >
                {label}
              </text>
            ))}
          </svg>
        )}
        {/* Draggable corner dots (HTML elements for better pointer handling) */}
        {imgSize.w > 0 && imgRef.current && corners.map((c, i) => {
          const rect = imgRef.current!.getBoundingClientRect()
          const containerRect = containerRef.current!.getBoundingClientRect()
          const scaleX = rect.width / imgSize.w
          const scaleY = rect.height / imgSize.h
          const left = rect.left - containerRect.left + c.x * scaleX
          const top = rect.top - containerRect.top + c.y * scaleY
          return (
            <div
              key={i}
              onPointerDown={(e) => handleCornerPointerDown(e, i)}
              style={{
                position: 'absolute',
                left: left - 12,
                top: top - 12,
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: '#a78bfa',
                border: '3px solid white',
                cursor: 'grab',
                touchAction: 'none',
                pointerEvents: 'all',
                boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              }}
            />
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={() => setView('upload')}
          style={btnStyle}
        >
          ← Back
        </button>
        <button
          onClick={handleConfirm}
          disabled={loading || corners.length !== 4}
          style={corners.length === 4 ? primaryBtn : { ...btnStyle, opacity: 0.5 }}
        >
          {loading ? 'Processing...' : paperDetected ? 'Confirm & View Traces →' : 'Rectify & Trace →'}
        </button>
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 6, border: '1px solid #3f3f46',
  background: '#27272a', color: '#e4e4e7', cursor: 'pointer', fontSize: 14,
}
const primaryBtn: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 6, border: 'none',
  background: '#7c3aed', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 600,
}
