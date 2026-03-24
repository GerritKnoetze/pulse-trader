<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import {
  CheckCircleIcon,
  ArrowsRightLeftIcon,
} from '@heroicons/vue/24/outline';
import { useSettings } from '~/composables/useSettings';
import { useToast } from '~/composables/useToast';

const { getSettings } = useSettings();
const toast = useToast();

const tradingBrokers = [
  {
    id: 'tradezero',
    name: 'TradeZero',
    description: 'Commission-free trading with direct market access',
    icon: ArrowsRightLeftIcon,
    available: true,
  },
];

const activeTradingBroker = ref('tradezero');

const tradezeroSettings = reactive({
  apiUrl: 'https://webapi.tradezero.com/',
  liveAccount: '',
  liveApiKeyId: '',
  liveApiKeySecret: '',
  paperAccount: '',
  paperApiKeyId: '',
  paperApiKeySecret: '',
});
const originalMaskedLiveSecret = ref('');
const originalMaskedPaperSecret = ref('');

function selectTradingBroker(id: string) {
  activeTradingBroker.value = id;
}

async function load() {
  try {
    const data = await getSettings();
    if (data['active-trading-broker']) activeTradingBroker.value = data['active-trading-broker'] as string;
    const details = data['trading-broker-details'] as Record<string, string> | null;
    if (details) {
      tradezeroSettings.apiUrl = details.apiUrl || 'https://webapi.tradezero.com/';
      tradezeroSettings.liveAccount = details.liveAccount || '';
      tradezeroSettings.liveApiKeyId = details.liveApiKeyId || '';
      tradezeroSettings.liveApiKeySecret = details.liveApiKeySecret || '';
      tradezeroSettings.paperAccount = details.paperAccount || '';
      tradezeroSettings.paperApiKeyId = details.paperApiKeyId || '';
      tradezeroSettings.paperApiKeySecret = details.paperApiKeySecret || '';
      originalMaskedLiveSecret.value = details.liveApiKeySecret || '';
      originalMaskedPaperSecret.value = details.paperApiKeySecret || '';
    }
  } catch {
    toast.error('Failed to load trading broker settings');
  }
}

function getFormData(): Record<string, unknown> {
  return {
    'active-trading-broker': activeTradingBroker.value,
    'trading-broker-details': {
      apiUrl: tradezeroSettings.apiUrl,
      liveAccount: tradezeroSettings.liveAccount,
      liveApiKeyId: tradezeroSettings.liveApiKeyId,
      liveApiKeySecret: tradezeroSettings.liveApiKeySecret,
      paperAccount: tradezeroSettings.paperAccount,
      paperApiKeyId: tradezeroSettings.paperApiKeyId,
      paperApiKeySecret: tradezeroSettings.paperApiKeySecret,
    },
  };
}

defineExpose({ getFormData });

onMounted(load);
</script>

<template>
  <div class="settings-section">
    <!-- Trading Broker Selection -->
    <div id="trading-broker" class="settings-card">
      <div class="settings-card-header">
        <h3>Trading / Account Broker</h3>
        <span class="settings-card-description">Broker used for placing orders, account management, and portfolio tracking</span>
      </div>
      <div class="settings-card-body">
        <div class="broker-selector">
          <div
            v-for="broker in tradingBrokers"
            :key="broker.id"
            :class="['broker-card', { active: activeTradingBroker === broker.id, disabled: !broker.available }]"
            @click="broker.available && selectTradingBroker(broker.id)"
          >
            <div class="broker-icon">
              <component :is="broker.icon" />
            </div>
            <div class="broker-info">
              <h4>{{ broker.name }}</h4>
              <p>{{ broker.description }}</p>
              <span v-if="!broker.available" class="coming-soon-badge">Coming Soon</span>
            </div>
            <div v-if="activeTradingBroker === broker.id" class="active-indicator">
              <CheckCircleIcon class="check-icon" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TradeZero Configuration -->
    <div v-if="activeTradingBroker === 'tradezero'" id="tradezero-config" class="settings-card">
      <div class="settings-card-header">
        <h3>TradeZero Configuration</h3>
      </div>
      <div class="settings-card-body">
        <!-- General -->
        <h4 class="subsection-title">General</h4>
        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">API Base URL</span>
            <span class="label-description">TradeZero Web API base URL</span>
          </label>
          <input
            v-model="tradezeroSettings.apiUrl"
            type="text"
            class="input-field"
            
            placeholder="https://webapi.tradezero.com/"
          />
        </div>

        <!-- Live Account -->
        <h4 class="subsection-title">Live Account</h4>
        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">Account ID</span>
            <span class="label-description">Your TradeZero live trading account ID (e.g. US12345678)</span>
          </label>
          <input
            v-model="tradezeroSettings.liveAccount"
            type="text"
            class="input-field"
            
            placeholder="e.g. US12345678"
            autocomplete="off"
          />
        </div>

        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">API Key ID</span>
            <span class="label-description">API Key ID for your live trading account</span>
          </label>
          <input
            v-model="tradezeroSettings.liveApiKeyId"
            type="text"
            class="input-field"
            
            placeholder="Enter live account API Key ID"
            autocomplete="off"
          />
        </div>

        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">API Key Secret</span>
            <span class="label-description">API Key Secret for your live trading account (stored encrypted)</span>
          </label>
          <input
            v-model="tradezeroSettings.liveApiKeySecret"
            type="text"
            class="input-field"
            
            placeholder="Enter live account API Key Secret"
            autocomplete="off"
          />
        </div>

        <!-- Paper Account -->
        <h4 class="subsection-title">Paper Account</h4>
        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">Account ID</span>
            <span class="label-description">Your TradeZero paper trading account ID (e.g. PA12345678)</span>
          </label>
          <input
            v-model="tradezeroSettings.paperAccount"
            type="text"
            class="input-field"
            
            placeholder="e.g. PA12345678"
            autocomplete="off"
          />
        </div>

        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">API Key ID</span>
            <span class="label-description">API Key ID for your paper trading account</span>
          </label>
          <input
            v-model="tradezeroSettings.paperApiKeyId"
            type="text"
            class="input-field"
            
            placeholder="Enter paper account API Key ID"
            autocomplete="off"
          />
        </div>

        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">API Key Secret</span>
            <span class="label-description">API Key Secret for your paper trading account (stored encrypted)</span>
          </label>
          <input
            v-model="tradezeroSettings.paperApiKeySecret"
            type="text"
            class="input-field"
            
            placeholder="Enter paper account API Key Secret"
            autocomplete="off"
          />
        </div>

        <div class="info-banner">
          <p><strong>Note:</strong> API credentials are encrypted at rest using AES-256-GCM. Secrets are never returned in plaintext after saving.</p>
          <p>Manage your API keys at <a href="https://webapi.tradezero.com/" target="_blank" rel="noopener">webapi.tradezero.com</a></p>
        </div>
      </div>
    </div>

  </div>
</template>
