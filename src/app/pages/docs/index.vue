<script setup lang="ts">
import { useDocsRegistry } from '~/composables/useDocsRegistry'
import DocsMethodBadge from '~/components/docs/DocsMethodBadge.vue'

definePageMeta({ layout: 'docs' })
useHead({ title: 'API Documentation — Pulse Trader' })

const { getCategories } = useDocsRegistry()
const categories = getCategories()
</script>

<template>
  <div class="docs-overview">
    <h1>API Documentation</h1>
    <p class="docs-overview-description">
      Welcome to the Pulse Trader REST API documentation. Browse endpoints, explore
      request and response structures, and send live requests directly from this
      interface.
    </p>

    <div class="docs-overview-section">
      <h2>Base URL</h2>
      <code class="docs-base-url">http://localhost:4000</code>
    </div>

    <div class="docs-overview-section">
      <h2>Authentication</h2>
      <p class="docs-overview-text">
        No authentication is currently required. All endpoints are publicly
        accessible during development.
      </p>
    </div>

    <div class="docs-overview-section">
      <h2>Endpoints</h2>
      <div v-for="cat in categories" :key="cat.name" class="docs-endpoint-group">
        <h3>{{ cat.name }}</h3>
        <div class="docs-endpoint-list">
          <NuxtLink
            v-for="ep in cat.endpoints"
            :key="ep.slug"
            :to="`/docs/${ep.slug}`"
            class="docs-endpoint-card"
          >
            <div class="docs-endpoint-card-header">
              <DocsMethodBadge :method="ep.method" />
              <code>{{ ep.path }}</code>
            </div>
            <div class="docs-endpoint-card-body">
              <span class="docs-endpoint-card-title">{{ ep.title }}</span>
              <span class="docs-endpoint-card-desc">{{ ep.description }}</span>
            </div>
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
