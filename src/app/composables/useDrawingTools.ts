import { ref } from 'vue'

export type DrawingToolId =
  | 'trendline'
  | 'ray'
  | 'horizontal-line'
  | 'horizontal-ray'
  | 'vertical-line'
  | 'ruler'
  | null

/**
 * Module-level singletons — shared across the toolbar and all PulseChart instances.
 */
const activeTool        = ref<DrawingToolId>(null)
const selectedDrawingId = ref<number | null>(null)
const magnetEnabled     = ref(false)
let   _deleteCallback:  (() => void) | null = null

function clearSelection(): void {
  selectedDrawingId.value = null
  _deleteCallback         = null
}

export function useDrawingTools() {
  return {
    activeTool,
    selectedDrawingId,
    magnetEnabled,
    /** Toggle: clicking an already-active tool deselects it. Clears any selection. */
    setActiveTool: (id: Exclude<DrawingToolId, null>) => {
      activeTool.value = activeTool.value === id ? null : id
      if (activeTool.value !== null) clearSelection()
    },
    /** Called by PulseChart when the user clicks a drawing. */
    selectDrawing: (id: number, deleteFn: () => void) => {
      selectedDrawingId.value = id
      _deleteCallback         = deleteFn
    },
    clearSelection,
    /** Executes the registered delete callback then clears the selection. */
    deleteSelected: () => {
      _deleteCallback?.()
      clearSelection()
    },
  }
}
