# Scanner — "The Strat" Strategy Scanner

## Overview

The Scanner page (`/scanner`) is a full-screen trading scanner built around **"The Strat"** strategy by Rob Smith. It scans a universe of tickers and classifies each one by its current candlestick pattern, signal type, and market context across multiple time frames.

---

## File Structure

```
src/app/
  pages/
    scanner.vue                      # Page entry point (layout: scanner)
  layouts/
    scanner.vue                      # Full-height layout (no padding, overflow hidden)
  components/scanner/
    ScannerToolbar.vue               # Top bar: timeframes, scan mode, quick filters
    ScannerGrid.vue                  # Data grid + status bar + side strip
  composables/
    useScanner.ts                    # Singleton state: data, filtering, sorting
  types/
    scanner.ts                       # TypeScript interfaces and types
```

---

## Layout

The scanner uses a dedicated layout (`scanner.vue`) that removes the default page padding and locks `overflow: hidden` so the grid can manage its own internal scroll. The page is composed of two stacked components:

```
┌─────────────────────────────────────────────────────────────┐
│  ScannerToolbar  (fixed height 2.5rem)                      │
├──────────────────────────────────────────────────────────────┤
│  ScannerGrid (flex row)                                      │
│  ┌────────────────────────────────────────┐ ┌─────────────┐ │
│  │  Scrollable data table                 │ │ Side strip  │ │
│  ├────────────────────────────────────────┤ │  Columns    │ │
│  │  Status bar (Total / Showing / STATS)  │ │  Grid State │ │
│  └────────────────────────────────────────┘ │  My Filters │ │
│                                              └─────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## ScannerToolbar

Controls that drive the scanner's filtering state via `useScanner`.

| Control | Description |
|---|---|
| **Time Frame** | Buttons: `15`, `30`, `60`, `D`, `W`, `M`, `Q`, `Y`. Active frame highlighted in orange. Calls `setTimeframe()`. |
| **Scan Mode** | Toggle between `Signal` (in-force signals) and `Setup` (pre-close setups). Calls `setMode()`. |
| **Quick Filters** | Dropdown of preset pattern filters. Calls `toggleQuickFilter()`. Active filter label shown on the button. |
| **Clear (✕)** | Always rendered (`v-show`), visible only when a filter is active. Calls `clearFilters()`. |
| **Grid Options** | Dropdown stub for future grid preferences (two-bar display, auto-size columns). |

> **Note on dropdowns:** Both dropdown menus use `mouseenter`/`mouseleave` on the wrapper. A `::before` pseudo-element bridges the gap between the button and the menu so the mouse can travel between them without closing the dropdown.

---

## ScannerGrid

### Columns

| Column | Key | Description |
|---|---|---|
| Symbol | `symbol` | Ticker symbol. Bold white. |
| ATR % | `atrPct` | Average True Range as a percentage of price. |
| Last | `last` | Last traded price. |
| Sector | `sector` | Market sector (e.g. Technology, Healthcare). |
| Category | `category` | Pattern category — see colour coding below. |
| Signal | `signal` | Specific signal name — see colour coding below. |
| Pattern | `pattern` | Numeric Strat pattern notation (e.g. `2u-2u`, `1-2u`, `3-2u-1`). |
| CC | `cc` | Current candle direction (`2u` = up, `2d` = down, `1` = inside). |
| Avg. Vol(30) | `avgVol30` | 30-day average volume. Formatted as `M` / `K`. |
| In Force | `inForce` | Green dot = signal is currently in force. |
| FTFC | `ftfc` | Amber dot = Full Time Frame Continuity confirmed. |
| Chg $ | `chgDollar` | Dollar change. Green = positive, red = negative. |
| Ch% | `chgPct` | Percentage change. Green = positive, red = negative. |
| ATR $ | `atrDollar` | ATR expressed in dollars. |

All columns are sortable. Clicking a column header cycles: `asc → desc → unsorted`.

### Colour Coding

**Category**
| Value | Colour |
|---|---|
| `Continuation` | Green (`#42b883`) |
| `Continuation+` | Bright green (`#4ade80`) |
| `Inside` | Amber (`#f59e0b`) |
| `Reversal` | Orange (`#f97316`) |

**Signal**
| Pattern type | Colour |
|---|---|
| Up / expansion / inside up / green | Green (`#42b883`) |
| Down / red | Orange (`#f97316`) |
| Hammer | Amber (`#f59e0b`) |

### Side Strip

Three vertical buttons on the far right edge. Icons face up; labels read top-to-bottom (`writing-mode: vertical-lr`).

| Button | Purpose (Phase 2) |
|---|---|
| **Columns** | Show/hide column selector panel |
| **Grid State** | Save or restore default column layout |
| **My Filters** | Manage and save custom filter presets |

> These panels are stub-wired (toggle state exists) but not yet implemented.

### Status Bar

Fixed to the bottom of the grid. Shows `Total` (full universe size) and `Showing` (after filters). The **STATS** button will open a sector statistics breakdown in a future phase.

---

## useScanner Composable

Module-level singleton — state is shared across any component that calls `useScanner()`.

### State

| Property | Type | Description |
|---|---|---|
| `timeframe` | `ScannerTimeframe` | Active time frame selection |
| `mode` | `ScannerMode` | `'signal'` or `'setup'` |
| `activeQuickFilter` | `string \| null` | ID of the active quick filter |
| `sortKey` | `keyof ScannerRow \| null` | Column currently sorted |
| `sortDir` | `'asc' \| 'desc' \| null` | Sort direction |

### Computed

| Property | Description |
|---|---|
| `filteredRows` | Mock rows after quick-filter and sort are applied |
| `totalCount` | Total rows in the dataset |
| `showingCount` | Rows visible after filtering |

### Actions

| Method | Description |
|---|---|
| `setTimeframe(tf)` | Change the active time frame |
| `setMode(m)` | Switch between Signal and Setup scan mode |
| `toggleQuickFilter(id)` | Apply a filter, or clear it if already active |
| `clearFilters()` | Remove any active quick filter |
| `setSortBy(key)` | Cycle sort state for a column |

---

## Types (`src/app/types/scanner.ts`)

```ts
type ScannerTimeframe = '15' | '30' | '60' | 'D' | 'W' | 'M' | 'Q' | 'Y'
type ScannerMode      = 'signal' | 'setup'
type ScannerCategory  = 'Continuation' | 'Continuation+' | 'Inside' | 'Reversal' | ''
type SortDirection    = 'asc' | 'desc' | null

interface ScannerRow { ... }   // One row of scanner data
interface ScannerColumnDef {}  // Column metadata
interface QuickFilter {}       // Filter preset { id, label, isCustom? }
```

---

## Current State (Phase 1)

- UI shell is complete and matches the reference design.
- Data is **static mock data** (24 rows from the reference screenshot).
- Filtering and sorting work on the mock dataset.
- No live market data integration yet.

## Planned (Phase 2+)

- Connect to live market data API (Polygon.io / Massive) to compute Strat patterns in real time.
- Implement column visibility panel (side strip → Columns).
- Implement saved filter presets (side strip → My Filters).
- Implement grid state persistence (side strip → Grid State).
- STATS panel: sector-level percentage breakdown of 2u/2d across all time frames.
- Export to CSV / copy with headers (right-click context menu).
- Custom watchlist filtering (ticker symbol input at top).
- Multi-time frame column showing Strat state across all time frames simultaneously.
