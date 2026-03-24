<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import AppHeader from '~/components/layout/AppHeader.vue'
import AppSidebar from '~/components/layout/AppSidebar.vue'
import AppFooter from '~/components/layout/AppFooter.vue'
import ToastContainer from '~/components/common/ToastContainer.vue'

const sidebarCollapsed = ref(true)
const mainContentRef = ref<HTMLElement | null>(null)
const isScrolled = ref(false)

const onMainScroll = (e: Event) => {
  const target = e.target as HTMLElement
  isScrolled.value = target.scrollTop > 10
}

onMounted(() => {
  mainContentRef.value?.addEventListener('scroll', onMainScroll, { passive: true })
})

onBeforeUnmount(() => {
  mainContentRef.value?.removeEventListener('scroll', onMainScroll)
})

const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value
}
</script>

<template>
  <div class="app-wrapper">
    <AppHeader @toggle-sidebar="toggleSidebar" />
    <AppSidebar :collapsed="sidebarCollapsed" />
    <main
      ref="mainContentRef"
      class="main-content"
      :class="{
        'sidebar-collapsed': sidebarCollapsed,
        'is-scrolled': isScrolled,
      }"
    >
      <slot />
    </main>
    <AppFooter />
    <ToastContainer />
  </div>
</template>
