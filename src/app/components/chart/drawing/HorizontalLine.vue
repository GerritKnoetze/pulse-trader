<script setup lang="ts">
/**
 * HorizontalLineLayer — canvas overlay for horizontal-line drawings.
 *
 * Rendering is imperative: parent calls resize() on layout changes and
 * redraw() whenever pan/zoom/data changes. This keeps the layer decoupled
 * from PulseChart internals while still using a shared canvas stack.
 */
import { ref } from 'vue'

export interface HorizontalLineDrawing {
  id:    number
  price: number
}

const YELLOW        = '#f0c040'
const YELLOW_GUTTER = '#c49a00'
const FONT          = "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', sans-serif"

const cvs = ref<HTMLCanvasElement | null>(null)

// ── Public API ────────────────────────────────────────────────────────────────

function resize(w: number, h: number, dpr: number): void {
  const cv = cvs.value; if (!cv) return
  cv.width        = Math.round(w * dpr)
  cv.height       = Math.round(h * dpr)
  cv.style.width  = `${w}px`
  cv.style.height = `${h}px`
  cv.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function redraw(
  drawings:   HorizontalLineDrawing[],
  selectedId: number | null,
  prToY:      (p: number) => number,
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
    const y       = prToY(d.price)
    const isSelected = d.id === selectedId
    if (y < 0 || y > plH) continue

    // Line — same yellow always
    c.strokeStyle = YELLOW
    c.lineWidth   = 1
    c.beginPath()
    c.moveTo(0, y); c.lineTo(plW, y)
    c.stroke()

    // Hollow circle at mid-point to indicate selection
    if (isSelected) {
      const cx = plW / 2
      c.beginPath()
      c.arc(cx, y, 4, 0, Math.PI * 2)
      c.strokeStyle = YELLOW
      c.lineWidth   = 1.5
      c.stroke()
      // White fill punch-out so it reads as hollow on the line
      c.beginPath()
      c.arc(cx, y, 2.5, 0, Math.PI * 2)
      c.fillStyle = '#121212'
      c.fill()
    }

    // Price label in the gutter
    const lbl  = fmtPrice(d.price)
    const lW   = c.measureText(lbl).width + 12
    const lH   = 16
    const lX   = plW + 1
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
  <canvas ref="cvs" class="hl-layer" />
</template>

<style scoped>
.hl-layer {
  position:       absolute;
  top:            0;
  left:           0;
  pointer-events: none;
}
</style>
