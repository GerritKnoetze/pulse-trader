<script setup lang="ts">
import { ref, watch } from 'vue'
import { CheckCircleIcon, XCircleIcon } from '@heroicons/vue/24/solid'

const props = defineProps<{ open: boolean }>()
const emit  = defineEmits<{ (e: 'close'): void }>()

// ── Types ─────────────────────────────────────────────────────────────────────
type StepId     = 'config' | 'api' | 'chat'
type StepStatus = 'pending' | 'running' | 'success' | 'error'

interface Step {
  id:     StepId
  label:  string
  status: StepStatus
  logs:   string[]
}

interface StepEvent {
  type:   'step'
  id:     StepId
  status: 'running' | 'success' | 'error'
  msg:    string
}

interface DoneEvent {
  type:    'done'
  overall: 'success' | 'error'
}

// ── State ─────────────────────────────────────────────────────────────────────
const steps = ref<Step[]>([
  { id: 'config', label: 'Load Configuration',      status: 'pending', logs: [] },
  { id: 'api',    label: 'REST API / Auth Test',     status: 'pending', logs: [] },
  { id: 'chat',   label: 'Chat Completion Response', status: 'pending', logs: [] },
])

const overall = ref<'running' | 'success' | 'error' | 'idle'>('idle')
const done    = ref(false)

function reset() {
  steps.value.forEach(s => { s.status = 'pending'; s.logs = [] })
  overall.value = 'idle'
  done.value    = false
}

// ── Run test via SSE ──────────────────────────────────────────────────────────
function runTest() {
  reset()
  overall.value = 'running'

  const es = new EventSource('/api/settings/llm-connection-test')

  es.onmessage = (e) => {
    try {
      const data: StepEvent | DoneEvent = JSON.parse(e.data)
      if (data.type === 'step') {
        const step = steps.value.find(s => s.id === data.id)
        if (step) { step.status = data.status; step.logs.push(data.msg) }
      } else if (data.type === 'done') {
        overall.value = data.overall
        done.value = true
        es.close()
      }
    } catch { /* ignore */ }
  }

  es.onerror = () => {
    steps.value.forEach(s => {
      if (s.status === 'pending' || s.status === 'running') {
        s.status = 'error'
        s.logs.push('Connection to test endpoint lost')
      }
    })
    overall.value = 'error'
    done.value = true
    es.close()
  }
}

watch(() => props.open, (v) => { if (v) runTest() })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ct-overlay" @click.self="done && emit('close')">
      <div class="ct-modal">

        <!-- Header -->
        <div class="ct-header">
          <span class="ct-title">Connection Test — GitHub Copilot</span>
          <button v-if="done" class="ct-close" title="Close" @click="emit('close')">✕</button>
        </div>

        <!-- Steps -->
        <div class="ct-steps">
          <div v-for="step in steps" :key="step.id" class="ct-step" :class="`ct-step--${step.status}`">
            <div class="ct-step-icon">
              <svg v-if="step.status === 'running'" class="ct-spinner" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-dasharray="40 22" />
              </svg>
              <CheckCircleIcon v-else-if="step.status === 'success'" class="ct-icon-ok" />
              <XCircleIcon     v-else-if="step.status === 'error'"   class="ct-icon-err" />
              <span            v-else                                  class="ct-icon-pending" />
            </div>
            <div class="ct-step-content">
              <div class="ct-step-label">{{ step.label }}</div>
              <div v-for="(log, i) in step.logs" :key="i" class="ct-step-log">{{ log }}</div>
            </div>
          </div>
        </div>

        <!-- Result banner -->
        <div v-if="done" class="ct-result" :class="`ct-result--${overall}`">
          <CheckCircleIcon v-if="overall === 'success'" class="ct-result-icon" />
          <XCircleIcon     v-else                       class="ct-result-icon" />
          <span v-if="overall === 'success'">GitHub Copilot is configured and responding correctly</span>
          <span v-else>One or more tests failed — review the details above</span>
        </div>

        <!-- Footer -->
        <div class="ct-footer">
          <button v-if="done" class="ct-btn" @click="runTest">Re-run</button>
          <button v-if="done" class="ct-btn ct-btn--primary" @click="emit('close')">Close</button>
          <span v-else class="ct-running-hint">Running tests…</span>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ct-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ct-modal {
  width: 580px;
  max-width: 95vw;
  background: #141414;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6);
}
.ct-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid #222;
  background: #111;
}
.ct-title { font-size: 0.9rem; font-weight: 600; color: #e0e0e0; }
.ct-close {
  background: none; border: none; color: #666; font-size: 1rem;
  cursor: pointer; padding: 0.1rem 0.3rem; border-radius: 3px; line-height: 1;
}
.ct-close:hover { color: #ccc; background: #222; }

.ct-steps { padding: 0.75rem 0; display: flex; flex-direction: column; }
.ct-step {
  display: flex; gap: 0.75rem; align-items: flex-start;
  padding: 0.65rem 1.1rem; border-bottom: 1px solid #1a1a1a;
}
.ct-step-icon {
  flex-shrink: 0; width: 20px; height: 20px;
  margin-top: 1px; display: flex; align-items: center; justify-content: center;
}
.ct-icon-pending { display: block; width: 10px; height: 10px; border-radius: 50%; background: #333; }
.ct-icon-ok  { width: 20px; height: 20px; color: #4ade80; }
.ct-icon-err { width: 20px; height: 20px; color: #ff6b6b; }

@keyframes spin { to { transform: rotate(360deg); } }
.ct-spinner { width: 18px; height: 18px; color: #60a5fa; animation: spin 0.9s linear infinite; }

.ct-step-content { flex: 1; min-width: 0; overflow: hidden; }
.ct-step-label { font-size: 0.83rem; font-weight: 600; color: #ccc; margin-bottom: 0.15rem; }
.ct-step--pending .ct-step-label { color: #555; }
.ct-step-log {
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 0.74rem; line-height: 1.5; color: #888;
  overflow-wrap: anywhere; word-break: break-all; white-space: normal;
}
.ct-step--running  .ct-step-log { color: #7ca0d0; }
.ct-step--success  .ct-step-log:last-child { color: #4ade80; }
.ct-step--error    .ct-step-log:last-child { color: #ff8888; }

.ct-result {
  display: flex; align-items: center; gap: 0.6rem;
  margin: 0.75rem 1.1rem; padding: 0.65rem 0.85rem;
  border-radius: 5px; font-size: 0.82rem; font-weight: 500;
}
.ct-result--success { background: rgba(74,222,128,0.08); color: #4ade80; border: 1px solid rgba(74,222,128,0.2); }
.ct-result--error   { background: rgba(255,107,107,0.08); color: #ff8888; border: 1px solid rgba(255,107,107,0.2); }
.ct-result-icon { width: 18px; height: 18px; flex-shrink: 0; }

.ct-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem;
  padding: 0.75rem 1.1rem; background: #0f0f0f; border-top: 1px solid #1e1e1e;
}
.ct-running-hint { font-size: 0.78rem; color: #555; font-style: italic; }
.ct-btn {
  padding: 0.35rem 0.9rem; font-size: 0.8rem; border-radius: 4px;
  border: 1px solid #333; background: #1c1c1c; color: #aaa; cursor: pointer;
}
.ct-btn:hover { background: #242424; color: #ddd; }
.ct-btn--primary { background: #1d3a5e; border-color: #2a5a9a; color: #90c0f0; }
.ct-btn--primary:hover { background: #1a4a7a; color: #b0d0ff; }
</style>
