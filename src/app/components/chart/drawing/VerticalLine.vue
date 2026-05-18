<script setup lang="ts">
/**
 * VerticalLineLayer — canvas overlay for vertical-line drawings.
 * Each line is pinned to a bar index and spans the full plot height.
 * Mirrors the HorizontalLine layer pattern exactly, rotated 90°.
 */
import { ref } from 'vue'

export interface VerticalLineDrawing {
  id:       number
  barIndex: number
  time:     number   // unix seconds — for the time-axis label
}

const YELLOW        = '#f0c040'
const YELLOW_GUTTER = '#c49a00'
const FONT          = "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', sans-serif"
const TAH           = 20   // must match PulseChart constant

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
  drawings:    VerticalLineDrawing[],
  selectedId:  number | null,
  barToX:      (i: number) => number,
  timeToBar:   (t: number) => number,
  plW:         number,
  plH:         number,
  csW:         number,
  csH:         number,
  timeVisible: boolean,
): void {
  const cv = cvs.value; if (!cv) return
  const c  = cv.getContext('2d'); if (!c) return
  c.clearRect(0, 0, csW, csH)
  if (!drawings.length) return

  c.font = FONT
  c.setLineDash([])

  for (const d of drawings) {
    const x          = barToX(timeToBar(d.time) + 0.5)
    const isSelected = d.id === selectedId
    if (x < 0 || x > plW) continue

    // Full-height vertical line
    c.strokeStyle = YELLOW
    c.lineWidth   = 1
    c.beginPath()
    c.moveTo(x, 0); c.lineTo(x, plH)
    c.stroke()

    // Selection indicator: hollow circle at mid-height
    if (isSelected) {
      const midY = plH / 2
      c.beginPath()
      c.arc(x, midY, 4, 0, Math.PI * 2)
      c.strokeStyle = YELLOW
      c.lineWidth   = 1.5
      c.stroke()
      c.beginPath()
      c.arc(x, midY, 2.5, 0, Math.PI * 2)
      c.fillStyle = '#121212'
      c.fill()
    }

    // Time label in the bottom axis gutter
    const lbl = fmtTime(d.time, timeVisible)
    const lW  = c.measureText(lbl).width + 12
    const lH  = 16
    const lX  = Math.max(0, Math.min(plW - lW, x - lW / 2))
    const lY  = plH + (TAH - lH) / 2
    c.fillStyle = YELLOW_GUTTER
    c.fillRect(lX, lY, lW, lH)
    c.fillStyle    = '#fff'
    c.textAlign    = 'center'
    c.textBaseline = 'middle'
    c.fillText(lbl, lX + lW / 2, lY + lH / 2)
  }
}

function fmtTime(secs: number, intraday: boolean): string {
  const d = new Date(secs * 1000)
  if (intraday) {
    const mo = (d.getMonth() + 1).toString().padStart(2, '0')
    const dy = d.getDate().toString().padStart(2, '0')
    const hh = d.getHours().toString().padStart(2, '0')
    const mm = d.getMinutes().toString().padStart(2, '0')
    return `${mo}/${dy} ${hh}:${mm}`
  }
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${M[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

defineExpose({ resize, redraw })
</script>

<template>
  <canvas ref="cvs" class="vl-layer" />
</template>

<style scoped>
.vl-layer {
  position:       absolute;
  top:            0;
  left:           0;
  pointer-events: none;
}
</style>
