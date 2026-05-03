<script setup lang="ts">
import {
  FunnelIcon,
} from '@heroicons/vue/24/outline'
import { FunnelIcon as FunnelIconSolid } from '@heroicons/vue/24/solid'
import { useScanner } from '~/composables/useScanner'
import { useChartTabs } from '~/composables/useChartTabs'
import { useGridColumns } from '~/composables/useGridColumns'
import { useGridFilters } from '~/composables/useGridFilters'
import type { ScannerRow } from '~/types/scanner'
import type { ColDef } from '~/composables/useGridColumns'

const MTF_TFS = ['15', '30', '60', 'D', 'W', 'Q', 'Y'] as const
type MtfTf = typeof MTF_TFS[number]

const { sortKey, sortDir, setSortBy } = useScanner()
const { openTab } = useChartTabs()

const {
  orderedColumns,
  colWidths,
  dragOverIdx,
  onColDragStart,
  onColDragOver,
  onColDrop,
  onColDragEnd,
  startResize,
} = useGridColumns()

const {
  localFilteredRows,
  hasColFilter,
  openFilter,
} = useGridFilters()

// ── Formatting helpers ──────────────────────────────────────
function fmtVolume(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M'
  if (v >= 1_000)     return (v / 1_000).toFixed(1).replace(/\.?0+$/, '') + 'K'
  return String(v)
}
function fmtPrice(v: number): string { return v.toFixed(2) }
function fmtChg(v: number): string   { return (v >= 0 ? '+' : '') + v.toFixed(2) }
function fmtChgPct(v: number): string { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%' }

// ── Color class helpers ─────────────────────────────────────
function categoryClass(cat: string): string {
  if (cat === 'Continuation+') return 'cat-cont-plus'
  if (cat === 'Continuation')  return 'cat-cont'
  if (cat === 'Inside')        return 'cat-inside'
  if (cat === 'Reversal')      return 'cat-reversal'
  return ''
}
function signalClass(sig: string): string {
  const s = sig.toLowerCase()
  if (s.includes('inside up') || s.includes('2-2 up') || s.includes('expansion') || s.includes('green')) return 'sig-bullish'
  if (s.includes('inside down') || s.includes('down') || s.includes('red')) return 'sig-bearish'
  if (s.includes('hammer')) return 'sig-hammer'
  return ''
}
function ccClass(cc: string): string {
  if (cc === '2u') return 'cc-up'
  if (cc === '2d') return 'cc-down'
  return ''
}
function chgClass(v: number): string { return v >= 0 ? 'chg-pos' : 'chg-neg' }

// ── Cell rendering helpers ───────────────────────────────────
function getCellClass(col: ColDef, row: ScannerRow): string {
  switch (col.key) {
    case 'last':      return 'td-last'
    case 'sector':    return 'td-sector'
    case 'category':  return `td-category ${categoryClass(row.category)}`
    case 'signal':    return `td-signal ${signalClass(row.signal)}`
    case 'pattern':   return 'td-pattern'
    case 'cc2':       return `td-cc ${ccClass(row.cc2)}`
    case 'cc1':       return `td-cc ${ccClass(row.cc1)}`
    case 'cc':        return `td-cc ${ccClass(row.cc)}`
    case 'avgVol30':  return 'td-vol'
    case 'chgDollar': return chgClass(row.chgDollar)
    case 'chgPct':    return chgClass(row.chgPct)
    case 'atrDollar': return 'td-atrd'
    default:          return ''
  }
}
function getCellText(col: ColDef, row: ScannerRow): string {
  switch (col.key) {
    case 'atrPct':    return row.atrPct.toFixed(1)
    case 'last':      return fmtPrice(row.last)
    case 'sector':    return row.sector
    case 'category':  return row.category
    case 'signal':    return row.signal
    case 'pattern':   return row.pattern
    case 'cc2':       return row.cc2
    case 'cc1':       return row.cc1
    case 'cc':        return row.cc
    case 'avgVol30':  return fmtVolume(row.avgVol30)
    case 'chgDollar': return fmtChg(row.chgDollar)
    case 'chgPct':    return fmtChgPct(row.chgPct)
    case 'atrDollar': return row.atrDollar.toFixed(2)
    default:          return String((row as unknown as Record<string, unknown>)[col.key as string] ?? '')
  }
}
function getCellTdClass(col: ColDef, row: ScannerRow): string {
  if (col.key === 'symbol')  return 'td-symbol'
  if (col.key === 'inForce') return 'center td-inforce'
  if (col.key === 'ftfc')    return 'center td-ftfc'
  if (col.key === 'mtf')     return 'td-mtf'
  return [col.align, getCellClass(col, row)].filter(Boolean).join(' ')
}
</script>

<template>
  <div class="scanner-grid-scroll">
    <table class="scanner-table">
      <thead>
        <tr>
          <th
            v-for="(col, colIdx) in orderedColumns"
            :key="col.key"
            :style="{ width: colWidths[col.key] + 'px', minWidth: colWidths[col.key] + 'px' }"
            :class="['col-' + col.key, col.align, { 'col-drag-over': dragOverIdx === colIdx }]"
            @dragover="onColDragOver($event, colIdx)"
            @drop="onColDrop($event, colIdx)"
            @dragleave="dragOverIdx = null"
          >
            <div class="th-cell">
              <span
                class="th-inner"
                draggable="true"
                @dragstart="onColDragStart($event, colIdx)"
                @dragend="onColDragEnd"
                @click="!col.noSort && setSortBy(col.key as keyof ScannerRow)"
              >
                <span class="th-label">{{ col.label }}</span>
                <span class="th-icons">
                  <span v-if="!col.noSort" class="th-sort">
                    <span v-if="sortKey === col.key && sortDir === 'asc'" class="sort-icon active">▲</span>
                    <span v-else-if="sortKey === col.key && sortDir === 'desc'" class="sort-icon active">▼</span>
                  </span>
                  <button
                    v-if="!col.noFilter"
                    class="th-filter-btn"
                    :class="{ 'th-filter-active': hasColFilter(col.key as keyof ScannerRow) }"
                    :title="hasColFilter(col.key as keyof ScannerRow) ? 'Filter active – click to edit' : 'Filter'"
                    @click.stop="openFilter(col.key as keyof ScannerRow, $event)"
                  >
                    <FunnelIconSolid v-if="hasColFilter(col.key as keyof ScannerRow)" class="th-filter-icon" />
                    <FunnelIcon v-else class="th-filter-icon" />
                  </button>
                </span>
              </span>
              <span class="col-resize-handle" @mousedown.stop="startResize($event, col.key as string)" @click.stop />
            </div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in localFilteredRows"
          :key="row.id"
        >
          <td
            v-for="col in orderedColumns"
            :key="col.key"
            :class="getCellTdClass(col, row)"
          >
            <template v-if="col.key === 'symbol'">
              <span class="symbol-link" @click="openTab(row.symbol, row.last)">{{ row.symbol }}</span>
            </template>
            <template v-else-if="col.key === 'inForce'">
              <span v-if="row.inForce" class="dot dot-green" title="In Force" />
            </template>
            <template v-else-if="col.key === 'ftfc'">
              <span v-if="row.ftfc" class="dot dot-amber" title="Full Time Frame Continuity" />
            </template>
            <template v-else-if="col.key === 'mtf'">
              <span class="mtf-chips">
                <span
                  v-for="tf in MTF_TFS"
                  :key="tf"
                  :class="['mtf-chip', 'mtf-' + row.mtf[tf as MtfTf]]"
                >{{ tf }}</span>
              </span>
            </template>
            <template v-else>{{ getCellText(col as ColDef, row) }}</template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.scanner-grid-scroll {
  flex: 1;
  overflow: auto;
}

/* ── Table ─────────────────────────────────────────────────── */
.scanner-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.83rem;
  table-layout: fixed;
}

.scanner-table thead th {
  background: var(--color-background-mute);
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 0;
  text-align: left;
  border-bottom: 1px solid var(--color-border);
  border-right: 1px solid rgba(51, 51, 51, 0.4);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.scanner-table thead th:last-child {
  border-right: none;
}

.th-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.42rem 0.5rem;
  gap: 0.25rem;
  flex: 1;
  overflow: hidden;
  cursor: grab;
  user-select: none;
}

.th-inner:active {
  cursor: grabbing;
}

.th-cell {
  position: relative;
  display: flex;
  align-items: stretch;
  height: 100%;
}

.th-label {
  font-size: 0.77rem;
  font-weight: 600;
  color: #aaa;
  overflow: hidden;
  text-overflow: ellipsis;
}

.th-icons {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  flex-shrink: 0;
}

.th-sort,
.th-filter-btn {
  opacity: 0.5;
  transition: opacity 0.12s;
}

.scanner-table thead th:hover .th-sort,
.scanner-table thead th:hover .th-filter-btn {
  opacity: 1;
}

.th-filter-btn.th-filter-active {
  opacity: 1;
  color: #c87628;
}

.th-sort {
  display: flex;
  align-items: center;
}

.sort-icon {
  font-size: 0.6rem;
  line-height: 1;
  color: #888;
}

.sort-icon.active {
  color: #c87628;
}

/* ── Column resize handle ───────────────────────────────────── */
.col-resize-handle {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 5px;
  cursor: col-resize;
  z-index: 2;
  background: transparent;
  transition: background 0.12s;
}

.col-resize-handle:hover {
  background: rgba(200, 118, 40, 0.5);
}

/* ── Column drag-over highlight ─────────────────────────────── */
.scanner-table thead th.col-drag-over {
  background: rgba(200, 118, 40, 0.15);
  outline: 2px solid rgba(200, 118, 40, 0.5);
  outline-offset: -2px;
}

/* ── Table cells ───────────────────────────────────────────── */
.scanner-table tbody tr {
  border-bottom: 1px solid rgba(51, 51, 51, 0.35);
  transition: background 0.1s ease;
}

.scanner-table tbody tr:nth-child(even) {
  background: rgba(255, 255, 255, 0.012);
}

.scanner-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.05);
}

.scanner-table td {
  padding: 0.32rem 0.5rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-right: 1px solid rgba(51, 51, 51, 0.2);
  color: var(--color-text-soft);
}

.scanner-table td:last-child {
  border-right: none;
}

.right  { text-align: right; }
.center { text-align: center; }
.left   { text-align: left; }

.td-symbol {
  font-size: 0.88rem;
  color: var(--color-text) !important;
  letter-spacing: 0.02em;
}

.symbol-link {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
  transition: text-decoration-color 0.15s ease;
}

.symbol-link:hover {
  text-decoration-color: currentColor;
}

.td-last {
  color: var(--color-text) !important;
  font-variant-numeric: tabular-nums;
}

.td-sector { font-size: 0.81rem; }

.td-category { font-size: 0.82rem; }
.cat-cont      { color: #42b883 !important; }
.cat-cont-plus { color: #4ade80 !important; }
.cat-inside    { color: #f59e0b !important; }
.cat-reversal  { color: #f97316 !important; }

.td-signal { font-size: 0.82rem; }
.sig-bullish { color: #42b883 !important; }
.sig-bearish { color: #f97316 !important; }
.sig-hammer  { color: #f59e0b !important; }

.td-pattern {
  font-size: 0.81rem;
  color: #bbb !important;
}

.td-cc { font-weight: 600; font-size: 0.82rem; }
.cc-up   { color: #42b883 !important; }
.cc-down { color: #f97316 !important; }

.td-vol { font-variant-numeric: tabular-nums; }

.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-green { background: #22c55e; box-shadow: 0 0 4px rgba(34, 197, 94, 0.5); }
.dot-amber { background: #f59e0b; box-shadow: 0 0 4px rgba(245, 158, 11, 0.4); }

.chg-pos { color: #42b883 !important; font-variant-numeric: tabular-nums; }
.chg-neg { color: #ff6b6b !important; font-variant-numeric: tabular-nums; }

.td-atrd { color: #ccc !important; font-variant-numeric: tabular-nums; }

/* ── Column filter button in header ─────────────────────────── */
.th-filter-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  padding: 1px 2px;
  border-radius: 3px;
  cursor: pointer;
  color: #666;
  flex-shrink: 0;
  transition: color 0.12s, background 0.12s;
}

.th-filter-btn:hover {
  color: #ccc;
  background: rgba(255,255,255,0.08);
}

.scanner-table thead th:hover .th-filter-btn {
  color: #999;
}

.th-filter-icon {
  width: 0.7rem;
  height: 0.7rem;
}

/* ── MTF column ────────────────────────────────────────────── */
.td-mtf { padding: 0.28rem 0.4rem; }

.mtf-chips {
  display: flex;
  align-items: center;
  gap: 2px;
}

.mtf-chip {
  font-size: 0.64rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  letter-spacing: 0.01em;
  line-height: 1.5;
}

.mtf-up {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.14);
}

.mtf-down {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.14);
}
</style>
