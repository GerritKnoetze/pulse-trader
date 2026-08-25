/**
 * Volume overlay — raw per-bar volume from the data feed. No computation is
 * needed: the volume histogram just consumes each bar's `volume` field.
 */

export interface VolumeInput {
  volume?: number
}

export function volumesOf(bars: VolumeInput[]): number[] {
  return bars.map(b => (b.volume && b.volume > 0 ? b.volume : 0))
}

export function maxVolume(bars: VolumeInput[]): number {
  let max = 0
  for (const b of bars) if (b.volume && b.volume > max) max = b.volume
  return max
}
