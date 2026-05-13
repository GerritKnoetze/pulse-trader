<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useAppLog } from '~/composables/useAppLog'
import { useSettings } from '~/composables/useSettings'

const props = defineProps<{ open: boolean }>()
const emit  = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const { entries, connect, disconnect, clearLog } = useAppLog()
const { getSettings } = useSettings()

// ── Debug mode ────────────────────────────────────────────────────────────────
const debugMode  = ref(false)   // set by settings checkbox — controls badge visibility
const showDetail = ref(true)    // toggled by clicking the badge — controls detail rows

async function loadDebugMode() {
  try {
    const data = await getSettings()
    debugMode.value = data['debug-mode'] === 'true'
  } catch { /* non-critical */ }
}

function toggleDetail() {
  showDetail.value = !showDetail.value
}



// ── Resize via splitter drag ──────────────────────────────────────────────────
const panelHeight = ref(200)
const MIN_H = 80
const MAX_H = 600
let dragStartY = 0
let dragStartH = 0

function onSplitterMousedown(e: MouseEvent) {
  e.preventDefault()
  dragStartY = e.clientY
  dragStartH = panelHeight.value
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup',   onDragEnd)
}

function onDragMove(e: MouseEvent) {
  // Dragging up (negative delta) → increase height
  const delta = dragStartY - e.clientY
  panelHeight.value = Math.min(MAX_H, Math.max(MIN_H, dragStartH + delta))
}

function onDragEnd() {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup',   onDragEnd)
}

// ── Auto-scroll to bottom ─────────────────────────────────────────────────────
const logBody = ref<HTMLElement | null>(null)
let userScrolledUp = false

function onScroll() {
  if (!logBody.value) return
  const el = logBody.value
  userScrolledUp = el.scrollTop + el.clientHeight < el.scrollHeight - 4
}

watch(entries, async () => {
  if (userScrolledUp) return
  await nextTick()
  if (logBody.value) logBody.value.scrollTop = logBody.value.scrollHeight
}, { deep: true })

// ── Timestamp formatter ───────────────────────────────────────────────────────
function fmt(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── Copy all entries to clipboard ────────────────────────────────────────────
const copyFeedback = ref(false)
function copyLog() {
  const text = entries.value
    .map(e => {
      const line = `${fmt(e.ts)}  ${e.level.toUpperCase().padEnd(5)}  ${e.msg}`
      return (debugMode.value && showDetail.value && e.detail) ? `${line}\n              ${e.detail}` : line
    })
    .join('\n')
  navigator.clipboard.writeText(text).then(() => {
    copyFeedback.value = true
    setTimeout(() => { copyFeedback.value = false }, 1500)
  })
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(() => { connect(); loadDebugMode() })
onUnmounted(disconnect)
</script>

<template>
  <div v-if="open" class="log-console" :style="{ height: `${panelHeight}px` }">
    <!-- Splitter / drag handle -->
    <div class="log-splitter" title="Drag to resize" @mousedown="onSplitterMousedown">
      <span class="log-splitter-grip" />
    </div>

    <!-- Toolbar -->
    <div class="log-toolbar">
      <span class="log-title">Console</span>
      <span class="log-count">{{ entries.length }} entries</span>
      <span class="log-toolbar-spacer" />
      <button
        v-if="debugMode"
        class="log-btn"
        :class="{ 'log-btn--debug-on': showDetail }"
        :title="showDetail ? 'Hide debug detail lines' : 'Show debug detail lines'"
        @click="toggleDetail"
      >Debug</button>
      <button class="log-btn" title="Copy all to clipboard" @click="copyLog">{{ copyFeedback ? 'Copied!' : 'Copy' }}</button>
      <button class="log-btn" title="Clear" @click="clearLog">Clear</button>
      <button class="log-btn log-btn--close" title="Close" @click="emit('update:open', false)">✕</button>
    </div>

    <!-- Log entries -->
    <div ref="logBody" class="log-body" @scroll="onScroll">
      <div v-if="entries.length === 0" class="log-empty">No log entries yet…</div>
      <template v-for="entry in entries" :key="entry.id">
        <div
          class="log-row"
          :class="`log-row--${entry.level}`"
        >
          <span class="log-ts">{{ fmt(entry.ts) }}</span>
          <span class="log-level">{{ entry.level.toUpperCase() }}</span>
          <span class="log-msg">{{ entry.msg }}</span>
        </div>
        <div
          v-if="debugMode && showDetail && entry.detail"
          class="log-row log-row--detail"
        >
          <span class="log-ts log-ts--detail">╰</span>
          <span class="log-detail">{{ entry.detail }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.log-console {
  display: flex;
  flex-direction: column;
  background: #0d0d0d;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
  overflow: hidden;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
}

/* ── Splitter ──────────────────────────────────────────────────────────────── */
.log-splitter {
  height: 6px;
  cursor: ns-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: #1a1a1a;
  border-bottom: 1px solid var(--color-border);
}
.log-splitter:hover { background: #252525; }
.log-splitter-grip {
  display: block;
  width: 32px;
  height: 3px;
  border-radius: 2px;
  background: #3a3a3a;
}
.log-splitter:hover .log-splitter-grip { background: #555; }

/* ── Toolbar ───────────────────────────────────────────────────────────────── */
.log-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.2rem 0.75rem;
  background: #111;
  border-bottom: 1px solid #222;
  flex-shrink: 0;
}
.log-title {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #666;
  text-transform: uppercase;
}
.log-count {
  font-size: 0.7rem;
  color: #444;
}
.log-btn {
  font-size: 0.72rem;
  background: none;
  border: 1px solid #333;
  border-radius: 3px;
  color: #777;
  padding: 0.1rem 0.45rem;
  cursor: pointer;
  line-height: 1.4;
}
.log-btn:hover { background: #222; color: #aaa; }
.log-btn--debug-on {
  color: #4a9a4a;
  border-color: #2a5a2a;
  background: #1a2a1a;
}
.log-btn--debug-on:hover { background: #223322; color: #6aba6a; }
.log-toolbar-spacer { flex: 1; }

/* ── Log body ──────────────────────────────────────────────────────────────── */
.log-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.25rem 0;
  scroll-behavior: smooth;
}
.log-body::-webkit-scrollbar { width: 6px; }
.log-body::-webkit-scrollbar-track { background: #111; }
.log-body::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }

.log-empty {
  padding: 0.75rem 0.75rem;
  color: #444;
  font-size: 0.76rem;
}

.log-row {
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
  padding: 0.1rem 0.75rem;
  font-size: 0.76rem;
  line-height: 1.55;
  border-bottom: 1px solid #141414;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.log-row:hover { background: #151515; }

.log-ts {
  color: #3a3a3a;
  flex-shrink: 0;
  font-size: 0.7rem;
}

.log-level {
  flex-shrink: 0;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  width: 36px;
}
.log-msg {
  color: #b0b0b0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Level colours */
.log-row--info  .log-level { color: #2a7a4a; }
.log-row--warn  .log-level { color: #c87628; }
.log-row--warn  .log-msg   { color: #c8a050; }
.log-row--error .log-level { color: #ff6b6b; }
.log-row--error .log-msg   { color: #ff8888; }

/* Debug detail row */
.log-row--detail {
  border-bottom: none;
  padding-top: 0;
  padding-bottom: 0.15rem;
  background: #0a0a0a;
  align-items: flex-start;
}
.log-ts--detail {
  color: #252525;
  user-select: none;
}
.log-detail {
  color: #3d5a45;
  font-size: 0.7rem;
  white-space: normal;
  word-break: break-word;
  line-height: 1.45;
  overflow: visible;
  text-overflow: unset;
}
</style>
