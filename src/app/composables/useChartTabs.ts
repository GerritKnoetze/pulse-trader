import { ref, readonly } from 'vue'

export interface ChartTab {
  symbol: string
  basePrice: number
}

// Module-level singleton state
const tabs = ref<ChartTab[]>([])
const activeTab = ref<'scan' | string>('scan')

export function useChartTabs() {
  function openTab(symbol: string, basePrice: number) {
    if (!tabs.value.find(t => t.symbol === symbol)) {
      tabs.value.push({ symbol, basePrice })
    }
    activeTab.value = symbol
  }

  function closeTab(symbol: string) {
    const idx = tabs.value.findIndex(t => t.symbol === symbol)
    if (idx === -1) return
    if (activeTab.value === symbol) {
      activeTab.value = tabs.value[idx - 1]?.symbol ?? 'scan'
    }
    tabs.value.splice(idx, 1)
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
  }
}
