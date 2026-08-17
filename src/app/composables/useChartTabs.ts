import { ref, readonly } from 'vue'
import type { StratSetup } from '~/types/scanner'

export interface ChartTab {
  symbol: string
  basePrice: number
  setup?: StratSetup
}

// Module-level singleton state
const tabs = ref<ChartTab[]>([])
const activeTab = ref<'scan' | string>('scan')
// symbol → true while its chart is loading (lazy chunk + bar fetch)
const tabLoading = ref<Record<string, boolean>>({})

export function useChartTabs() {
  function openTab(symbol: string, basePrice: number, setup?: StratSetup) {
    const existing = tabs.value.find(t => t.symbol === symbol)
    if (existing) {
      // Update setup if a newer one is passed
      if (setup) existing.setup = setup
    } else {
      tabs.value.push({ symbol, basePrice, setup })
      // A brand-new tab starts in the loading state — it stays until the chart
      // component finishes building (covers the lazy chunk + bar fetch).
      tabLoading.value = { ...tabLoading.value, [symbol]: true }
    }
    activeTab.value = symbol
  }

  /** Mark a tab's chart as loading/ready. Called by the chart component. */
  function setTabLoading(symbol: string, loading: boolean) {
    tabLoading.value = { ...tabLoading.value, [symbol]: loading }
  }

  function isTabLoading(symbol: string): boolean {
    return tabLoading.value[symbol] === true
  }

  function closeTab(symbol: string) {
    const idx = tabs.value.findIndex(t => t.symbol === symbol)
    if (idx === -1) return
    if (activeTab.value === symbol) {
      activeTab.value = tabs.value[idx - 1]?.symbol ?? 'scan'
    }
    tabs.value.splice(idx, 1)
    const next = { ...tabLoading.value }
    delete next[symbol]
    tabLoading.value = next
  }

  function setActiveTab(tab: 'scan' | string) {
    activeTab.value = tab
  }

  return {
    tabs: readonly(tabs),
    activeTab: readonly(activeTab),
    openTab,
    closeTab,
    setActiveTab,
    setTabLoading,
    isTabLoading,
  }
}
