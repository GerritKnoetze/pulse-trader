import { ref } from 'vue'
import { useScanner } from '~/composables/useScanner'
import { useGridFilters } from '~/composables/useGridFilters'

const PRESETS_KEY = 'pulse-scanner-filter-presets'

export interface FilterPreset {
  id: string
  name: string
  createdAt: string
  columnFilters: Record<string, string[]>
  quickFilter: string | null
}

function loadPresetsFromStorage(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    return raw ? (JSON.parse(raw) as FilterPreset[]) : []
  } catch {
    return []
  }
}

// ── Module-level singleton state ────────────────────────────
const savedPresets = ref<FilterPreset[]>([])
const newPresetName = ref('')
const confirmReplace = ref<FilterPreset | null>(null)

function persistPresets() {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(savedPresets.value))
}

export function useGridFilterPresets() {
  const { activeQuickFilter, toggleQuickFilter, clearFilters } = useScanner()
  const { columnFilters, resetFilters } = useGridFilters()

  function savePreset() {
    const name = newPresetName.value.trim()
    if (!name) return
    const existing = savedPresets.value.find(p => p.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      confirmReplace.value = existing
      return
    }
    commitSave(name)
  }

  function commitSave(name: string) {
    const existing = savedPresets.value.find(p => p.name.toLowerCase() === name.toLowerCase())
    const updated: FilterPreset = {
      id: existing?.id ?? (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      name: existing?.name ?? name,
      createdAt: new Date().toLocaleString(),
      columnFilters: JSON.parse(JSON.stringify(columnFilters.value)),
      quickFilter: activeQuickFilter.value,
    }
    if (existing) {
      savedPresets.value = savedPresets.value.map(p => p.id === existing.id ? updated : p)
    } else {
      savedPresets.value = [...savedPresets.value, updated]
    }
    persistPresets()
    newPresetName.value = ''
    confirmReplace.value = null
  }

  function cancelReplace() {
    confirmReplace.value = null
  }

  function applyPreset(preset: FilterPreset) {
    columnFilters.value = JSON.parse(JSON.stringify(preset.columnFilters))
    clearFilters()
    if (preset.quickFilter) {
      toggleQuickFilter(preset.quickFilter)
    }
  }

  function deletePreset(id: string) {
    savedPresets.value = savedPresets.value.filter(p => p.id !== id)
    persistPresets()
  }

  function clearAllFilters() {
    resetFilters()
    clearFilters()
  }

  function initPresets() {
    savedPresets.value = loadPresetsFromStorage()
  }

  /** Count of columns that have an active (non-full-selection) filter */
  function activeColFilterCount(): number {
    return Object.values(columnFilters.value).filter(v => Array.isArray(v) && v.length > 0).length
  }

  return {
    savedPresets,
    newPresetName,
    confirmReplace,
    savePreset,
    commitSave,
    cancelReplace,
    applyPreset,
    deletePreset,
    clearAllFilters,
    initPresets,
    activeColFilterCount,
  }
}
