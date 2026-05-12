import { ref, computed, watch } from 'vue'
import type { ScannerRow } from '~/types/scanner'

export const MTF_TFS = ['1', '5', '15', '30', '60', 'D', 'W', 'M', 'Q', 'Y'] as const
export type MtfTf = typeof MTF_TFS[number]

export interface ColDef {
  key: keyof ScannerRow | 'mtf'
  label: string
  width: string
  align: 'left' | 'right' | 'center'
  noSort?: boolean
  noFilter?: boolean
}

export const COLUMNS: ColDef[] = [
  { key: 'symbol',    label: 'Symbol',       width: '72px',  align: 'left'   },
  { key: 'atrPct',    label: 'ATR %',        width: '58px',  align: 'left'   },
  { key: 'last',      label: 'Last',         width: '74px',  align: 'left'   },
  { key: 'sector',    label: 'Sector',       width: '148px', align: 'left'   },
  { key: 'category',  label: 'Category',     width: '114px', align: 'left'   },
  { key: 'signal',    label: 'Signal',       width: '132px', align: 'left'   },
  { key: 'pattern',   label: 'Pattern',      width: '82px',  align: 'left'   },
  { key: 'cc2',       label: 'CC2',          width: '48px',  align: 'center' },
  { key: 'cc1',       label: 'CC1',          width: '48px',  align: 'center' },
  { key: 'cc',        label: 'CC',           width: '48px',  align: 'center' },
  { key: 'avgVol30',  label: 'Avg. Vol(30)', width: '94px',  align: 'left'   },
  { key: 'inForce',   label: 'In Force',     width: '72px',  align: 'center' },
  { key: 'ftfc',      label: 'FTFC',         width: '56px',  align: 'center' },
  { key: 'chgDollar', label: 'Chg $',        width: '66px',  align: 'left'   },
  { key: 'chgPct',    label: 'Ch%',          width: '60px',  align: 'left'   },
  { key: 'atrDollar', label: 'ATR $',        width: '60px',  align: 'left'   },
  { key: 'mtf',       label: 'MTF',          width: '248px', align: 'center', noSort: true, noFilter: true },
  { key: 'setup',     label: 'Setup',        width: '88px',  align: 'center', noSort: true },
]

const GRID_STATE_KEY = 'pulse-scanner-grid-state'

interface GridState {
  colOrder: string[]
  colWidths: Record<string, number>
  hiddenCols: string[]
}

export const DEFAULT_COL_ORDER = COLUMNS.map(c => c.key as string)
export const DEFAULT_COL_WIDTHS = Object.fromEntries(COLUMNS.map(c => [c.key, parseInt(c.width)]))

function loadGridState(): GridState | null {
  try {
    const raw = localStorage.getItem(GRID_STATE_KEY)
    return raw ? (JSON.parse(raw) as GridState) : null
  } catch {
    return null
  }
}

// ── Module-level singleton state ────────────────────────────
const colOrder = ref<string[]>([...DEFAULT_COL_ORDER])
const colWidths = ref<Record<string, number>>({ ...DEFAULT_COL_WIDTHS })
const hiddenCols = ref<Set<string>>(new Set())
const dragSource = ref<number | null>(null)
const dragOverIdx = ref<number | null>(null)

const orderedColumns = computed(() =>
  colOrder.value
    .map(key => COLUMNS.find(c => c.key === key)!)
    .filter(col => col && !hiddenCols.value.has(col.key as string))
)

function persistGridState() {
  const state: GridState = {
    colOrder: colOrder.value,
    colWidths: colWidths.value,
    hiddenCols: [...hiddenCols.value],
  }
  localStorage.setItem(GRID_STATE_KEY, JSON.stringify(state))
}

watch([colOrder, colWidths], persistGridState, { deep: true })
watch(hiddenCols, persistGridState, { deep: true })

function toggleColVisibility(key: string) {
  const next = new Set(hiddenCols.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  hiddenCols.value = next
}

function resetColumns() {
  colOrder.value = [...DEFAULT_COL_ORDER]
  colWidths.value = { ...DEFAULT_COL_WIDTHS }
  hiddenCols.value = new Set()
  localStorage.removeItem(GRID_STATE_KEY)
}

function initColumns() {
  const saved = loadGridState()
  if (saved) {
    colOrder.value = saved.colOrder
    colWidths.value = saved.colWidths
    hiddenCols.value = new Set(saved.hiddenCols)
  }
}

function onColDragStart(e: DragEvent, idx: number) {
  // idx is the visible-column index; store the colOrder index instead
  const key = orderedColumns.value[idx]?.key as string | undefined
  dragSource.value = key !== undefined ? colOrder.value.indexOf(key) : null
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onColDragOver(e: DragEvent, idx: number) {
  if (dragSource.value === null) return
  e.preventDefault()
  dragOverIdx.value = idx
}

function onColDrop(e: DragEvent, idx: number) {
  e.preventDefault()
  // idx is the visible-column index; map to colOrder key then find its order index
  const targetKey = orderedColumns.value[idx]?.key as string | undefined
  if (dragSource.value !== null && targetKey !== undefined) {
    const newOrder = [...colOrder.value]
    const [moved] = newOrder.splice(dragSource.value, 1)
    if (moved !== undefined) {
      // After the splice, find the target key's new position and insert before it
      const insertAt = newOrder.indexOf(targetKey)
      if (insertAt >= 0) newOrder.splice(insertAt, 0, moved)
      else newOrder.push(moved)
      colOrder.value = newOrder
    }
  }
  dragSource.value = null
  dragOverIdx.value = null
}

function onColDragEnd() {
  dragSource.value = null
  dragOverIdx.value = null
}

function startResize(e: MouseEvent, key: string) {
  e.preventDefault()
  e.stopPropagation()
  const startX = e.clientX
  const startWidth = colWidths.value[key] ?? 80
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  function onMove(ev: MouseEvent) {
    colWidths.value = { ...colWidths.value, [key]: Math.max(40, startWidth + ev.clientX - startX) }
  }
  function onUp() {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function autoSizeColumns() {
  const table = document.querySelector('.scanner-table') as HTMLTableElement | null
  if (!table) return

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  const thEl = table.querySelector('th')
  const tdEl = table.querySelector('tbody td')
  const thFont = thEl ? getComputedStyle(thEl).font : '13px sans-serif'
  const tdFont = tdEl ? getComputedStyle(tdEl).font : '13px sans-serif'

  const CELL_PAD  = 24  // left + right cell padding
  const ICON_PAD  = 24  // extra room for sort + filter icons in header
  const MIN_WIDTH = 40

  const newWidths: Record<string, number> = { ...colWidths.value }

  orderedColumns.value.forEach((col, colIdx) => {
    if (col.key === 'mtf') return  // chip-based — keep as-is

    // Measure header label
    ctx.font = thFont
    let maxW = ctx.measureText(col.label).width + CELL_PAD + (col.noSort && col.noFilter ? 0 : ICON_PAD)

    // Measure every body cell in this column
    ctx.font = tdFont
    const trs = table.querySelectorAll('tbody tr')
    trs.forEach(tr => {
      const td = tr.querySelectorAll('td')[colIdx]
      if (!td) return
      const text = (td.textContent ?? '').trim()
      if (!text) return
      const w = ctx.measureText(text).width + CELL_PAD
      if (w > maxW) maxW = w
    })

    // Symbol column: add room for copy icon button
    if (col.key === 'symbol') maxW += 22

    newWidths[col.key as string] = Math.ceil(Math.max(maxW, MIN_WIDTH))
  })

  colWidths.value = newWidths
}

export function useGridColumns() {
  return {
    COLUMNS,
    MTF_TFS,
    colOrder,
    colWidths,
    hiddenCols,
    orderedColumns,
    dragSource,
    dragOverIdx,
    toggleColVisibility,
    resetColumns,
    initColumns,
    persistGridState,
    onColDragStart,
    onColDragOver,
    onColDrop,
    onColDragEnd,
    startResize,
    autoSizeColumns,
  }
}
