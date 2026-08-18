<script setup lang="ts">
import {
  HomeIcon,
  Cog6ToothIcon,
  BookOpenIcon,
  MagnifyingGlassIcon,
  CircleStackIcon,
} from '@heroicons/vue/24/outline'

defineProps<{
  collapsed: boolean
}>()
</script>

<template>
  <aside class="app-sidebar" :class="{ collapsed }">
    <nav class="sidebar-nav">
      <div class="nav-main">
        <NuxtLink to="/" class="nav-item" :title="collapsed ? 'Dashboard' : ''">
          <span class="icon">
            <HomeIcon class="icon-svg" />
          </span>
          <span v-show="!collapsed" class="label">Dashboard</span>
        </NuxtLink>
        <NuxtLink to="/scanner" class="nav-item" :title="collapsed ? 'Scanner' : ''">
          <span class="icon">
            <MagnifyingGlassIcon class="icon-svg" />
          </span>
          <span v-show="!collapsed" class="label">Scanner</span>
        </NuxtLink>
        <NuxtLink to="/data" class="nav-item" :title="collapsed ? 'Data' : ''">
          <span class="icon">
            <CircleStackIcon class="icon-svg" />
          </span>
          <span v-show="!collapsed" class="label">Data</span>
        </NuxtLink>
      </div>

      <div class="nav-bottom">
        <NuxtLink to="/docs" class="nav-item" :title="collapsed ? 'Documentation' : ''">
          <span class="icon">
            <BookOpenIcon class="icon-svg" />
          </span>
          <span v-show="!collapsed" class="label">Documentation</span>
        </NuxtLink>
        <NuxtLink to="/settings" class="nav-item" :title="collapsed ? 'Settings' : ''">
          <span class="icon">
            <Cog6ToothIcon class="icon-svg" />
          </span>
          <span v-show="!collapsed" class="label">Settings</span>
        </NuxtLink>
      </div>
    </nav>
  </aside>
</template>
