<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import {
  CheckCircleIcon,
  ChartBarIcon,
} from '@heroicons/vue/24/outline';
import { useSettings } from '~/composables/useSettings';
import { useToast } from '~/composables/useToast';
import SettingsConnectionTestModal from '~/components/settings/SettingsConnectionTestModal.vue';

const { getSettings } = useSettings();
const toast = useToast();

const testModalOpen = ref(false);

const dataBrokers = [
  {
    id: 'massive',
    name: 'Massive',
    description: 'Market data provider with delayed/real-time feeds',
    icon: ChartBarIcon,
    available: true,
  },
];

const activeDataBroker = ref('massive');

const massiveSettings = reactive({
  apiKey: '',
  apiUrl: 'https://api.massive.com',
  wsUrl: 'wss://socket.massive.com',
});
const originalMaskedKey = ref('');

function selectDataBroker(id: string) {
  activeDataBroker.value = id;
}

async function load() {
  try {
    const data = await getSettings();
    if (data['active-data-broker']) activeDataBroker.value = data['active-data-broker'] as string;
    const details = data['data-broker-details'] as Record<string, string> | null;
    if (details) {
      massiveSettings.apiKey = details.apiKey || '';
      massiveSettings.apiUrl = details.apiUrl || 'https://api.massive.com';
      massiveSettings.wsUrl = details.wsUrl || 'wss://socket.massive.com';
      originalMaskedKey.value = details.apiKey || '';
    }
  } catch {
    toast.error('Failed to load data provider settings');
  }
}

function getFormData(): Record<string, unknown> {
  return {
    'active-data-broker': activeDataBroker.value,
    'data-broker-details': {
      apiKey: massiveSettings.apiKey,
      apiUrl: massiveSettings.apiUrl,
      wsUrl: massiveSettings.wsUrl,
    },
  };
}

defineExpose({ getFormData });

async function testConnection() {
  testModalOpen.value = true;
}

onMounted(load);
</script>

<template>
  <div class="settings-section">
    <!-- Data Provider Selection -->
    <div id="data-provider" class="settings-card">
      <div class="settings-card-header">
        <h3>Data Provider</h3>
        <span class="settings-card-description">Broker used for market data, real-time quotes, and price feeds</span>
      </div>
      <div class="settings-card-body">
        <div class="broker-selector">
          <div
            v-for="broker in dataBrokers"
            :key="broker.id"
            :class="['broker-card', { active: activeDataBroker === broker.id, disabled: !broker.available }]"
            @click="broker.available && selectDataBroker(broker.id)"
          >
            <div class="broker-icon">
              <component :is="broker.icon" />
            </div>
            <div class="broker-info">
              <h4>{{ broker.name }}</h4>
              <p>{{ broker.description }}</p>
              <span v-if="!broker.available" class="coming-soon-badge">Coming Soon</span>
            </div>
            <div v-if="activeDataBroker === broker.id" class="active-indicator">
              <CheckCircleIcon class="check-icon" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Massive Configuration -->
    <div v-if="activeDataBroker === 'massive'" id="massive-config" class="settings-card">
      <div class="settings-card-header">
        <h3>Massive Configuration</h3>
      </div>
      <div class="settings-card-body">
        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">API Key</span>
            <span class="label-description">Your Massive API key (stored securely encrypted)</span>
          </label>
          <input
            v-model="massiveSettings.apiKey"
            type="text"
            class="input-field"
            
            placeholder="Enter your Massive API key"
            autocomplete="off"
          />
        </div>

        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">API Base URL</span>
            <span class="label-description">Base URL for Massive API</span>
          </label>
          <input
            v-model="massiveSettings.apiUrl"
            type="text"
            class="input-field"
            
            placeholder="https://api.massive.com"
          />
        </div>

        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">WebSocket URL</span>
            <span class="label-description">WebSocket endpoint (delayed: wss://delayed.massive.com, real-time: wss://socket.massive.com)</span>
          </label>
          <input
            v-model="massiveSettings.wsUrl"
            type="text"
            class="input-field"
            
            placeholder="wss://socket.massive.com"
          />
        </div>

        <div class="info-banner">
          <p><strong>Note:</strong> Free/Starter plans use delayed data (15-min delay) with wss://delayed.massive.com. Real-time WebSocket (wss://socket.massive.com) requires Advanced/Business plan.</p>
          <p>Get your API key at <a href="https://massive.com/pricing" target="_blank" rel="noopener">massive.com/pricing</a></p>
        </div>

        <div class="test-connection">
          <button
            class="btn btn-primary"
            @click="testConnection"
          >
            Test Connection
          </button>
        </div>
      </div>
    </div>

  </div>

  <SettingsConnectionTestModal :open="testModalOpen" @close="testModalOpen = false" />
</template>
