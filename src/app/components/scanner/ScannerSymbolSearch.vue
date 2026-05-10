<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { XMarkIcon, MagnifyingGlassIcon } from '@heroicons/vue/24/outline'
import { useChartTabs } from '~/composables/useChartTabs'

interface TickerResult {
  ticker?: string
  name?: string
  type?: string
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { openTab } = useChartTabs()

const query = ref('')
const results = ref<TickerResult[]>([])
const isLoading = ref(false)
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.open, (val) => {
  if (val) {
    query.value = ''
    results.value = []
    activeIndex.value = 0
    nextTick(() => inputRef.value?.focus())
  }
})

watch(query, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!val.trim()) {
    results.value = []
    return
  }
  isLoading.value = true
  debounceTimer = setTimeout(async () => {
    try {
      const data = await $fetch<{ success: boolean; data: TickerResult[] }>(
        '/api/market-data/tickers',
        { query: { search: val.trim() } },
      )
      results.value = data.data ?? []
      activeIndex.value = 0
    } catch {
      results.value = []
    } finally {
      isLoading.value = false
    }
  }, 250)
})

function close() {
  emit('update:open', false)
}

function select(ticker: TickerResult) {
  if (!ticker.ticker) return
  openTab(ticker.ticker, 0)
  close()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { close(); return }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    const item = results.value[activeIndex.value]
    if (item) select(item)
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sss-fade">
      <div v-if="open" class="sss-backdrop" @mousedown.self="close">
        <div class="sss-modal" role="dialog" aria-modal="true" aria-label="Symbol Search">
          <div class="sss-header">
            <MagnifyingGlassIcon class="sss-header-icon" />
            <input
              ref="inputRef"
              v-model="query"
              class="sss-input"
              placeholder="Search symbol or company name…"
              autocomplete="off"
              spellcheck="false"
              @keydown="onKeydown"
            />
            <button class="sss-close" title="Close" @click="close">
              <XMarkIcon class="sss-close-icon" />
            </button>
          </div>

          <div class="sss-body">
            <div v-if="isLoading" class="sss-state">Searching…</div>
            <div v-else-if="query && !results.length" class="sss-state">No results for "{{ query }}"</div>
            <div v-else-if="!query" class="sss-state sss-hint">Type a ticker or company name to search</div>
            <ul v-else class="sss-list">
              <li
                v-for="(item, i) in results"
                :key="item.ticker"
                class="sss-item"
                :class="{ active: i === activeIndex }"
                @mouseenter="activeIndex = i"
                @click="select(item)"
              >
                <span class="sss-ticker">{{ item.ticker }}</span>
                <span class="sss-name">{{ item.name }}</span>
                <span v-if="item.type" class="sss-type">{{ item.type }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sss-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 9000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 8vh;
}

.sss-modal {
  width: 560px;
  max-width: calc(100vw - 2rem);
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 8px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.7);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Header */
.sss-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.sss-header-icon {
  width: 18px;
  height: 18px;
  color: #c87628;
  flex-shrink: 0;
}

.sss-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--color-text);
  font-size: 1rem;
  font-weight: 500;
}

.sss-input::placeholder {
  color: var(--color-text-soft);
  opacity: 0.5;
  font-weight: 400;
}

.sss-close {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--color-text-soft);
  cursor: pointer;
  border-radius: var(--radius-sm, 4px);
  padding: 0.2rem;
  transition: color 0.15s, background 0.15s;
}

.sss-close:hover {
  color: var(--color-text);
  background: rgba(255, 255, 255, 0.06);
}

.sss-close-icon {
  width: 18px;
  height: 18px;
}

/* Body */
.sss-body {
  min-height: 3rem;
  max-height: 420px;
  overflow-y: auto;
}

.sss-body::-webkit-scrollbar { width: 4px; }
.sss-body::-webkit-scrollbar-thumb { background: var(--color-border); }

.sss-state {
  padding: 1.25rem 1rem;
  font-size: 0.85rem;
  color: var(--color-text-soft);
  text-align: center;
}

.sss-hint { opacity: 0.5; }

/* Results list */
.sss-list {
  list-style: none;
  margin: 0;
  padding: 0.3rem;
}

.sss-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  transition: background 0.1s;
}

.sss-item:hover,
.sss-item.active {
  background: rgba(200, 118, 40, 0.12);
}

.sss-ticker {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--color-text);
  min-width: 72px;
  letter-spacing: 0.03em;
}

.sss-item.active .sss-ticker {
  color: #c87628;
}

.sss-name {
  flex: 1;
  font-size: 0.83rem;
  color: var(--color-text-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sss-type {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #777;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  flex-shrink: 0;
}

/* Transition */
.sss-fade-enter-active,
.sss-fade-leave-active {
  transition: opacity 0.15s ease;
}
.sss-fade-enter-active .sss-modal,
.sss-fade-leave-active .sss-modal {
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.sss-fade-enter-from,
.sss-fade-leave-to {
  opacity: 0;
}
.sss-fade-enter-from .sss-modal,
.sss-fade-leave-to .sss-modal {
  transform: translateY(-12px);
  opacity: 0;
}
</style>
