import { computed, ref } from 'vue'
import { useScanner } from '~/composables/useScanner'
import type { StratSetup, SetupQuality } from '~/types/scanner'

// ── Module-level singleton state ──────────────────────────────────────────────

const qualityFilter  = ref<SetupQuality | null>(null)
const sortMode       = ref<'rr' | 'atrRisk' | 'detectedAt'>('rr')
const selectedSetup  = ref<StratSetup | null>(null)

// ── Composable ─────────────────────────────────────────────────────────────────

export function useStratSetups() {
  const { rows } = useScanner()

  const allSetups = computed<StratSetup[]>(() =>
    rows.value
      .filter(r => r.setup != null)
      .map(r => r.setup!)
  )

  const filteredSetups = computed<StratSetup[]>(() => {
    let s = allSetups.value
    if (qualityFilter.value) {
      s = s.filter(x => x.quality === qualityFilter.value)
    }
    return [...s].sort((a, b) => {
      if (sortMode.value === 'rr')        return b.rr - a.rr
      if (sortMode.value === 'atrRisk')   return a.atrRisk - b.atrRisk
      return b.detectedAt.localeCompare(a.detectedAt)
    })
  })

  const setupBadgeCount = computed(() =>
    allSetups.value.filter(s => s.quality === 'A+' || s.quality === 'A').length
  )

  function setQualityFilter(q: SetupQuality | null) {
    qualityFilter.value = qualityFilter.value === q ? null : q
  }
  function setSortMode(m: 'rr' | 'atrRisk' | 'detectedAt') { sortMode.value = m }
  function selectSetup(setup: StratSetup | null) { selectedSetup.value = setup }

  return {
    allSetups,
    filteredSetups,
    setupBadgeCount,
    qualityFilter,
    sortMode,
    selectedSetup,
    setQualityFilter,
    setSortMode,
    selectSetup,
  }
}
