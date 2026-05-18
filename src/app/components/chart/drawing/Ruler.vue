<script setup lang="ts">
import { ref } from 'vue'

export interface RulerDrawing {
  id:        number
  barIndex1: number   // local bar-index cache
  price1:    number
  barIndex2: number   // local bar-index cache
  price2:    number
  time1:     number   // unix seconds — canonical x anchor
  time2:     number   // unix seconds — canonical x anchor
}

const FONT = "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', sans-serif"

const cvs = ref<HTMLCanvasElement | null>(null)

function resize(w: number, h: number, dpr: number): void {
  const el = cvs.value
  if (!el) return
  el.width  = w * dpr
  el.height = h * dpr
  el.style.width  = `${w}px`
  el.style.height = `${h}px`
  el.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath()
  c.moveTo(x + r, y)
  c.lineTo(x + w - r, y)
  c.arcTo(x + w, y,     x + w, y + r,     r)
  c.lineTo(x + w, y + h - r)
  c.arcTo(x + w, y + h, x + w - r, y + h, r)
  c.lineTo(x + r, y + h)
  c.arcTo(x,      y + h, x,      y + h - r, r)
  c.lineTo(x,      y + r)
  c.arcTo(x,      y,     x + r,  y,         r)
  c.closePath()
}

function fmtDelta(v: number): string {
  const sign = v >= 0 ? '+' : ''
  const a    = Math.abs(v)
  const s    = a >= 100 ? v.toFixed(2) : a >= 1 ? v.toFixed(2) : v.toPrecision(3)
  return sign + s
}

function redraw(
  drawings:   RulerDrawing[],
  selectedId: number | null,
  barToX:     (i: number) => number,
  prToY:      (p: number) => number,
  timeToBar:  (t: number) => number,
  plW:        number,
  plH:        number,
  csW:        number,
  csH:        number,
): void {
  const el = cvs.value
  if (!el) return
  const c = el.getContext('2d')!
  c.clearRect(0, 0, csW, csH)
  if (!drawings.length) return

  c.font = FONT

  for (const d of drawings) {
    const x1 = barToX(timeToBar(d.time1) + 0.5)
    const y1 = prToY(d.price1)
    const x2 = barToX(timeToBar(d.time2) + 0.5)
    const y2 = prToY(d.price2)
    const isSelected = d.id === selectedId
    const isUp       = d.price2 >= d.price1

    const left   = Math.min(x1, x2)
    const right  = Math.max(x1, x2)
    const top    = Math.min(y1, y2)
    const bottom = Math.max(y1, y2)
    const rW = right - left
    const rH = bottom - top

    const lineClr = isUp ? '#089981' : '#f23645'
    const fillClr = isUp ? 'rgba(8,153,129,0.12)' : 'rgba(242,54,69,0.12)'

    // Clipped drawing region
    c.save()
    c.beginPath(); c.rect(0, 0, plW, plH); c.clip()

    // Filled rectangle
    c.fillStyle = fillClr
    c.fillRect(left, top, rW, rH)

    // Horizontal price-level lines (top + bottom edges)
    c.strokeStyle = lineClr
    c.lineWidth   = 1
    c.setLineDash([])
    c.beginPath()
    c.moveTo(left, y1); c.lineTo(right, y1)
    c.moveTo(left, y2); c.lineTo(right, y2)
    c.stroke()

    // Vertical bar-boundary lines (dashed)
    c.setLineDash([3, 3])
    c.beginPath()
    c.moveTo(x1, top); c.lineTo(x1, bottom)
    c.moveTo(x2, top); c.lineTo(x2, bottom)
    c.stroke()
    c.setLineDash([])

    c.restore()

    // ── Stats label ──────────────────────────────────────────────────────────
    const barDiff  = Math.abs(timeToBar(d.time2) - timeToBar(d.time1))
    const priceDiff = d.price2 - d.price1
    const pct       = d.price1 !== 0 ? (priceDiff / Math.abs(d.price1)) * 100 : 0
    const pSign     = priceDiff >= 0 ? '+' : ''
    const pctSign   = pct >= 0 ? '+' : ''

    const lines = [
      fmtDelta(priceDiff),
      `${pSign}${pct.toFixed(2)}%`,
      `${barDiff} bar${barDiff === 1 ? '' : 's'}`,
    ]

    c.font = FONT
    c.textBaseline = 'top'
    const lineH = 15
    const pad   = 7
    const maxTW = Math.max(...lines.map(l => c.measureText(l).width))
    const boxW  = maxTW + pad * 2
    const boxH  = lineH * lines.length + pad

    // Centre label inside the measurement rect; clamp to plot area
    let lx = left + (rW - boxW) / 2
    let ly = top  + (rH - boxH) / 2
    lx = Math.max(2, Math.min(plW - boxW - 2, lx))
    ly = Math.max(2, Math.min(plH - boxH - 2, ly))

    c.fillStyle = 'rgba(18,18,18,0.88)'
    roundRect(c, lx, ly, boxW, boxH, 3)
    c.fill()
    c.strokeStyle = isSelected ? '#f0c040' : lineClr
    c.lineWidth   = 1
    roundRect(c, lx, ly, boxW, boxH, 3)
    c.stroke()

    c.fillStyle    = lineClr
    c.textAlign    = 'right'
    for (let i = 0; i < lines.length; i++) {
      c.fillText(lines[i]!, lx + boxW - pad, ly + pad / 2 + i * lineH)
    }
    c.textAlign = 'left'

    // ── Anchor dots when selected ────────────────────────────────────────────
    if (isSelected) {
      for (const [px, py] of [[x1, y1], [x2, y2]] as [number, number][]) {
        c.beginPath()
        c.arc(px, py, 4, 0, Math.PI * 2)
        c.fillStyle   = '#1e222d'
        c.fill()
        c.strokeStyle = '#f0c040'
        c.lineWidth   = 1.5
        c.stroke()
      }
      // Centre drag handle
      c.beginPath()
      c.arc((x1 + x2) / 2, (y1 + y2) / 2, 4, 0, Math.PI * 2)
      c.fillStyle   = '#1e222d'
      c.fill()
      c.strokeStyle = '#f0c040'
      c.lineWidth   = 1.5
      c.stroke()
    }
  }
}

defineExpose({ resize, redraw })
</script>

<template>
  <canvas ref="cvs" class="pc-layer" />
</template>
