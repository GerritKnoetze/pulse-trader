<script setup lang="ts">
import DocsSidebar from '~/components/docs/DocsSidebar.vue'
import AppLogo from '~/components/AppLogo.vue'
</script>

<template>
  <div class="docs-wrapper">
    <header class="docs-header">
      <div class="docs-header-left">
        <NuxtLink to="/docs" class="docs-header-brand">
          <AppLogo size="1.5rem" />
          <span class="docs-header-title">Pulse Trader</span>
          <span class="docs-header-docs-label">docs</span>
        </NuxtLink>
      </div>

      <div class="docs-header-right">
        <NuxtLink to="/docs/changelog" class="docs-header-link">Changelog</NuxtLink>
        <NuxtLink to="/" class="docs-header-link">Dashboard</NuxtLink>
      </div>
    </header>

    <div class="docs-body">
      <DocsSidebar />
      <main class="docs-main">
        <slot />
      </main>
    </div>
  </div>
</template>
