<script setup lang="ts">
import { ref } from 'vue'

export interface TrendlineDrawing {
  id:        number
  barIndex1: number
  price1:    number
  barIndex2: number
  price2:    number
  time1:     number   // unix seconds — canonical cross-timeframe anchor
  time2:     number
}

const YELLOW = '#f0c040'

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

function redraw(
  drawings:   TrendlineDrawing[],
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

  c.setLineDash([])

  for (const d of drawings) {
    const x1 = barToX(timeToBar(d.time1) + 0.5)
    const y1 = prToY(d.price1)
    const x2 = barToX(timeToBar(d.time2) + 0.5)
    const y2 = prToY(d.price2)
    const isSelected = d.id === selectedId

    // Line — draw directly (canvas clips to its bounds; both anchors are in plot area)
    c.strokeStyle = YELLOW
    c.lineWidth   = 1
    c.beginPath()
    c.moveTo(x1, y1); c.lineTo(x2, y2)
    c.stroke()

    // Selection: hollow circles at both endpoints + center circle (whole-line drag)
    if (isSelected) {
      for (const [ex, ey] of [[x1, y1], [x2, y2]] as [number, number][]) {
        c.beginPath()
        c.arc(ex, ey, 4, 0, Math.PI * 2)
        c.fillStyle   = '#1e222d'
        c.fill()
        c.strokeStyle = YELLOW
        c.lineWidth   = 1.5
        c.stroke()
      }
      const midX = (x1 + x2) / 2
      const midY = (y1 + y2) / 2
      c.beginPath()
      c.arc(midX, midY, 4, 0, Math.PI * 2)
      c.fillStyle   = '#1e222d'
      c.fill()
      c.strokeStyle = YELLOW
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
