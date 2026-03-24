<script setup lang="ts">
import { ref, computed } from 'vue'
import { ClipboardDocumentIcon, ClipboardDocumentCheckIcon } from '@heroicons/vue/24/outline'
import type { EndpointDefinition } from '~/composables/useDocsRegistry'
import DocsMethodBadge from './DocsMethodBadge.vue'

const props = defineProps<{
  endpoint: EndpointDefinition
}>()

const paramValues = inject<Ref<Record<string, string>>>('paramValues')!
const response = ref<{ status: number; statusText: string; body: unknown; time: number } | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const activeTab = ref<'sample' | 'query'>('sample')
const activeRequestTab = ref<'path' | 'query' | 'headers' | 'json'>('headers')

// Param groups — computed so the template stays clean
const pathParams = computed(() => props.endpoint.params?.filter((p) => p.in === 'path') ?? [])
const queryParams = computed(() => props.endpoint.params?.filter((p) => p.in === 'query') ?? [])
const headerParams = computed(() => props.endpoint.params?.filter((p) => p.in === 'header') ?? [])
const bodyParams = computed(() => props.endpoint.params?.filter((p) => p.in === 'body') ?? [])

// Reset state whenever the endpoint changes
watch(
  () => props.endpoint,
  () => {
    response.value = null
    error.value = null
    activeTab.value = 'sample'
    // Auto-select the most relevant request tab
    activeRequestTab.value =
      headerParams.value.length ? 'headers'
      : pathParams.value.length ? 'path'
      : queryParams.value.length ? 'query'
      : 'json'
  },
  { immediate: true },
)

const requestURL = useRequestURL()
const baseUrl = computed(() => `${requestURL.protocol}//${requestURL.host}`)

const requestPath = computed(() => {
  let url = props.endpoint.path

  if (props.endpoint.params) {
    for (const p of props.endpoint.params) {
      if (p.in === 'path' && paramValues.value[p.name]) {
        url = url.replace(`{${p.name}}`, encodeURIComponent(paramValues.value[p.name] ?? ''))
      }
    }
  }

  const queryParams =
    props.endpoint.params?.filter(
      (p) => p.in === 'query' && paramValues.value[p.name],
    ) || []

  if (queryParams.length) {
    const qs = queryParams
      .map(
        (p) =>
          `${encodeURIComponent(p.name)}=${encodeURIComponent(paramValues.value[p.name] ?? '')}`,
      )
      .join('&')
    url += `?${qs}`
  }

  return url
})

const curlCommand = computed(() => {
  const method = props.endpoint.method !== 'GET' ? ` -X ${props.endpoint.method}` : ''

  const headerArgs = (props.endpoint.params?.filter((p) => p.in === 'header') ?? [])
    .filter((p) => paramValues.value[p.name])
    .map((p) => {
      const val = p.bearer ? `Bearer ${paramValues.value[p.name]}` : paramValues.value[p.name]
      return ` -H "${p.name}: ${val}"`
    })
    .join('')

  const bodyObj = buildBodyObject()
  const bodyArg = Object.keys(bodyObj).length
    ? ` -H "Content-Type: application/json" -d '${JSON.stringify(bodyObj)}'`
    : ''

  return `curl${method}${headerArgs}${bodyArg} "${baseUrl.value}${requestPath.value}"`
})

const sendRequest = async () => {
  loading.value = true
  error.value = null
  response.value = null
  activeTab.value = 'query'

  const start = performance.now()

  try {
    const headers: Record<string, string> = {}
    for (const p of props.endpoint.params?.filter((p) => p.in === 'header') ?? []) {
      if (paramValues.value[p.name]) {
        headers[p.name] = p.bearer ? `Bearer ${paramValues.value[p.name]}` : paramValues.value[p.name]!
      }
    }

    const bodyObj = buildBodyObject()

    const res = await $fetch.raw(requestPath.value, {
      method: props.endpoint.method as 'GET',
      headers: Object.keys(headers).length ? headers : undefined,
      body: Object.keys(bodyObj).length ? bodyObj : undefined,
    })
    response.value = {
      status: res.status,
      statusText: res.statusText,
      body: res._data,
      time: Math.round(performance.now() - start),
    }
  } catch (e: unknown) {
    const time = Math.round(performance.now() - start)
    const err = e as { response?: { status: number; statusText: string; _data?: unknown }; message?: string }

    if (err.response) {
      response.value = {
        status: err.response.status,
        statusText: err.response.statusText,
        body: err.response._data || err.message,
        time,
      }
    } else {
      error.value = err.message || 'Request failed'
    }
  } finally {
    loading.value = false
  }
}

const formatJson = (obj: unknown) => {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

const highlightJson = (obj: unknown): string => {
  const raw = formatJson(obj)
  return raw.replace(
    /("[^"\\]*(?:\\.[^"\\]*)*")\s*:|"[^"\\]*(?:\\.[^"\\]*)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g,
    (match, key) => {
      if (key !== undefined) return `<span class="json-key">${key}</span>:`
      if (match.startsWith('"')) return `<span class="json-string">${match}</span>`
      if (match === 'true' || match === 'false') return `<span class="json-boolean">${match}</span>`
      if (match === 'null') return `<span class="json-null">${match}</span>`
      return `<span class="json-number">${match}</span>`
    },
  )
}

const copied = ref(false)
const copyCurl = async () => {
  await navigator.clipboard.writeText(curlCommand.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

const copiedResponse = ref(false)
const copyResponse = async (obj: unknown) => {
  await navigator.clipboard.writeText(formatJson(obj))
  copiedResponse.value = true
  setTimeout(() => (copiedResponse.value = false), 2000)
}

// Coerce a string param value to the correct JS type based on the param definition
function coerceBodyValue(p: { type: string }, raw: string): unknown {
  if (p.type === 'boolean') return raw === 'true'
  if (p.type === 'number' || p.type === 'integer') {
    const n = Number(raw)
    return isNaN(n) ? raw : n
  }
  return raw
}

// Build the outgoing body object, reconstructing nested objects from dot-notation keys
function buildBodyObject(): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const p of props.endpoint.params?.filter((p) => p.in === 'body') ?? []) {
    if (p.type === 'object' && p.fields?.length) {
      const nested: Record<string, unknown> = {}
      for (const f of p.fields) {
        const val = paramValues.value[`${p.name}.${f.name}`]
        if (val !== undefined && val !== '') nested[f.name] = coerceBodyValue(f, val)
      }
      if (Object.keys(nested).length) obj[p.name] = nested
    } else {
      const val = paramValues.value[p.name]
      if (val !== undefined && val !== '') obj[p.name] = coerceBodyValue(p, val)
    }
  }
  return obj
}

// Live JSON preview of the outgoing request
const requestJson = computed(() => {
  const headers: Record<string, string> = {}
  for (const p of props.endpoint.params?.filter((p) => p.in === 'header') ?? []) {
    if (paramValues.value[p.name]) {
      headers[p.name] = p.bearer ? `Bearer ${paramValues.value[p.name]}` : paramValues.value[p.name]!
    }
  }

  const body = buildBodyObject()

  return {
    method: props.endpoint.method,
    url: `${baseUrl.value}${requestPath.value}`,
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(Object.keys(body).length ? { body } : {}),
  }
})

const statusClass = computed(() => {
  if (!response.value) return ''
  const s = response.value.status
  if (s >= 200 && s < 300) return 'status-success'
  if (s >= 400 && s < 500) return 'status-client-error'
  return 'status-server-error'
})
</script>

<template>
  <div class="api-tester">
    <!-- Request -->
    <div class="tester-section">
      <div class="tester-url-bar">
        <DocsMethodBadge :method="endpoint.method" />
        <code class="tester-url">{{ baseUrl }}{{ requestPath }}</code>
      </div>

      <!-- Path params (always visible, no tab) -->
      <!-- removed: path params are now in the Path tab below -->

      <!-- Request tabs: Headers / Path / Query / Body / JSON -->
      <div v-if="endpoint.params?.length" class="tester-request-tabs">
        <button
          v-if="headerParams.length"
          class="tester-request-tab"
          :class="{ active: activeRequestTab === 'headers' }"
          @click="activeRequestTab = 'headers'"
        >
          Headers
          <span class="tester-tab-badge">{{ headerParams.length }}</span>
        </button>
        <button
          v-if="pathParams.length"
          class="tester-request-tab"
          :class="{ active: activeRequestTab === 'path' }"
          @click="activeRequestTab = 'path'"
        >
          Path
          <span class="tester-tab-badge">{{ pathParams.length }}</span>
        </button>
        <button
          v-if="queryParams.length"
          class="tester-request-tab"
          :class="{ active: activeRequestTab === 'query' }"
          @click="activeRequestTab = 'query'"
        >
          Query
          <span class="tester-tab-badge">{{ queryParams.length }}</span>
        </button>
        <button
          class="tester-request-tab"
          :class="{ active: activeRequestTab === 'json' }"
          @click="activeRequestTab = 'json'"
        >
          JSON
        </button>
      </div>

      <!-- Path params -->
      <div v-if="activeRequestTab === 'path' && pathParams.length" class="tester-params">
        <div v-for="param in pathParams" :key="param.name" class="tester-param-row">
          <label class="tester-param-label">
            {{ param.name }}
            <span class="param-required">*</span>
          </label>
          <input
            v-model="paramValues[param.name]"
            class="tester-param-input"
            :placeholder="param.example || param.default || param.type"
          />
        </div>
      </div>

      <!-- Query params -->
      <div v-if="activeRequestTab === 'query' && queryParams.length" class="tester-params">
        <div v-for="param in queryParams" :key="param.name" class="tester-param-row">
          <label class="tester-param-label">
            {{ param.name }}
            <span v-if="param.required" class="param-required">*</span>
          </label>
          <input
            v-model="paramValues[param.name]"
            class="tester-param-input"
            :placeholder="param.example || param.default || param.type"
          />
        </div>
      </div>

      <!-- Headers -->
      <div v-if="activeRequestTab === 'headers' && headerParams.length" class="tester-params">
        <div v-for="param in headerParams" :key="param.name" class="tester-param-row">
          <label class="tester-param-label">
            {{ param.name }}
            <span v-if="param.required" class="param-required">*</span>
          </label>
          <div class="tester-param-input-wrap">
            <span v-if="param.bearer" class="param-bearer-badge">Bearer</span>
            <input
              v-model="paramValues[param.name]"
              class="tester-param-input"
              :class="{ 'has-prefix': param.bearer }"
              :placeholder="param.example || param.default || param.type"
            />
          </div>
        </div>
      </div>

      <!-- JSON — live request preview -->
      <div v-if="activeRequestTab === 'json'" class="tester-json-preview">
        <button class="tester-response-copy" :title="copiedResponse ? 'Copied!' : 'Copy request JSON'" @click="copyResponse(requestJson)">
          <ClipboardDocumentCheckIcon v-if="copiedResponse" class="tester-curl-copy-icon copied" />
          <ClipboardDocumentIcon v-else class="tester-curl-copy-icon" />
        </button>
        <pre class="tester-response-body"><code class="language-json" v-html="highlightJson(requestJson)" /></pre>
      </div>

      <!-- Curl -->
      <div class="tester-curl">
        <code>{{ curlCommand }}</code>
        <button class="tester-curl-copy" :title="copied ? 'Copied!' : 'Copy command'" @click="copyCurl">
          <ClipboardDocumentCheckIcon v-if="copied" class="tester-curl-copy-icon copied" />
          <ClipboardDocumentIcon v-else class="tester-curl-copy-icon" />
        </button>
      </div>

      <!-- Run Query hint + button -->
      <div class="tester-action-area">
        <div class="tester-hint">Click &ldquo;Run Query&rdquo; to view the API response below</div>
        <button class="tester-run-btn" :disabled="loading" @click="sendRequest">
          <span>{{ loading ? 'Running…' : 'Run Query' }}</span>
          <svg v-if="!loading" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="tester-run-icon"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" /></svg>
        </button>
      </div>
    </div>

    <!-- Response — always visible -->
    <div class="tester-section">
      <div class="tester-tabs">
        <button
          class="tester-tab"
          :class="{ active: activeTab === 'sample' }"
          @click="activeTab = 'sample'"
        >
          Sample Response
        </button>
        <button
          class="tester-tab"
          :class="{ active: activeTab === 'query' }"
          @click="activeTab = 'query'"
        >
          Query Response
        </button>

        <span v-if="activeTab === 'query' && response" class="tester-response-meta">
          <span class="tester-status" :class="statusClass">
            {{ response.status }} {{ response.statusText }}
          </span>
          <span class="tester-time">{{ response.time }}ms</span>
        </span>
      </div>

      <!-- Sample Response tab -->
      <div v-if="activeTab === 'sample'" class="tester-response-content">
        <div v-if="endpoint.sampleResponse" class="tester-response-wrapper">
          <button class="tester-response-copy" :title="copiedResponse ? 'Copied!' : 'Copy response'" @click="copyResponse(endpoint.sampleResponse)">
            <ClipboardDocumentCheckIcon v-if="copiedResponse" class="tester-curl-copy-icon copied" />
            <ClipboardDocumentIcon v-else class="tester-curl-copy-icon" />
          </button>
          <pre class="tester-response-body"><code class="language-json" v-html="highlightJson(endpoint.sampleResponse)" /></pre>
        </div>
        <div v-else class="tester-empty">No sample response available.</div>
      </div>

      <!-- Query Response tab -->
      <div v-if="activeTab === 'query'" class="tester-response-content">
        <div v-if="loading" class="tester-loading">
          <div class="tester-spinner" />
          Running query…
        </div>
        <div v-else-if="error" class="tester-error">{{ error }}</div>
        <div v-else-if="response" class="tester-response-wrapper">
          <button class="tester-response-copy" :title="copiedResponse ? 'Copied!' : 'Copy response'" @click="copyResponse(response.body)">
            <ClipboardDocumentCheckIcon v-if="copiedResponse" class="tester-curl-copy-icon copied" />
            <ClipboardDocumentIcon v-else class="tester-curl-copy-icon" />
          </button>
          <pre class="tester-response-body"><code class="language-json" v-html="highlightJson(response.body)" /></pre>
        </div>
        <div v-else class="tester-empty">Click &ldquo;Run Query&rdquo; to execute the request.</div>
      </div>
    </div>
  </div>
</template>
