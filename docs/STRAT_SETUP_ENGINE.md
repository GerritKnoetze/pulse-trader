# Strat Setup Engine — Implementation Plan

## Overview

Extends the existing scanner with a **decision layer** that identifies high-probability Strat setups, scores them, and guides the trader through the systematic entry process step-by-step with live alerts.

---

## What the scanner already does

| Already computed | Used for |
|---|---|
| Bar type per timeframe (`1`, `2u`, `2d`, `3`) | CC codes, pattern strings |
| 3-bar pattern strings (`2d-1-2u`, `3-2u-1`, …) | Signal column |
| MTF directions across all 10 timeframes | FTFC dot |
| `inForce` flag | Green dot |
| ATR $ / ATR % | Risk sizing |

**Missing:** the context-aware setup scoring, step-by-step trade guidance, and notification/alert mechanism.

---

## What The Strat requires (5 sequential checks)

```
1. COMBO IDENTIFICATION  — what is the pattern on the signal timeframe?
2. TF CONTINUITY CHECK   — is the next higher TF aligned? (not an inside bar above)
3. ENTRY PRICE           — break of prior candle high/low
4. STOP PLACEMENT        — low/high of the entry candle (or lower-TF refinement)
5. TARGETS               — prior candle H/L → prior-prior candle H/L → …
```

Intraday workflow layers: **30min combo → 1H check → D check → 5min entry/stop**

---

## Architecture — Three Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Alert System                                      │
│  Browser Notification · Toast · SSE broadcast · Webhook     │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Setups Panel UI                                   │
│  ScannerSetupsPanel · ScannerSetupChecklist                 │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: StratSetupEngine (server service)                 │
│  scoreSetup() · quality grading · entry/stop/targets        │
└─────────────────────────────────────────────────────────────┘
```

---

## Layer 1 — `StratSetupEngine` (server service)

**File:** `src/server/services/strat-setup-engine.ts`

### Core types

```ts
export type SetupQuality = 'A+' | 'A' | 'B' | 'C'
export type TfContinuityStatus = 'full' | 'partial' | 'conflicted' | 'blocked'

export interface StratSetup {
  symbol:           string
  signalTf:         ScannerTimeframe   // TF where the combo formed
  combo:            string             // e.g. "2-1-2 Bullish Reversal"
  comboType:        'Reversal' | 'Continuation' | 'Reversal+' | 'Continuation+'
  direction:        'long' | 'short'
  quality:          SetupQuality       // A+ = FTFC + premium combo + inForce + R:R ≥ 2
  entryPrice:       number             // break of prior candle high (long) or low (short)
  stop:             number             // low/high of entry candle
  targets:          number[]           // [T1, T2, T3] — prior candle extremes
  rr:               number             // (T1 - entry) / (entry - stop)
  atrRisk:          number             // (entry - stop) / ATR$ — ATRs risked
  tfContinuity:     TfContinuityStatus
  higherTfBlocked:  boolean            // true if immediate higher TF is inside bar (1)
  inForce:          boolean
  ftfc:             boolean
  detectedAt:       string             // ISO timestamp
  alertSent:        boolean
}
```

### Quality grading rules

| Grade | Requirements |
|---|---|
| `A+` | FTFC + premium combo + `inForce` + R:R ≥ 2 |
| `A` | FTFC OR premium combo + `inForce` |
| `B` | Basic combo + signal TF continuity only |
| `C` | Pattern exists, higher TF conflicts |

> **Note:** FTFC for day trading requires all intraday TFs (5M, 15M, 30M, 1H) **and** D to agree. W/M/Q/Y are not part of the day-trading FTFC check.

### Premium combos (from The Strat "Our Favorites")

| Combo | Notes |
|---|---|
| `2-1-2 Bullish/Bearish Reversal` | Highest magnitude, enter after consolidation |
| `3-1-2 Bullish/Bearish Reversal` | Large magnitude, continuation if 3 clears |
| `3-2-2 Bullish/Bearish Reversal` | Early entry into larger move |
| `1-2-2 Bullish/Bearish Reversal` | Play off failed directional bar |
| `1-3 Bullish/Bearish` | Entering during range expansion |

### Mapping from existing pattern strings

| Existing `pattern` value | Strat Combo name | Direction |
|---|---|---|
| `2d-1-2u` | 2-1-2 Bullish Reversal | long |
| `2u-1-2d` | 2-1-2 Bearish Reversal | short |
| `2u-1-2u` | 2-1-2 Bullish Continuation | long |
| `2d-1-2d` | 2-1-2 Bearish Continuation | short |
| `3-1-2u` | 3-1-2 Bullish Reversal | long |
| `3-1-2d` | 3-1-2 Bearish Reversal | short |
| `3-2d-2u` | 3-2-2 Bullish Reversal | long |
| `3-2u-2d` | 3-2-2 Bearish Reversal | short |
| `1-2d-2u` | 1-2-2 Bullish Reversal | long |
| `1-2u-2d` | 1-2-2 Bearish Reversal | short |
| `2u-2u` | 2-2 Bullish Continuation | long |
| `2d-2d` | 2-2 Bearish Continuation | short |
| `2d-2u` | 2-2 Bullish Reversal | long |
| `2u-2d` | 2-2 Bearish Reversal | short |
| `1-3` (close > 1-bar high) | 1-3 Bullish | long |
| `1-3` (close < 1-bar low) | 1-3 Bearish | short |

### Entry / Stop / Target computation

```
LONG setup:
  entry  = bars[n-2].high          (break above prior candle high)
  stop   = bars[n-1].low           (low of entry candle)
  T1     = bars[n-3].high          (high two candles back)
  T2     = bars[n-4].high          (high three candles back)
  T3     = bars[n-5].high          (high four candles back)

SHORT setup:
  entry  = bars[n-2].low           (break below prior candle low)
  stop   = bars[n-1].high          (high of entry candle)
  T1     = bars[n-3].low           (low two candles back)
  T2     = bars[n-4].low           (low three candles back)
  T3     = bars[n-5].low           (low four candles back)
```

### Scanner engine integration

In `src/server/services/scanner-engine.ts`, `enrichTicker()`:
1. Fetch minute bars alongside daily bars
2. After `computeTA()`, aggregate minute bars into 30M, 1H, 15M, 5M bars
3. For each intraday TF in priority order (30M → 1H → 15M → 5M), compute the pattern and call `scoreSetup(row, tfBars, signalTf, tfPattern)`
4. First matching setup wins — attach to row and broadcast `setup-alert`
5. Track `alertSent` per `${symbol}-${signalTf}` to avoid duplicates

> **No daily/swing setups:** `scoreSetup` rejects any `signalTf` outside `['1','5','15','30','60']`. D/W/M/Q/Y are used only as continuity checks, never as signal timeframes.

---

## Layer 2 — Frontend UI

### `ScannerSetupsPanel.vue`

New drawer component (mirrors existing drawer pattern) showing ranked live setups.

```
┌─────────────────────────────────────────────────────────┐
│  LIVE SETUPS                               [A+] [A] [B] │
├──────────────────────┬──────────────────────────────────┤
│  AAPL  A+  LONG      │  30M: 2-1-2 Bullish Reversal     │
│  ████ $182.50        │  Entry:  $183.20  (break of 30M) │
│  ▲ TF: ████████████ │  Stop:   $181.80  (30M low)      │
│                      │  T1:     $185.40  (prior high)   │
│                      │  T2:     $188.00  (2× prior)     │
│                      │  R:R 2.3 · Risk 0.8× ATR         │
│                      │  ✓ 1H up · ✓ D up · ✓ FTFC      │
├──────────────────────┴──────────────────────────────────┤
│  MSFT  A   SHORT     │  D: 2-1-2 Bearish Reversal       │
│  ████ $415.10        │  Entry:  $412.00  (break of D)   │
│  ▼ TF: ████████▄▄▄▄ │  Stop:   $416.50  (D high)       │
│                      │  T1:     $405.00  · R:R 1.8      │
│                      │  ✗ W conflicted                  │
└─────────────────────────────────────────────────────────┘
```

**Features:**
- Filter by quality grade (A+/A/B/C buttons)
- Sort by R:R, ATR risk, or detected time
- Click row → opens `ScannerSetupChecklist`
- Real-time updates via existing SSE stream

### `ScannerSetupChecklist.vue`

Step-by-step workflow panel for the selected setup. Steps auto-tick as conditions are met.

**Intraday checklist (30M setup):**
```
SETUP CHECKLIST — AAPL LONG (30M 2-1-2 Bullish Reversal)
──────────────────────────────────────────────────────────
Step 1  ✓  30M combo identified: 2-1-2 Bullish Reversal
Step 2  ✓  1H is 2u (not inside bar — not blocked)
Step 3  ✓  D is 2u (trend confirmed)
Step 4  ✓  W is 2u (full continuity — FTFC)
Step 5  ○  Wait for 5M break above $183.20
Step 6  ○  Enter LONG at $183.20 · Stop $181.80 ($1.40 risk)
Step 7  ○  Scale out 50% at T1 $185.40 (R:R 1.6)
Step 8  ○  Runner to T2 $188.00 (R:R 3.4)
──────────────────────────────────────────────────────────
[ Open Chart ]  [ Set Alert ]  [ Copy Trade Params ]
```

**Actions:**
- **Open Chart** — opens `ScannerSymbolChart` for the symbol
- **Set Alert** — arms a browser notification for when price hits entry
- **Copy Trade Params** — copies entry/stop/T1/T2/T3 to clipboard as JSON or plain text

### `ScannerSideStrip.vue` changes

Add a "Setups" icon (e.g. lightning bolt) with a numeric badge showing count of active A+/A setups.

### Type additions to `src/app/types/scanner.ts`

```ts
export type SetupQuality = 'A+' | 'A' | 'B' | 'C'

export interface StratSetup {
  symbol:          string
  signalTf:        ScannerTimeframe
  combo:           string
  comboType:       'Reversal' | 'Continuation' | 'Reversal+' | 'Continuation+'
  direction:       'long' | 'short'
  quality:         SetupQuality
  entryPrice:      number
  stop:            number
  targets:         number[]
  rr:              number
  atrRisk:         number
  higherTfBlocked: boolean
  inForce:         boolean
  ftfc:            boolean
  detectedAt:      string
}

// Extend ScannerRow (additive — optional field)
// Add to existing ScannerRow interface:
//   setup?: StratSetup
```

---

## Layer 3 — Alert / Notification System

### Trigger conditions

| Event | Grade threshold |
|---|---|
| New setup detected | Configurable (A+ only / A and above / all) |
| `inForce` flips to `true` | Always for A+/A |
| T1 hit | Always for any active setup |
| Stop hit (setup invalidated) | Always for any active setup |

### Delivery mechanisms

1. **SSE broadcast** — extend existing `broadcastStatus()` to emit `setup-alert` events
2. **Toast** — use existing `useToast()` composable for in-app notifications
3. **Browser Notification API** — `Notification.requestPermission()` on first setup alert
4. **Webhook** (optional) — POST to Discord/Slack URL stored in settings DB

### Server-side tracking (in `ScannerEngine`)

```ts
// Track alerts sent to prevent duplicate notifications
private alertsSent = new Set<string>()  // key: `${symbol}-${signalTf}-${detectedAt}`

private maybeAlert(setup: StratSetup) {
  const key = `${setup.symbol}-${setup.signalTf}-${setup.detectedAt}`
  if (this.alertsSent.has(key)) return
  this.alertsSent.add(key)
  this.broadcastSetupAlert(setup)
}
```

### Settings additions (`SettingsGeneral.vue`)

- Alert grade threshold dropdown: `A+ only` / `A and above` / `B and above` / `All`
- Webhook URL text input (Discord/Slack/custom)
- Browser notification permission toggle

---

## Phase 4 (Optional) — Multi-TF Chart Panel

Replace the current seeded-random `ScannerSymbolChart.vue` with a **4-panel real-data chart** using the bars already fetched by the scanner engine.

```
┌─────────────────┬─────────────────┐
│   D (trend)     │   1H (check)    │
├─────────────────┼─────────────────┤
│   30M (combo)   │   5M (entry)    │
└─────────────────┴─────────────────┘
```

**Each panel auto-draws:**
- Entry price level (dashed white line)
- Stop level (dashed red line)
- T1 / T2 / T3 targets (dashed green lines)
- Bar-type labels (`1`, `2u`, `2d`, `3`) on each candle

**How the price levels are determined:**

All four panels display the same price levels sourced from the `StratSetup` object, computed on the **signal timeframe** (`signalTf`) — the intraday TF where the combo was detected (30M, 1H, 15M, or 5M):

| Level | Source | Derivation |
|---|---|---|
| **Entry** (white) | `signalTf` bars | `bars[n-2].high` for long · `bars[n-2].low` for short — break of the prior completed candle |
| **Stop** (red) | `signalTf` bars | `bars[n-1].low` for long · `bars[n-1].high` for short — opposite extreme of the entry candle |
| **T1** (green) | `signalTf` bars | `bars[n-3].high/low` — extreme of the candle two bars back |
| **T2** (green) | `signalTf` bars | `bars[n-4].high/low` — extreme of the candle three bars back |
| **T3** (green) | `signalTf` bars | `bars[n-5].high/low` — extreme of the candle four bars back |

**Why all four panels show the same levels:**

The levels are absolute price values, so they are meaningful on every timeframe. Displaying them across all panels lets the trader see:
- **D panel** — whether the entry is near a significant daily level (prior day H/L)
- **1H panel** — whether the 1H structure confirms the direction of the trade
- **30M panel** — the combo candles that generated the signal (the levels will align with the 30M candles when `signalTf = 30M`)
- **5M panel** — where to watch for the actual entry trigger and fine-tune the stop

When the chart is opened via **Open Chart** from `ScannerSetupChecklist`, the `StratSetup` is passed directly as a prop and the levels are drawn automatically on all four panels on render.

**Chart library:** TradingView Lightweight Charts (already referenced for chart work)

---

## Implementation Roadmap

| Phase | Description | Files | Effort |
|---|---|---|---|
| **1** | Backend setup scoring | `strat-setup-engine.ts` + scanner-engine changes | 1–2 days |
| **2** | Setups Panel UI | `ScannerSetupsPanel.vue`, `ScannerSetupChecklist.vue`, side-strip badge | 2–3 days |
| **3** | Alert system | SSE extension, toast, browser notifications, settings | 1 day |
| **4** | Multi-TF real chart | Replace `ScannerSymbolChart.vue` with 4-panel real-data chart | 2–3 days |

**Recommended build order:** Phase 1 → Phase 3 → Phase 2 → Phase 4

---

## Status

| Phase | Status |
|---|---|
| Phase 1 — Backend scoring | ✅ Complete |
| Phase 2 — Setups Panel UI | ✅ Complete |
| Phase 3 — Alert system | ✅ Complete |
| Phase 4 — Multi-TF chart | ⬜ Not started |
