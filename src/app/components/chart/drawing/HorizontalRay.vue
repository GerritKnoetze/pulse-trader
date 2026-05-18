<script setup lang="ts">
/**
 * HorizontalRay — canvas overlay for horizontal-ray drawings.
 * A ray starts at a fixed bar+price and extends to the right edge of the chart.
 */
import { ref } from 'vue'

export interface HorizontalRayDrawing {
  id:       number
  price:    number
  barIndex: number   // originating chart bar index (local cache)
  time:     number   // unix seconds — canonical cross-timeframe anchor
}

const YELLOW        = '#f0c040'
const YELLOW_GUTTER = '#c49a00'
const FONT          = "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', sans-serif"

const cvs = ref<HTMLCanvasElement | null>(null)

function resize(w: number, h: number, dpr: number): void {
  const cv = cvs.value; if (!cv) return
  cv.width        = Math.round(w * dpr)
  cv.height       = Math.round(h * dpr)
  cv.style.width  = `${w}px`
  cv.style.height = `${h}px`
  cv.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function redraw(
  drawings:   HorizontalRayDrawing[],
  selectedId: number | null,
  prToY:      (p: number) => number,
  barToX:     (i: number) => number,
  timeToBar:  (t: number) => number,
  plW:        number,
  plH:        number,
  csW:        number,
  csH:        number,
): void {
  const cv = cvs.value; if (!cv) return
  const c  = cv.getContext('2d'); if (!c) return
  c.clearRect(0, 0, csW, csH)
  if (!drawings.length) return

  c.font = FONT
  c.setLineDash([])

  for (const d of drawings) {
    const y          = prToY(d.price)
    const startX     = barToX(timeToBar(d.time) + 0.5)
    const isSelected = d.id === selectedId

    if (y < 0 || y > plH) continue
    if (startX > plW) continue   // origin is off-screen to the right — nothing visible

    const drawFrom = Math.max(0, startX)

    // Line from origin (or left edge if scrolled past) to right edge
    c.strokeStyle = YELLOW
    c.lineWidth   = 1
    c.beginPath()
    c.moveTo(drawFrom, y); c.lineTo(plW, y)
    c.stroke()

    // Selection: hollow circle at the ray's origin (first click anchor)
    if (isSelected) {
      const anchorX = Math.max(0, startX)
      c.beginPath()
      c.arc(anchorX, y, 4, 0, Math.PI * 2)
      c.strokeStyle = YELLOW
      c.lineWidth   = 1.5
      c.stroke()
      c.beginPath()
      c.arc(anchorX, y, 2.5, 0, Math.PI * 2)
      c.fillStyle = '#121212'
      c.fill()
    }

    // Price gutter label
    const lbl = fmtPrice(d.price)
    const lW  = c.measureText(lbl).width + 12
    const lH  = 16
    const lX  = plW + 1
    c.fillStyle = YELLOW_GUTTER
    c.fillRect(lX, y - lH / 2, lW, lH)
    c.fillStyle    = '#fff'
    c.textAlign    = 'center'
    c.textBaseline = 'middle'
    c.fillText(lbl, lX + lW / 2, y)
  }
}

function fmtPrice(p: number): string {
  return p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(2) : p.toPrecision(3)
}

defineExpose({ resize, redraw })
</script>

<template>
  <canvas ref="cvs" class="hr-layer" />
</template>

<style scoped>
.hr-layer {
  position:       absolute;
  top:            0;
  left:           0;
  pointer-events: none;
}
</style>
