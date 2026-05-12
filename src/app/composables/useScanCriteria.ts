import { ref, computed } from 'vue'
import type { ScanCriteria } from '~/types/scanner'

const STORAGE_KEY = 'pulse-scanner-criteria'

const DEFAULTS: ScanCriteria = {
  minPrice:         undefined,
  maxPrice:         undefined,
  minChangePercent: undefined,
  maxChangePercent: undefined,
  minVolume:        undefined,
  minRvol:          undefined,
}

function load(): ScanCriteria {
  if (typeof window === 'undefined') return { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ScanCriteria>) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

// Module-level singleton
const criteria = ref<ScanCriteria>(load())

function persist() {
  if (typeof window === 'undefined') return
  // Only persist fields that are actually set
  const toSave: Partial<ScanCriteria> = {}
  for (const [k, v] of Object.entries(criteria.value)) {
    if (v !== undefined && v !== null && v !== '') {
      (toSave as Record<string, unknown>)[k] = v
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
}

const activeCount = computed(() => {
  const c = criteria.value
  let count = 0
  // min+max pairs count as one criteria each
  if (c.minPrice         !== undefined || c.maxPrice         !== undefined) count++
  if (c.minChangePercent !== undefined || c.maxChangePercent !== undefined) count++
  if (c.minVolume        !== undefined) count++
  if (c.minRvol          !== undefined) count++
  return count
})

function resetCriteria() {
  criteria.value = { ...DEFAULTS }
  persist()
}

function updateCriteria(patch: Partial<ScanCriteria>) {
  criteria.value = { ...criteria.value, ...patch }
  persist()
}

/** Convert criteria to URL query params for the API call */
function criteriaToParams(c: ScanCriteria): Record<string, string> {
  const params: Record<string, string> = {}
  if (c.minPrice         !== undefined) params['minPrice']         = String(c.minPrice)
  if (c.maxPrice         !== undefined) params['maxPrice']         = String(c.maxPrice)
  if (c.minChangePercent !== undefined) params['minChangePercent'] = String(c.minChangePercent)
  if (c.maxChangePercent !== undefined) params['maxChangePercent'] = String(c.maxChangePercent)
  if (c.minVolume        !== undefined) params['minVolume']        = String(c.minVolume)
  if (c.minRvol          !== undefined) params['minRvol']          = String(c.minRvol)
  return params
}

export function useScanCriteria() {
  return {
    criteria,
    activeCount,
    updateCriteria,
    resetCriteria,
    criteriaToParams,
  }
}
