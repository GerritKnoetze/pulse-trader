import { ref, computed, watch } from 'vue'
import type { ScannerRow } from '~/types/scanner'
import { useScanner } from '~/composables/useScanner'

const COL_FILTERS_KEY = 'pulse-scanner-col-filters'

function loadColFilters(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(COL_FILTERS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}

// ── Module-level singleton state ────────────────────────────
const openFilterCol = ref<keyof ScannerRow | null>(null)
const filterDropdownPos = ref({ top: 0, left: 0 })
const filterSearch = ref('')
const columnFilters = ref<Record<string, string[]>>({})

watch(columnFilters, (val) => {
  localStorage.setItem(COL_FILTERS_KEY, JSON.stringify(val))
}, { deep: true })

export function cellDisplayValue(key: keyof ScannerRow, row: ScannerRow): string {
  const v = row[key]
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (v === null || v === undefined) return ''
  return String(v)
}

export function useGridFilters() {
  const { allRows, filteredRows } = useScanner()

  const localFilteredRows = computed(() => {
    let rows = filteredRows.value
    for (const [keyStr, selected] of Object.entries(columnFilters.value)) {
      if (!selected || selected.length === 0) continue
      const key = keyStr as keyof ScannerRow
      rows = rows.filter(row => selected.includes(cellDisplayValue(key, row)))
    }
    return rows
  })

  function getUniqueValues(key: keyof ScannerRow): string[] {
    const vals = new Set<string>()
    for (const row of allRows.value) {
      vals.add(cellDisplayValue(key, row))
    }
    return [...vals].sort((a, b) => {
      if (a === 'True') return -1
      if (b === 'True') return 1
      return a.localeCompare(b)
    })
  }

  function filteredUniqueValues(key: keyof ScannerRow): string[] {
    const all = getUniqueValues(key)
    if (!filterSearch.value) return all
    const s = filterSearch.value.toLowerCase()
    return all.filter(v => v.toLowerCase().includes(s))
  }

  function hasColFilter(key: keyof ScannerRow): boolean {
    const cf = columnFilters.value[key as string]
    if (!Array.isArray(cf) || cf.length === 0) return false
    const total = getUniqueValues(key).length
    return total === 0 || cf.length < total
  }

  function isAllSelected(key: keyof ScannerRow): boolean {
    const cf = columnFilters.value[key as string]
    if (!cf) return true
    const all = getUniqueValues(key)
    return all.every(v => cf.includes(v))
  }

  function isIndeterminate(key: keyof ScannerRow): boolean {
    const cf = columnFilters.value[key as string]
    if (!cf) return false
    const all = getUniqueValues(key)
    const selected = all.filter(v => cf.includes(v))
    return selected.length > 0 && selected.length < all.length
  }

  function isValueSelected(key: keyof ScannerRow, val: string): boolean {
    const cf = columnFilters.value[key as string]
    if (!cf) return true
    return cf.includes(val)
  }

  function toggleSelectAll(key: keyof ScannerRow) {
    const all = getUniqueValues(key)
    if (isAllSelected(key)) {
      columnFilters.value[key as string] = []
    } else {
      columnFilters.value[key as string] = [...all]
    }
  }

  function toggleFilterValue(key: keyof ScannerRow, val: string) {
    const all = getUniqueValues(key)
    const current = columnFilters.value[key as string] ?? [...all]
    const idx = current.indexOf(val)
    if (idx >= 0) {
      columnFilters.value[key as string] = current.filter(v => v !== val)
    } else {
      columnFilters.value[key as string] = [...current, val]
    }
  }

  function openFilter(key: keyof ScannerRow, event: MouseEvent) {
    event.stopPropagation()
    if (openFilterCol.value === key) {
      openFilterCol.value = null
      return
    }
    const btn = event.currentTarget as HTMLElement
    const rect = btn.getBoundingClientRect()
    filterDropdownPos.value = { top: rect.bottom + 2, left: rect.left }
    openFilterCol.value = key
    filterSearch.value = ''
  }

  function closeFilterDropdown() {
    openFilterCol.value = null
  }

  function clearColFilter(key: keyof ScannerRow) {
    delete columnFilters.value[key as string]
    openFilterCol.value = null
  }

  function resetFilters() {
    columnFilters.value = {}
    localStorage.removeItem(COL_FILTERS_KEY)
  }

  function initFilters() {
    columnFilters.value = loadColFilters()
  }

  return {
    openFilterCol,
    filterDropdownPos,
    filterSearch,
    columnFilters,
    localFilteredRows,
    getUniqueValues,
    filteredUniqueValues,
    hasColFilter,
    isAllSelected,
    isIndeterminate,
    isValueSelected,
    toggleSelectAll,
    toggleFilterValue,
    openFilter,
    closeFilterDropdown,
    clearColFilter,
    resetFilters,
    initFilters,
  }
}
