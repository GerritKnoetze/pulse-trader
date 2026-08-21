/**
 * REPAIR POLLUTED MINUTE BARS (self-contained, run with tsx)
 * ==========================================================
 *   npx tsx scripts/repair-polluted-minutes.tsx            # dry run (no changes)
 *   npx tsx scripts/repair-polluted-minutes.tsx --apply    # actually fix
 *   npx tsx scripts/repair-polluted-minutes.tsx --db <path># other DB
 *
 * Background: before 2026-08-19, getOrSyncFiveMinuteBars passed the raw API
 * timespan ('minute') into fetchAggregates, so 5-min aggregate bars were
 * stamped as 'minute' and REPLACE-overwrote the real 1-minute bars that fall
 * on 5-min boundaries. The source bug is fixed; this script repairs the rows
 * already written to the DB.
 *
 * Repair strategy (per affected ticker):
 *   1. Find minute rows whose OHLCV exactly matches a stored '5min' row at the
 *      same timestamp (the pollution signature).
 *   2. Delete the ticker's whole 'minute' series (scattered bad rows can't be
 *      repaired by a tail-only incremental fetch).
 *   3. Clear its minute sync-state and re-sync the full 60-day window from
 *      Massive.com so the 1-minute series is rewritten from source.
 *
 * Dry-run by default — pass --apply to mutate.
 */
import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const dbArg = (() => {
  const i = process.argv.indexOf('--db')
  return i > -1 ? process.argv[i + 1] : undefined
})()
const DB_PATH = dbArg ?? path.join(process.cwd(), 'data', 'pulse-trader.db')
process.env.DB_PATH = DB_PATH

async function main(): Promise<void> {
  const { getConnectionManager } = await import('../src/server/database/connection-manager')
  const { MarketDataRepository } = await import('../src/server/database/repositories/market-data-repository')
  const mds = await import('../src/server/services/market-data.service')

  const repo = new MarketDataRepository()
  const db = getConnectionManager().getDatabase()

  // Find the pollution signature: minute rows identical to a 5min row.
  const pollutedRows = db.prepare(`
    SELECT m.Ticker, COUNT(*) AS n
    FROM MarketData m
    JOIN MarketData f
      ON f.Ticker = m.Ticker AND f.Timespan = '5min' AND f.Timestamp = m.Timestamp
    WHERE m.Timespan = 'minute'
      AND ABS(m.Volume - f.Volume) < 0.0001
      AND ABS(m.Close - f.Close) < 0.0001
    GROUP BY m.Ticker
  `).all() as { Ticker: string; n: number }[]

  // Ticketers with 5min rows but NO minute rows at all — left behind by an
  // interrupted run (minute series deleted, re-sync never finished).
  const missingMinute = db.prepare(`
    SELECT DISTINCT Ticker FROM MarketData WHERE Timespan = '5min'
    AND Ticker NOT IN (SELECT DISTINCT Ticker FROM MarketData WHERE Timespan = 'minute')
  `).all() as { Ticker: string }[]

  const pollutedByTicker = new Map(pollutedRows.map(r => [r.Ticker, r.n]))
  for (const { Ticker } of missingMinute) {
    if (!pollutedByTicker.has(Ticker)) pollutedByTicker.set(Ticker, 0)
  }
  const affected = [...pollutedByTicker.keys()].sort()

  console.log(`DB: ${DB_PATH}`)
  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} (--apply to mutate)`)
  console.log(`Affected tickers: ${affected.length} (${pollutedRows.reduce((s, r) => s + r.n, 0)} polluted + ${missingMinute.length} missing-minute)`)

  let deletedTotal = 0
  for (const Ticker of affected) {
    const polluted = pollutedByTicker.get(Ticker) ?? 0
    const total = (db.prepare("SELECT COUNT(*) AS n FROM MarketData WHERE Ticker = ? AND Timespan = 'minute'").get(Ticker) as { n: number }).n

    if (apply) {
      repo.deleteByTicker(Ticker, 'minute')
      repo.clearSyncState(Ticker, 'minute')
      try {
        const bars = await mds.getOrSyncMinuteBars(Ticker)
        console.log(`  ${Ticker}: deleted ${polluted}/${total} polluted rows, re-synced ${bars.length} minute bars`)
      } catch (e) {
        console.log(`  ${Ticker}: deleted ${polluted}/${total} rows but re-sync failed: ${(e as Error).message}`)
      }
    } else {
      console.log(`  ${Ticker}: ${polluted}/${total} polluted rows would be deleted + re-synced`)
    }
    deletedTotal += polluted
  }

  console.log(apply ? `Done — ${deletedTotal} polluted rows removed and series rewritten.` : `Dry run — ${deletedTotal} polluted rows identified. Pass --apply to fix.`)
  process.exit(0)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(2)
})
