import { ref } from 'vue'

/**
 * Module-level singletons — shared across every PulseChart instance.
 * The source chart broadcasts syncTime (bar timestamp) + syncPrice
 * (the actual market price at the cursor's Y position). Receiving charts
 * look up their own bar for syncTime and call prToY(syncPrice) so the
 * horizontal line is at the correct price on every chart's scale.
 */
const syncEnabled = ref(false)
const syncTime    = ref<number | null>(null)   // unix seconds of hovered bar
const syncPrice   = ref<number | null>(null)   // price at cursor Y (continuous)

export function useChartSync() {
  return {
    syncEnabled,
    syncTime,
    syncPrice,
    setSyncTime:  (t: number | null) => { syncTime.value  = t },
    setSyncPrice: (p: number | null) => { syncPrice.value = p },
  }
}
