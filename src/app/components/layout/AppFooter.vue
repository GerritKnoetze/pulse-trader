<template>
  <footer class="app-footer">
    <div class="footer-content">
      <span class="copyright">&copy; {{ new Date().getFullYear() }} Afrihandel (Pty) Ltd. All rights reserved.</span>
      <span class="version">v{{ version }}</span>
    </div>
  </footer>
</template>

<script setup lang="ts">
const { version } = useVersion()
</script>
