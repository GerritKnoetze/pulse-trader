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
const expandedSubFields = ref<Set<string>>(new Set())

watch(
  () => endpoint.value?.slug,
  () => {
    expandedParams.value = new Set()
    expandedFields.value = new Set()
    expandedSubFields.value = new Set()
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

const toggleSubField = (parentName: string, childName: string) => {
  const key = `${parentName}__${childName}`
  const next = new Set(expandedSubFields.value)
  next.has(key) ? next.delete(key) : next.add(key)
  expandedSubFields.value = next
}

// ── Shared param values (injected by DocsApiTester via provide/inject) ──
const paramValues = ref<Record<string, string>>({})
provide('paramValues', paramValues)

// ── Custom boolean dropdown state ──
const openDropdown = ref<string | null>(null)
const setDropdown = (key: string, val: string) => {
  paramValues.value[key] = val
  openDropdown.value = null
}
const toggleDropdown = (key: string) => {
  openDropdown.value = openDropdown.value === key ? null : key
}
const closeDropdown = () => { openDropdown.value = null }

watch(
  endpoint,
  (ep) => {
    if (!ep) return
    const initial: Record<string, string> = {}
    for (const p of ep.params ?? []) {
      if (p.type === 'boolean') {
        initial[p.name] = ''
      } else if (p.default) {
        initial[p.name] = p.default
      }
    }
    paramValues.value = initial
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="endpoint" class="docs-endpoint-page" @click="closeDropdown">
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
                <!-- Inline input — scalar body params only -->
                <template v-if="param.in === 'body' && param.type !== 'object'">
                  <div v-if="param.type === 'boolean'" class="docs-param-dropdown" @keydown.esc="closeDropdown">
                    <button
                      class="docs-param-input docs-param-dropdown-btn"
                      :class="{ 'select-placeholder': !paramValues[param.name] }"
                      @click.stop="toggleDropdown(param.name)"
                    >
                      <span>{{ paramValues[param.name] || '— select —' }}</span>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="docs-param-dropdown-chevron"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    <ul v-if="openDropdown === param.name" class="docs-param-dropdown-menu" @click.stop>
                      <li @click="setDropdown(param.name, 'true')">true</li>
                      <li @click="setDropdown(param.name, 'false')">false</li>
                    </ul>
                  </div>
                  <input
                    v-else-if="param.type === 'number' || param.type === 'integer'"
                    v-model="paramValues[param.name]"
                    type="number"
                    class="docs-param-input"
                    :placeholder="param.example || param.default || param.type"
                    step="any"
                  />
                  <input
                    v-else
                    v-model="paramValues[param.name]"
                    class="docs-param-input"
                    :placeholder="param.example || param.default || param.type"
                  />
                </template>
              </div>
              <div class="docs-attr-desc">{{ param.description }}</div>
              <!-- Nested child params with inline inputs -->
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
                    <!-- Inline input for child body params -->
                    <template v-if="param.in === 'body'">
                      <div v-if="child.type === 'boolean'" class="docs-param-dropdown" @keydown.esc="closeDropdown">
                        <button
                          class="docs-param-input docs-param-dropdown-btn"
                          :class="{ 'select-placeholder': !paramValues[`${param.name}.${child.name}`] }"
                          @click.stop="toggleDropdown(`${param.name}.${child.name}`)"
                        >
                          <span>{{ paramValues[`${param.name}.${child.name}`] || '— select —' }}</span>
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="docs-param-dropdown-chevron"><path d="m6 9 6 6 6-6"/></svg>
                        </button>
                        <ul v-if="openDropdown === `${param.name}.${child.name}`" class="docs-param-dropdown-menu" @click.stop>
                          <li @click="setDropdown(`${param.name}.${child.name}`, 'true')">true</li>
                          <li @click="setDropdown(`${param.name}.${child.name}`, 'false')">false</li>
                        </ul>
                      </div>
                      <input
                        v-else-if="child.type === 'number' || child.type === 'integer'"
                        v-model="paramValues[`${param.name}.${child.name}`]"
                        type="number"
                        class="docs-param-input"
                        :placeholder="child.example || child.type"
                        step="any"
                      />
                      <input
                        v-else
                        v-model="paramValues[`${param.name}.${child.name}`]"
                        class="docs-param-input"
                        :placeholder="child.example || child.type"
                      />
                    </template>
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
                      <button
                        v-if="child.fields?.length"
                        class="docs-attr-expand-btn"
                        :class="{ expanded: expandedSubFields.has(`${field.name}__${child.name}`) }"
                        :aria-expanded="expandedSubFields.has(`${field.name}__${child.name}`)"
                        @click="toggleSubField(field.name, child.name)"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                      </button>
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
                  <!-- Grandchild fields -->
                  <div v-if="child.fields?.length && expandedSubFields.has(`${field.name}__${child.name}`)" class="docs-attr-children">
                    <div v-for="grandchild in child.fields" :key="grandchild.name" class="docs-attr-child-row">
                      <div class="docs-attr-header">
                        <div class="docs-attr-name-group">
                          <span class="docs-attr-name">{{ grandchild.name }}</span>
                          <div class="docs-attr-badges">
                            <span class="docs-badge docs-badge-type">{{ grandchild.type }}</span>
                            <span class="docs-badge" :class="grandchild.required ? 'docs-badge-required' : 'docs-badge-optional'">
                              {{ grandchild.required ? 'required' : 'optional' }}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div class="docs-attr-desc">{{ grandchild.description }}</div>
                    </div>
                  </div>
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
