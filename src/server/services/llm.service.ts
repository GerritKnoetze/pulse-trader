import { SettingsRepository } from '../database/repositories/settings-repository';
import { decryptJsonFields } from '../utils/encryption';

// ─── Types ───────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionChoice {
  index: number;
  message: { role: string; content: string };
  finish_reason: string;
}

interface ChatCompletionResponse {
  id: string;
  choices: ChatCompletionChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface LlmSettings {
  apiKey: string;
  model: string;
  apiUrl: string;
}

// ─── Settings Loader ─────────────────────────────────────────

function loadLlmSettings(): LlmSettings {
  const repo = new SettingsRepository();

  const detailsRaw = repo.getValue('llm-details');
  if (!detailsRaw) throw new Error('LLM settings not configured. Go to Settings → AI / LLM to add your API key.');

  let details: Record<string, unknown>;
  try {
    details = JSON.parse(detailsRaw);
  } catch {
    throw new Error('LLM settings are corrupted. Please reconfigure in Settings → AI / LLM.');
  }

  // Decrypt sensitive fields
  const decrypted = decryptJsonFields('llm-details', details);

  const apiKey = decrypted.apiKey as string;
  if (!apiKey || apiKey.includes('••••')) {
    throw new Error('LLM API key not set. Go to Settings → AI / LLM to add your GitHub PAT.');
  }

  return {
    apiKey,
    model: (decrypted.model as string) || 'gpt-4o',
    apiUrl: (decrypted.apiUrl as string) || 'https://models.inference.ai.azure.com',
  };
}

// ─── Rate Limiter ────────────────────────────────────────────

const RATE_LIMIT_TOKENS = 40_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_BUFFER = 0.85; // use at most 85% of budget before waiting
const MAX_RETRIES = 3;

const tokenUsageLog: { timestamp: number; tokens: number }[] = [];

function getTokensUsedInWindow(): number {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  // Prune old entries
  while (tokenUsageLog.length > 0 && tokenUsageLog[0]!.timestamp < cutoff) {
    tokenUsageLog.shift();
  }
  return tokenUsageLog.reduce((sum, entry) => sum + entry.tokens, 0);
}

function recordTokenUsage(tokens: number): void {
  tokenUsageLog.push({ timestamp: Date.now(), tokens });
}

async function waitForTokenBudget(estimatedTokens: number): Promise<void> {
  const budget = RATE_LIMIT_TOKENS * RATE_LIMIT_BUFFER;

  while (true) {
    const used = getTokensUsedInWindow();
    if (used + estimatedTokens <= budget) return;

    // Find when enough tokens will expire from the window
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    const oldestRelevant = tokenUsageLog.find(e => e.timestamp >= cutoff);
    const waitMs = oldestRelevant
      ? (oldestRelevant.timestamp + RATE_LIMIT_WINDOW_MS) - Date.now() + 1000
      : RATE_LIMIT_WINDOW_MS;

    const waitSec = Math.ceil(Math.max(waitMs, 5000) / 1000);
    console.log(`[LLM Rate Limiter] Token budget low (${used}/${RATE_LIMIT_TOKENS} used). Waiting ${waitSec}s...`);
    await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
  }
}

function parseRetryAfter(headers: Headers, errorText: string): number {
  // 1. Check Retry-After header (seconds or HTTP-date)
  const headerVal = headers.get('retry-after');
  if (headerVal) {
    const secs = Number(headerVal);
    if (!isNaN(secs) && secs > 0) return Math.min(secs, 120);
  }

  // 2. Parse from error body: "wait 60 seconds", "try again in 30.5s", etc.
  const match = errorText.match(/(?:wait|in)\s+([\d.]+)\s*s(?:econds?)?/i);
  const parsed = match ? parseFloat(match[1]!) : 60;

  // Cap at 120s — anything longer means the quota is exhausted, no point blocking
  return Math.min(Math.max(parsed, 1), 120);
}

// ─── Core Chat Completion ────────────────────────────────────

export async function chat(
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  const settings = loadLlmSettings();
  const maxTokens = options?.maxTokens ?? 4096;

  // Rough estimate: ~4 chars per token for the prompt + maxTokens for completion
  const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const estimatedTokens = Math.ceil(promptChars / 4) + maxTokens;

  // Wait if we're near the rate limit
  await waitForTokenBudget(estimatedTokens);

  const body = {
    model: settings.model,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: maxTokens,
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(`${settings.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      const errorText = await response.text().catch(() => '');
      const retrySec = parseRetryAfter(response.headers, errorText);
      console.log(`[LLM Rate Limiter] 429 received (attempt ${attempt}/${MAX_RETRIES}). Waiting ${retrySec}s...`);

      if (attempt === MAX_RETRIES) {
        throw new Error(`LLM API error (429): ${errorText}`);
      }

      // Record a large usage to prevent further calls from racing ahead
      recordTokenUsage(RATE_LIMIT_TOKENS);
      await new Promise(resolve => setTimeout(resolve, retrySec * 1000));
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`LLM API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM returned empty response');

    // Track actual token usage from the API response
    const actualTokens = data.usage?.total_tokens ?? estimatedTokens;
    recordTokenUsage(actualTokens);

    return content;
  }

  throw new Error('LLM API: max retries exceeded');
}

// ─── Research-Specific Prompts ───────────────────────────────

const SYSTEM_PROMPT = `You are an autonomous quantitative trading researcher. Your job is to independently DISCOVER, DESIGN, and OPTIMIZE trading strategies from scratch given a user's hypothesis or desired outcome.

You are NOT given a pre-built strategy. You must research and find the optimal approach.

## Built-in Indicators
These are pre-implemented and ready to use:
- SMA  — Simple Moving Average. Key: SMA_{period} (e.g. SMA_10, SMA_50)
- EMA  — Exponential Moving Average. Key: EMA_{period} (e.g. EMA_10, EMA_21)
- RSI  — Relative Strength Index (0-100). Key: RSI_{period} (e.g. RSI_14)
- ATR  — Average True Range. Key: ATR_{period} (e.g. ATR_14)
- BollingerBands — Keys: BB_upper_{period}, BB_middle_{period}, BB_lower_{period}
- MACD — Moving Average Convergence Divergence. Params: fastPeriod, slowPeriod, signalPeriod. Keys: MACD_line, MACD_signal, MACD_histogram
- VWAP — Volume Weighted Average Price. Key: VWAP

## Custom Indicators
If you need ANY indicator not listed above (e.g. Stochastic, Williams %R, CCI, OBV, Donchian Channel, Keltner Channel, Ichimoku, ADX, etc.), you can define it yourself using "customIndicators".

Each custom indicator has:
- "type": a unique name matching the indicator's type in the indicators array
- "key": the primary lookup key used in rules (e.g. "STOCH_K_14")
- "compute": a JavaScript function BODY (not arrow function) that receives (closes, highs, lows, volumes, params, length) and must RETURN either:
  - A single number[] of the same length as the input arrays
  - An object { "KEY1": number[], "KEY2": number[] } for multi-output indicators

Example custom indicator (Stochastic %K):
{
  "type": "Stochastic",
  "key": "STOCH_K_14",
  "compute": "var period = params.period || 14; var result = new Array(length).fill(NaN); for (var i = period - 1; i < length; i++) { var highest = -Infinity, lowest = Infinity; for (var j = i - period + 1; j <= i; j++) { if (highs[j] > highest) highest = highs[j]; if (lows[j] < lowest) lowest = lows[j]; } result[i] = highest !== lowest ? ((closes[i] - lowest) / (highest - lowest)) * 100 : 50; } return result;"
}

If a custom indicator computation fails, it fills with NaN and the strategy will generate 0 trades — you'll see this in the results and can fix the compute code in the next iteration.

## Rule Engine Constraints (CRITICAL)
- Rule conditions: crosses_above, crosses_below, above, below
- ALL entry rules are evaluated with AND logic — every rule must be true simultaneously
- ALL exit rules are also AND logic
- In rules, "indicator" and "compareIndicator" must use the EXACT computed key with period suffix
  - Correct: "indicator": "SMA_10", "compareIndicator": "SMA_50"
  - WRONG: "indicator": "SMA", "compareIndicator": "SMA"
- For crosses_above/crosses_below between two indicators: set "indicator" to fast, "compareIndicator" to slow, no "value"
- For comparing to a fixed number: set "indicator" to key and "value" to the number, no "compareIndicator"
  - Example: RSI above 70 → { "indicator": "RSI_14", "condition": "above", "value": 70 }

## IMPORTANT: Generating Trades
- Keep entry rules SIMPLE (1-2 rules max) to ensure trades are generated
- AND logic means more rules = exponentially fewer signals
- Prefer a SINGLE crosses_above/crosses_below rule for entry
- Use stop-loss and take-profit for risk management instead of complex exit rules
- A strategy with 0 trades is useless — always prioritize signal frequency

## JSON Output Format
Output ONLY valid JSON (no markdown fences):
{
  "hypothesis": "string — explain the specific trading thesis and WHY this strategy should work",
  "config": {
    "tickers": ["string"],
    "timeframe": "day",
    "dateRange": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
    "indicators": [{ "type": "SMA|EMA|RSI|BollingerBands|ATR|MACD|VWAP|AnyCustomType", "params": { "period": number, ... } }],
    "customIndicators": [{ "type": "AnyCustomType", "key": "CUSTOM_KEY", "compute": "...js function body..." }],
    "entryRules": [{ "indicator": "SMA_10", "condition": "crosses_above", "compareIndicator": "SMA_50" }],
    "exitRules": [{ "indicator": "SMA_10", "condition": "crosses_below", "compareIndicator": "SMA_50" }],
    "initialCapital": number,
    "positionSize": number (percent of capital, e.g. 100 = 100%),
    "stopLoss": number? (percent, e.g. 5 = 5%),
    "takeProfit": number? (percent, e.g. 10 = 10%)
  }
}

Only include "customIndicators" if you use indicator types not in the built-in list.`;

export async function generateHypothesis(context: {
  projectName: string;
  category: string;
  description?: string;
  existingHypothesis?: string;
  tickers: string[];
  dateRange?: { from: string; to: string };
  initialCapital?: number;
}): Promise<{ hypothesis: string; config: Record<string, unknown> }> {
  const userPrompt = `Research and design a complete trading strategy from scratch.

The user wants to explore:
- Project: ${context.projectName}
- Category: ${context.category}
- Tickers: ${context.tickers.join(', ')}
${context.description ? `- Description / Desired Outcome: ${context.description}` : ''}
${context.existingHypothesis ? `- User's Idea / Hypothesis: ${context.existingHypothesis}` : ''}
${context.dateRange ? `- Date Range: ${context.dateRange.from} to ${context.dateRange.to}` : '- Date Range: 2024-01-01 to 2024-12-31'}
${context.initialCapital ? `- Initial Capital: $${context.initialCapital}` : '- Initial Capital: $10000'}

Based on the user's idea, research and design a COMPLETE strategy:
1. Choose appropriate indicators and their parameters
2. Define entry and exit rules
3. Set position sizing and risk management (stop-loss, take-profit)
4. Explain your reasoning in the hypothesis

Output ONLY the JSON object.`;

  const content = await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ], { temperature: 0.8 });

  return parseStrategyJson(content);
}

export async function analyzeResults(context: {
  hypothesis: string;
  config: Record<string, unknown>;
  results: Record<string, unknown>;
  iteration: number;
  userGoal?: string;
}): Promise<string> {
  const userPrompt = `Analyze these backtest results for iteration #${context.iteration}.

${context.userGoal ? `User's Goal: ${context.userGoal}` : ''}
Strategy Hypothesis: ${context.hypothesis}

Config Used: ${JSON.stringify(context.config, null, 2)}

Results:
- Total PnL: $${(context.results.totalPnL as number)?.toFixed(2)} (${(context.results.totalPnLPercent as number)?.toFixed(2)}%)
- Total Trades: ${context.results.totalTrades}
- Win Rate: ${(context.results.winRate as number)?.toFixed(1)}%
- Max Drawdown: ${(context.results.maxDrawdownPercent as number)?.toFixed(2)}%
- Sharpe Ratio: ${(context.results.sharpeRatio as number)?.toFixed(2)}
- Profit Factor: ${context.results.profitFactor}
- Avg Win: $${(context.results.avgWin as number)?.toFixed(2)}
- Avg Loss: $${(context.results.avgLoss as number)?.toFixed(2)}

Provide a concise analysis covering:
1. How well does this strategy serve the user's goal?
2. What's working and what isn't in the current approach?
3. Key risks and weaknesses
4. Should we try a DIFFERENT strategy approach entirely, or refine the current one?`;

  return await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ], { temperature: 0.5 });
}

export async function suggestRefinement(context: {
  hypothesis: string;
  config: Record<string, unknown>;
  results: Record<string, unknown>;
  analysis: string;
  history: { iteration: number; pnl: number; winRate: number; sharpe: number }[];
  userGoal?: string;
}): Promise<{ hypothesis: string; config: Record<string, unknown> }> {
  const historyStr = context.history
    .map(h => `  Iteration ${h.iteration}: PnL=$${h.pnl.toFixed(2)}, WinRate=${h.winRate.toFixed(1)}%, Sharpe=${h.sharpe.toFixed(2)}`)
    .join('\n');

  const userPrompt = `Design an improved or entirely new strategy based on the research so far.

${context.userGoal ? `User's Goal: ${context.userGoal}` : ''}
Current Hypothesis: ${context.hypothesis}
Current Config: ${JSON.stringify(context.config, null, 2)}

Analysis: ${context.analysis}

Iteration History:
${historyStr}

You are free to:
- Try completely DIFFERENT indicators (e.g. switch from SMA to RSI, MACD, Bollinger Bands)
- Redesign entry/exit rules from scratch
- Change the strategy paradigm entirely (e.g. from momentum to mean-reversion)
- Adjust risk management (position size, stop-loss, take-profit)
- Combine multiple indicators for more sophisticated signals

Do NOT just tweak numbers — think about whether a fundamentally different approach might work better.
Keep the same tickers, date range, and initial capital.
Output ONLY the improved JSON.`;

  const content = await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ], { temperature: 0.7 });

  return parseStrategyJson(content);
}

export async function assessConvergence(history: {
  iteration: number;
  pnl: number;
  winRate: number;
  sharpe: number;
  maxDrawdownPercent: number;
}[]): Promise<{ converged: boolean; reason: string }> {
  // Simple heuristic convergence check (no LLM call needed for this)
  if (history.length < 2) return { converged: false, reason: 'Need more iterations' };

  const last = history[history.length - 1]!;
  const prev = history[history.length - 2]!;

  // Stop if strategy is good enough
  if (last.sharpe > 2 && last.winRate > 55 && last.pnl > 0) {
    return { converged: true, reason: 'Strategy meets quality thresholds (Sharpe > 2, Win Rate > 55%)' };
  }

  // Stop if no meaningful improvement over last 2 iterations
  if (history.length >= 3) {
    const prevPrev = history[history.length - 3]!;
    const pnlDelta1 = Math.abs(last.pnl - prev.pnl);
    const pnlDelta2 = Math.abs(prev.pnl - prevPrev.pnl);
    const avgPnl = Math.abs(last.pnl) || 1;

    if (pnlDelta1 / avgPnl < 0.02 && pnlDelta2 / avgPnl < 0.02) {
      return { converged: true, reason: 'Performance has plateaued (< 2% change over 2 iterations)' };
    }
  }

  // Stop if performance is degrading
  if (history.length >= 3) {
    const recent = history.slice(-3);
    const degrading = recent.every((h, i) =>
      i === 0 || h.pnl <= recent[i - 1]!.pnl,
    );
    if (degrading) {
      return { converged: true, reason: 'Performance degrading over last 3 iterations' };
    }
  }

  return { converged: false, reason: `Iteration ${last.iteration}: continuing optimization` };
}

// ─── Helpers ─────────────────────────────────────────────────

function parseStrategyJson(content: string): { hypothesis: string; config: Record<string, unknown> } {
  // Strip markdown fences if present
  let json = content.trim();
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const parsed = JSON.parse(json);
    if (!parsed.hypothesis || !parsed.config) {
      throw new Error('Missing required fields: hypothesis, config');
    }
    return { hypothesis: parsed.hypothesis, config: parsed.config };
  } catch (e) {
    throw new Error(`Failed to parse LLM strategy response: ${e instanceof Error ? e.message : String(e)}\n\nRaw response:\n${content.substring(0, 500)}`);
  }
}
