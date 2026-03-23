<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronDownIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { useDocsRegistry } from '~/composables/useDocsRegistry'
import DocsMethodBadge from './DocsMethodBadge.vue'

const searchQuery = ref('')

const route = useRoute()
const router = useRouter()
const { getCategories, getEndpoint } = useDocsRegistry()
const categories = getCategories()

// All categories collapsed by default
const collapsedCategories = ref<Set<string>>(new Set(categories.map((c) => c.name)))

// Auto-expand the category of the currently active endpoint
watch(
  () => route.params.slug,
  (slug) => {
    const s = Array.isArray(slug) ? slug.join('/') : slug
    if (!s) return
    const ep = getEndpoint(s)
    if (ep && collapsedCategories.value.has(ep.category)) {
      collapsedCategories.value.delete(ep.category)
      collapsedCategories.value = new Set(collapsedCategories.value)
    }
  },
  { immediate: true }
)

function toggleCategory(name: string) {
  if (collapsedCategories.value.has(name)) {
    collapsedCategories.value.delete(name)
  } else {
    collapsedCategories.value.add(name)
  }
  collapsedCategories.value = new Set(collapsedCategories.value)
}

function isCollapsed(name: string) {
  return collapsedCategories.value.has(name)
}

// Filtered categories based on search query
const isSearching = computed(() => searchQuery.value.trim().length > 0)

const filteredCategories = computed(() => {
  if (!isSearching.value) return categories
  const q = searchQuery.value.trim().toLowerCase()
  return categories
    .map((cat) => ({
      ...cat,
      endpoints: cat.endpoints.filter(
        (ep) =>
          ep.title.toLowerCase().includes(q) ||
          ep.path.toLowerCase().includes(q) ||
          ep.category.toLowerCase().includes(q),
      ),
    }))
    .filter((cat) => cat.endpoints.length > 0)
})

// Navigate to overview when search yields no results
watch(filteredCategories, (cats) => {
  if (isSearching.value && cats.length === 0) {
    router.push('/docs')
  }
})
</script>

<template>
  <aside class="docs-sidebar">
    <div class="docs-sidebar-search">
      <MagnifyingGlassIcon class="docs-search-icon" />
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search endpoints…"
        class="docs-search-input"
      />
      <button v-if="isSearching" class="docs-search-clear" @click="searchQuery = ''">
        <XMarkIcon class="docs-search-clear-icon" />
      </button>
    </div>
    <nav>
      <NuxtLink to="/docs" class="docs-sidebar-item docs-sidebar-overview" active-class="" exact-active-class="active">
        Overview
      </NuxtLink>

      <div v-if="isSearching && filteredCategories.length === 0" class="docs-sidebar-no-results">
        No results for &ldquo;{{ searchQuery }}&rdquo;
      </div>

      <div v-for="cat in filteredCategories" :key="cat.name" class="docs-sidebar-category">
        <button class="docs-sidebar-category-title" @click="toggleCategory(cat.name)">
          {{ cat.name }}
          <ChevronDownIcon
            class="docs-sidebar-chevron"
            :class="{ collapsed: !isSearching && isCollapsed(cat.name) }"
          />
        </button>
        <template v-if="isSearching || !isCollapsed(cat.name)">
          <NuxtLink
            v-for="ep in cat.endpoints"
            :key="ep.slug"
            :to="`/docs/${ep.slug}`"
            class="docs-sidebar-item"
            active-class=""
            exact-active-class="active"
          >
            <DocsMethodBadge :method="ep.method" size="sm" />
            <span>{{ ep.title }}</span>
          </NuxtLink>
        </template>
      </div>
    </nav>
  </aside>
</template>
