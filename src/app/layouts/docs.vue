<script setup lang="ts">
import AppHeader from '~/components/layout/AppHeader.vue'
import DocsSidebar from '~/components/docs/DocsSidebar.vue'
</script>

<template>
  <div class="docs-wrapper">
    <AppHeader back-arrow />

    <div class="docs-body">
      <DocsSidebar />
      <main class="docs-main">
        <slot />
      </main>
    </div>
  </div>
</template>
