<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import {
  MagnifyingGlassIcon,
  XMarkIcon,
  CheckIcon,
  CurrencyDollarIcon,
  ChartBarIcon,
  ArrowsRightLeftIcon,
  SparklesIcon,
} from '@heroicons/vue/24/outline';
import { useSettings } from '~/composables/useSettings';
import { useToast } from '~/composables/useToast';
import SettingsGeneral from '~/components/settings/SettingsGeneral.vue';
import SettingsDataProvider from '~/components/settings/SettingsDataProvider.vue';
import SettingsTradingBroker from '~/components/settings/SettingsTradingBroker.vue';
import SettingsLlmProvider from '~/components/settings/SettingsLlmProvider.vue';

useHead({ title: 'Settings — Pulse Trader' });

const { saveSettings } = useSettings();
const toast = useToast();

// ── Child component refs ───────────────────────────────────
const generalRef = ref<InstanceType<typeof SettingsGeneral> | null>(null);
const dataProviderRef = ref<InstanceType<typeof SettingsDataProvider> | null>(null);
const tradingBrokerRef = ref<InstanceType<typeof SettingsTradingBroker> | null>(null);
const llmProviderRef = ref<InstanceType<typeof SettingsLlmProvider> | null>(null);

// ── Save all ────────────────────────────────────────────────
const saving = ref(false);

async function saveAll() {
  saving.value = true;
  try {
    const payload: Record<string, unknown> = {
      ...generalRef.value?.getFormData(),
      ...dataProviderRef.value?.getFormData(),
      ...tradingBrokerRef.value?.getFormData(),
      ...llmProviderRef.value?.getFormData(),
    };
    await saveSettings(payload);
    toast.success('All settings saved');
  } catch {
    toast.error('Failed to save settings');
  } finally {
    saving.value = false;
  }
}

// ── Navigation sections ────────────────────────────────────
const sections = [
  { id: 'trading', label: 'Trading', icon: CurrencyDollarIcon },
  { id: 'data-provider', label: 'Data Provider', icon: ChartBarIcon },
  { id: 'trading-broker', label: 'Trading Broker', icon: ArrowsRightLeftIcon },
  { id: 'llm-provider', label: 'AI / LLM', icon: SparklesIcon },
];

// ── Search ──────────────────────────────────────────────────
const searchQuery = ref('');

/** Searchable keywords per section (nav labels + field labels + subsections) */
const sectionKeywords: Record<string, string[]> = {
  trading: ['trading', 'trading preferences', 'local currency', 'position size', 'risk per trade', 'confirm trade', 'debug', 'debug mode', 'technical logs', 'console'],
  'data-provider': ['data provider', 'massive', 'api key', 'api base url', 'websocket', 'market data', 'price feeds', 'quotes'],
  'trading-broker': ['trading broker', 'account broker', 'tradezero', 'live account', 'paper account', 'api key', 'api secret', 'orders', 'portfolio'],
  'llm-provider': ['ai', 'llm', 'language model', 'github copilot', 'personal access token', 'pat', 'gpt'],
};

const filteredSections = computed(() => {
  if (!searchQuery.value.trim()) return sections;
  const q = searchQuery.value.toLowerCase();
  return sections.filter(
    s => s.label.toLowerCase().includes(q)
      || s.id.toLowerCase().includes(q)
      || sectionKeywords[s.id]?.some(kw => kw.includes(q)),
  );
});

const visibleSectionIds = computed(() => new Set(filteredSections.value.map(s => s.id)));

function clearSearch() {
  searchQuery.value = '';
}

// ── Active section tracking via IntersectionObserver ────────
const activeSection = ref('trading');
let observer: IntersectionObserver | null = null;

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  const scrollParent = document.querySelector('.main-content');
  if (el && scrollParent) {
    const parentRect = scrollParent.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const offset = elRect.top - parentRect.top + scrollParent.scrollTop - 24;
    scrollParent.scrollTo({ top: offset, behavior: 'smooth' });
  }
  activeSection.value = id;
}

function setupObserver() {
  const root = document.querySelector('.main-content');
  if (!root) return;

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          activeSection.value = entry.target.id;
        }
      }
    },
    {
      root: root,
      rootMargin: '-10% 0px -70% 0px',
      threshold: 0,
    },
  );

  for (const section of sections) {
    const el = document.getElementById(section.id);
    if (el) observer.observe(el);
  }
}

onMounted(() => {
  nextTick(setupObserver);
});

onBeforeUnmount(() => {
  observer?.disconnect();
});
</script>

<template>
  <div class="settings-page">
    <!-- Two-column layout: sticky nav + flowing content -->
    <div class="settings-layout">
      <!-- Left Navigation (sticky within scroll) -->
      <nav class="settings-nav">
        <div class="settings-search-box">
          <MagnifyingGlassIcon class="settings-search-icon" />
          <input
            v-model="searchQuery"
            type="text"
            class="settings-search-input"
            placeholder="Search settings..."
          />
          <button v-if="searchQuery" class="settings-search-clear" @click="clearSearch">
            <XMarkIcon class="settings-search-clear-icon" />
          </button>
        </div>
        <ul class="settings-nav-list">
          <li
            v-for="section in filteredSections"
            :key="section.id"
            :class="['settings-nav-item', { active: activeSection === section.id }]"
            @click="scrollToSection(section.id)"
          >
            <component :is="section.icon" class="settings-nav-icon" />
            <span>{{ section.label }}</span>
          </li>
        </ul>
        <button class="btn btn-primary settings-save-btn" :disabled="saving" @click="saveAll">
          <CheckIcon class="btn-icon" />
          {{ saving ? 'Saving...' : 'Save Changes' }}
        </button>
      </nav>

      <!-- Right Content (flows naturally, parent scrolls) -->
      <div class="settings-content">
        <SettingsGeneral v-show="visibleSectionIds.has('trading')" ref="generalRef" />
        <SettingsDataProvider v-show="visibleSectionIds.has('data-provider')" ref="dataProviderRef" />
        <SettingsTradingBroker v-show="visibleSectionIds.has('trading-broker')" ref="tradingBrokerRef" />
        <SettingsLlmProvider v-show="visibleSectionIds.has('llm-provider')" ref="llmProviderRef" />
        <div v-if="searchQuery && filteredSections.length === 0" class="settings-no-results">
          <p>No settings match "{{ searchQuery }}"</p>
        </div>
      </div>
    </div>
  </div>
</template>
