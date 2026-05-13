<script setup lang="ts">
import { reactive, onMounted } from 'vue';
import { useSettings } from '~/composables/useSettings';
import { useToast } from '~/composables/useToast';

const { getSettings } = useSettings();
const toast = useToast();

const form = reactive({
  localCurrency: 'USD',
  defaultPositionSize: 100,
  riskPerTrade: 2,
  confirmTrades: true,
  debugMode: false,
});

async function load() {
  try {
    const data = await getSettings();
    if (data['local-currency']) form.localCurrency = data['local-currency'];
    if (data['default-position-size']) form.defaultPositionSize = Number(data['default-position-size']);
    if (data['risk-per-trade']) form.riskPerTrade = Number(data['risk-per-trade']);
    form.confirmTrades = data['confirm-trades'] === 'true';
    form.debugMode = data['debug-mode'] === 'true';
  } catch {
    toast.error('Failed to load trading settings');
  }
}

function getFormData(): Record<string, string> {
  return {
    'local-currency': form.localCurrency,
    'default-position-size': String(form.defaultPositionSize),
    'risk-per-trade': String(form.riskPerTrade),
    'confirm-trades': String(form.confirmTrades),
    'debug-mode': String(form.debugMode),
  };
}

defineExpose({ getFormData });

onMounted(load);
</script>

<template>
  <div class="settings-section">
    <!-- Trading Preferences -->
    <div id="trading" class="settings-card">
      <div class="settings-card-header">
        <h3>Trading Preferences</h3>
      </div>
      <div class="settings-card-body">
        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">Local Currency</span>
            <span class="label-description">Your local currency for portfolio conversion</span>
          </label>
          <select v-model="form.localCurrency" class="select-field">
            <option value="USD">USD - US Dollar ($)</option>
            <option value="EUR">EUR - Euro (€)</option>
            <option value="GBP">GBP - British Pound (£)</option>
            <option value="ZAR">ZAR - South African Rand (R)</option>
            <option value="JPY">JPY - Japanese Yen (¥)</option>
            <option value="CAD">CAD - Canadian Dollar (C$)</option>
            <option value="AUD">AUD - Australian Dollar (A$)</option>
            <option value="CHF">CHF - Swiss Franc (Fr)</option>
          </select>
        </div>

        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">Default Position Size</span>
            <span class="label-description">Default number of shares for new trades</span>
          </label>
          <input v-model.number="form.defaultPositionSize" type="number" class="input-field" min="1" step="1" />
        </div>

        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">Risk Per Trade (%)</span>
            <span class="label-description">Maximum risk percentage per trade</span>
          </label>
          <input v-model.number="form.riskPerTrade" type="number" class="input-field" min="0.1" max="10" step="0.1" />
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">Confirm trade actions</span>
            <span class="label-description">Show confirmation dialog before executing trades</span>
          </div>
          <label class="setting-checkbox">
            <input v-model="form.confirmTrades" type="checkbox" class="checkbox-input" />
            <span class="checkbox-custom" />
          </label>
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">Debug mode</span>
            <span class="label-description">Show detailed technical logs below each scanner log entry</span>
          </div>
          <label class="setting-checkbox">
            <input v-model="form.debugMode" type="checkbox" class="checkbox-input" />
            <span class="checkbox-custom" />
          </label>
        </div>
      </div>
    </div>

  </div>
</template>
