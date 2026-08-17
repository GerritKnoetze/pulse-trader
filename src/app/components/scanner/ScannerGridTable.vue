<script setup lang="ts">
import { ref } from 'vue'
import {
  FunnelIcon,
  DocumentDuplicateIcon,
  XMarkIcon,
  BoltIcon,
  MinusCircleIcon,
  WifiIcon,
  ExclamationCircleIcon,
} from '@heroicons/vue/24/outline'
import { FunnelIcon as FunnelIconSolid, BoltIcon as BoltSolidIcon } from '@heroicons/vue/24/solid'
import ScannerSetupChecklist from '~/components/scanner/ScannerSetupChecklist.vue'
import type { StratSetup } from '~/types/scanner'

const copiedSymbol = ref<string | null>(null)
let copyTimeout: ReturnType<typeof setTimeout> | null = null

function copySymbol(symbol: string) {
  navigator.clipboard.writeText(symbol)
  copiedSymbol.value = symbol
  if (copyTimeout) clearTimeout(copyTimeout)
  copyTimeout = setTimeout(() => { copiedSymbol.value = null }, 1500)
}
import LoadingOverlay from '~/components/common/LoadingOverlay.vue'
import { useScanner } from '~/composables/useScanner'
import { useChartTabs } from '~/composables/useChartTabs'
import { useGridColumns } from '~/composables/useGridColumns'
import { useGridFilters } from '~/composables/useGridFilters'
import type { ScannerRow } from '~/types/scanner'
import type { ColDef } from '~/composables/useGridColumns'

const MTF_TFS = ['1', '5', 'D'] as const
type MtfTf = typeof MTF_TFS[number]
const MTF_VISIBLE = new Set<MtfTf>(['1', '5', 'D'])

const { sortKey, sortDir, setSortBy, loadMore, isLoadingMore, nextCursor, isScanning, runScan, lastScan, total } = useScanner()
const { openTab } = useChartTabs()

// ── Setup modal ─────────────────────────────────────────────
const modalSetup = ref<StratSetup | null>(null)
function openSetupModal(setup: StratSetup) { modalSetup.value = setup }
function closeSetupModal() { modalSetup.value = null }

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
  <div class="scanner-grid-scroll" :style="isScanning ? { overflow: 'hidden' } : {}">
    <!-- Loading overlay -->
    <LoadingOverlay v-if="isScanning" label="Scanning market..." />
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
        <tr v-if="localFilteredRows.length === 0">
          <td :colspan="orderedColumns.length" class="empty-state">
            <div class="empty-state-inner">
              <template v-if="lastScan">
                <p class="empty-title">No matching symbols</p>
                <p class="empty-sub">
                  The last scan found no rows{{ total > 0 ? ` (${total} before grid filters)` : '' }}.
                  Adjust your criteria or filters and scan again.
                </p>
              </template>
              <template v-else>
                <p class="empty-title">No data loaded</p>
                <p class="empty-sub">Run an initial scan to pull the market snapshot and build your watchlist.</p>
              </template>
              <button class="empty-scan-btn" :disabled="isScanning" @click="runScan(false)">
                <span v-if="isScanning" class="empty-spinner" />
                {{ isScanning ? 'Scanning…' : lastScan ? 'Rescan' : 'Run Initial Scan' }}
              </button>
            </div>
          </td>
        </tr>
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
              <span class="symbol-cell">
                <span class="symbol-link" @click="openTab(row.symbol, row.last, row.setup)">{{ row.symbol }}</span>
                <button
                  class="symbol-copy-btn"
                  :class="{ 'symbol-copy-copied': copiedSymbol === row.symbol }"
                  :title="copiedSymbol === row.symbol ? 'Copied!' : 'Copy symbol'"
                  @click.stop="copySymbol(row.symbol)"
                >
                  <DocumentDuplicateIcon class="symbol-copy-icon" />
                </button>
              </span>
            </template>
            <template v-else-if="col.key === 'inForce'">
              <span v-if="row.inForce" class="dot dot-green" title="In Force" />
            </template>
            <template v-else-if="col.key === 'ftfc'">
              <span v-if="row.ftfc" class="dot dot-amber" title="Full Time Frame Continuity" />
            </template>
            <template v-else-if="col.key === 'wsActive'">
              <span class="icon-cell" :title="row.wsActive ? 'WS live' : 'WS off'">
                <WifiIcon class="ws-icon" :class="row.wsActive ? 'ws-on' : 'ws-off'" />
              </span>
            </template>
            <template v-else-if="col.key === 'enrichLevel'">
              <span
                class="icon-cell"
                :title="row.enrichLevel === 'full'
                  ? 'Fully enriched (daily + intraday)'
                  : row.enrichLevel === 'daily'
                    ? 'Enriched — daily bars only'
                    : row.enrichLevel === 'error'
                      ? 'Rate limited — data not fetched'
                      : 'Not enriched (snapshot data)'"
              >
                <BoltSolidIcon v-if="row.enrichLevel === 'full'" class="enrich-icon enrich-full" />
                <BoltIcon v-else-if="row.enrichLevel === 'daily'" class="enrich-icon enrich-daily" />
                <ExclamationCircleIcon v-else-if="row.enrichLevel === 'error'" class="enrich-icon enrich-error" />
                <MinusCircleIcon v-else class="enrich-icon enrich-none" />
              </span>
            </template>
            <template v-else-if="col.key === 'mtf'">
              <span class="mtf-chips">
                <span
                  v-for="tf in MTF_TFS"
                  :key="tf"
                  :class="['mtf-chip', 'mtf-' + row.mtf[tf as MtfTf], MTF_VISIBLE.has(tf) ? '' : 'mtf-chip--hidden']"
                >{{ tf }}</span>
              </span>
            </template>
            <template v-else-if="col.key === 'setup'">
              <template v-if="row.setup">
                <div class="setup-cell" @click.stop="openSetupModal(row.setup)">
                  <span :class="['setup-badge', `setup-q-${row.setup.quality.replace('+','plus')}`]">
                    {{ row.setup.quality }}
                  </span>
                  <span :class="['setup-dir', row.setup.direction === 'long' ? 'setup-long' : 'setup-short']">
                    {{ row.setup.direction === 'long' ? '▲' : '▼' }}
                  </span>
                  <!-- Hover tooltip -->
                  <div class="setup-tooltip">
                    <div class="stt-header">
                      <span :class="['stt-quality', `setup-q-${row.setup.quality.replace('+','plus')}`]">{{ row.setup.quality }}</span>
                      <span :class="['stt-dir', row.setup.direction === 'long' ? 'setup-long' : 'setup-short']">{{ row.setup.direction.toUpperCase() }}</span>
                      <span class="stt-tf">{{ row.setup.signalTf }}</span>
                    </div>
                    <div class="stt-combo">{{ row.setup.combo }}</div>
                    <div class="stt-levels">
                      <span class="stt-lbl">Entry</span><span class="stt-entry">${{ row.setup.entryPrice.toFixed(2) }}</span>
                      <span class="stt-lbl">Stop</span><span class="stt-stop">${{ row.setup.stop.toFixed(2) }}</span>
                      <span class="stt-lbl">T1</span><span class="stt-t1">${{ row.setup.targets[0]?.toFixed(2) ?? '—' }}</span>
                    </div>
                    <div class="stt-rr">R:R {{ row.setup.rr }} · {{ row.setup.atrRisk }}× ATR</div>
                    <div class="stt-hint">Click for full checklist</div>
                  </div>
                </div>
              </template>
            </template>
            <template v-else>{{ getCellText(col, row) }}</template>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td :colspan="orderedColumns.length" class="load-more-cell">
            <span v-if="isLoadingMore" class="load-more-spinner">Loading…</span>
            <button
              v-else-if="nextCursor"
              class="load-more-btn"
              @click="loadMore()"
            >Load more</button>
          </td>
        </tr>
      </tfoot>
    </table>
  </div>

  <!-- Setup modal -->
  <Teleport to="body">
    <div v-if="modalSetup" class="setup-modal-backdrop" @click.self="closeSetupModal">
      <div class="setup-modal">
        <button class="setup-modal-close" @click="closeSetupModal">
          <XMarkIcon class="setup-modal-close-icon" />
        </button>
        <ScannerSetupChecklist :setup="modalSetup" @back="closeSetupModal" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scanner-grid-scroll {
  flex: 1;
  overflow: auto;
  position: relative;
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

.symbol-cell {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.symbol-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  color: transparent;
  transition: color 0.15s;
  flex-shrink: 0;
}

.td-symbol:hover .symbol-copy-btn,
.symbol-copy-btn.symbol-copy-copied {
  color: var(--color-text-mute, #888);
}

.symbol-copy-btn:hover {
  color: var(--color-text, #eee) !important;
}

.symbol-copy-btn.symbol-copy-copied {
  color: #42b883 !important;
}

.symbol-copy-icon {
  width: 0.85rem;
  height: 0.85rem;
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
.cat-reversal  { color: #ff6b6b !important; }

.td-signal { font-size: 0.82rem; }
.sig-bullish { color: #42b883 !important; }
.sig-bearish { color: #ff6b6b !important; }
.sig-hammer  { color: #f59e0b !important; }

.td-pattern {
  font-size: 0.81rem;
  color: #bbb !important;
}

.td-cc { font-weight: 600; font-size: 0.82rem; }
.cc-up   { color: #42b883 !important; }
.cc-down { color: #ff6b6b !important; }

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

/* ── WS + enrichment icon columns ─────────────────────────── */
.icon-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
}

.ws-icon,
.enrich-icon {
  width: 14px;
  height: 14px;
}

.ws-on         { color: #4ade80; }
.ws-off        { color: #555; }
.enrich-full   { color: #4ade80; }
.enrich-daily  { color: #f59e0b; }
.enrich-error  { color: #f23645; }
.enrich-none   { color: #555; }

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

.mtf-chip--hidden {
  display: none;
}

.mtf-up {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.14);
}

.mtf-down {
  color: #ff6b6b;
  background: rgba(255, 107, 107, 0.14);
}

/* ── Infinite scroll sentinel ───────────────────────────────── */
.load-more-cell {
  padding: 0.6rem;
  text-align: center;
  border: none;
}
.load-more-btn {
  padding: 0.35rem 1.1rem;
  font-size: 0.78rem;
  color: var(--color-text-mute, #aaa);
  background: transparent;
  border: 1px solid var(--color-border, #444);
  border-radius: 4px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.load-more-btn:hover {
  color: var(--color-text, #eee);
  border-color: var(--color-text-mute, #888);
}
.load-more-spinner {
  display: inline-block;
  padding: 0.5rem;
  font-size: 0.78rem;
  color: #666;
  animation: pulse-text 1s ease-in-out infinite;
}
@keyframes pulse-text { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

/* ── Setup column ───────────────────────────────────────────── */
.td-setup { padding: 0.28rem 0.4rem; }

.setup-cell {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  cursor: pointer;
  padding: 0.1rem 0.2rem;
  border-radius: 4px;
  transition: background 0.12s;
}
.setup-cell:hover { background: rgba(255,255,255,0.06); }

.setup-badge {
  font-size: 0.66rem;
  font-weight: 800;
  padding: 0.08rem 0.28rem;
  border-radius: 3px;
  letter-spacing: 0.03em;
}
.setup-q-Aplus  { background: rgba(42,92,42,0.8);  color: #6dde6d; }
.setup-q-A      { background: rgba(30,74,30,0.8);  color: #4fc34f; }
.setup-q-B      { background: rgba(58,58,26,0.8);  color: #c8c840; }
.setup-q-C      { background: rgba(58,26,26,0.8);  color: #c84040; }

.setup-dir  { font-size: 0.65rem; font-weight: 700; }
.setup-long  { color: #22c55e; }
.setup-short { color: #ff6b6b; }

/* Tooltip */
.setup-tooltip {
  display: none;
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  width: 200px;
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 6px;
  padding: 0.5rem 0.55rem;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  pointer-events: none;
}
/* Keep it on screen if near right edge */
.setup-cell:hover .setup-tooltip { display: block; }

.stt-header {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin-bottom: 0.25rem;
}
.stt-quality {
  font-size: 0.65rem;
  font-weight: 800;
  padding: 0.05rem 0.25rem;
  border-radius: 3px;
}
.stt-dir  { font-size: 0.68rem; font-weight: 700; }
.stt-tf   { font-size: 0.65rem; color: #888; margin-left: auto; }
.stt-combo { font-size: 0.68rem; color: #ccc; margin-bottom: 0.3rem; }

.stt-levels {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 0.4rem;
  row-gap: 0.15rem;
  font-size: 0.67rem;
  margin-bottom: 0.3rem;
  font-variant-numeric: tabular-nums;
}
.stt-lbl   { color: #777; }
.stt-entry { color: #a8d0ff; }
.stt-stop  { color: #ffb0b0; }
.stt-t1    { color: #a0e8b0; }
.stt-rr    { font-size: 0.65rem; color: #999; margin-bottom: 0.25rem; }
.stt-hint  { font-size: 0.62rem; color: #555; text-align: center; }

/* ── Setup modal ────────────────────────────────────────────── */
.setup-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.setup-modal {
  position: relative;
  background: #161616;
  border: 1px solid #333;
  border-radius: 8px;
  width: 380px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
}

.setup-modal-close {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  color: #777;
  padding: 0.2rem;
  border-radius: 4px;
  z-index: 1;
  transition: color 0.12s;
  display: flex;
  align-items: center;
}
.setup-modal-close:hover { color: #ccc; }
.setup-modal-close-icon { width: 1rem; height: 1rem; }

/* ── Loading state — handled by LoadingOverlay component ── */

/* ── Empty state ───────────────────────────────────────────── */
.empty-state {
  padding: 3rem 1.5rem;
  text-align: center;
}

.empty-state-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  max-width: 420px;
  margin: 0 auto;
}

.empty-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
}

.empty-sub {
  font-size: 0.8rem;
  color: var(--color-text-soft);
  margin: 0 0 0.5rem;
}

.empty-scan-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.4rem 1.1rem;
  font-size: 0.8rem;
  font-weight: 600;
  background: #c87628;
  border: none;
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
  letter-spacing: 0.02em;
}
.empty-scan-btn:hover:not(:disabled) { background: #d98a3a; }
.empty-scan-btn:disabled { opacity: 0.5; cursor: default; }

.empty-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
