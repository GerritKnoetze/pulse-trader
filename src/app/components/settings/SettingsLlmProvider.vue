<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  SparklesIcon,
} from '@heroicons/vue/24/outline';
import { useSettings } from '~/composables/useSettings';
import { useToast } from '~/composables/useToast';
import type { GithubModel } from '~/server/api/settings/llm-models.get';

const { getSettings } = useSettings();
const toast = useToast();

const llmProviders = [
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    description: 'GitHub Models API using a classic Personal Access Token',
    icon: SparklesIcon,
    available: true,
  },
];

const activeLlmProvider = ref('github-copilot');

const llmSettings = reactive({
  apiKey: '',
  model: 'gpt-4o',
  customModel: '',
  apiUrl: 'https://models.inference.ai.azure.com',
});

const testing = ref(false);
const testResult = ref<{ success: boolean; response?: string; latencyMs?: number; error?: string } | null>(null);

// ─── Model Selection (mirrors Pulse) ─────────────────────────

const STATIC_MODELS: { label: string; models: { id: string; label: string }[] }[] = [
  {
    label: 'OpenAI',
    models: [
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-5-mini', label: 'GPT-5 mini' },
      { id: 'gpt-5.1', label: 'GPT-5.1' },
      { id: 'gpt-5.1-codex', label: 'GPT-5.1-Codex' },
      { id: 'gpt-5.1-codex-max', label: 'GPT-5.1-Codex-Max' },
      { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1-Codex-Mini (Preview)' },
      { id: 'gpt-5.2', label: 'GPT-5.2' },
      { id: 'gpt-5.2-codex', label: 'GPT-5.2-Codex' },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3-Codex' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
    ],
  },
  {
    label: 'Anthropic Claude',
    models: [
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { id: 'claude-opus-4-6-fast', label: 'Claude Opus 4.6 (fast mode) (Preview)' },
      { id: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ],
  },
  {
    label: 'Google Gemini',
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-3-flash', label: 'Gemini 3 Flash (Preview)' },
      { id: 'gemini-3-pro', label: 'Gemini 3 Pro (Preview)' },
      { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro (Preview)' },
    ],
  },
  {
    label: 'Other',
    models: [
      { id: 'o4-mini', label: 'o4-mini' },
      { id: 'grok-code-fast-1', label: 'Grok Code Fast 1' },
      { id: 'raptor-mini', label: 'Raptor mini (Preview)' },
    ],
  },
];

const liveModels = ref<GithubModel[]>([]);
const modelsLoading = ref(false);

function formatContext(ctx?: number): string {
  if (!ctx) return '';
  if (ctx >= 1000) return `${Math.round(ctx / 1000)}K`;
  return `${ctx}`;
}

function resolveMultiplier(m: GithubModel): number | null {
  const direct =
    m.rate_limit_multiplier ??
    m.request_multiplier ??
    m.model_limit_multiplier ??
    m.limit_multiplier;
  if (typeof direct === 'number') return direct;

  const tierMap: Record<string, number> = { free: 0, low: 1, medium: 1, high: 3, premium: 10 };
  if (m.rate_limit_tier) {
    const tier = m.rate_limit_tier.toLowerCase();
    if (tier in tierMap) return tierMap[tier];
    const match = tier.match(/^(\d+\.?\d*)x?$/);
    if (match) return parseFloat(match[1]);
  }
  return null;
}

function formatModelLabel(m: GithubModel): string {
  const parts: string[] = [];
  const ctx = formatContext(m.context_length);
  if (ctx) parts.push(`${ctx} ctx`);
  const mult = resolveMultiplier(m);
  if (mult !== null) parts.push(`${mult}x`);
  const name = m.friendly_name || m.name || m.id;
  return parts.length ? `${name}  [${parts.join(' · ')}]` : name;
}

const allModelGroups = computed(() => {
  const result = STATIC_MODELS.map(g => ({ label: g.label, models: [...g.models] }));

  if (liveModels.value.length > 0) {
    const existingIds = new Set(STATIC_MODELS.flatMap(g => g.models.map(m => m.id)));
    const apiGroups = new Map<string, { id: string; label: string }[]>();

    for (const m of liveModels.value) {
      if (m.task !== 'chat-completion') continue;
      const name = m.name || m.id;
      if (existingIds.has(name)) continue;
      const publisher = m.publisher || 'Other';
      if (!apiGroups.has(publisher)) apiGroups.set(publisher, []);
      apiGroups.get(publisher)!.push({ id: name, label: formatModelLabel(m) });
    }

    for (const [label, models] of apiGroups) {
      result.push({ label, models });
    }
  }

  return result;
});

const fetchLiveModels = async () => {
  modelsLoading.value = true;
  try {
    const res = await $fetch<{ success: boolean; data: GithubModel[] }>('/api/settings/llm-models');
    if (res.success && res.data.length > 0) {
      liveModels.value = res.data;
    }
  } catch {
    // silently fall back to static list
  } finally {
    modelsLoading.value = false;
  }
};

// ─── Settings Load / Save / Test ─────────────────────────────

function selectProvider(id: string) {
  activeLlmProvider.value = id;
}

async function load() {
  try {
    const data = await getSettings();
    if (data['llm-provider']) activeLlmProvider.value = data['llm-provider'] as string;
    const details = data['llm-details'] as Record<string, string> | null;
    if (details) {
      llmSettings.apiKey = details.apiKey || '';
      llmSettings.apiUrl = details.apiUrl || 'https://models.inference.ai.azure.com';
      const model = details.model || 'gpt-4o';
      // Check if model exists in static list; if not, treat as custom
      const staticIds = new Set(STATIC_MODELS.flatMap(g => g.models.map(m => m.id)));
      if (staticIds.has(model)) {
        llmSettings.model = model;
      } else {
        llmSettings.model = 'custom';
        llmSettings.customModel = model;
      }
    }
  } catch {
    toast.error('Failed to load LLM settings');
  }
}

async function testConnection() {
  testing.value = true;
  testResult.value = null;
  try {
    const res = await $fetch<{ success: boolean; data: { response: string; latencyMs: number } }>('/api/settings/llm-test', { method: 'POST' });
    testResult.value = { success: true, response: res.data.response, latencyMs: res.data.latencyMs };
    toast.success(`LLM connected (${res.data.latencyMs}ms)`);
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message || (err instanceof Error ? err.message : 'Connection failed');
    testResult.value = { success: false, error: message };
    toast.error('LLM test failed');
  } finally {
    testing.value = false;
  }
}

function getFormData(): Record<string, unknown> {
  const isCustom = llmSettings.model === 'custom';
  const model = isCustom ? llmSettings.customModel : llmSettings.model;
  return {
    'llm-provider': activeLlmProvider.value,
    'llm-details': {
      apiKey: llmSettings.apiKey,
      model,
      apiUrl: llmSettings.apiUrl,
    },
  };
}

defineExpose({ getFormData });

onMounted(async () => {
  await Promise.all([load(), fetchLiveModels()]);
});
</script>

<template>
  <div class="settings-section">
    <!-- LLM Provider Selection -->
    <div id="llm-provider" class="settings-card">
      <div class="settings-card-header">
        <h3>AI / LLM Provider</h3>
        <span class="settings-card-description">Language model used for AI-driven analysis and strategy refinement</span>
      </div>
      <div class="settings-card-body">
        <div class="broker-selector">
          <div
            v-for="provider in llmProviders"
            :key="provider.id"
            :class="['broker-card', { active: activeLlmProvider === provider.id, disabled: !provider.available }]"
            @click="provider.available && selectProvider(provider.id)"
          >
            <div class="broker-icon">
              <component :is="provider.icon" />
            </div>
            <div class="broker-info">
              <h4>{{ provider.name }}</h4>
              <p>{{ provider.description }}</p>
              <span v-if="!provider.available" class="coming-soon-badge">Coming Soon</span>
            </div>
            <div v-if="activeLlmProvider === provider.id" class="active-indicator">
              <CheckCircleIcon class="check-icon" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- GitHub Copilot Configuration -->
    <div v-if="activeLlmProvider === 'github-copilot'" id="github-copilot-config" class="settings-card">
      <div class="settings-card-header">
        <h3>GitHub Copilot Configuration</h3>
      </div>
      <div class="settings-card-body">
        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">Personal Access Token</span>
            <span class="label-description">Classic PAT with <code>copilot</code> scope (stored encrypted)</span>
          </label>
          <input
            v-model="llmSettings.apiKey"
            type="password"
            class="input-field"
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            autocomplete="off"
          />
        </div>

        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">Model</span>
            <span class="label-description">AI model for chat completions — pick from the list or choose Custom</span>
          </label>
          <div class="model-select-wrapper">
            <select v-model="llmSettings.model" class="input-field">
              <optgroup
                v-for="group in allModelGroups"
                :key="group.label"
                :label="group.label"
              >
                <option
                  v-for="m in group.models"
                  :key="m.id"
                  :value="m.id"
                >{{ m.label }}</option>
              </optgroup>
              <optgroup label="">
                <option value="custom">Custom Model...</option>
              </optgroup>
            </select>
            <div v-if="modelsLoading" class="model-loading">Loading models from API…</div>
          </div>
        </div>

        <div v-if="llmSettings.model === 'custom'" class="setting-item">
          <label class="setting-label">
            <span class="label-text">Custom Model Name</span>
            <span class="label-description">Enter the exact model identifier from <a href="https://github.com/marketplace/models" target="_blank" rel="noopener">GitHub Models</a></span>
          </label>
          <input
            v-model="llmSettings.customModel"
            type="text"
            class="input-field"
            placeholder="e.g., claude-3-opus"
            autocomplete="off"
          />
        </div>

        <div class="setting-item">
          <label class="setting-label">
            <span class="label-text">API Base URL</span>
            <span class="label-description">GitHub Models inference endpoint</span>
          </label>
          <input
            v-model="llmSettings.apiUrl"
            type="text"
            class="input-field"
            placeholder="https://models.inference.ai.azure.com"
          />
        </div>

        <div class="info-banner">
          <p><strong>Note:</strong> Your PAT is encrypted at rest using AES-256-GCM. It's never returned in plaintext after saving.</p>
          <p>Create a Classic PAT at <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">github.com/settings/tokens</a> — enable the <strong>copilot</strong> scope.</p>
        </div>

        <div class="test-connection">
          <button
            class="btn btn-primary"
            :disabled="testing"
            @click="testConnection"
          >
            <ArrowPathIcon class="btn-icon" :class="{ spinning: testing }" />
            {{ testing ? 'Testing...' : 'Test Connection' }}
          </button>
          <span v-if="testResult && testResult.success" class="connection-ok">✓ Connected ({{ testResult.latencyMs }}ms)</span>
          <span v-if="testResult && !testResult.success" class="connection-fail">✗ {{ testResult.error }}</span>
        </div>
      </div>
    </div>

  </div>
</template>


