import { ref } from 'vue'
import { useGridColumns } from '~/composables/useGridColumns'

const LAYOUTS_KEY = 'pulse-scanner-layouts'

export interface GridLayout {
  id: string
  name: string
  createdAt: string
  colOrder: string[]
  colWidths: Record<string, number>
}

function loadLayoutsFromStorage(): GridLayout[] {
  try {
    const raw = localStorage.getItem(LAYOUTS_KEY)
    return raw ? (JSON.parse(raw) as GridLayout[]) : []
  } catch {
    return []
  }
}

// ── Module-level singleton state ────────────────────────────
const savedLayouts = ref<GridLayout[]>([])
const newLayoutName = ref('')
const confirmReplace = ref<GridLayout | null>(null)

function persistLayouts() {
  localStorage.setItem(LAYOUTS_KEY, JSON.stringify(savedLayouts.value))
}

export function useGridLayouts() {
  const { colOrder, colWidths } = useGridColumns()

  function saveLayout() {
    const name = newLayoutName.value.trim()
    if (!name) return
    const existing = savedLayouts.value.find(l => l.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      confirmReplace.value = existing
      return
    }
    commitSave(name)
  }

  function commitSave(name: string) {
    const existing = savedLayouts.value.find(l => l.name.toLowerCase() === name.toLowerCase())
    const updated: GridLayout = {
      id: existing?.id ?? (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      name: existing?.name ?? name,
      createdAt: new Date().toLocaleString(),
      colOrder: [...colOrder.value],
      colWidths: { ...colWidths.value },
    }
    if (existing) {
      savedLayouts.value = savedLayouts.value.map(l => l.id === existing.id ? updated : l)
    } else {
      savedLayouts.value = [...savedLayouts.value, updated]
    }
    persistLayouts()
    newLayoutName.value = ''
    confirmReplace.value = null
  }

  function cancelReplace() {
    confirmReplace.value = null
  }

  function applyLayout(layout: GridLayout) {
    colOrder.value = [...layout.colOrder]
    colWidths.value = { ...layout.colWidths }
  }

  function deleteLayout(id: string) {
    savedLayouts.value = savedLayouts.value.filter(l => l.id !== id)
    persistLayouts()
  }

  function initLayouts() {
    savedLayouts.value = loadLayoutsFromStorage()
  }

  return {
    savedLayouts,
    newLayoutName,
    confirmReplace,
    saveLayout,
    commitSave,
    cancelReplace,
    applyLayout,
    deleteLayout,
    initLayouts,
  }
}
