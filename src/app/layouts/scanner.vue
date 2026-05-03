<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import AppHeader from '~/components/layout/AppHeader.vue'
import AppSidebar from '~/components/layout/AppSidebar.vue'
import AppFooter from '~/components/layout/AppFooter.vue'
import ToastContainer from '~/components/common/ToastContainer.vue'

const sidebarCollapsed = ref(true)

const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value
}
</script>

<template>
  <div class="app-wrapper">
    <AppHeader @toggle-sidebar="toggleSidebar" />
    <AppSidebar :collapsed="sidebarCollapsed" />
    <main
      class="main-content scanner-layout"
      :class="{ 'sidebar-collapsed': sidebarCollapsed }"
    >
      <slot />
    </main>
    <AppFooter />
    <ToastContainer />
  </div>
</template>
