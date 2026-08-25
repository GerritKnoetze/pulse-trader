<script setup lang="ts">
/**
 * PulseChart — lightweight, zero-dependency, layered canvas candlestick chart.
 * Styled to exactly match TradingView's dark theme.
 *
 * Architecture — 3 stacked <canvas> layers (bottom → top):
 *   bg-canvas    grid lines + axis labels   redraws on resize / pan / zoom
 *   bars-canvas  OHLC candles + markers      redraws on data / pan / zoom
 *   ui-canvas    crosshair + OHLC labels     redraws on every mouse move (RAF)
 *
 * Performance:
 *   • DPR scaling applied once via setTransform — all coords in CSS-pixel space.
 *   • Candles batched: 2 stroke calls (wicks) + 2 fill calls (bodies).
 *   • Only the visible bar window is iterated — O(visible) not O(total).
 *   • Dirty-level RAF coalesces calls: level-1 (crosshair) never retriggers bars.
 */
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useChartSync } from '~/composables/useChartSync'
import { useDrawingTools } from '~/composables/useDrawingTools'
import { hlDrawings, hrDrawings, vlDrawings, rayDrawings, tlDrawings, allocDrawingId, subscribeDrawings, notifyDrawingsChanged } from '~/composables/useDrawings'
import HorizontalLineLayer, { type HorizontalLineDrawing } from './drawing/HorizontalLine.vue'
import HorizontalRayLayer,  { type HorizontalRayDrawing  } from './drawing/HorizontalRay.vue'
import VerticalLineLayer,   { type VerticalLineDrawing   } from './drawing/VerticalLine.vue'
import RayLayer,            { type RayDrawing            } from './drawing/Ray.vue'
import TrendlineLayer,      { type TrendlineDrawing      } from './drawing/Trendline.vue'
import RulerLayer,          { type RulerDrawing          } from './drawing/Ruler.vue'

// ── TradingView dark-theme palette ────────────────────────────────────────────
const TV = {
  bg:      '#121212',
  grid:    '#1e1e1e',
  border:  '#2a2a2a',
  axisTxt: '#787b86',
  up:      '#089981',
  down:    '#f23645',
  xhair:   '#787b86',
  lblBg:   '#242424',
  lblTxt:  '#d1d4dc',
  font:    "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', sans-serif",
} as const

// ── Overlay colours (EMA / VWAP / volume / MACD) ──────────────────────────────
const OVERLAY = {
  ema9:  '#ffffff',
  ema20: '#2196f3',
  ema200:'#ab47bc',
  vwap:  '#ff9800',
  macd:  '#2962ff',
  macdSignal: '#ff6d00',
  volUp:  'rgba(8, 153, 129, 0.35)',
  volDn:  'rgba(242, 54, 69, 0.35)',
  macdUp: 'rgba(8, 153, 129, 0.7)',
  macdDn: 'rgba(242, 54, 69, 0.7)',
} as const

// ── Public types ──────────────────────────────────────────────────────────────
export interface OHLCBar {
  time:  number   // unix seconds
  open:  number
  high:  number
  low:   number
  close: number
  volume?: number
  ema9?: number
  ema20?: number
  ema200?: number
  ema12?: number
  ema26?: number
  macd?: number
  macdSignal?: number
  macdHist?: number
  vwap?: number
}
export interface BarMarker {
  barIndex: number
  text:     string
  color:    string
}

// Which indicator overlays are enabled (toggled from the chart header).
export interface ChartOverlays {
  ema9: boolean
  ema20: boolean
  ema200: boolean
  vwap: boolean
  volume: boolean
  macd: boolean
}

// ── Props ─────────────────────────────────────────────────────────────────────
// NOTE: the overlays default must be an inline literal — Vue hoists the
// withDefaults factory, so it cannot reference a locally declared binding.
const props = withDefaults(defineProps<{
  bars:         OHLCBar[]
  markers?:     BarMarker[]
  timeVisible?: boolean
  showSeconds?: boolean
  overlays?:    ChartOverlays
}>(), {
  markers:     () => [],
  timeVisible: false,
  showSeconds: false,
  overlays:    () => ({ ema9: false, ema20: true, ema200: false, vwap: false, volume: true, macd: false }),
})

// ── Crosshair sync ────────────────────────────────────────────────────────────
const { syncEnabled, syncTime, syncPrice, setSyncTime, setSyncPrice } = useChartSync()
const { activeTool, selectedDrawingId, selectDrawing, clearSelection, setActiveTool, magnetEnabled } = useDrawingTools()

// ── Canvas refs ───────────────────────────────────────────────────────────────
const wrapEl  = ref<HTMLDivElement | null>(null)
const bgCvs   = ref<HTMLCanvasElement | null>(null)
const barsCvs = ref<HTMLCanvasElement | null>(null)
const uiCvs   = ref<HTMLCanvasElement | null>(null)
const hlLayer = ref<InstanceType<typeof HorizontalLineLayer> | null>(null)
const hrLayer = ref<InstanceType<typeof HorizontalRayLayer>  | null>(null)
const vlLayer = ref<InstanceType<typeof VerticalLineLayer>   | null>(null)
const rayLayer    = ref<InstanceType<typeof RayLayer>           | null>(null)
const tlLayer     = ref<InstanceType<typeof TrendlineLayer>    | null>(null)
const rulerLayer  = ref<InstanceType<typeof RulerLayer>        | null>(null)

// ── Layout constants ──────────────────────────────────────────────────────────
let   PAW   = 52   // right price-axis width (px) — recalculated dynamically
const TAH   = 20   // bottom time-axis height (px)
const RMAR  = 5    // extra bar slots on the right (used by resetView)
const PAD   = 0.08 // vertical price padding (8 %)
const MINVB = 5    // minimum visible bars (maximum zoom-in)

// The right-side empty margin is a CONSTANT FRACTION of the plot width (≈ the
// reset-view gap) rather than a fixed number of bar slots — otherwise zooming in
// makes the margin grow (5 slots × a big slot-width), while a too-small margin
// cuts off the last candle. rightEdgeIndex() maps the current visible range to
// the right-edge bar index so the LAST candle sits a constant pixel gap from the
// price gutter at any zoom level (half slot for the candle centre + half body,
// then the gap). CANDLE_HALF_BODY_SLOTS ≈ bodyW/2 relative to the slot width.
const RIGHT_GAP_FRAC = RMAR / (60 + RMAR)
const CANDLE_HALF_BODY_SLOTS = 0.3

// ── Viewport state  (plain vars — intentionally NOT reactive) ─────────────────
let dpr  = 1
let csW  = 0   // full canvas CSS width
let csH  = 0   // full canvas CSS height
let plW  = 0   // plot area width  = csW - PAW
let plH  = 0   // plot area height = csH - TAH (all panes)

// Sub-pane layout (computed from the enabled overlays):
let priceH = 0   // price pane height (candles + overlays)
let macdY0 = 0   // top of the MACD pane (0 when disabled)
let macdH  = 0   // MACD pane height (0 when disabled)
let macdGap = 0  // gap between price pane and MACD pane
let volH   = 0   // volume-region height at the bottom of the price pane (0 when off)

let vFrom = 0  // first visible bar index (float)
let vTo   = 0  // last  visible bar index (float)
let pMin  = 0  // visible price min
let pMax  = 1  // visible price max

// When the user drags the right price gutter, candle height becomes manual:
// this overrides the auto-fit price range until "Reset chart". null = autofit.
let manualPriceRange: { pMin: number; pMax: number } | null = null

// MACD pane value range (visible bars), zero line always included.
let macdMin = 0
let macdMax = 0

// True when the viewport is NOT showing the right-most (live) candle — shows the
// "snap to latest" arrow. Kept reactive so the button appears/disappears as the
// user pans or the live candle advances.
const canSnapToLatest = ref(false)

// Reactive copy of the dynamic right price-axis width so the snap button sits
// INSIDE the plot area (left of the gutter) rather than on top of it.
const priceAxisW = ref(52)

// ── Coordinate transforms ─────────────────────────────────────────────────────
const barToX = (i: number) => (i - vFrom) / (vTo - vFrom) * plW
const prToY  = (p: number) => priceH - (p - pMin) / (pMax - pMin) * priceH
const xToBar = (x: number) => vFrom + x / plW * (vTo - vFrom)
const yToPr  = (y: number) => pMin  + (1 - y / priceH) * (pMax - pMin)
const macdToY = (v: number) => macdY0 + macdH - (v - macdMin) / (macdMax - macdMin) * macdH
const yToMacd = (y: number) => macdMin + (1 - (y - macdY0) / macdH) * (macdMax - macdMin)

// Binary-search props.bars for the bar whose .time is closest to the given
// unix timestamp.  Returns a local bar index valid for this chart instance.
function timeToBar(time: number): number {
  const arr = props.bars
  if (!arr.length) return 0
  let lo = 0, hi = arr.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid]!.time < time) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(arr[lo - 1]!.time - time) < Math.abs(arr[lo]!.time - time)) return lo - 1
  return lo
}

function cx(cv: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  return cv?.getContext('2d') ?? null
}

// ── Price range ───────────────────────────────────────────────────────────────
function computePriceRange(): void {
  const bars = props.bars
  // Auto-fit is disabled once the user scales the price gutter manually.
  if (manualPriceRange) {
    pMin = manualPriceRange.pMin
    pMax = manualPriceRange.pMax
    if (pMin >= pMax) pMax = pMin + 1e-9
    return
  }
  if (!bars.length) { pMin = 0; pMax = 1; return }

  const f = Math.max(0, Math.floor(vFrom))
  const t = Math.min(bars.length - 1, Math.ceil(vTo))
  let lo = Infinity, hi = -Infinity
  for (let i = f; i <= t; i++) {
    const b = bars[i]!
    if (b.low  < lo) lo = b.low
    if (b.high > hi) hi = b.high
  }
  if (!isFinite(lo)) { pMin = 0; pMax = 1; return }

  const pad = (hi - lo) * PAD
  pMin = lo - pad
  pMax = hi + pad
  if (pMin >= pMax) pMax = pMin + 1
}

// ── Sub-pane layout ───────────────────────────────────────────────────────────
function computePanes(): void {
  const macdOn = !!props.overlays?.macd
  macdGap = macdOn ? 8 : 0
  macdH = macdOn ? Math.max(36, Math.round(plH * 0.22)) : 0
  priceH = plH - macdH - macdGap
  macdY0 = priceH + macdGap
  const volOn = !!props.overlays?.volume
  volH = volOn ? Math.max(14, Math.round(priceH * 0.16)) : 0
}

// MACD value range over the visible bars (zero line always in range).
function computeMacdRange(): void {
  macdMin = 0
  macdMax = 0
  if (!props.overlays?.macd || !props.bars.length) return
  const f = Math.max(0, Math.floor(vFrom))
  const t = Math.min(props.bars.length - 1, Math.ceil(vTo))
  let lo = 0, hi = 0
  for (let i = f; i <= t; i++) {
    const b = props.bars[i]!
    for (const v of [b.macd, b.macdSignal, b.macdHist]) {
      if (v == null) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  const span = Math.max(1e-9, hi - lo)
  const pad = span * 0.12
  macdMin = lo - pad
  macdMax = hi + pad
  if (macdMin >= macdMax) macdMax = macdMin + 1
}

// ── Dynamic price-axis width ──────────────────────────────────────────────────
function computePAW(): void {
  const c = cx(bgCvs.value)
  if (!c) return
  c.font = TV.font
  // Measure both extremes — whichever is wider sets the gutter
  const w = Math.max(
    c.measureText(fmtPrice(pMin)).width,
    c.measureText(fmtPrice(pMax)).width,
  )
  const newPAW = Math.ceil(w) + 18  // 6px left pad + 6px right pad + 6px border gap
  if (newPAW !== PAW) {
    PAW = newPAW
    plW = csW - PAW
  }
  priceAxisW.value = PAW
}

// ── Canvas sizing ─────────────────────────────────────────────────────────────
function resizeAll(): void {
  const el = wrapEl.value
  if (!el) return
  dpr = window.devicePixelRatio || 1
  csW = el.clientWidth
  csH = el.clientHeight
  plW = csW - PAW
  plH = csH - TAH
  computePanes()

  // Dynamically size the price axis after resizing
  computePAW()

  for (const cv of [bgCvs.value, barsCvs.value, uiCvs.value]) {
    if (!cv) continue
    cv.width        = Math.round(csW * dpr)
    cv.height       = Math.round(csH * dpr)
    cv.style.width  = `${csW}px`
    cv.style.height = `${csH}px`
    // Apply DPR scale once — all subsequent drawing uses CSS-pixel coords
    cv.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  hlLayer.value?.resize(csW, csH, dpr)
  hrLayer.value?.resize(csW, csH, dpr)
  vlLayer.value?.resize(csW, csH, dpr)
  rayLayer.value?.resize(csW, csH, dpr)
  tlLayer.value?.resize(csW, csH, dpr)
  rulerLayer.value?.resize(csW, csH, dpr)
}

// ── Layer: background / grid ──────────────────────────────────────────────────
function drawBg(): void {
  const c = cx(bgCvs.value)
  if (!c) return

  c.clearRect(0, 0, csW, csH)
  c.fillStyle = TV.bg
  c.fillRect(0, 0, csW, csH)

  const rng = pMax - pMin
  if (rng > 0) {
    const tgt   = Math.max(3, Math.floor(plH / 42))
    const step  = niceStep(rng / tgt)
    const first = Math.ceil(pMin / step) * step

    c.lineWidth    = 1
    c.strokeStyle  = TV.grid
    c.setLineDash([])
    c.font         = TV.font
    c.fillStyle    = TV.axisTxt
    c.textAlign    = 'right'
    c.textBaseline = 'middle'
    c.beginPath()
    for (let p = first; p < pMax + step * 0.01; p += step) {
      const y = prToY(p)
      if (y < -1 || y > priceH + 1) continue
      c.moveTo(0, y); c.lineTo(plW, y)
      c.fillText(fmtPrice(p), csW - 6, y)
    }
    c.stroke()
  }

  drawTimeAxis(c)

  // ── MACD sub-pane: grid + right-axis labels + zero line ─────────────────────
  if (props.overlays?.macd && macdH > 0) {
    const span = macdMax - macdMin
    const step = niceStep(span / 3)
    const first = Math.ceil(macdMin / step) * step
    c.lineWidth    = 1
    c.strokeStyle  = TV.grid
    c.setLineDash([])
    c.font         = TV.font
    c.fillStyle    = TV.axisTxt
    c.textAlign    = 'right'
    c.textBaseline = 'middle'
    c.beginPath()
    for (let v = first; v < macdMax + step * 0.01; v += step) {
      const y = macdToY(v)
      if (y < macdY0 - 1 || y > macdY0 + macdH + 1) continue
      c.moveTo(0, y); c.lineTo(plW, y)
      c.fillText(fmtNum(v), csW - 6, y)
    }
    c.stroke()

    // Zero line
    const zy = macdToY(0)
    if (zy >= macdY0 && zy <= macdY0 + macdH) {
      c.strokeStyle = TV.border
      c.beginPath()
      c.moveTo(0, zy); c.lineTo(plW, zy)
      c.stroke()
    }
  }

  // Volume (VOL) is shown in the top-left OHLCV readout — no static pane label.

  // Axis border lines
  c.strokeStyle = TV.border
  c.lineWidth   = 1
  c.setLineDash([])
  c.beginPath()
  c.moveTo(plW, 0); c.lineTo(plW, csH)
  c.moveTo(0, plH); c.lineTo(csW, plH)
  // Separator between the price pane and the MACD pane
  if (macdH > 0) { c.moveTo(0, macdY0); c.lineTo(csW, macdY0) }
  c.stroke()
}

function drawTimeAxis(c: CanvasRenderingContext2D): void {
  const bars = props.bars
  if (!bars.length) return

  const range     = vTo - vFrom
  const maxLabels = Math.max(2, Math.floor(plW / 80))
  const step      = niceStepInt(range / maxLabels)
  const f         = Math.max(0, Math.floor(vFrom))
  const t         = Math.min(bars.length - 1, Math.ceil(vTo))
  const start     = Math.ceil(f / step) * step

  c.strokeStyle = TV.grid
  c.lineWidth   = 1
  c.setLineDash([])
  c.beginPath()
  for (let i = start; i <= t; i += step) {
    const x = barToX(i + 0.5)
    if (x < 0 || x > plW) continue
    c.moveTo(x, 0); c.lineTo(x, plH)
  }
  c.stroke()

  c.fillStyle    = TV.axisTxt
  c.font         = TV.font
  c.textAlign    = 'center'
  c.textBaseline = 'middle'
  for (let i = start; i <= t; i += step) {
    const b = bars[i]; if (!b) continue
    const x = barToX(i + 0.5)
    if (x < 4 || x > plW - 4) continue
    c.fillText(fmtTime(b.time, props.timeVisible), x, plH + TAH / 2)
  }
}

// ── Layer: candlestick bars ───────────────────────────────────────────────────

/** Polyline for one per-bar numeric overlay (EMA / VWAP). Skips nulls cleanly. */
function drawOverlayLine(
  c: CanvasRenderingContext2D,
  field: keyof OHLCBar,
  color: string,
  f: number,
  t: number,
): void {
  const bars = props.bars
  // Clip to the PRICE pane so EMA/VWAP values that fall outside the visible
  // price range never paint into the MACD pane below.
  c.save()
  c.beginPath()
  c.rect(0, 0, plW, priceH)
  c.clip()
  c.strokeStyle = color
  c.lineWidth   = 1
  c.setLineDash([])
  c.beginPath()
  let pen = false
  for (let i = f; i <= t; i++) {
    const v = bars[i]?.[field]
    if (typeof v !== 'number' || Number.isNaN(v)) { pen = false; continue }
    const x = barToX(i + 0.5)
    const y = prToY(v)
    if (pen) c.lineTo(x, y)
    else c.moveTo(x, y)
    pen = true
  }
  c.stroke()
  c.restore()
}

/** Volume histogram at the bottom of the price pane (scaled to the series max). */
function drawVolume(c: CanvasRenderingContext2D, f: number, t: number, slotW: number): void {
  if (!props.overlays?.volume || volH <= 0) return
  const bars = props.bars
  let max = 0
  for (const b of bars) if (b.volume && b.volume > max) max = b.volume
  if (max <= 0) return
  const baseY = priceH
  const width = Math.max(1, Math.min(slotW * 0.6, slotW - 1))
  const upRects: number[][] = []
  const dnRects: number[][] = []
  for (let i = f; i <= t; i++) {
    const b = bars[i]!
    const v = b.volume && b.volume > 0 ? b.volume : 0
    const h = Math.max(1, (v / max) * volH)
    const rect = [barToX(i + 0.5) - width / 2, baseY - h, width, h]
    if (b.close >= b.open) upRects.push(rect)
    else dnRects.push(rect)
  }
  c.fillStyle = OVERLAY.volUp
  for (const r of upRects) c.fillRect(r[0], r[1], r[2], r[3])
  c.fillStyle = OVERLAY.volDn
  for (const r of dnRects) c.fillRect(r[0], r[1], r[2], r[3])
}

/** MACD sub-pane: histogram + MACD line + signal line. */
function drawMacdPane(c: CanvasRenderingContext2D, f: number, t: number, slotW: number): void {
  if (!props.overlays?.macd || macdH <= 0) return
  const bars = props.bars
  // Clip to the MACD pane so the histogram/signals never bleed up into the
  // price pane (EMA/VWAP area).
  c.save()
  c.beginPath()
  c.rect(0, macdY0, plW, macdH)
  c.clip()
  const width = Math.max(1, Math.min(slotW * 0.6, slotW - 1))
  const upRects: number[][] = []
  const dnRects: number[][] = []
  for (let i = f; i <= t; i++) {
    const b = bars[i]!
    const h = b.macdHist
    if (h == null || h === 0) continue
    const yZero = macdToY(0)
    const yVal = macdToY(h)
    const yT = Math.min(yZero, yVal)
    const hh = Math.max(1, Math.abs(yVal - yZero))
    const rect = [barToX(i + 0.5) - width / 2, yT, width, hh]
    if (h >= 0) upRects.push(rect)
    else dnRects.push(rect)
  }
  c.fillStyle = OVERLAY.macdUp
  for (const r of upRects) c.fillRect(r[0], r[1], r[2], r[3])
  c.fillStyle = OVERLAY.macdDn
  for (const r of dnRects) c.fillRect(r[0], r[1], r[2], r[3])

  drawMacdLine(c, 'macd', OVERLAY.macd, f, t)
  drawMacdLine(c, 'macdSignal', OVERLAY.macdSignal, f, t)
  c.restore()
}

function drawMacdLine(c: CanvasRenderingContext2D, field: keyof OHLCBar, color: string, f: number, t: number): void {
  const bars = props.bars
  c.strokeStyle = color
  c.lineWidth   = 1
  c.setLineDash([])
  c.beginPath()
  let pen = false
  for (let i = f; i <= t; i++) {
    const v = bars[i]?.[field]
    if (typeof v !== 'number' || Number.isNaN(v)) { pen = false; continue }
    const x = barToX(i + 0.5)
    const y = macdToY(v)
    if (pen) c.lineTo(x, y)
    else c.moveTo(x, y)
    pen = true
  }
  c.stroke()
}

function drawBars(): void {
  const c = cx(barsCvs.value)
  if (!c) return

  c.clearRect(0, 0, csW, csH)

  // Clip all bar drawing to the plot area so candles never paint over the price gutter
  c.save()
  c.beginPath()
  c.rect(0, 0, plW, plH)
  c.clip()

  const bars = props.bars

  if (!bars.length) {
    c.fillStyle    = TV.axisTxt
    c.font         = TV.font
    c.textAlign    = 'center'
    c.textBaseline = 'middle'
    c.fillText('No data', plW / 2, plH / 2)
    c.restore()
    return
  }

  const f     = Math.max(0, Math.floor(vFrom))
  const t     = Math.min(bars.length - 1, Math.ceil(vTo))
  const range = vTo - vFrom
  const slotW = plW / range
  const bodyW = Math.max(1, Math.min(slotW * 0.6, slotW - 1))
  const wickW = 1

  // Volume bars first (under the candles)
  drawVolume(c, f, t, slotW)

  // Collect geometry — 4 arrays, one call per color
  type Rect = [number, number, number, number]
  type Line = [number, number, number, number]
  const upBdy: Rect[] = [], dnBdy: Rect[] = []
  const upWk:  Line[] = [], dnWk:  Line[] = []

  for (let i = f; i <= t; i++) {
    const b  = bars[i]!
    const xc = barToX(i + 0.5)
    const yH = prToY(b.high),  yL = prToY(b.low)
    const yO = prToY(b.open),  yC = prToY(b.close)
    const yT = Math.min(yO, yC)
    const yB = Math.max(yO, yC)
    const bh = Math.max(1, yB - yT)
    if (b.close >= b.open) {
      upBdy.push([xc - bodyW / 2, yT, bodyW, bh])
      upWk.push ([xc, yH, xc, yL])
    } else {
      dnBdy.push([xc - bodyW / 2, yT, bodyW, bh])
      dnWk.push ([xc, yH, xc, yL])
    }
  }

  // Wicks first, bodies on top
  c.lineWidth   = wickW
  c.strokeStyle = TV.up
  c.beginPath()
  for (const [x1,y1,x2,y2] of upWk) { c.moveTo(x1,y1); c.lineTo(x2,y2) }
  c.stroke()

  c.strokeStyle = TV.down
  c.beginPath()
  for (const [x1,y1,x2,y2] of dnWk) { c.moveTo(x1,y1); c.lineTo(x2,y2) }
  c.stroke()

  c.fillStyle = TV.up
  for (const [x,y,w,h] of upBdy) c.fillRect(x, y, w, h)

  c.fillStyle = TV.down
  for (const [x,y,w,h] of dnBdy) c.fillRect(x, y, w, h)

  // ── Price-pane overlay lines (EMA / VWAP) ───────────────────────────────────
  const ov = props.overlays
  if (ov?.ema9)   drawOverlayLine(c, 'ema9',  OVERLAY.ema9,  f, t)
  if (ov?.ema20)  drawOverlayLine(c, 'ema20', OVERLAY.ema20, f, t)
  if (ov?.ema200) drawOverlayLine(c, 'ema200',OVERLAY.ema200,f, t)
  if (ov?.vwap)   drawOverlayLine(c, 'vwap',  OVERLAY.vwap,  f, t)

  // Bar markers (Strat bar-type labels)
  if (props.markers.length) {
    const fs = Math.max(8, Math.min(11, slotW * 0.55))
    c.font         = `bold ${fs}px -apple-system, sans-serif`
    c.textAlign    = 'center'
    c.textBaseline = 'bottom'
    for (const m of props.markers) {
      if (m.barIndex < f || m.barIndex > t) continue
      const b = bars[m.barIndex]; if (!b) continue
      c.fillStyle = m.color
      c.fillText(m.text, barToX(m.barIndex + 0.5), prToY(b.high) - 3)
    }
  }

  // ── MACD sub-pane ───────────────────────────────────────────────────────────
  drawMacdPane(c, f, t, slotW)

  // Restore clip so the last-price line and gutter label can draw outside the plot area
  c.restore()

  // ── Last-price line + gutter label ────────────────────────────────────────
  const last = bars[bars.length - 1]
  if (last) {
    const isUp  = last.close >= last.open
    const color = isUp ? TV.up : TV.down
    const y     = prToY(last.close)

    if (y >= 0 && y <= priceH) {
      // Dotted horizontal line across plot area — 50% opacity
      c.strokeStyle = isUp
        ? 'rgba(8, 153, 129, 0.5)'
        : 'rgba(242, 54, 69, 0.5)'
      c.lineWidth   = 1
      c.setLineDash([2, 3])
      c.beginPath()
      c.moveTo(0, y); c.lineTo(plW, y)
      c.stroke()
      c.setLineDash([])

      // Filled label box in the gutter
      const lbl  = fmtPrice(last.close)
      c.font     = TV.font
      const lW   = c.measureText(lbl).width + 12
      const lH   = 16
      const lX   = plW + 1
      const lY   = y - lH / 2
      c.fillStyle = color
      c.fillRect(lX, lY, lW, lH)
      c.fillStyle    = '#fff'
      c.textAlign    = 'center'
      c.textBaseline = 'middle'
      c.fillText(lbl, lX + lW / 2, y)
    }
  }
}

// ── Layer: UI (crosshair + labels — redraws at pointer rate) ─────────────────
let cxX = -1, cxY = -1
let isHovered  = false
let ctrlHeld   = false   // tracks Ctrl key for OHLC snap

// Returns the OHLC value (H/L/O/C) of the bar at cxX closest to a given price
function snapOHLC(price: number): number {
  if (!props.bars.length) return price
  const bi  = Math.max(0, Math.min(props.bars.length - 1, Math.round(xToBar(cxX))))
  const b   = props.bars[bi]; if (!b) return price
  const candidates = [b.open, b.high, b.low, b.close]
  let best = candidates[0]!
  let bestDist = Math.abs(best - price)
  for (const v of candidates) {
    const d = Math.abs(v - price)
    if (d < bestDist) { bestDist = d; best = v }
  }
  return best
}

function drawUI(): void {
  const c = cx(uiCvs.value)
  if (!c) return

  // Determine crosshair coords — local hover takes priority, then external sync
  let drawX = cxX
  let drawY = cxY

  if (!isHovered && syncEnabled.value && syncTime.value != null) {
    const si = findBarByTime(syncTime.value)
    if (si >= 0 && si < props.bars.length) {
      drawX = barToX(si + 0.5)
      // Convert the broadcasted price to this chart's local Y using its own price scale
      if (syncPrice.value != null) drawY = prToY(syncPrice.value)
    }
  }

  // Snap the vertical crosshair to the nearest candle centre (horizontal stays freeform)
  if (isHovered && props.bars.length) {
    const snapBi = Math.max(0, Math.min(props.bars.length - 1, Math.round(xToBar(drawX))))
    drawX = barToX(snapBi + 0.5)
  }

  c.clearRect(0, 0, csW, csH)
  if (drawX < 0 || drawX > plW || drawY < 0 || drawY > plH) return

  // Ctrl/magnet snap: lock drawY to nearest OHLC of the bar under cursor
  if (isHovered && (ctrlHeld || magnetEnabled.value)) {
    const snapped = snapOHLC(yToPr(drawY))
    drawY = prToY(snapped)
  }

  // ── Crosshair lines ────────────────────────────────────────────────────────
  c.strokeStyle = TV.xhair
  c.lineWidth   = 1
  c.setLineDash([4, 4])
  c.beginPath()
  c.moveTo(drawX, 0);  c.lineTo(drawX, plH)
  c.moveTo(0, drawY);  c.lineTo(plW, drawY)
  c.stroke()
  c.setLineDash([])

  // ── Ray pending preview (dashed line from anchor to cursor) ──────────────
  if (isHovered && activeTool.value === 'ray' && rayPending !== null && props.bars.length) {
    const px1 = barToX(rayPending.barIndex + 0.5)
    const py1 = prToY(rayPending.price)
    if (px1 !== drawX) {
      const slope   = (drawY - py1) / (drawX - px1)
      const goRight = drawX > px1
      const edgeX   = goRight ? plW : 0
      const edgeY   = py1 + slope * (edgeX - px1)
      let fromX = px1, fromY = py1
      if  (goRight && px1 < 0)   { fromX = 0;   fromY = py1 + slope * (0   - px1) }
      if (!goRight && px1 > plW) { fromX = plW;  fromY = py1 + slope * (plW - px1) }
      c.save()
      c.beginPath(); c.rect(0, 0, plW, plH); c.clip()
      c.strokeStyle = '#f0c040'
      c.lineWidth   = 1
      c.setLineDash([4, 4])
      c.beginPath()
      c.moveTo(fromX, fromY); c.lineTo(edgeX, edgeY)
      c.stroke()
      c.setLineDash([])
      c.restore()
    }
    // Anchor dot
    c.beginPath()
    c.arc(px1, py1, 3, 0, Math.PI * 2)
    c.strokeStyle = '#f0c040'
    c.lineWidth   = 1.5
    c.stroke()
  }

  // ── Ruler pending preview (semi-transparent rect from anchor to cursor) ────
  if (isHovered && activeTool.value === 'ruler' && rulerPending !== null && props.bars.length) {
    const px1 = barToX(rulerPending.barIndex + 0.5)
    const py1 = prToY(rulerPending.price)
    const isUp = drawY < py1  // canvas y is inverted
    c.save()
    c.beginPath(); c.rect(0, 0, plW, plH); c.clip()
    const rLineClr = isUp ? '#089981' : '#f23645'
    c.fillStyle = isUp ? 'rgba(8,153,129,0.10)' : 'rgba(242,54,69,0.10)'
    c.fillRect(Math.min(px1, drawX), Math.min(py1, drawY), Math.abs(drawX - px1), Math.abs(drawY - py1))
    c.strokeStyle = rLineClr
    c.lineWidth   = 1
    c.setLineDash([])
    c.beginPath()
    c.moveTo(Math.min(px1, drawX), py1); c.lineTo(Math.max(px1, drawX), py1)
    c.moveTo(Math.min(px1, drawX), drawY); c.lineTo(Math.max(px1, drawX), drawY)
    c.stroke()
    c.setLineDash([3, 3])
    c.beginPath()
    c.moveTo(px1, Math.min(py1, drawY)); c.lineTo(px1, Math.max(py1, drawY))
    c.moveTo(drawX, Math.min(py1, drawY)); c.lineTo(drawX, Math.max(py1, drawY))
    c.stroke()
    c.setLineDash([])
    c.beginPath()
    c.arc(px1, py1, 3, 0, Math.PI * 2)
    c.strokeStyle = rLineClr
    c.lineWidth   = 1.5
    c.stroke()
    c.restore()
    // Live info box — updated every mouse-move before second anchor is placed
    const curBarIdx  = Math.max(0, Math.min(props.bars.length - 1, Math.round(xToBar(drawX))))
    const curPrice   = yToPr(drawY)
    const priceDiff  = curPrice - rulerPending.price
    const pct        = rulerPending.price !== 0 ? (priceDiff / Math.abs(rulerPending.price)) * 100 : 0
    const pSign      = priceDiff >= 0 ? '+' : ''
    const rBarDiff   = Math.abs(curBarIdx - rulerPending.barIndex)
    const rLeft      = Math.min(px1, drawX)
    const rRight     = Math.max(px1, drawX)
    const rTop       = Math.min(py1, drawY)
    const rBottom    = Math.max(py1, drawY)
    // Direction-aware legend (same convention as the finished Ruler legend):
    //   long  (isUp):  Close top → stats → Open bottom
    //   short (!isUp): Open   top → stats → Close bottom
    const rStats = [
      (priceDiff >= 0 ? '+' : '') + (Math.abs(priceDiff) >= 100 ? priceDiff.toFixed(2) : Math.abs(priceDiff) >= 1 ? priceDiff.toFixed(2) : priceDiff.toPrecision(3)),
      `${pSign}${pct.toFixed(2)}%`,
      `${rBarDiff} bar${rBarDiff === 1 ? '' : 's'}`,
    ]
    const rInfoLines = isUp
      ? [`C: ${fmtPrice(curPrice)}`, ...rStats, `O: ${fmtPrice(rulerPending.price)}`]
      : [`O: ${fmtPrice(rulerPending.price)}`, ...rStats, `C: ${fmtPrice(curPrice)}`]
    rulerLayer.value?.drawInfoBox(c, rLeft, rRight, rTop, rBottom, isUp, rLineClr, rInfoLines, plW, plH)
    rulerLayer.value?.drawYLabels(c, py1, rulerPending.price, drawY, curPrice, isUp, plW, plH)
  }

  // ── Trendline pending preview (dashed line from anchor to cursor) ──────────
  if (isHovered && activeTool.value === 'trendline' && tlPending !== null && props.bars.length) {
    const px1 = barToX(tlPending.barIndex + 0.5)
    const py1 = prToY(tlPending.price)
    c.save()
    c.beginPath(); c.rect(0, 0, plW, plH); c.clip()
    c.strokeStyle = '#f0c040'
    c.lineWidth   = 1
    c.setLineDash([4, 4])
    c.beginPath()
    c.moveTo(px1, py1); c.lineTo(drawX, drawY)
    c.stroke()
    c.setLineDash([])
    for (const [ex, ey] of [[px1, py1], [drawX, drawY]] as [number, number][]) {
      c.beginPath()
      c.arc(ex, ey, 3, 0, Math.PI * 2)
      c.strokeStyle = '#f0c040'
      c.lineWidth   = 1.5
      c.stroke()
    }
    c.restore()
  }

  // ── Right-axis label (price pane or MACD pane) ────────────────────────────
  const inMacdPane = macdH > 0 && drawY >= macdY0 && drawY <= macdY0 + macdH

  if (inMacdPane) {
    const mVal = yToMacd(drawY)
    const mLbl = fmtNum(mVal)
    c.font      = TV.font
    const mW    = c.measureText(mLbl).width + 14
    const mH    = 16
    const mX    = plW + 1
    const mY    = drawY - mH / 2
    c.fillStyle   = TV.lblBg
    c.fillRect(mX, mY, mW, mH)
    c.strokeStyle = TV.border
    c.lineWidth   = 1
    c.strokeRect(mX, mY, mW, mH)
    c.fillStyle    = TV.lblTxt
    c.textAlign    = 'center'
    c.textBaseline = 'middle'
    c.fillText(mLbl, mX + mW / 2, drawY)
  } else if (drawY <= priceH) {
    // Price label (right axis)
    const price = yToPr(drawY)
    const pLbl  = fmtPrice(price)
    c.font      = TV.font
    const pW    = c.measureText(pLbl).width + 14
    const pH    = 16
    const pX    = plW + 1
    const pY    = drawY - pH / 2
    c.fillStyle   = TV.lblBg
    c.fillRect(pX, pY, pW, pH)
    c.strokeStyle = TV.border
    c.lineWidth   = 1
    c.strokeRect(pX, pY, pW, pH)
    c.fillStyle    = TV.lblTxt
    c.textAlign    = 'center'
    c.textBaseline = 'middle'
    c.fillText(pLbl, pX + pW / 2, drawY)
  }

  // ── Time label (bottom axis) ──────────────────────────────────────────────
  // drawX is always at bar-centre (barToX(i + 0.5)), so xToBar returns i + 0.5.
  // Math.floor gives the correct bar index; Math.round would give i + 1 (off by one).
  const bi  = Math.max(0, Math.min(props.bars.length - 1, Math.floor(xToBar(drawX))))
  const bar = props.bars[bi]
  if (!bar) return

  const tLbl = fmtTimeFull(bar.time, props.timeVisible, props.showSeconds)
  const tW   = c.measureText(tLbl).width + 14
  const tH   = 16
  const tX   = Math.max(0, Math.min(plW - tW, drawX - tW / 2))
  const tY   = plH + (TAH - tH) / 2
  c.fillStyle   = TV.lblBg
  c.fillRect(tX, tY, tW, tH)
  c.strokeStyle = TV.border
  c.strokeRect(tX, tY, tW, tH)
  c.fillStyle    = TV.lblTxt
  c.textAlign    = 'center'
  c.textBaseline = 'middle'
  c.fillText(tLbl, tX + tW / 2, tY + tH / 2)

  // ── Readout (top-left header): price pane → OHLCV + overlay legend; MACD pane → MACD values ──
  c.font         = TV.font
  c.textAlign    = 'left'
  c.textBaseline = 'top'

  if (inMacdPane) {
    // MACD readout sits in the top-left corner of the MACD pane.
    const pairs: [string, number | undefined, string][] = [
      ['MACD', bar.macd, OVERLAY.macd],
      ['SIG', bar.macdSignal, OVERLAY.macdSignal],
      ['HIST', bar.macdHist, bar.macdHist != null && bar.macdHist >= 0 ? TV.up : TV.down],
    ]
    let mx = 8
    const my = macdY0 + 6
    for (const [lbl, val, clr] of pairs) {
      const txt = val == null ? '—' : fmtNum(val)
      c.fillStyle = TV.axisTxt
      c.fillText(lbl, mx, my)
      mx += c.measureText(lbl).width + 2
      c.fillStyle = val == null ? TV.axisTxt : clr
      c.fillText(txt, mx, my)
      mx += c.measureText(txt).width + 10
    }
  } else if (drawY <= priceH) {
    const isUp = bar.close >= bar.open
    let rx = 8
    const ry = 6
    for (const [lbl, val, clr] of [
      ['O', fmtPrice(bar.open),  TV.axisTxt          ],
      ['H', fmtPrice(bar.high),  TV.up               ],
      ['L', fmtPrice(bar.low),   TV.down             ],
      ['C', fmtPrice(bar.close), isUp ? TV.up : TV.down],
      ['V', bar.volume == null ? '—' : fmtVol(bar.volume), TV.axisTxt],
    ] as [string, string, string][]) {
      c.fillStyle = TV.axisTxt
      c.fillText(lbl, rx, ry)
      rx += c.measureText(lbl).width + 2
      c.fillStyle = clr
      c.fillText(val, rx, ry)
      rx += c.measureText(val).width + 10
    }

    // Overlay legend — enabled EMA/VWAP lines with their value at the hovered bar.
    const legend: [string, string, string][] = []
    const ov = props.overlays
    if (ov?.vwap)   legend.push(['VWAP',  bar.vwap   == null ? '—' : fmtNum(bar.vwap),  OVERLAY.vwap])
    if (ov?.ema9)   legend.push(['EMA9',  bar.ema9   == null ? '—' : fmtNum(bar.ema9),  OVERLAY.ema9])
    if (ov?.ema20)  legend.push(['EMA20', bar.ema20  == null ? '—' : fmtNum(bar.ema20), OVERLAY.ema20])
    if (ov?.ema200) legend.push(['EMA200',bar.ema200 == null ? '—' : fmtNum(bar.ema200),OVERLAY.ema200])
    if (legend.length) {
      let lx = 8
      const ly = 20
      for (const [lbl, txt, clr] of legend) {
        c.fillStyle = clr
        c.fillText(lbl, lx, ly)
        lx += c.measureText(lbl).width + 2
        c.fillText(txt, lx, ly)
        lx += c.measureText(txt).width + 12
      }
    }
  }
}

// ── Redraw scheduler ──────────────────────────────────────────────────────────
// dirty levels:  0 = nothing pending
//                1 = UI layer only  (crosshair)
//                2 = full redraw    (data / pan / zoom / resize)
let rafId = 0
let dirty  = 0

// ── Per-instance pending state for two-click drawing tools ──────────────────
let rayPending:   { barIndex: number; price: number } | null = null
let tlPending:    { barIndex: number; price: number } | null = null
let rulerPending: { barIndex: number; price: number } | null = null
// Ruler drawings are LOCAL to this chart instance — not shared across timeframes
const localRulerDrawings: RulerDrawing[] = []

function schedule(level: 1 | 2): void {
  if (level > dirty) dirty = level
  cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(flush)
}

function drawDrawings(): void {
  hlLayer.value?.redraw(hlDrawings,   selectedDrawingId.value, prToY,                            plW, plH, csW, csH)
  hrLayer.value?.redraw(hrDrawings,   selectedDrawingId.value, prToY,  barToX, timeToBar,        plW, plH, csW, csH)
  vlLayer.value?.redraw(vlDrawings,   selectedDrawingId.value, barToX, timeToBar,                plW, plH, csW, csH, props.timeVisible)
  rayLayer.value?.redraw(rayDrawings, selectedDrawingId.value, barToX, prToY,   yToPr, timeToBar, plW, plH, csW, csH)
  tlLayer.value?.redraw(tlDrawings,          selectedDrawingId.value, barToX, prToY,   timeToBar,        plW, plH, csW, csH)
  rulerLayer.value?.redraw(localRulerDrawings, selectedDrawingId.value, barToX, prToY,   timeToBar,        plW, plH, csW, csH)
}

// Find horizontal-line drawing within HIT_PX of a Y coordinate
function findHLNear(y: number): HorizontalLineDrawing | null {
  const HIT = 6
  for (const d of hlDrawings) {
    if (Math.abs(prToY(d.price) - y) <= HIT) return d
  }
  return null
}

// Find horizontal-ray drawing within HIT_PX (must be to the right of the ray origin)
function findHRNear(x: number, y: number): HorizontalRayDrawing | null {
  const HIT = 6
  for (const d of hrDrawings) {
    if (Math.abs(prToY(d.price) - y) > HIT) continue
    if (x >= barToX(timeToBar(d.time) + 0.5) - HIT) return d
  }
  return null
}

// Find vertical-line drawing within HIT_PX of an X coordinate
function findVLNear(x: number): VerticalLineDrawing | null {
  const HIT = 6
  for (const d of vlDrawings) {
    if (Math.abs(barToX(timeToBar(d.time) + 0.5) - x) <= HIT) return d
  }
  return null
}

// Find ray drawing within HIT_PX of the extended line
function findRayNear(x: number, y: number): RayDrawing | null {
  const HIT = 6
  for (const d of rayDrawings) {
    const x1 = barToX(timeToBar(d.time1) + 0.5)
    const y1 = prToY(d.price1)
    const x2 = barToX(timeToBar(d.time2) + 0.5)
    const y2 = prToY(d.price2)
    if (x1 === x2) continue
    const goRight = x2 > x1
    if  (goRight && x < x1 - HIT) continue   // left of origin
    if (!goRight && x > x1 + HIT) continue   // right of origin
    const dx = x2 - x1, dy = y2 - y1
    const dist = Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / Math.sqrt(dx * dx + dy * dy)
    if (dist <= HIT) return d
  }
  return null
}

// Find ruler drawing — hit inside the bounding rectangle
function findRulerNear(x: number, y: number): RulerDrawing | null {
  const HIT = 6
  for (const d of localRulerDrawings) {
    const x1 = barToX(timeToBar(d.time1) + 0.5)
    const y1 = prToY(d.price1)
    const x2 = barToX(timeToBar(d.time2) + 0.5)
    const y2 = prToY(d.price2)
    if (x >= Math.min(x1, x2) - HIT && x <= Math.max(x1, x2) + HIT &&
        y >= Math.min(y1, y2) - HIT && y <= Math.max(y1, y2) + HIT) return d
  }
  return null
}

// Find trendline drawing within HIT_PX of the line segment
function findTrendlineNear(x: number, y: number): TrendlineDrawing | null {
  const HIT = 6
  for (const d of tlDrawings) {
    const x1 = barToX(timeToBar(d.time1) + 0.5)
    const y1 = prToY(d.price1)
    const x2 = barToX(timeToBar(d.time2) + 0.5)
    const y2 = prToY(d.price2)
    const dx = x2 - x1, dy = y2 - y1
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) continue
    const t     = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lenSq))
    const nearX = x1 + t * dx
    const nearY = y1 + t * dy
    if (Math.sqrt((x - nearX) ** 2 + (y - nearY) ** 2) <= HIT) return d
  }
  return null
}

function flush(): void {
  if (dirty >= 2) { computePriceRange(); computeMacdRange(); computePAW(); drawBg(); drawBars() }
  if (dirty >= 1) { drawUI(); drawDrawings() }
  dirty = 0
}

// ── View management ───────────────────────────────────────────────────────────
function resetView(): void {
  const n = props.bars.length
  if (!n) return
  const vis = Math.min(n, 60)
  vFrom = n - vis
  vTo   = n - 1 + RMAR
  computePriceRange()
  drawBg(); drawBars(); drawUI(); drawDrawings()
  updateSnapFlag()
}

function atRightEdge(): boolean {
  const n = props.bars.length
  if (!n) return false
  const range = Math.max(MINVB, vTo - vFrom)
  return vTo >= rightEdgeIndex(range) - 1.5
}

/** Right-edge bar index for a given visible range, keeping a constant pixel margin. */
function rightEdgeIndex(range: number): number {
  return (props.bars.length - 0.5) + CANDLE_HALF_BODY_SLOTS + RIGHT_GAP_FRAC * range
}

/** Reflect whether the user has scrolled off the live (right-most) candle. */
function updateSnapFlag(): void {
  canSnapToLatest.value = props.bars.length > 0 && !atRightEdge()
}

/** Jump to the right-most candle, PRESERVING the current zoom and the fixed right margin. */
function snapToLatest(): void {
  const n = props.bars.length
  if (!n) return
  const range = Math.max(MINVB, vTo - vFrom)
  vTo   = rightEdgeIndex(range)
  vFrom = Math.max(0, vTo - range)
  schedule(2)
  updateSnapFlag()
}

/** Start a vertical-scale drag on the right price gutter (disables auto-fit). */
function startGutterDrag(e: MouseEvent): void {
  if (!manualPriceRange) {
    // First drag seeds the manual range from the current auto-fit so repeated
    // drags build on it — auto-fit stays off until the user resets the chart.
    manualPriceRange = { pMin, pMax }
  }
  const y = Math.max(0, Math.min(priceH, e.offsetY))
  const anchorPrice = yToPr(y)
  const range = Math.max(1e-9, pMax - pMin)
  gutterDrag = {
    startClientY: e.clientY,
    anchorPrice,
    anchorRatio: Math.min(1, Math.max(0, (anchorPrice - pMin) / range)),
    pMin0: pMin,
    pMax0: pMax,
  }
  if (wrapEl.value) wrapEl.value.style.cursor = 'ns-resize'
}

/** Apply a gutter drag: scale the price range around the drag anchor. */
function applyGutterDrag(e: MouseEvent): void {
  if (!gutterDrag) return
  const dyPix = e.clientY - gutterDrag.startClientY
  // Drag up (negative) → scale<1 → range shrinks → candles grow (expand).
  // Drag down (positive) → scale>1 → range grows → candles shrink (contract).
  const scale = Math.exp(dyPix * 0.006)
  const pMin0 = gutterDrag.pMin0
  const pMax0 = gutterDrag.pMax0
  const range0 = Math.max(1e-9, pMax0 - pMin0)
  const anchor = gutterDrag.anchorPrice
  const ratio = gutterDrag.anchorRatio
  const newRange = Math.max(1e-9, range0 * scale)
  manualPriceRange = {
    pMin: anchor - ratio * newRange,
    pMax: anchor + (1 - ratio) * newRange,
  }
  computePriceRange()
  computeMacdRange()
  schedule(2)
}

function endGutterDrag(): void {
  gutterDrag = null
  if (wrapEl.value) wrapEl.value.style.cursor = 'crosshair'
}

/** "Reset chart": re-enable auto-fit (price range) and reset the horizontal view. */
function resetChart(): void {
  manualPriceRange = null
  resetView()
  schedule(2)
  dismissCtxMenu()
}

defineExpose({ resetView })

// ── Interaction handlers ──────────────────────────────────────────────────────
let isDrag   = false
let panMoved = false   // true once pointer moved enough to count as a pan
let dx0 = 0, vFrom0 = 0, vTo0 = 0
let dy0 = 0, pMin0drag = 0, pMax0drag = 0 // vertical-pan snapshot (free-form drag)

// ── Price-gutter vertical-scale drag ──────────────────────────────────────────
// Dragging the right price axis up/down expands/contracts candle height and
// DISABLES the auto-fit (manualPriceRange takes over) until "Reset chart".
interface GutterDrag {
  startClientY: number
  anchorPrice:  number  // price under the cursor at drag start (kept fixed)
  anchorRatio:  number  // 0..1 fraction down the pane of the anchor
  pMin0: number
  pMax0: number
}
let gutterDrag: GutterDrag | null = null

// ── Anchor drag state ────────────────────────────────────────────────────────
// anchor 3 = center circle (whole-line drag for ray/tl)
let anchorDrag: {
  type: 'hl' | 'hr' | 'vl' | 'ray' | 'tl' | 'ruler'
  id: number
  anchor: 1 | 2 | 3
  initX: number; initY: number
  snap?: { time1: number; price1: number; time2: number; price2: number }
} | null = null

// Returns the anchor hit by (x,y) on the currently selected drawing, or null.
function findSelectedAnchorHit(x: number, y: number): { type: 'hl' | 'hr' | 'vl' | 'ray' | 'tl' | 'ruler'; id: number; anchor: 1 | 2 | 3 } | null {
  const sid = selectedDrawingId.value
  if (sid === null) return null
  const HIT = 8

  const hl = hlDrawings.find(d => d.id === sid)
  if (hl && Math.hypot(x - plW / 2, y - prToY(hl.price)) <= HIT)
    return { type: 'hl', id: sid, anchor: 1 }

  const hr = hrDrawings.find(d => d.id === sid)
  if (hr && Math.hypot(x - Math.max(0, barToX(timeToBar(hr.time) + 0.5)), y - prToY(hr.price)) <= HIT)
    return { type: 'hr', id: sid, anchor: 1 }

  const vl = vlDrawings.find(d => d.id === sid)
  if (vl && Math.hypot(x - barToX(timeToBar(vl.time) + 0.5), y - plH / 2) <= HIT)
    return { type: 'vl', id: sid, anchor: 1 }

  const ray = rayDrawings.find(d => d.id === sid)
  if (ray) {
    if (Math.hypot(x - barToX(timeToBar(ray.time1) + 0.5), y - prToY(ray.price1)) <= HIT)
      return { type: 'ray', id: sid, anchor: 1 }
    if (Math.hypot(x - barToX(timeToBar(ray.time2) + 0.5), y - prToY(ray.price2)) <= HIT)
      return { type: 'ray', id: sid, anchor: 2 }
    const rMidX = (barToX(timeToBar(ray.time1) + 0.5) + barToX(timeToBar(ray.time2) + 0.5)) / 2
    const rMidY = (prToY(ray.price1) + prToY(ray.price2)) / 2
    if (Math.hypot(x - rMidX, y - rMidY) <= HIT)
      return { type: 'ray', id: sid, anchor: 3 }
  }

  const tl = tlDrawings.find(d => d.id === sid)
  if (tl) {
    if (Math.hypot(x - barToX(timeToBar(tl.time1) + 0.5), y - prToY(tl.price1)) <= HIT)
      return { type: 'tl', id: sid, anchor: 1 }
    if (Math.hypot(x - barToX(timeToBar(tl.time2) + 0.5), y - prToY(tl.price2)) <= HIT)
      return { type: 'tl', id: sid, anchor: 2 }
    const tMidX = (barToX(timeToBar(tl.time1) + 0.5) + barToX(timeToBar(tl.time2) + 0.5)) / 2
    const tMidY = (prToY(tl.price1) + prToY(tl.price2)) / 2
    if (Math.hypot(x - tMidX, y - tMidY) <= HIT)
      return { type: 'tl', id: sid, anchor: 3 }
  }

  const ruler = localRulerDrawings.find(d => d.id === sid)
  if (ruler) {
    const rx1 = barToX(timeToBar(ruler.time1) + 0.5)
    const ry1 = prToY(ruler.price1)
    const rx2 = barToX(timeToBar(ruler.time2) + 0.5)
    const ry2 = prToY(ruler.price2)
    if (Math.hypot(x - rx1, y - ry1) <= HIT) return { type: 'ruler', id: sid, anchor: 1 }
    if (Math.hypot(x - rx2, y - ry2) <= HIT) return { type: 'ruler', id: sid, anchor: 2 }
    if (Math.hypot(x - (rx1 + rx2) / 2, y - (ry1 + ry2) / 2) <= HIT)
      return { type: 'ruler', id: sid, anchor: 3 }
  }

  return null
}

// Mutate the dragged anchor to the given canvas position.
function applyAnchorDrag(x: number, y: number): void {
  if (!anchorDrag) return
  const { type, id, anchor, initX, initY, snap } = anchorDrag

  // Whole-line drag (center circle, anchor === 3)
  if (anchor === 3 && snap) {
    const dBar   = xToBar(x) - xToBar(initX)
    const dPrice = yToPr(y)  - yToPr(initY)
    const clamp  = (bi: number) => Math.max(0, Math.min(props.bars.length - 1, Math.round(bi)))
    if (type === 'ray') {
      const d = rayDrawings.find(d => d.id === id)
      if (d) {
        const newBi1 = clamp(timeToBar(snap.time1) + dBar)
        const newBi2 = clamp(timeToBar(snap.time2) + dBar)
        d.barIndex1 = newBi1; d.time1 = props.bars[newBi1]?.time ?? snap.time1; d.price1 = snap.price1 + dPrice
        d.barIndex2 = newBi2; d.time2 = props.bars[newBi2]?.time ?? snap.time2; d.price2 = snap.price2 + dPrice
      }
    } else if (type === 'tl') {
      const d = tlDrawings.find(d => d.id === id)
      if (d) {
        const newBi1 = clamp(timeToBar(snap.time1) + dBar)
        const newBi2 = clamp(timeToBar(snap.time2) + dBar)
        d.barIndex1 = newBi1; d.time1 = props.bars[newBi1]?.time ?? snap.time1; d.price1 = snap.price1 + dPrice
        d.barIndex2 = newBi2; d.time2 = props.bars[newBi2]?.time ?? snap.time2; d.price2 = snap.price2 + dPrice
      }
    } else if (type === 'ruler') {
      const d = localRulerDrawings.find(d => d.id === id)
      if (d) {
        const newBi1 = clamp(timeToBar(snap.time1) + dBar)
        const newBi2 = clamp(timeToBar(snap.time2) + dBar)
        d.barIndex1 = newBi1; d.time1 = props.bars[newBi1]?.time ?? snap.time1; d.price1 = snap.price1 + dPrice
        d.barIndex2 = newBi2; d.time2 = props.bars[newBi2]?.time ?? snap.time2; d.price2 = snap.price2 + dPrice
      }
      return  // local drawing — no notifyDrawingsChanged needed
    }
    return
  }

  // Endpoint drag (anchor 1 or 2): absolute position
  const bi    = Math.max(0, Math.min(props.bars.length - 1, Math.round(xToBar(x))))
  const price = yToPr(y)

  if (type === 'hl') {
    const d = hlDrawings.find(d => d.id === id)
    if (d) d.price = price
  } else if (type === 'hr') {
    const d = hrDrawings.find(d => d.id === id)
    if (d) { d.price = price; d.barIndex = bi; d.time = props.bars[bi]?.time ?? d.time }
  } else if (type === 'vl') {
    const d = vlDrawings.find(d => d.id === id)
    if (d) { d.barIndex = bi; const bar = props.bars[bi]; if (bar) d.time = bar.time }
  } else if (type === 'ray') {
    const d = rayDrawings.find(d => d.id === id)
    if (d) {
      if (anchor === 1) { d.barIndex1 = bi; d.time1 = props.bars[bi]?.time ?? d.time1; d.price1 = price }
      else              { d.barIndex2 = bi; d.time2 = props.bars[bi]?.time ?? d.time2; d.price2 = price }
    }
  } else if (type === 'tl') {
    const d = tlDrawings.find(d => d.id === id)
    if (d) {
      if (anchor === 1) { d.barIndex1 = bi; d.time1 = props.bars[bi]?.time ?? d.time1; d.price1 = price }
      else              { d.barIndex2 = bi; d.time2 = props.bars[bi]?.time ?? d.time2; d.price2 = price }
    }
  } else if (type === 'ruler') {
    const d = localRulerDrawings.find(d => d.id === id)
    if (d) {
      if (anchor === 1) { d.barIndex1 = bi; d.time1 = props.bars[bi]?.time ?? d.time1; d.price1 = price }
      else              { d.barIndex2 = bi; d.time2 = props.bars[bi]?.time ?? d.time2; d.price2 = price }
    }
    return  // local drawing — caller schedule(1) is sufficient
  }
  notifyDrawingsChanged()
}

function onMouseMove(e: MouseEvent): void {
  isHovered = true
  // Price-gutter vertical-scale drag takes priority.
  if (gutterDrag) {
    applyGutterDrag(e)
    return
  }
  // Anchor drag takes priority over chart pan
  if (anchorDrag) {
    applyAnchorDrag(e.offsetX, e.offsetY)
    cxX = e.offsetX; cxY = e.offsetY
    schedule(1)
    return
  }
  if (isDrag) {
    // Horizontal pan (always) + vertical pan only when free-form (autofit off),
    // so a drag "moves" the candles around the pane until the user resets.
    const vMoved = manualPriceRange ? Math.abs(e.clientY - dy0) > 3 : false
    if (Math.abs(e.clientX - dx0) > 3 || vMoved) panMoved = true
    const shift = (dx0 - e.clientX) / plW * (vTo0 - vFrom0)
    const range = vTo0 - vFrom0
    const maxTo = rightEdgeIndex(range)
    vFrom       = Math.max(0, vFrom0 + shift)
    vTo         = vFrom + range
    if (vTo > maxTo) { vTo = maxTo; vFrom = Math.max(0, vTo - range) }
    if (manualPriceRange) {
      const priceDelta = (e.clientY - dy0) *
        ((manualPriceRange.pMax - manualPriceRange.pMin) / Math.max(1, priceH))
      manualPriceRange = { pMin: pMin0drag + priceDelta, pMax: pMax0drag + priceDelta }
      computePriceRange()
    }
  }
  // Always update crosshair
  cxX      = e.offsetX
  cxY      = e.offsetY
  ctrlHeld = e.ctrlKey
  if (syncEnabled.value && props.bars.length) {
    const bi = Math.max(0, Math.min(props.bars.length - 1, Math.round(xToBar(cxX))))
    setSyncTime(props.bars[bi]?.time ?? null)
    const rawPrice = yToPr(cxY)
    setSyncPrice((ctrlHeld || magnetEnabled.value) ? snapOHLC(rawPrice) : rawPrice)
  }
  // Cursor: gutter → vertical resize; over anchor → grab; near a drawing line →
  // pointer; else crosshair
  if (wrapEl.value && !isDrag && !gutterDrag) {
    if (e.offsetX >= plW) {
      wrapEl.value.style.cursor = 'ns-resize'
    } else {
      const overAnchor = activeTool.value === null && e.offsetX < plW &&
        !!findSelectedAnchorHit(e.offsetX, e.offsetY)
      const near = !overAnchor && activeTool.value === null && e.offsetX < plW &&
        (!!findHLNear(e.offsetY) || !!findHRNear(e.offsetX, e.offsetY) || !!findVLNear(e.offsetX) || !!findRayNear(e.offsetX, e.offsetY) || !!findTrendlineNear(e.offsetX, e.offsetY) || !!findRulerNear(e.offsetX, e.offsetY))
      wrapEl.value.style.cursor = overAnchor ? 'grab' : near ? 'pointer' : 'crosshair'
    }
  }
  updateSnapFlag()
  schedule(isDrag ? 2 : 1)
}

function onMouseLeave(): void {
  anchorDrag = null
  isHovered  = false
  ctrlHeld   = false
  isDrag     = false
  cxX = -1; cxY = -1
  if (wrapEl.value) wrapEl.value.style.cursor = 'crosshair'
  if (syncEnabled.value) { setSyncTime(null); setSyncPrice(null) }
  schedule(1)
}

function onMouseDown(e: MouseEvent): void {
  // Check if clicking on an anchor of the selected drawing — start anchor drag
  if (activeTool.value === null && e.offsetX < plW && e.offsetY < priceH) {
    const hit = findSelectedAnchorHit(e.offsetX, e.offsetY)
    if (hit) {
      // For center-circle drag (anchor 3), snapshot the drawing's current positions
      let snap: { time1: number; price1: number; time2: number; price2: number } | undefined = undefined
      if (hit.anchor === 3) {
        if (hit.type === 'ray') {
          const d = rayDrawings.find(d => d.id === hit.id)
          if (d) snap = { time1: d.time1, price1: d.price1, time2: d.time2, price2: d.price2 }
        } else if (hit.type === 'tl') {
          const d = tlDrawings.find(d => d.id === hit.id)
          if (d) snap = { time1: d.time1, price1: d.price1, time2: d.time2, price2: d.price2 }
        } else if (hit.type === 'ruler') {
          const d = localRulerDrawings.find(d => d.id === hit.id)
          if (d) snap = { time1: d.time1, price1: d.price1, time2: d.time2, price2: d.price2 }
        }
      }
      anchorDrag = { ...hit, initX: e.offsetX, initY: e.offsetY, snap }
      if (wrapEl.value) wrapEl.value.style.cursor = 'grabbing'
      return
    }
  }
  // Right price gutter → vertical candle scale (not horizontal pan).
  if (e.offsetX >= plW) {
    startGutterDrag(e)
    return
  }
  isDrag    = true
  panMoved  = false
  dx0       = e.clientX
  dy0       = e.clientY
  vFrom0    = vFrom
  vTo0      = vTo
  pMin0drag = pMin
  pMax0drag = pMax
}

function onMouseUp(e: MouseEvent): void {
  if (gutterDrag) {
    endGutterDrag()
    return
  }
  if (anchorDrag) {
    applyAnchorDrag(e.offsetX, e.offsetY)
    anchorDrag = null
    if (wrapEl.value) wrapEl.value.style.cursor = 'crosshair'
    schedule(1)
    return
  }
  const wasPan = panMoved
  isDrag   = false
  panMoved = false
  if (!wasPan) onChartClick(e)
}

function onChartClick(e: MouseEvent): void {
  // Shift+click: auto-activate the ruler tool and fall through to place first anchor
  if (e.shiftKey && activeTool.value !== 'ruler' && e.offsetX < plW && e.offsetY < priceH && props.bars.length) {
    clearSelection()
    activeTool.value = 'ruler'
    rulerPending = null  // ensure clean state for a fresh ruler
  }

  if (activeTool.value === 'horizontal-line' && e.offsetX < plW && e.offsetY < priceH) {
    const rawPrice  = yToPr(e.offsetY)
    const price     = e.ctrlKey ? snapOHLC(rawPrice) : rawPrice
    hlDrawings.push({ id: allocDrawingId(), price })
    setActiveTool('horizontal-line') // toggles back to null (auto-deselect)
    notifyDrawingsChanged()
    return
  }
  if (activeTool.value === 'horizontal-ray' && e.offsetX < plW && e.offsetY < priceH) {
    const rawPrice = yToPr(e.offsetY)
    const price    = e.ctrlKey ? snapOHLC(rawPrice) : rawPrice
    const barIndex = Math.max(0, Math.min(props.bars.length - 1, Math.round(xToBar(e.offsetX))))
    hrDrawings.push({ id: allocDrawingId(), price, barIndex, time: props.bars[barIndex]?.time ?? 0 })
    setActiveTool('horizontal-ray')
    notifyDrawingsChanged()
    return
  }
  if (activeTool.value === 'vertical-line' && e.offsetX < plW && e.offsetY < priceH) {
    const barIndex = Math.max(0, Math.min(props.bars.length - 1, Math.round(xToBar(e.offsetX))))
    const bar      = props.bars[barIndex]
    if (bar) vlDrawings.push({ id: allocDrawingId(), barIndex, time: bar.time })
    setActiveTool('vertical-line')
    notifyDrawingsChanged()
    return
  }
  if (activeTool.value === 'ray' && e.offsetX < plW && e.offsetY < priceH) {
    const barIndex = Math.max(0, Math.min(props.bars.length - 1, Math.round(xToBar(e.offsetX))))
    const price    = yToPr(e.offsetY)
    if (rayPending === null) {
      rayPending = { barIndex, price }   // first click — anchor origin
    } else {
      if (barIndex !== rayPending.barIndex) {
        rayDrawings.push({
          id:        allocDrawingId(),
          barIndex1: rayPending.barIndex,
          price1:    rayPending.price,
          barIndex2: barIndex,
          price2:    price,
          time1:     props.bars[rayPending.barIndex]?.time ?? 0,
          time2:     props.bars[barIndex]?.time ?? 0,
        })
      }
      rayPending = null
      setActiveTool('ray')   // toggle off after second click
    }
    notifyDrawingsChanged()
    return
  }
  if (activeTool.value === 'trendline' && e.offsetX < plW && e.offsetY < priceH) {
    const barIndex = Math.max(0, Math.min(props.bars.length - 1, Math.round(xToBar(e.offsetX))))
    const price    = yToPr(e.offsetY)
    if (tlPending === null) {
      tlPending = { barIndex, price }   // first click — anchor start
    } else {
      if (barIndex !== tlPending.barIndex || price !== tlPending.price) {
        tlDrawings.push({
          id:        allocDrawingId(),
          barIndex1: tlPending.barIndex,
          price1:    tlPending.price,
          barIndex2: barIndex,
          price2:    price,
          time1:     props.bars[tlPending.barIndex]?.time ?? 0,
          time2:     props.bars[barIndex]?.time ?? 0,
        })
      }
      tlPending = null
      setActiveTool('trendline')   // toggle off after second click
    }
    notifyDrawingsChanged()
    return
  }
  if (activeTool.value === 'ruler' && e.offsetX < plW && e.offsetY < priceH) {
    const barIndex = Math.max(0, Math.min(props.bars.length - 1, Math.round(xToBar(e.offsetX))))
    const price    = yToPr(e.offsetY)
    if (rulerPending === null) {
      rulerPending = { barIndex, price }   // first click — anchor start
    } else {
      if (barIndex !== rulerPending.barIndex || price !== rulerPending.price) {
        localRulerDrawings.push({
          id:        allocDrawingId(),
          barIndex1: rulerPending.barIndex,
          price1:    rulerPending.price,
          barIndex2: barIndex,
          price2:    price,
          time1:     props.bars[rulerPending.barIndex]?.time ?? 0,
          time2:     props.bars[barIndex]?.time ?? 0,
        })
      }
      rulerPending = null
      setActiveTool('ruler')   // toggle off after second click
    }
    schedule(1)   // local drawing — no need to notify other charts
    return
  }
  // Selection mode — no active tool
  if (activeTool.value === null && e.offsetX < plW && e.offsetY < priceH) {
    const hitHL = findHLNear(e.offsetY)
    const hitHR = !hitHL ? findHRNear(e.offsetX, e.offsetY) : null
    const hitVL  = !hitHL && !hitHR ? findVLNear(e.offsetX) : null
    const hitRay = !hitHL && !hitHR && !hitVL ? findRayNear(e.offsetX, e.offsetY) : null
    const hitTL    = !hitHL && !hitHR && !hitVL && !hitRay ? findTrendlineNear(e.offsetX, e.offsetY) : null
    const hitRuler = !hitHL && !hitHR && !hitVL && !hitRay && !hitTL ? findRulerNear(e.offsetX, e.offsetY) : null
    if (hitHL) {
      const hitId = hitHL.id
      selectDrawing(hitId, () => {
        const idx = hlDrawings.findIndex(d => d.id === hitId)
        if (idx >= 0) hlDrawings.splice(idx, 1)
        notifyDrawingsChanged()
      })
    } else if (hitHR) {
      const hitId = hitHR.id
      selectDrawing(hitId, () => {
        const idx = hrDrawings.findIndex(d => d.id === hitId)
        if (idx >= 0) hrDrawings.splice(idx, 1)
        notifyDrawingsChanged()
      })
    } else if (hitVL) {
      const hitId = hitVL.id
      selectDrawing(hitId, () => {
        const idx = vlDrawings.findIndex(d => d.id === hitId)
        if (idx >= 0) vlDrawings.splice(idx, 1)
        notifyDrawingsChanged()
      })
    } else if (hitRay) {
      const hitId = hitRay.id
      selectDrawing(hitId, () => {
        const idx = rayDrawings.findIndex(d => d.id === hitId)
        if (idx >= 0) rayDrawings.splice(idx, 1)
        notifyDrawingsChanged()
      })
    } else if (hitTL) {
      const hitId = hitTL.id
      selectDrawing(hitId, () => {
        const idx = tlDrawings.findIndex(d => d.id === hitId)
        if (idx >= 0) tlDrawings.splice(idx, 1)
        notifyDrawingsChanged()
      })
    } else if (hitRuler) {
      const hitId = hitRuler.id
      selectDrawing(hitId, () => {
        const idx = localRulerDrawings.findIndex(d => d.id === hitId)
        if (idx >= 0) localRulerDrawings.splice(idx, 1)
        schedule(1)   // local — no cross-chart notification needed
      })
    } else {
      clearSelection()
    }
    schedule(1)
  }
}

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  const pivot = xToBar(e.offsetX)
  const range = (vTo - vFrom) * (e.deltaY > 0 ? 1.15 : 0.87)
  const clamp = Math.max(MINVB, Math.min(props.bars.length + RMAR, range))
  const ratio = (pivot - vFrom) / (vTo - vFrom)
  vFrom       = pivot - clamp * ratio
  vTo         = vFrom + clamp
  const maxTo = rightEdgeIndex(clamp)
  if (vTo > maxTo) { vTo = maxTo; vFrom = Math.max(0, vTo - clamp) }
  vFrom       = Math.max(0, vFrom)
  updateSnapFlag()
  schedule(2)
}

function onDblClick(): void { resetView() }

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtPrice(p: number): string {
  return p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(2) : p.toPrecision(3)
}

/** Compact formatter for indicator values (EMA/MACD/VWAP) — keeps ticks tidy. */
/** Compact volume formatter (e.g. 1.24M) for the VOL legend readout. */
function fmtVol(p: number): string {
  const a = Math.abs(p)
  if (a >= 1e9) return (p / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return (p / 1e6).toFixed(2) + 'M'
  if (a >= 1e3) return (p / 1e3).toFixed(1) + 'K'
  return String(p)
}

function fmtNum(p: number): string {
  const a = Math.abs(p)
  if (a >= 100) return p.toFixed(2)
  if (a >= 1) return p.toFixed(2)
  if (a >= 0.001) return p.toPrecision(3)
  return p.toPrecision(2)
}

function fmtTime(secs: number, intraday: boolean): string {
  const d = new Date(secs * 1000)
  return intraday
    ? `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    : `${d.getMonth() + 1}/${d.getDate()}`
}

function fmtTimeFull(secs: number, intraday: boolean, showSeconds: boolean): string {
  const d = new Date(secs * 1000)
  if (intraday) {
    const mo = (d.getMonth() + 1).toString().padStart(2, '0')
    const dy = d.getDate().toString().padStart(2, '0')
    const hh = d.getHours().toString().padStart(2, '0')
    const mm = d.getMinutes().toString().padStart(2, '0')
    const ss = showSeconds ? `:${d.getSeconds().toString().padStart(2, '0')}` : ''
    return `${mo}/${dy} ${hh}:${mm}${ss}`
  }
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${M[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag
  return 10 * mag
}

function niceStepInt(raw: number): number {
  return Math.max(1, Math.round(niceStep(Math.max(raw, 0.5))))
}

// Binary search — find bar index with time closest to target
function findBarByTime(time: number): number {
  const bars = props.bars
  if (!bars.length) return -1
  let lo = 0, hi = bars.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (bars[mid]!.time < time) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(bars[lo - 1]!.time - time) < Math.abs(bars[lo]!.time - time)) {
    return lo - 1
  }
  return lo
}

// ── Context menu ─────────────────────────────────────────────────────────────
const ctxMenu = ref<{ x: number; y: number } | null>(null)

function onContextMenu(e: MouseEvent): void {
  e.preventDefault()
  ctxMenu.value = { x: e.clientX, y: e.clientY }
}

function dismissCtxMenu(): void {
  ctxMenu.value = null
}

function deleteAllDrawings(): void {
  hlDrawings.splice(0)
  hrDrawings.splice(0)
  vlDrawings.splice(0)
  rayDrawings.splice(0)
  tlDrawings.splice(0)
  localRulerDrawings.splice(0)
  clearSelection()
  notifyDrawingsChanged()
  schedule(1)
  dismissCtxMenu()
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
let ro: ResizeObserver | null = null

onMounted(() => {
  resizeAll()
  resetView()
  ro = new ResizeObserver(() => { resizeAll(); schedule(2) })
  if (wrapEl.value) ro.observe(wrapEl.value)
  window.addEventListener('keydown', onKeyCtrl)
  window.addEventListener('keyup',   onKeyCtrl)
  // Redraw this chart whenever any drawing changes (including changes made on other timeframes)
  const unsub = subscribeDrawings(() => schedule(1))
  onUnmounted(unsub)
})

onUnmounted(() => {
  ro?.disconnect()
  cancelAnimationFrame(rafId)
  window.removeEventListener('keydown', onKeyCtrl)
  window.removeEventListener('keyup',   onKeyCtrl)
})

function onKeyCtrl(e: KeyboardEvent): void {
  if (e.key !== 'Control') return
  ctrlHeld = e.type === 'keydown'
  if (isHovered && activeTool.value === 'horizontal-line') schedule(1)
}

// Bars: keep viewport if already at right edge (follow live candle),
// otherwise keep the current pan position and just redraw.
watch(() => props.bars, () => {
  if (!props.bars.length) return
  // Cold start: bars arrived after mount and the viewport was never set — snap
  // straight to the latest so the chart opens on the live candle (not the oldest).
  if (vFrom === 0 && vTo === 0) {
    resetView()
    return
  }
  if (atRightEdge()) {
    const range = vTo - vFrom
    vTo   = rightEdgeIndex(range)
    vFrom = Math.max(0, vTo - range)
  }
  updateSnapFlag()
  schedule(2)
})

watch(() => props.markers, () => schedule(2), { deep: false })

// Overlay toggles change the pane layout (MACD pane height, volume region).
watch(() => props.overlays, () => {
  computePanes()
  computeMacdRange()
  schedule(2)
}, { deep: true })

// Sync crosshair — redraw UI layer when another chart moves its crosshair
watch(syncTime, () => { if (!isHovered) schedule(1) })
watch(syncPrice, () => { if (!isHovered) schedule(1) })
watch(syncEnabled, (enabled) => { if (!enabled && !isHovered) { cxX = -1; cxY = -1; schedule(1) } })
watch(activeTool, (tool) => {
  if (tool !== 'ray')       rayPending   = null
  if (tool !== 'trendline') tlPending    = null
  if (tool !== 'ruler')     rulerPending = null
  schedule(1)
})
watch(selectedDrawingId, () => schedule(1))
</script>

<template>
  <!--
    All events go on the wrapper div; all canvases are pointer-events:none.
    This gives one clean event surface without z-index conflicts.
  -->
  <div
    ref="wrapEl"
    class="pulse-chart"
    @mousemove="onMouseMove"
    @mouseleave="onMouseLeave"
    @mousedown="onMouseDown"
    @mouseup="onMouseUp"
    @wheel.prevent="onWheel"
    @dblclick="onDblClick"
    @contextmenu.prevent="onContextMenu"
  >
    <!-- Right-click context menu -->
    <Teleport to="body">
      <div
        v-if="ctxMenu"
        class="pc-ctx-backdrop"
        @mousedown.self="dismissCtxMenu"
        @contextmenu.prevent
      >
        <ul
          class="pc-ctx-menu"
          :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        >
          <li @click="resetChart">Reset chart</li>
          <li @click="deleteAllDrawings">Delete All Drawings</li>
        </ul>
      </div>
    </Teleport>
    <canvas ref="bgCvs"   class="pc-layer" />
    <canvas ref="barsCvs" class="pc-layer" />
    <canvas ref="uiCvs"   class="pc-layer" />
    <HorizontalLineLayer ref="hlLayer" />
    <HorizontalRayLayer  ref="hrLayer" />
    <VerticalLineLayer   ref="vlLayer" />
    <RayLayer            ref="rayLayer" />
    <TrendlineLayer      ref="tlLayer" />
    <RulerLayer          ref="rulerLayer" />

    <!-- Snap-to-latest: appears when the view is panned off the live candle.
         Positioned inside the chart area (left of the price-axis gutter). -->
    <button
      v-if="canSnapToLatest"
      class="pc-snap"
      :style="{ right: (priceAxisW + 10) + 'px' }"
      title="Jump to latest candle"
      aria-label="Jump to latest candle"
      @mousemove.stop
      @mousedown.stop
      @click.stop.prevent="snapToLatest"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z" fill="currentColor" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.pulse-chart {
  position:     relative;
  width:        100%;
  height:       100%;
  overflow:     hidden;
  cursor:       crosshair;
  background:   #121212;
  user-select:  none;
}

/* Floating "snap to latest" control — gray body, primary-orange border, sitting
   inside the chart plot area (right offset is driven by the dynamic price-axis
   width via an inline style) just above the time axis. */
.pc-snap {
  position:      absolute;
  bottom:        24px;
  width:         28px;
  height:        28px;
  display:       flex;
  align-items:   center;
  justify-content: center;
  padding:       0;
  border:        1px solid var(--pc-primary, #ff9800);
  border-radius: 50%;
  background:    #4b5563;
  color:         var(--pc-primary, #ff9800);
  cursor:        pointer;
  box-shadow:    0 2px 8px rgba(0, 0, 0, 0.45);
  z-index:       6;
  transition:    background 0.15s ease, transform 0.15s ease;
}
.pc-snap:hover { background: #374151; transform: scale(1.08); }

.pc-layer {
  position: absolute;
  top:    0;
  left:   0;
  pointer-events: none;
}
</style>

<style>
.pc-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.pc-ctx-menu {
  position: absolute;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  background: #1e1e1e;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0,0,0,.6);
  min-width: 180px;
  font: 12px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', sans-serif;
  color: #d1d4dc;
}

.pc-ctx-menu li {
  padding: 7px 14px;
  cursor: pointer;
  white-space: nowrap;
}

.pc-ctx-menu li:hover {
  background: #2a2d2e;
  color: #ffffff;
}
</style>
