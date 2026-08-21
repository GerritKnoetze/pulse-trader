<script setup lang="ts">
import { reactive, onMounted } from 'vue';
import { useSettings } from '~/composables/useSettings';
import { useToast } from '~/composables/useToast';

const { getSettings } = useSettings();
const toast = useToast();

const form = reactive({
  intradayWindowDays: 60,
  dailyLookbackDays: 600,
  tenSecondLookbackMinutes: 70,
  tenSecondPruneHours: 2,
});

async function load() {
  try {
    const data = await getSettings();
    if (data['intraday-window-calendar-days']) form.intradayWindowDays = Number(data['intraday-window-calendar-days']);
    if (data['daily-lookback-calendar-days']) form.dailyLookbackDays = Number(data['daily-lookback-calendar-days']);
    if (data['ten-second-lookback-minutes']) form.tenSecondLookbackMinutes = Number(data['ten-second-lookback-minutes']);
    if (data['ten-second-prune-hours']) form.tenSecondPruneHours = Number(data['ten-second-prune-hours']);
  } catch {
    toast.error('Failed to load data retention settings');
  }
}

function getFormData(): Record<string, string> {
  return {
    'intraday-window-calendar-days': String(form.intradayWindowDays),
    'daily-lookback-calendar-days': String(form.dailyLookbackDays),
    'ten-second-lookback-minutes': String(form.tenSecondLookbackMinutes),
    'ten-second-prune-hours': String(form.tenSecondPruneHours),
  };
}

defineExpose({ getFormData });

onMounted(load);
</script>

<template>
  <div class="settings-section">
    <!-- Data Retention -->
    <div id="data-retention" class="settings-card">
      <div class="settings-card-header">
        <h3>Data Retention</h3>
      </div>
      <div class="settings-card-body">
        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">Intraday window (days)</span>
            <span class="label-description">How many calendar days of 1-minute / 5-minute history are fetched and retained. Default 60 (≈42 trading days — enough for a 200 EMA on the 60-min chart). Lower it to save disk space and speed up scans; raise it for more intraday history. Daily data always accumulates independently.</span>
          </label>
          <input v-model.number="form.intradayWindowDays" type="number" class="input-field" min="1" step="1" />
        </div>
        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">Daily lookback (days)</span>
            <span class="label-description">How many calendar days of daily history are fetched on first touch and served to charts (default 600 ≈ 400 trading days — enough for weekly/monthly bars, ATR14 and avgVol30). Raise toward 1825 for a 5-year daily repository.</span>
          </label>
          <input v-model.number="form.dailyLookbackDays" type="number" class="input-field" min="30" step="1" />
        </div>
        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">10-second lookback (minutes)</span>
            <span class="label-description">How far back the 10-second history seed fetches on a cold chart open (default 70 minutes ≈ 420 bars — enough to seed a 200 EMA with context).</span>
          </label>
          <input v-model.number="form.tenSecondLookbackMinutes" type="number" class="input-field" min="1" step="1" />
        </div>
        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">10-second retention (hours)</span>
            <span class="label-description">Rolling window for stored 10-second SQLite rows — older rows are pruned (default 2 hours). Lower it to shrink the DB; raise it to keep more 10s history per symbol.</span>
          </label>
          <input v-model.number="form.tenSecondPruneHours" type="number" class="input-field" min="1" step="1" />
        </div>
      </div>
    </div>
  </div>
</template>
