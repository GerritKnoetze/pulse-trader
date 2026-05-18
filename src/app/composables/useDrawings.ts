/**
 * useDrawings — shared drawing state across all PulseChart instances.
 *
 * All timeframes share the same drawing arrays, so a line placed on the weekly
 * chart automatically appears on daily, hourly, 5-min, etc.  Moving or deleting
 * a drawing on any timeframe updates every other timeframe in the same RAF tick.
 */
import type { HorizontalLineDrawing } from '~/components/chart/drawing/HorizontalLine.vue'
import type { HorizontalRayDrawing  } from '~/components/chart/drawing/HorizontalRay.vue'
import type { VerticalLineDrawing   } from '~/components/chart/drawing/VerticalLine.vue'
import type { RayDrawing            } from '~/components/chart/drawing/Ray.vue'
import type { TrendlineDrawing      } from '~/components/chart/drawing/Trendline.vue'

// ── Shared drawing arrays ─────────────────────────────────────────────────────
export const hlDrawings:  HorizontalLineDrawing[] = []
export const hrDrawings:  HorizontalRayDrawing[]  = []
export const vlDrawings:  VerticalLineDrawing[]   = []
export const rayDrawings: RayDrawing[]            = []
export const tlDrawings:  TrendlineDrawing[]      = []

// ── Shared ID counter ─────────────────────────────────────────────────────────
let _nextId = 1
export function allocDrawingId(): number { return _nextId++ }

// ── Change notifications ──────────────────────────────────────────────────────
// Each mounted PulseChart subscribes with a function that calls schedule(1).
// Any mutation calls notifyDrawingsChanged() to redraw all charts at once.
const _subs = new Set<() => void>()

export function subscribeDrawings(fn: () => void): () => void {
  _subs.add(fn)
  return () => _subs.delete(fn)
}

export function notifyDrawingsChanged(): void {
  _subs.forEach(fn => fn())
}
