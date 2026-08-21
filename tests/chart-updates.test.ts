/**
 * Client chart update logic tests — ScannerSymbolChart.vue.
 *
 * Mounts the real chart component with mocked composables/components and
 * verifies the data-accuracy-critical behaviours:
 *   1. Historical bars from chart-bars populate the panels on open.
 *   2. SSE `bars` events append newer candles / replace the current one.
 *   3. A full daily seed is adopted when the D panel starts empty (cold open).
 *   4. Live row updates patch the forming candle and build the D today bar.
 *
 * Run: npm run test:chart  (vitest run tests/chart-updates.test.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'

// Hoisted shared state so the mocked composable and the test share one `rows`
// ref and one captured SSE `bars` handler.
const h = vi.hoisted(() => ({
  rows: null as unknown as ReturnType<typeof ref>,
  barsHandler: null as unknown as (msg: any) => void,
}))

vi.mock('~/composables/useScanner', () => ({
  useScanner: () => ({ rows: h.rows }),
  subscribeBars: (fn: (msg: any) => void) => {
    h.barsHandler = fn
    return () => { h.barsHandler = null as never }
  },
}))

vi.mock('~/composables/useChartTabs', () => ({
  useChartTabs: () => ({ setTabLoading: vi.fn() }),
}))

vi.mock('~/components/chart/PulseChartPanel.vue', () => ({
  default: {
    name: 'PulseChartPanel',
    props: ['symbol', 'label', 'title', 'timeVisible', 'bars', 'markers', 'isDemo'],
    template: '<div class="panel-stub" />',
  },
}))
vi.mock('~/components/chart/ChartToolbar.vue', () => ({
  default: { name: 'ChartToolbar', props: ['refreshing'], emits: ['refresh'], template: '<div class="toolbar-stub" />' },
}))
vi.mock('~/components/common/LoadingOverlay.vue', () => ({
  default: { name: 'LoadingOverlay', props: ['label'], template: '<div class="overlay-stub" />' },
}))

import ScannerSymbolChart from '~/components/scanner/ScannerSymbolChart.vue'

interface ApiBar { t: number; o: number; h: number; l: number; c: number; v: number }
const bar = (t: number, o = 10, h = 11, l = 9, c = 10.5, v = 100): ApiBar => ({ t, o, h, l, c, v })

let currentBarsResponse: Record<string, ApiBar[]>
const $fetch = vi.fn()

function barsResponse(overrides: Record<string, ApiBar[]> = {}): { symbol: string; bars: Record<string, ApiBar[]> } {
  return { symbol: 'TEST', bars: { D: [], W: [], M: [], '1': [], '5': [], '10s': [], '60': [], '30': [], ...overrides } }
}

function panelBars(wrapper: ReturnType<typeof mount>, label: string): any[] {
  const panel = wrapper.findAllComponents({ name: 'PulseChartPanel' })
    .find(c => (c.props('label') as string) === label)
  return panel ? (panel.props('bars') as any[]) : []
}

async function mountChart(symbol = 'TEST'): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(ScannerSymbolChart, { props: { symbol, basePrice: 10 } })
  await flushPromises()
  await nextTick()
  return wrapper
}

beforeEach(() => {
  h.rows = ref([]) as never
  h.barsHandler = null as never
  currentBarsResponse = barsResponse()
  $fetch.mockReset()
  $fetch.mockImplementation((url: unknown) => {
    if (String(url).includes('/api/scanner/chart-bars')) return Promise.resolve(currentBarsResponse)
    return Promise.resolve({ success: true })
  })
  ;(globalThis as unknown as { $fetch: unknown }).$fetch = $fetch
})

describe('ScannerSymbolChart data updates', () => {
  it('populates panels from chart-bars history on open', async () => {
    currentBarsResponse = barsResponse({
      D: [bar(1_600_000_000), bar(1_600_086_400)],
      '1': [bar(1_600_000_000, 10, 11, 9, 10.5, 100)],
    })
    const w = await mountChart()
    expect(panelBars(w, 'D')).toHaveLength(2)
    expect(panelBars(w, '1M')).toHaveLength(1)
    expect(panelBars(w, '1M')[0]!.close).toBe(10.5)
    expect(panelBars(w, '5M')).toHaveLength(0)
    expect(panelBars(w, '10s')).toHaveLength(0)
  })

  it('appends newer bars from an SSE minute bars event', async () => {
    currentBarsResponse = barsResponse({ '1': [bar(1_600_000_000)] })
    const w = await mountChart()
    h.barsHandler!({ type: 'bars', symbol: 'TEST', timespan: 'minute', bars: [bar(1_600_060_000, 11, 12, 10, 11.5, 200)] })
    await nextTick()
    const one = panelBars(w, '1M')
    expect(one).toHaveLength(2)
    expect(one[1]!.close).toBe(11.5)
  })

  it('replaces the current (in-progress) bar when an equal-timestamp bar arrives', async () => {
    currentBarsResponse = barsResponse({ '1': [bar(1_600_000_000, 10, 11, 9, 10.5, 100)] })
    const w = await mountChart()
    h.barsHandler!({ type: 'bars', symbol: 'TEST', timespan: 'minute', bars: [bar(1_600_000_000, 10, 12, 9, 11.9, 150)] })
    await nextTick()
    const one = panelBars(w, '1M')
    expect(one).toHaveLength(1)
    expect(one[0]!.close).toBe(11.9)
  })

  it('adopts a full daily seed when the D panel is empty (cold open)', async () => {
    currentBarsResponse = barsResponse() // D empty
    const w = await mountChart()
    expect(panelBars(w, 'D')).toHaveLength(0)
    h.barsHandler!({ type: 'bars', symbol: 'TEST', timespan: 'day', bars: [bar(1_600_000_000), bar(1_600_086_400)] })
    await nextTick()
    expect(panelBars(w, 'D')).toHaveLength(2)
    expect(panelBars(w, 'D')[0]!.close).toBe(10.5)
  })

  it('ignores bars events for other symbols', async () => {
    currentBarsResponse = barsResponse({ '1': [bar(1_600_000_000)] })
    const w = await mountChart()
    h.barsHandler!({ type: 'bars', symbol: 'OTHER', timespan: 'minute', bars: [bar(1_600_060_000)] })
    await nextTick()
    expect(panelBars(w, '1M')).toHaveLength(1)
  })

  it('patches the forming candle from the live row and builds the D today bar', async () => {
    currentBarsResponse = barsResponse({
      D: [bar(1_700_000_000, 49, 52, 48, 51, 400)],
      '1': [bar(1_700_000_000, 50, 51, 49, 50.5, 500)],
    })
    const w = await mountChart()
    const nowMs = Date.now()
    h.rows.value = [{
      id: 'TEST', symbol: 'TEST', last: 55.25, ts: nowMs,
      day: { o: 50, h: 56, l: 49, c: 55.25 },
    } as never]
    await nextTick()
    await nextTick()
    const one = panelBars(w, '1M')
    expect(one[one.length - 1]!.close).toBe(55.25)
    const d = panelBars(w, 'D')
    expect(d[d.length - 1]!.open).toBe(50)
    expect(d[d.length - 1]!.close).toBe(55.25)
    expect(d[d.length - 1]!.high).toBe(56)
    expect(d[d.length - 1]!.low).toBe(49)
  })
})
