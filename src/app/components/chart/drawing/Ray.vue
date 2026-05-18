<script setup lang="ts">
/**
 * RayLayer — canvas overlay for diagonal ray drawings.
 * A ray originates at barIndex1/price1, passes through barIndex2/price2,
 * and extends to the appropriate chart edge.
 */
import { ref } from 'vue'

export interface RayDrawing {
  id:        number
  barIndex1: number
  price1:    number
  barIndex2: number
  price2:    number
  time1:     number   // unix seconds — canonical cross-timeframe anchor
  time2:     number
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
  drawings:   RayDrawing[],
  selectedId: number | null,
  barToX:     (i: number) => number,
  prToY:      (p: number) => number,
  yToPr:      (y: number) => number,
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
    const x1         = barToX(timeToBar(d.time1) + 0.5)
    const y1         = prToY(d.price1)
    const x2         = barToX(timeToBar(d.time2) + 0.5)
    const y2         = prToY(d.price2)
    const isSelected = d.id === selectedId
    if (x1 === x2) continue   // degenerate — skip

    const slope    = (y2 - y1) / (x2 - x1)
    const goRight  = x2 > x1
    const edgeX    = goRight ? plW : 0
    const edgeY    = y1 + slope * (edgeX - x1)

    // Clip the origin to the visible plot if it's scrolled off-screen
    let fromX = x1, fromY = y1
    if  (goRight && x1 < 0)   { fromX = 0;   fromY = y1 + slope * (0   - x1) }
    if (!goRight && x1 > plW) { fromX = plW;  fromY = y1 + slope * (plW - x1) }

    // Draw line clipped to plot area
    c.save()
    c.beginPath(); c.rect(0, 0, plW, plH); c.clip()

    c.strokeStyle = YELLOW
    c.lineWidth   = 1
    c.beginPath()
    c.moveTo(fromX, fromY); c.lineTo(edgeX, edgeY)
    c.stroke()

    c.restore()

    // Selection indicator: hollow circles at both anchor points + center circle (whole-line drag)
    if (isSelected) {
      for (const [ax, ay] of [[x1, y1], [x2, y2]] as [number, number][]) {
        c.beginPath()
        c.arc(ax, ay, 4, 0, Math.PI * 2)
        c.strokeStyle = YELLOW
        c.lineWidth   = 1.5
        c.stroke()
        c.beginPath()
        c.arc(ax, ay, 2.5, 0, Math.PI * 2)
        c.fillStyle = '#121212'
        c.fill()
      }
      const midX = (x1 + x2) / 2
      const midY = (y1 + y2) / 2
      c.beginPath()
      c.arc(midX, midY, 4, 0, Math.PI * 2)
      c.strokeStyle = YELLOW
      c.lineWidth   = 1.5
      c.stroke()
      c.beginPath()
      c.arc(midX, midY, 2.5, 0, Math.PI * 2)
      c.fillStyle = '#121212'
      c.fill()
    }

    // Price label on the right axis where the ray exits the plot (only when going right)
    if (goRight && edgeY >= 0 && edgeY <= plH) {
      const lbl = fmtPrice(yToPr(edgeY))
      const lW  = c.measureText(lbl).width + 12
      const lH  = 16
      const lX  = plW + 1
      c.fillStyle = YELLOW_GUTTER
      c.fillRect(lX, edgeY - lH / 2, lW, lH)
      c.fillStyle    = '#fff'
      c.textAlign    = 'center'
      c.textBaseline = 'middle'
      c.fillText(lbl, lX + lW / 2, edgeY)
    }
  }
}

function fmtPrice(p: number): string {
  return p >= 1 ? p.toFixed(2) : p.toPrecision(3)
}

defineExpose({ resize, redraw })
</script>

<template>
  <canvas ref="cvs" class="ray-layer" />
</template>

<style scoped>
.ray-layer {
  position:       absolute;
  top:            0;
  left:           0;
  pointer-events: none;
}
</style>
