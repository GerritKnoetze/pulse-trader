<template>
    <svg :width="size" :height="size" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="15" fill="#1a1a1a"/>
        <defs>
            <linearGradient id="pulseGradient" x1="4" y1="16" x2="28" y2="16" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#c87628"/>
                <stop offset="100%" stop-color="#e8a84a"/>
            </linearGradient>
        </defs>
        <path d="M4 16 L10 16 L13 8 L19 24 L22 16 L28 16"
              stroke="url(#pulseGradient)"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              fill="none"/>
    </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
    size?: number | string
}>(), {
    size: '2rem',
})
</script>
