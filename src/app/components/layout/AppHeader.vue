<script setup lang="ts">
import { Bars3Icon, ChevronDownIcon } from '@heroicons/vue/24/outline'
import AppLogo from '~/components/AppLogo.vue'

defineEmits<{
  'toggle-sidebar': []
}>()

const supportOpen = ref(false)
</script>

<template>
  <header class="app-header">
    <button
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
        <h1 class="app-title">Pulse Trader</h1>
      </div>

      <nav class="main-nav">
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
        <!-- Future: connection status, user info, etc. -->
      </div>
    </div>
  </header>
</template>
