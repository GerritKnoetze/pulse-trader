<script setup lang="ts">
import DataManager from '~/components/data/DataManager.vue'

definePageMeta({ layout: 'scanner', ssr: false })
useHead({ title: 'Data Management — Pulse Trader' })
</script>

<template>
  <DataManager />
</template>
