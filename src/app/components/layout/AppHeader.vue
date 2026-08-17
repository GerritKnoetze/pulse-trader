<script setup lang="ts">
import { ArrowLeftIcon, Bars3Icon, ChevronDownIcon } from '@heroicons/vue/24/outline'
import AppLogo from '~/components/AppLogo.vue'
import MarketStatusBar from '~/components/layout/MarketStatusBar.vue'

defineProps<{
  /** Replace the sidebar burger with a back arrow to the dashboard. */
  backArrow?: boolean
}>()

defineEmits<{
  'toggle-sidebar': []
}>()

const supportOpen = ref(false)
</script>

<template>
  <header class="app-header">
    <NuxtLink
      v-if="backArrow"
      to="/"
      class="sidebar-toggle"
      aria-label="Back to dashboard"
      title="Back to dashboard"
    >
      <ArrowLeftIcon class="toggle-icon" />
    </NuxtLink>
    <button
      v-else
      class="sidebar-toggle"
      aria-label="Toggle navigation sidebar"
      title="Toggle navigation sidebar"
      @click="$emit('toggle-sidebar')"
    >
      <Bars3Icon class="toggle-icon" />
    </button>

    <div class="header-content">
      <div class="app-title-section">
        <AppLogo size="2rem" />
        <div class="app-title-text">
          <h1 class="app-title">Pulse Trader</h1>
          <span v-if="backArrow" class="app-title-docs-label">docs</span>
        </div>
      </div>

      <nav v-if="!backArrow" class="main-nav">
        <NuxtLink to="/" class="nav-button">
          Dashboard
        </NuxtLink>
        <NuxtLink to="/scanner" class="nav-button">
          Scanner
        </NuxtLink>

        <div class="nav-dropdown" :class="{ open: supportOpen }" @mouseenter="supportOpen = true" @mouseleave="supportOpen = false">
          <button class="nav-button nav-dropdown-trigger">
            Support
            <ChevronDownIcon class="nav-chevron" />
          </button>
          <div class="nav-dropdown-menu">
            <a href="#" class="nav-dropdown-item">Contact Us</a>
            <a href="#" class="nav-dropdown-item">About Pulse Trader</a>
          </div>
        </div>
      </nav>

      <div class="header-actions">
        <ClientOnly>
          <MarketStatusBar />
        </ClientOnly>
      </div>
    </div>
  </header>
</template>
