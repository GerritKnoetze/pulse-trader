<script setup lang="ts">
import { useDocsRegistry } from '~/composables/useDocsRegistry'
import DocsMethodBadge from '~/components/docs/DocsMethodBadge.vue'
import DocsApiTester from '~/components/docs/DocsApiTester.vue'

definePageMeta({ layout: 'docs' })

const route = useRoute()
const { getEndpoint } = useDocsRegistry()

const slug = computed(() => {
  const s = route.params.slug
  return Array.isArray(s) ? s.join('/') : s
})

const endpoint = computed(() => getEndpoint(slug.value ?? ''))

watchEffect(() => {
  if (endpoint.value) {
    useHead({ title: `${endpoint.value.title} — API Docs — Pulse Trader` })
  }
})

// ── Expand / collapse for nested params & response fields ──
const expandedParams = ref<Set<string>>(new Set())
const expandedFields = ref<Set<string>>(new Set())

watch(
  () => endpoint.value?.slug,
  () => {
    expandedParams.value = new Set()
    expandedFields.value = new Set()
  },
)

const toggleParam = (name: string) => {
  const next = new Set(expandedParams.value)
  next.has(name) ? next.delete(name) : next.add(name)
  expandedParams.value = next
}

const toggleField = (name: string) => {
  const next = new Set(expandedFields.value)
  next.has(name) ? next.delete(name) : next.add(name)
  expandedFields.value = next
}
</script>

<template>
  <div v-if="endpoint" class="docs-endpoint-page">
    <div class="docs-endpoint-layout">
      <!-- Left: Documentation -->
      <div class="docs-endpoint-info">
        <h1>{{ endpoint.title }}</h1>

        <div class="docs-endpoint-meta">
          <DocsMethodBadge :method="endpoint.method" />
          <pre class="docs-endpoint-path">{{ endpoint.path }}</pre>
        </div>

        <div class="docs-endpoint-description">
          <p>{{ endpoint.description }}</p>
        </div>

        <!-- Parameters -->
        <section class="docs-section">
          <div class="docs-section-title">Parameters</div>
          <div v-if="endpoint.params?.length" class="docs-attr-list">
            <div v-for="param in endpoint.params" :key="param.name" class="docs-attr-row">
              <div class="docs-attr-header">
                <div class="docs-attr-name-group">
                  <button
                    v-if="param.fields?.length"
                    class="docs-attr-expand-btn"
                    :class="{ expanded: expandedParams.has(param.name) }"
                    :aria-expanded="expandedParams.has(param.name)"
                    @click="toggleParam(param.name)"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                  </button>
                  <span class="docs-attr-name">{{ param.name }}</span>
                  <div class="docs-attr-badges">
                    <span class="docs-badge docs-badge-type">{{ param.type }}</span>
                    <span class="docs-badge" :class="param.required ? 'docs-badge-required' : 'docs-badge-optional'">
                      {{ param.required ? 'required' : 'optional' }}
                    </span>
                    <span class="docs-badge docs-badge-in">{{ param.in }}</span>
                  </div>
                </div>
              </div>
              <div class="docs-attr-desc">{{ param.description }}</div>
              <!-- Nested child params -->
              <div v-if="param.fields?.length && expandedParams.has(param.name)" class="docs-attr-children">
                <div v-for="child in param.fields" :key="child.name" class="docs-attr-child-row">
                  <div class="docs-attr-header">
                    <div class="docs-attr-name-group">
                      <span class="docs-attr-name">{{ child.name }}</span>
                      <div class="docs-attr-badges">
                        <span class="docs-badge docs-badge-type">{{ child.type }}</span>
                        <span class="docs-badge" :class="child.required ? 'docs-badge-required' : 'docs-badge-optional'">
                          {{ child.required ? 'required' : 'optional' }}
                        </span>
                        <span class="docs-badge docs-badge-in">{{ child.in }}</span>
                      </div>
                    </div>
                  </div>
                  <div class="docs-attr-desc">{{ child.description }}</div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="docs-muted">This endpoint does not require any parameters.</div>
        </section>

        <!-- Response Attributes -->
        <section v-if="endpoint.responseFields?.length" class="docs-section">
          <div class="docs-section-title">Response Attributes</div>
          <div class="docs-attr-list">
            <div v-for="field in endpoint.responseFields" :key="field.name" class="docs-attr-row">
              <div class="docs-attr-header">
                <div class="docs-attr-name-group">
                  <button
                    v-if="field.fields?.length"
                    class="docs-attr-expand-btn"
                    :class="{ expanded: expandedFields.has(field.name) }"
                    :aria-expanded="expandedFields.has(field.name)"
                    @click="toggleField(field.name)"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                  </button>
                  <span class="docs-attr-name">{{ field.name }}</span>
                  <div class="docs-attr-badges">
                    <span class="docs-badge docs-badge-type">{{ field.type }}</span>
                    <span class="docs-badge" :class="field.required ? 'docs-badge-required' : 'docs-badge-optional'">
                      {{ field.required ? 'required' : 'optional' }}
                    </span>
                  </div>
                </div>
              </div>
              <div class="docs-attr-desc">{{ field.description }}</div>
              <!-- Nested child fields -->
              <div v-if="field.fields?.length && expandedFields.has(field.name)" class="docs-attr-children">
                <div v-for="child in field.fields" :key="child.name" class="docs-attr-child-row">
                  <div class="docs-attr-header">
                    <div class="docs-attr-name-group">
                      <span class="docs-attr-name">{{ child.name }}</span>
                      <div class="docs-attr-badges">
                        <span class="docs-badge docs-badge-type">{{ child.type }}</span>
                        <span class="docs-badge" :class="child.required ? 'docs-badge-required' : 'docs-badge-optional'">
                          {{ child.required ? 'required' : 'optional' }}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div class="docs-attr-desc">{{ child.description }}</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- Right: API Tester -->
      <div class="docs-endpoint-tester">
        <DocsApiTester :endpoint="endpoint" />
      </div>
    </div>
  </div>

  <div v-else class="docs-not-found">
    <h1>Endpoint Not Found</h1>
    <p>The requested endpoint documentation could not be found.</p>
    <NuxtLink to="/docs">← Back to Overview</NuxtLink>
  </div>
</template>
